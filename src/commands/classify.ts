import { readConfig } from "../core/config.js";
import { parseFrontmatter, stringifyFrontmatter } from "../core/parser.js";
import { createPiProposalRunner, ensurePiProposalRuntimeAvailable } from "../core/proposal-agent.js";
import { CardStore } from "../core/store.js";
import {
  buildProposalId,
  computeProposalIdempotencyKey,
  ensureProposalAgentAvailable,
  isGeneratedArtifact,
  OrganizationProposal,
  OrganizationStore,
  ProposalAgentConfigError,
  ProposalKind,
  proposalTargetPathToSlug,
  resolveOrganizationFields,
  resolveProposalAgentConfig,
  toProposalTargetPath,
  type ProposalAgentConfig,
} from "../core/organization.js";

export type ClassifyEventType = "manual" | "post-write" | "post-import" | "post-retro" | "organize";

export interface ClassifyOptions {
  memexHome: string;
  slug?: string;
  since?: string;
  dryRun?: boolean;
  applySafe?: boolean;
  explain?: boolean;
  eventType?: ClassifyEventType;
  recentLimit?: number;
  runner?: ProposalRunner;
}

export interface ClassifyResult {
  success: boolean;
  output: string;
  proposalsCreated: number;
  proposalsSkipped: number;
  errors: string[];
}

export interface ProposalRunnerInput {
  agent: ProposalAgentConfig;
  card: {
    slug: string;
    path: string;
    content: string;
    data: Record<string, unknown>;
  };
  rules: Awaited<ReturnType<OrganizationStore["readRules"]>>;
  existingProposals: OrganizationProposal[];
  sourceEvent: ClassifyEventType;
}

export type ProposalRunner = (input: ProposalRunnerInput) => Promise<{
  proposals: Array<{
    kind: ProposalKind;
    confidence: number;
    rationale: string;
    evidence: string[];
    payload?: Record<string, unknown>;
    autoSafe?: boolean;
  }>;
}>;

export async function classifyCommand(store: CardStore, options: ClassifyOptions): Promise<ClassifyResult> {
  const eventType = options.eventType ?? "manual";
  const config = await readConfig(options.memexHome);

  let agent: ProposalAgentConfig;
  try {
    agent = resolveProposalAgentConfig(config);
    ensureProposalAgentAvailable(agent);
    await ensurePiProposalRuntimeAvailable(agent);
  } catch (error) {
    if (error instanceof ProposalAgentConfigError) {
      return {
        success: false,
        output: error.message,
        proposalsCreated: 0,
        proposalsSkipped: 0,
        errors: [error.code],
      };
    }
    return {
      success: false,
      output: String((error as Error).message || error),
      proposalsCreated: 0,
      proposalsSkipped: 0,
      errors: ["UNKNOWN"],
    };
  }

  const orgStore = new OrganizationStore(options.memexHome);
  const rules = await orgStore.readRules();
  const allExisting = await orgStore.listProposals();
  const targets = await resolveTargetCards(store, options);

  const runProposal = options.runner ?? createPiProposalRunner();
  let proposalsCreated = 0;
  let proposalsSkipped = 0;
  const lines: string[] = [];

  for (const target of targets) {
    const raw = await store.readCard(target.slug);
    const { data, content } = parseFrontmatter(raw);

    if (isGeneratedArtifact(target.slug, data)) {
      proposalsSkipped += 1;
      lines.push(`- ${target.slug}: skipped generated artifact`);
      continue;
    }

    let result: Awaited<ReturnType<ProposalRunner>>;
    try {
      result = await runProposal({
        agent,
        card: {
          slug: target.slug,
          path: target.targetPath,
          content,
          data,
        },
        rules,
        existingProposals: allExisting,
        sourceEvent: eventType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: message,
        proposalsCreated,
        proposalsSkipped,
        errors: [error instanceof ProposalAgentConfigError ? error.code : "UNKNOWN"],
      };
    }

    if (result.proposals.length === 0) {
      lines.push(`- ${target.slug}: no proposals`);
      continue;
    }

    for (const proposal of result.proposals) {
      const idempotencyKey = computeProposalIdempotencyKey(target.targetPath, `${eventType}:${proposal.kind}`, `${content}\n${JSON.stringify(proposal.payload || {})}`);
      const id = buildProposalId(idempotencyKey, proposal.kind);

      const record: OrganizationProposal = {
        id,
        kind: proposal.kind,
        targetPath: target.targetPath,
        confidence: normalizeConfidence(proposal.confidence),
        rationale: proposal.rationale,
        evidence: proposal.evidence,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceEvent: eventType,
        idempotencyKey,
        payload: proposal.payload,
        autoSafe: proposal.autoSafe,
      };

      if (!options.dryRun) {
        const upsert = await orgStore.upsertProposal(record);
        if (upsert.written) {
          proposalsCreated += 1;
          allExisting.push(record);
        } else {
          proposalsSkipped += 1;
        }
      } else {
        proposalsCreated += 1;
      }

      if (options.applySafe && record.autoSafe && record.kind === "classify" && record.confidence >= 0.9) {
        const resolution = resolveOrganizationFields(target.targetPath, data, rules, [...allExisting, record]);
        let mutated = false;
        if (resolution.type && data.type !== resolution.type) {
          data.type = resolution.type;
          mutated = true;
        }
        if (resolution.project && data.project !== resolution.project) {
          data.project = resolution.project;
          mutated = true;
        }
        if (resolution.package && data.package !== resolution.package) {
          data.package = resolution.package;
          mutated = true;
        }
        if (resolution.domain && data.domain !== resolution.domain) {
          data.domain = resolution.domain;
          mutated = true;
        }

        if (mutated && !options.dryRun) {
          const output = stringifyFrontmatter(content, data);
          await store.writeCard(target.slug, output);
        }
      }

      if (options.explain) {
        lines.push(`- ${target.slug}: ${record.kind} (${record.confidence.toFixed(2)}) -> ${record.rationale}`);
      }
    }

    if (!options.explain) {
      lines.push(`- ${target.slug}: ${result.proposals.length} proposal(s)`);
    }
  }

  const mode = options.dryRun ? "dry-run" : "apply";
  const summary = `classify (${mode}) processed ${targets.length} card(s): created=${proposalsCreated} skipped=${proposalsSkipped}`;
  return {
    success: true,
    output: [summary, ...lines].join("\n"),
    proposalsCreated,
    proposalsSkipped,
    errors: [],
  };
}

export async function classifyRecentCommand(store: CardStore, options: ClassifyOptions): Promise<ClassifyResult> {
  return classifyCommand(store, {
    ...options,
    since: options.since,
  });
}

export function isAutoClassifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.MEMEX_AUTO_CLASSIFY || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function classifySlugsForEvent(
  store: CardStore,
  memexHome: string,
  slugs: string[],
  eventType: Exclude<ClassifyEventType, "manual">,
  runner?: ProposalRunner,
): Promise<ClassifyResult> {
  const unique = [...new Set(slugs)].sort();
  let created = 0;
  let skipped = 0;
  const lines: string[] = [];

  for (const slug of unique) {
    const result = await classifyCommand(store, {
      memexHome,
      slug,
      eventType,
      runner,
      explain: false,
      dryRun: false,
    });

    if (!result.success) return result;
    created += result.proposalsCreated;
    skipped += result.proposalsSkipped;
    lines.push(...result.output.split("\n").slice(1));
  }

  return {
    success: true,
    output: [`classify (${eventType}) processed ${unique.length} card(s): created=${created} skipped=${skipped}`, ...lines].join("\n"),
    proposalsCreated: created,
    proposalsSkipped: skipped,
    errors: [],
  };
}

async function resolveTargetCards(store: CardStore, options: ClassifyOptions): Promise<Array<{ slug: string; path: string; targetPath: string }>> {
  const scanned = await store.scanAll();
  const withTargets = scanned.map((card) => ({
    ...card,
    targetPath: toProposalTargetPath(store.cardsDir, card.path),
  }));

  if (options.slug) {
    return withTargets.filter((card) => card.slug === options.slug);
  }

  if (!options.since) {
    const limit = options.recentLimit && options.recentLimit > 0 ? options.recentLimit : undefined;
    const base = withTargets.sort((a, b) => a.slug.localeCompare(b.slug));
    return limit ? base.slice(0, limit) : base;
  }

  const filtered: Array<{ slug: string; path: string; targetPath: string }> = [];
  for (const card of withTargets) {
    const raw = await store.readCard(card.slug);
    const { data } = parseFrontmatter(raw);
    const modified = normalizeDate(data.modified) ?? normalizeDate(data.created);
    if (!modified || modified >= options.since) filtered.push(card);
  }

  return filtered.sort((a, b) => a.slug.localeCompare(b.slug));
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.trim().length > 0) return value.slice(0, 10);
  return null;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function targetPathToSlug(targetPath: string): string | null {
  return proposalTargetPathToSlug(targetPath);
}
