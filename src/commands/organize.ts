import { readFile } from "node:fs/promises";
import { CardStore } from "../core/store.js";
import { parseFrontmatter, extractLinks, stringifyFrontmatter } from "../core/parser.js";
import { formatLinkStats } from "../core/formatter.js";
import {
  OrganizationStore,
  proposalTargetPathToSlug,
  resolveOrganizationFields,
  type OrganizationProposal,
  type RoutingRule,
} from "../core/organization.js";
import { buildIndexCommand } from "./rebuild-index.js";

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val || "");
}

interface OrganizeResult {
  output: string;
  exitCode: number;
}

type CardInfo = {
  title: string;
  modified: string;
  status: string;
  content: string;
  source: string;
  generated: string;
  type: string;
  isGeneratedNavigationIndex: boolean;
};

const NAV_INDEX_GENERATED = "navigation-index";
const ORGANIZE_SOURCE = "organize";

export async function organizeCommand(
  store: CardStore,
  lastOrganize: string | null,
  options: { memexHome?: string } = {},
): Promise<OrganizeResult> {
  const cards = await store.scanAll();
  if (cards.length === 0) return { output: "No cards yet.", exitCode: 0 };

  // Build link graph
  const outboundMap = new Map<string, string[]>();
  const inboundMap = new Map<string, string[]>();
  const cardData = new Map<string, CardInfo>();

  for (const card of cards) {
    inboundMap.set(card.slug, []);
  }

  for (const card of cards) {
    const raw = await readFile(card.path, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const source = String(data.source || "");
    const generated = String(data.generated || "");
    const type = String(data.type || "").trim().toLowerCase();

    outboundMap.set(card.slug, links);
    cardData.set(card.slug, {
      title: String(data.title || card.slug),
      modified: toDateString(data.modified || ""),
      status: String(data.status || ""),
      content: content.trim(),
      source,
      generated,
      type,
      isGeneratedNavigationIndex: source === ORGANIZE_SOURCE && generated === NAV_INDEX_GENERATED,
    });

    for (const link of links) {
      const existing = inboundMap.get(link) || [];
      existing.push(card.slug);
      inboundMap.set(link, existing);
    }
  }

  const isExcludedFromNoise = (slug: string): boolean => {
    if (slug === "index") return true;
    const info = cardData.get(slug);
    if (!info) return false;
    if (info.isGeneratedNavigationIndex) return true;
    if (info.type === "redirect") return true;
    return false;
  };

  // Link stats
  const stats = cards.map((card) => ({
    slug: card.slug,
    outbound: (outboundMap.get(card.slug) || []).length,
    inbound: (inboundMap.get(card.slug) || []).length,
  }));

  const sections: string[] = [];
  sections.push("# Organize Report\n");
  sections.push("## Link Stats\n" + formatLinkStats(stats));

  // Orphans
  const orphans = stats.filter((s) => s.inbound === 0 && !isExcludedFromNoise(s.slug));
  if (orphans.length > 0) {
    sections.push(
      "## Orphans (no inbound links)\n" +
      orphans.map((o) => `- ${o.slug} — ${cardData.get(o.slug)?.title}`).join("\n"),
    );
  }

  // Hubs
  const hubs = stats.filter((s) => s.inbound >= 10 && !isExcludedFromNoise(s.slug));
  if (hubs.length > 0) {
    sections.push(
      "## Hubs (≥10 inbound links)\n" +
      hubs.map((h) => `- ${h.slug} (${h.inbound} inbound) — ${cardData.get(h.slug)?.title}`).join("\n"),
    );
  }

  // Conflict cards (collected from first pass, no extra reads)
  const conflicts: string[] = [];
  for (const card of cards) {
    if (cardData.get(card.slug)?.status === "conflict") {
      conflicts.push(card.slug);
    }
  }
  if (conflicts.length > 0) {
    sections.push(
      "## Unresolved Conflicts\n" +
      conflicts.map((slug) => `- ${slug} — ${cardData.get(slug)?.title}`).join("\n"),
    );
  }

  // Recently modified cards + neighbors
  const recentCards: string[] = [];
  if (lastOrganize) {
    for (const card of cards) {
      if (isExcludedFromNoise(card.slug)) continue;
      const info = cardData.get(card.slug);
      // Include cards with no date (conservative: better to over-check than miss)
      if (info && (!info.modified || info.modified >= lastOrganize)) {
        recentCards.push(card.slug);
      }
    }
  } else {
    // First run: all cards are "recent"
    for (const card of cards) {
      if (!isExcludedFromNoise(card.slug)) {
        recentCards.push(card.slug);
      }
    }
  }

  if (recentCards.length > 0) {
    const pairSections: string[] = [];
    const seen = new Set<string>();

    for (const slug of recentCards) {
      const info = cardData.get(slug);
      if (!info) continue;

      const neighbors = outboundMap.get(slug) || [];
      for (const neighbor of neighbors) {
        if (isExcludedFromNoise(neighbor)) continue;

        const neighborInfo = cardData.get(neighbor);
        if (!neighborInfo) continue;

        // Create a stable pair key to avoid duplicates
        const pairKey = [slug, neighbor].sort().join("↔");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        // Only include content excerpts (first 300 chars) to keep output manageable
        const excerpt1 = info.content.slice(0, 300);
        const excerpt2 = neighborInfo.content.slice(0, 300);

        pairSections.push(
          `### ${slug} ↔ ${neighbor}\n` +
          `**${slug}** (${info.title}):\n${excerpt1}\n\n` +
          `**${neighbor}** (${neighborInfo.title}):\n${excerpt2}`,
        );
      }
    }

    if (pairSections.length > 0) {
      // Cap at 20 pairs to avoid overwhelming output
      const capped = pairSections.slice(0, 20);
      sections.push(
        "## Recently Modified Cards + Neighbors (check for contradictions)\n" +
        capped.join("\n\n") +
        (pairSections.length > 20
          ? `\n\n... and ${pairSections.length - 20} more pairs not shown. Run with a recent \`since\` date for targeted checks.`
          : ""),
      );
    }
  }

  let proposalApplied = 0;
  let proposalPending = 0;

  if (options.memexHome) {
    const orgStore = new OrganizationStore(options.memexHome);
    const proposals = await orgStore.listProposals();
    let rules = await orgStore.readRules();

    const actionable = proposals.filter((proposal) =>
      proposal.status === "approved"
      || (proposal.status === "pending" && proposal.autoSafe === true),
    );

    for (const proposal of actionable) {
      if (proposal.confidence < 0.9) {
        proposalPending += 1;
        continue;
      }

      if (proposal.kind === "classify") {
        const slug = proposalTargetPathToSlug(proposal.targetPath);
        if (!slug) {
          proposalPending += 1;
          continue;
        }

        try {
          const raw = await store.readCard(slug);
          const { data, content } = parseFrontmatter(raw);
          const resolution = resolveOrganizationFields(proposal.targetPath, data, rules, [proposal]);

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

          if (mutated) {
            await store.writeCard(slug, stringifyFrontmatter(content, data));
            await orgStore.updateProposalStatus(proposal.id, "applied");
            proposalApplied += 1;
          } else {
            proposalPending += 1;
          }
        } catch {
          proposalPending += 1;
        }
        continue;
      }

      if (proposal.kind === "route") {
        const routeMutation = applyRouteRuleMutation(rules, proposal);
        if (!routeMutation.mutated) {
          proposalPending += 1;
          continue;
        }

        rules = routeMutation.rules;
        await orgStore.writeRules(rules);
        await orgStore.updateProposalStatus(proposal.id, "applied");
        proposalApplied += 1;
        continue;
      }

      proposalPending += 1;
    }
  }

  const indexResult = await buildIndexCommand(store, { memexHome: options.memexHome });
  const indexLines: string[] = [
    `- mode: ${indexResult.nested ? "nested" : "flat"}`,
    `- created: ${indexResult.created.length}`,
    `- updated: ${indexResult.updated.length}`,
    `- unchanged: ${indexResult.unchanged.length}`,
    `- skipped: ${indexResult.skipped.length}`,
    `- mixed-mode artifacts: ${indexResult.mixedModeArtifacts.length}`,
  ];

  if (indexResult.skipped.length > 0) {
    indexLines.push("", "### Skipped");
    indexLines.push(...indexResult.skipped.map((item) => `- ${item.slug} — ${item.reason}`));
  }

  if (indexResult.mixedModeArtifacts.length > 0) {
    indexLines.push("", "### Mixed-mode Artifacts");
    indexLines.push(...indexResult.mixedModeArtifacts.map((slug) => `- ${slug}`));
  }

  sections.push("## Index Rebuild\n" + indexLines.join("\n"));

  if (options.memexHome) {
    sections.push("## Proposal Reconciliation\n" + [`- applied: ${proposalApplied}`, `- pending: ${proposalPending}`].join("\n"));
  }

  return { output: sections.join("\n\n"), exitCode: 0 };
}

function applyRouteRuleMutation(
  currentRules: RoutingRule[],
  proposal: OrganizationProposal,
): { mutated: boolean; rules: RoutingRule[] } {
  const candidate = buildRouteRuleFromProposal(proposal);
  if (!candidate) return { mutated: false, rules: currentRules };

  const existingById = currentRules.find((rule) => rule.id === candidate.id);
  if (existingById) {
    const updated: RoutingRule = {
      ...existingById,
      matchPathPrefix: candidate.matchPathPrefix,
      type: candidate.type,
      project: candidate.project,
      package: candidate.package,
      domain: candidate.domain,
      updatedAt: candidate.updatedAt,
    };

    if (sameRuleShape(existingById, updated)) {
      return { mutated: false, rules: currentRules };
    }

    return {
      mutated: true,
      rules: currentRules.map((rule) => (rule.id === candidate.id ? updated : rule)),
    };
  }

  const equivalentRule = currentRules.find((rule) => sameRuleShape(rule, candidate));
  if (equivalentRule) {
    return { mutated: false, rules: currentRules };
  }

  return {
    mutated: true,
    rules: [...currentRules, candidate],
  };
}

function buildRouteRuleFromProposal(proposal: OrganizationProposal): RoutingRule | null {
  const payload = proposal.payload;
  if (!isRecord(payload)) return null;

  const matchPathPrefix = asNonEmptyString(payload.matchPathPrefix);
  if (!matchPathPrefix) return null;

  const type = asNonEmptyString(payload.type);
  const project = asNonEmptyString(payload.project);
  const pkg = asNonEmptyString(payload.package);
  const domain = asNonEmptyString(payload.domain);

  if (!type && !project && !pkg && !domain) return null;

  const now = new Date().toISOString();
  const id = asNonEmptyString(payload.ruleId) ?? `proposal-route-${proposal.id}`;

  return {
    id,
    matchPathPrefix,
    type,
    project,
    package: pkg,
    domain,
    createdAt: now,
    updatedAt: now,
  };
}

function sameRuleShape(a: RoutingRule, b: RoutingRule): boolean {
  return (
    a.id === b.id
    && a.matchPathPrefix === b.matchPathPrefix
    && a.type === b.type
    && a.project === b.project
    && a.package === b.package
    && a.domain === b.domain
  );
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

