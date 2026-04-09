import { parseFrontmatter } from "../core/parser.js";
import { CardStore } from "../core/store.js";
import {
  buildProposalId,
  computeProposalIdempotencyKey,
  OrganizationStore,
  toProposalTargetPath,
  type OrganizationProposal,
} from "../core/organization.js";

export interface MaintainOptions {
  memexHome: string;
  dryRun?: boolean;
  maxBodyLines?: number;
}

export interface MaintainResult {
  success: boolean;
  output: string;
  created: number;
  skipped: number;
}

export async function maintainCommand(store: CardStore, options: MaintainOptions): Promise<MaintainResult> {
  const orgStore = new OrganizationStore(options.memexHome);
  const cards = await store.scanAll();
  const proposals: OrganizationProposal[] = [];

  const titleToCards = new Map<string, string[]>();

  for (const card of cards) {
    const raw = await store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const title = String(data.title || card.slug).trim().toLowerCase();
    const targetPath = toProposalTargetPath(store.cardsDir, card.path);
    const list = titleToCards.get(title) ?? [];
    list.push(targetPath);
    titleToCards.set(title, list);

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

  return {
    success: true,
    output: `maintain ${options.dryRun ? "dry-run" : "apply"}: proposals=${proposals.length} created=${created} skipped=${skipped}`,
    created,
    skipped,
  };
}

function createProposal(
  targetPath: string,
  kind: "split-suggestion" | "moc-suggestion",
  input: { confidence: number; rationale: string; evidence: string[] },
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
    payload: {
      maintain: true,
    },
  };
}
