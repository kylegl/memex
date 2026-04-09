import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const PROPOSAL_AGENT_THINKING_VALUES = ["low", "medium", "high"] as const;

export type ProposalAgentThinking = typeof PROPOSAL_AGENT_THINKING_VALUES[number];

export interface ProposalAgentConfig {
  name: string;
  model: string;
  thinking: ProposalAgentThinking;
}

export type ProposalKind = "classify" | "route" | "related-link" | "moc-suggestion" | "split-suggestion";
export type ProposalStatus = "pending" | "approved" | "rejected" | "applied";

export interface OrganizationProposal {
  id: string;
  kind: ProposalKind;
  targetPath: string;
  confidence: number;
  rationale: string;
  evidence: string[];
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  sourceEvent: string;
  idempotencyKey: string;
  autoSafe?: boolean;
  payload?: Record<string, unknown>;
}

export interface RoutingRule {
  id: string;
  matchPathPrefix: string;
  type?: string;
  project?: string;
  package?: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationResolution {
  type?: string;
  project?: string;
  package?: string;
  domain?: string;
  evidence: string[];
}

export class ProposalAgentConfigError extends Error {
  constructor(
    public readonly code:
      | "MEMEX_AGENT_CONFIG_MISSING"
      | "MEMEX_MODEL_CONFIG_MISSING"
      | "MEMEX_AGENT_THINKING_INVALID"
      | "MEMEX_AGENT_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ProposalAgentConfigError";
  }
}

export class OrganizationStore {
  private readonly operationalDir: string;
  private readonly proposalsDir: string;
  private readonly rulesPath: string;

  constructor(private readonly memexHome: string) {
    this.operationalDir = join(memexHome, ".memex");
    this.proposalsDir = join(this.operationalDir, "proposals");
    this.rulesPath = join(this.operationalDir, "organization-rules.json");
  }

  async ensureReady(): Promise<void> {
    this.assertSafePath(this.operationalDir);
    this.assertSafePath(this.proposalsDir);
    this.assertSafePath(this.rulesPath);
    await mkdir(this.proposalsDir, { recursive: true });
  }

  async listProposals(): Promise<OrganizationProposal[]> {
    await this.ensureReady();
    let files: string[] = [];
    try {
      files = await readdir(this.proposalsDir);
    } catch {
      return [];
    }

    const proposals: OrganizationProposal[] = [];
    for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
      const fullPath = join(this.proposalsDir, file);
      this.assertSafePath(fullPath);
      try {
        const parsed = JSON.parse(await readFile(fullPath, "utf-8")) as Partial<OrganizationProposal>;
        if (isProposal(parsed)) proposals.push(parsed);
      } catch {
        // Ignore unreadable proposal records. Organization must remain best-effort.
      }
    }

    return proposals.sort((a, b) => a.id.localeCompare(b.id));
  }

  async writeProposal(proposal: OrganizationProposal): Promise<void> {
    await this.ensureReady();
    const targetPath = join(this.proposalsDir, `${proposal.id}.json`);
    this.assertSafePath(targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    const canonical = stableStringify(sortProposal(proposal));
    await writeFile(targetPath, `${canonical}\n`, "utf-8");
  }

  async upsertProposal(proposal: OrganizationProposal): Promise<{ written: boolean; existing?: OrganizationProposal }> {
    await this.ensureReady();
    const existing = await this.findByIdempotencyKey(proposal.idempotencyKey);
    if (existing) return { written: false, existing };
    await this.writeProposal(proposal);
    return { written: true };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OrganizationProposal | null> {
    const all = await this.listProposals();
    return all.find((p) => p.idempotencyKey === idempotencyKey) ?? null;
  }

  async getProposal(id: string): Promise<OrganizationProposal | null> {
    await this.ensureReady();
    const path = join(this.proposalsDir, `${id}.json`);
    this.assertSafePath(path);
    try {
      const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<OrganizationProposal>;
      return isProposal(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async updateProposalStatus(id: string, status: ProposalStatus): Promise<OrganizationProposal | null> {
    const existing = await this.getProposal(id);
    if (!existing) return null;
    const updated: OrganizationProposal = {
      ...existing,
      status,
      updatedAt: nowIso(),
    };
    await this.writeProposal(updated);
    return updated;
  }

  async readRules(): Promise<RoutingRule[]> {
    await this.ensureReady();
    this.assertSafePath(this.rulesPath);
    try {
      const parsed = JSON.parse(await readFile(this.rulesPath, "utf-8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => isRule(item)).sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  async writeRules(rules: RoutingRule[]): Promise<void> {
    await this.ensureReady();
    this.assertSafePath(this.rulesPath);
    const normalized = rules.filter((rule) => isRule(rule)).map(sortRule).sort((a, b) => a.id.localeCompare(b.id));
    await writeFile(this.rulesPath, `${stableStringify(normalized)}\n`, "utf-8");
  }

  private assertSafePath(targetPath: string): void {
    const resolved = resolve(targetPath);
    const root = resolve(this.memexHome);
    if (!resolved.startsWith(root + sep) && resolved !== root) {
      throw new Error("Invalid organization path: path escapes memex home");
    }
  }
}

export function resolveProposalAgentConfig(
  config: {
    memexProposalAgentName?: string;
    memexProposalAgentModel?: string;
    memexProposalAgentThinking?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ProposalAgentConfig {
  const name = firstNonEmpty(env.MEMEX_PROPOSAL_AGENT_NAME, config.memexProposalAgentName, "memex-proposal-agent");
  const model = firstNonEmpty(env.MEMEX_PROPOSAL_AGENT_MODEL, config.memexProposalAgentModel, "openai-codex/gpt-3-codex");
  const thinking = firstNonEmpty(env.MEMEX_PROPOSAL_AGENT_THINKING, config.memexProposalAgentThinking, "medium");

  if (!name) {
    throw new ProposalAgentConfigError(
      "MEMEX_AGENT_CONFIG_MISSING",
      "MEMEX_AGENT_CONFIG_MISSING: memex proposal agent name is missing (set MEMEX_PROPOSAL_AGENT_NAME or .memexrc memexProposalAgentName)",
    );
  }

  if (!model) {
    throw new ProposalAgentConfigError(
      "MEMEX_MODEL_CONFIG_MISSING",
      "MEMEX_MODEL_CONFIG_MISSING: memex proposal model is missing (set MEMEX_PROPOSAL_AGENT_MODEL or .memexrc memexProposalAgentModel)",
    );
  }

  if (!isThinking(thinking)) {
    throw new ProposalAgentConfigError(
      "MEMEX_AGENT_THINKING_INVALID",
      "MEMEX_AGENT_THINKING_INVALID: expected low|medium|high",
    );
  }

  return { name, model, thinking };
}

export function ensureProposalAgentAvailable(agent: ProposalAgentConfig): void {
  if (!agent.name.trim()) {
    throw new ProposalAgentConfigError("MEMEX_AGENT_CONFIG_MISSING", "MEMEX_AGENT_CONFIG_MISSING: empty agent name");
  }
  if (!agent.model.trim()) {
    throw new ProposalAgentConfigError("MEMEX_MODEL_CONFIG_MISSING", "MEMEX_MODEL_CONFIG_MISSING: empty model");
  }

  const state = String(process.env.MEMEX_PROPOSAL_AGENT_AVAILABLE || "").trim().toLowerCase();
  if (state === "0" || state === "false" || state === "no") {
    throw new ProposalAgentConfigError(
      "MEMEX_AGENT_UNAVAILABLE",
      `MEMEX_AGENT_UNAVAILABLE: configured proposal agent '${agent.name}' is not available in this runtime`,
    );
  }
}

export function computeProposalIdempotencyKey(targetPath: string, sourceEvent: string, content: string): string {
  return sha256(`${targetPath}::${sourceEvent}::${sha256(content)}`);
}

export function toProposalTargetPath(cardsDir: string, absolutePath: string): string {
  const cardsRoot = resolve(cardsDir);
  const cardPath = resolve(absolutePath);
  if (!cardPath.startsWith(cardsRoot + sep) && cardPath !== cardsRoot) {
    throw new Error("Invalid organization target path: path escapes cards directory");
  }
  const relativePath = cardPath.slice(cardsRoot.length).replace(/^[/\\]/, "");
  return `cards/${relativePath.replace(/\\/g, "/")}`;
}

export function proposalTargetPathToSlug(targetPath: string): string | null {
  const normalized = targetPath.replace(/\\/g, "/");
  if (!normalized.startsWith("cards/")) return null;
  return normalized.slice("cards/".length).replace(/\.md$/i, "");
}

export function buildProposalId(idempotencyKey: string, kind: ProposalKind): string {
  return `${kind}-${idempotencyKey.slice(0, 24)}`;
}

export function resolveOrganizationFields(
  targetPath: string,
  frontmatter: Record<string, unknown>,
  rules: RoutingRule[],
  proposals: OrganizationProposal[],
): OrganizationResolution {
  const evidence: string[] = [];

  const fromPath = inferFromPath(targetPath);
  const fromFrontmatter = {
    type: asString(frontmatter.type),
    project: asString(frontmatter.project),
    package: asString(frontmatter.package),
    domain: asString(frontmatter.domain),
  };

  const matchingRule = rules
    .slice()
    .sort((a, b) => b.matchPathPrefix.length - a.matchPathPrefix.length)
    .find((rule) => targetPath.startsWith(rule.matchPathPrefix));

  const approvedClassify = proposals
    .filter((proposal) => proposal.status === "approved" || (proposal.status === "pending" && proposal.autoSafe))
    .filter((proposal) => proposal.targetPath === targetPath)
    .filter((proposal) => proposal.kind === "classify" || proposal.kind === "route")
    .sort((a, b) => b.confidence - a.confidence)[0];

  const payload = approvedClassify?.payload || {};

  const type = pickFirst(
    [fromPath.type, "path"],
    [fromFrontmatter.type, "frontmatter"],
    [matchingRule?.type, "rule"],
    [asString(payload.type), "proposal"],
    [inferFallbackType(targetPath), "heuristic"],
  );

  const project = pickFirst(
    [fromPath.project, "path"],
    [fromFrontmatter.project, "frontmatter"],
    [matchingRule?.project, "rule"],
    [asString(payload.project), "proposal"],
    [inferFallbackProject(targetPath), "heuristic"],
  );

  const pkg = pickFirst(
    [fromPath.package, "path"],
    [fromFrontmatter.package, "frontmatter"],
    [matchingRule?.package, "rule"],
    [asString(payload.package), "proposal"],
    [inferFallbackPackage(targetPath), "heuristic"],
  );

  const domain = pickFirst(
    [fromPath.domain, "path"],
    [fromFrontmatter.domain, "frontmatter"],
    [matchingRule?.domain, "rule"],
    [asString(payload.domain), "proposal"],
    [inferFallbackDomain(targetPath), "heuristic"],
  );

  if (type.value) evidence.push(`type from ${type.source}`);
  if (project.value) evidence.push(`project from ${project.source}`);
  if (pkg.value) evidence.push(`package from ${pkg.source}`);
  if (domain.value) evidence.push(`domain from ${domain.source}`);

  return {
    type: type.value,
    project: project.value,
    package: pkg.value,
    domain: domain.value,
    evidence,
  };
}

export function isGeneratedArtifact(slug: string, data: Record<string, unknown>): boolean {
  const source = asString(data.source);
  const generated = asString(data.generated);
  if (generated) return true;
  if (slug === "index" || slug.endsWith("/index")) return true;
  if (source === "organize") return true;
  if (source === "memex-review" || source === "memex-maintain") return true;
  return false;
}

function inferFromPath(targetPath: string): Partial<OrganizationResolution> {
  const normalized = targetPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const cardSegments = segments[0] === "cards" ? segments.slice(1) : segments;

  const top = cardSegments[0];
  const recognizedRoots = new Set(["core", "notes", "project", "reference", "memex", "pi", "dawarich"]);

  if (!top || (cardSegments.length < 2 && !recognizedRoots.has(top))) {
    return {};
  }

  const type = recognizedRoots.has(top) ? top : undefined;
  const project = top === "project" ? cardSegments[1] : undefined;
  const domain = top === "core" ? cardSegments[1] : top === "notes" ? cardSegments[1] : undefined;

  const pkg = cardSegments.length >= 2 ? cardSegments[1] : undefined;

  return {
    type: sanitizeSegment(type),
    project: sanitizeSegment(project),
    package: sanitizeSegment(pkg),
    domain: sanitizeSegment(domain),
  };
}

function sanitizeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\.md$/i, "").replace(/[^a-zA-Z0-9._-]/g, "").trim();
  return cleaned || undefined;
}

function inferFallbackType(targetPath: string): string | undefined {
  if (targetPath.includes("/project/")) return "project";
  if (targetPath.includes("/notes/")) return "notes";
  if (targetPath.includes("/core/")) return "core";
  return undefined;
}

function inferFallbackProject(targetPath: string): string | undefined {
  const normalized = targetPath.replace(/\\/g, "/");
  const idx = normalized.indexOf("/project/");
  if (idx < 0) return undefined;
  const rest = normalized.slice(idx + "/project/".length);
  return sanitizeSegment(rest.split("/")[0]);
}

function inferFallbackPackage(targetPath: string): string | undefined {
  const normalized = targetPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const cards = segments[0] === "cards" ? segments.slice(1) : segments;
  return sanitizeSegment(cards[1]);
}

function inferFallbackDomain(targetPath: string): string | undefined {
  if (targetPath.includes("/core/system/")) return "system";
  if (targetPath.includes("/core/user/")) return "user";
  return undefined;
}

function pickFirst(...entries: Array<[string | undefined, string]>): { value?: string; source: string } {
  for (const [value, source] of entries) {
    if (value) return { value, source };
  }
  return { value: undefined, source: "none" };
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized.length > 0) return normalized;
  }
  return "";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isThinking(value: string): value is ProposalAgentThinking {
  return (PROPOSAL_AGENT_THINKING_VALUES as readonly string[]).includes(value);
}

function isProposal(value: unknown): value is OrganizationProposal {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string"
    && typeof obj.kind === "string"
    && typeof obj.targetPath === "string"
    && typeof obj.confidence === "number"
    && typeof obj.rationale === "string"
    && Array.isArray(obj.evidence)
    && typeof obj.status === "string"
    && typeof obj.createdAt === "string"
    && typeof obj.updatedAt === "string"
    && typeof obj.sourceEvent === "string"
    && typeof obj.idempotencyKey === "string"
  );
}

function isRule(value: unknown): value is RoutingRule {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string"
    && typeof obj.matchPathPrefix === "string"
    && typeof obj.createdAt === "string"
    && typeof obj.updatedAt === "string"
  );
}

function sortProposal(proposal: OrganizationProposal): OrganizationProposal {
  const sortedPayload = proposal.payload ? sortRecord(proposal.payload) : undefined;
  return {
    id: proposal.id,
    kind: proposal.kind,
    targetPath: proposal.targetPath,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    evidence: [...proposal.evidence],
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    sourceEvent: proposal.sourceEvent,
    idempotencyKey: proposal.idempotencyKey,
    autoSafe: proposal.autoSafe,
    payload: sortedPayload,
  };
}

function sortRule(rule: RoutingRule): RoutingRule {
  return {
    id: rule.id,
    matchPathPrefix: rule.matchPathPrefix,
    type: rule.type,
    project: rule.project,
    package: rule.package,
    domain: rule.domain,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function sortRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (Array.isArray(value)) {
      output[key] = value.map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return sortRecord(item as Record<string, unknown>);
        }
        return item;
      });
      continue;
    }
    if (value && typeof value === "object") {
      output[key] = sortRecord(value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}
