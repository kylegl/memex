import { parseFrontmatter, stringifyFrontmatter } from "../core/parser.js";
import { CardStore } from "../core/store.js";
import {
  buildProposalId,
  computeProposalIdempotencyKey,
  OrganizationStore,
  proposalTargetPathToSlug,
  toProposalTargetPath,
  type OrganizationProposal,
} from "../core/organization.js";

export interface MaintainOptions {
  memexHome: string;
  dryRun?: boolean;
  applySafe?: boolean;
  maxBodyLines?: number;
}

export interface MaintainResult {
  success: boolean;
  output: string;
  created: number;
  skipped: number;
  applied: number;
}

export async function maintainCommand(store: CardStore, options: MaintainOptions): Promise<MaintainResult> {
  const orgStore = new OrganizationStore(options.memexHome);
  const cards = await store.scanAll();
  const proposals: OrganizationProposal[] = [];

  const titleToCards = new Map<string, string[]>();
  const redirectCandidates = new Map<string, { data: Record<string, unknown>; content: string }>();

  for (const card of cards) {
    const raw = await store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const title = String(data.title || card.slug).trim().toLowerCase();
    const targetPath = toProposalTargetPath(store.cardsDir, card.path);
    const list = titleToCards.get(title) ?? [];
    list.push(targetPath);
    titleToCards.set(title, list);

    const relocation = detectLegacyRelocationStub(content);
    if (relocation && !isRedirectType(data.type)) {
      proposals.push(createProposal(targetPath, "classify", {
        confidence: 0.96,
        rationale: "Legacy relocation stub detected; classify as redirect",
        evidence: ["legacy-relocation-stub", `hint:${relocation.hint}`],
        payload: { type: "redirect" },
        autoSafe: true,
      }));

      redirectCandidates.set(targetPath, { data, content });
    }

    const lines = content.split("\n").length;
    const maxLines = options.maxBodyLines ?? 220;
    if (lines > maxLines) {
      proposals.push(createProposal(targetPath, "split-suggestion", {
        confidence: 0.65,
        rationale: `Body length ${lines} lines exceeds maintain threshold ${maxLines}`,
        evidence: [`line-count:${lines}`, `threshold:${maxLines}`],
      }));
    }
  }

  for (const [title, paths] of titleToCards) {
    if (!title || paths.length < 2) continue;
    const sorted = paths.slice().sort();
    for (let i = 1; i < sorted.length; i += 1) {
      proposals.push(createProposal(sorted[i], "moc-suggestion", {
        confidence: 0.55,
        rationale: `Potential duplicate title cluster detected for '${title}'`,
        evidence: sorted.map((path) => `cluster:${path}`),
      }));
    }
  }

  let created = 0;
  let skipped = 0;

  for (const proposal of proposals) {
    if (options.dryRun) {
      created += 1;
      continue;
    }

    const result = await orgStore.upsertProposal(proposal);
    if (result.written) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  let applied = 0;
  if (!options.dryRun && options.applySafe) {
    for (const proposal of proposals) {
      if (!isSafeRedirectClassify(proposal)) continue;
      const slug = proposalTargetPathToSlug(proposal.targetPath);
      if (!slug) continue;

      const candidate = redirectCandidates.get(proposal.targetPath);
      if (!candidate) continue;
      if (isRedirectType(candidate.data.type)) continue;

      candidate.data.type = "redirect";
      const updated = stringifyFrontmatter(candidate.content, candidate.data);
      await store.writeCard(slug, updated);
      applied += 1;
    }
  }

  return {
    success: true,
    output: `maintain ${options.dryRun ? "dry-run" : "apply"}: proposals=${proposals.length} created=${created} skipped=${skipped} applied=${applied}`,
    created,
    skipped,
    applied,
  };
}

function createProposal(
  targetPath: string,
  kind: "classify" | "split-suggestion" | "moc-suggestion",
  input: {
    confidence: number;
    rationale: string;
    evidence: string[];
    payload?: Record<string, unknown>;
    autoSafe?: boolean;
  },
): OrganizationProposal {
  const idempotencyKey = computeProposalIdempotencyKey(targetPath, `maintain:${kind}`, input.evidence.join("|"));
  const now = new Date().toISOString();

  return {
    id: buildProposalId(idempotencyKey, kind),
    kind,
    targetPath,
    confidence: input.confidence,
    rationale: input.rationale,
    evidence: input.evidence,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    sourceEvent: "maintain",
    idempotencyKey,
    autoSafe: input.autoSafe,
    payload: {
      maintain: true,
      ...(input.payload ?? {}),
    },
  };
}

function detectLegacyRelocationStub(content: string): { hint: string } | null {
  const nonEmptyLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length === 0) return null;
  if (nonEmptyLines.length > 2) return null;

  const first = nonEmptyLines[0];
  if (!/^relocated to\b/i.test(first)) return null;

  return { hint: first.slice(0, 120) };
}

function isRedirectType(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "redirect";
}

function isSafeRedirectClassify(proposal: OrganizationProposal): boolean {
  if (proposal.kind !== "classify") return false;
  if (proposal.confidence < 0.9) return false;
  if (!proposal.autoSafe) return false;
  return proposal.payload?.type === "redirect";
}
