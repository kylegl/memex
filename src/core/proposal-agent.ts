import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ProposalRunner } from "../commands/classify.js";
import { ProposalAgentConfigError, type ProposalKind, type ProposalAgentConfig } from "./organization.js";

const execFile = promisify(execFileCb);

const BASELINE_PROMPT = [
  "You are Memex Proposal Agent. Your only job is to generate bounded organization proposals for Memex. Markdown cards remain canonical; you never mutate files directly.",
  "",
  "Return structured JSON proposals only. Do not return freeform prose.",
  "",
  "Allowed proposal kinds: classify, route, related-link, moc-suggestion, split-suggestion.",
  "",
  "Never perform direct mutations: no file moves, no title rewrites, no body rewrites, no archive/delete actions.",
  "",
  "Evidence precedence when reasoning: (1) explicit path, (2) explicit frontmatter, (3) accepted routing rules, (4) approved/safe proposal history, (5) fallback heuristics.",
  "",
  "Every proposal must include: target path, kind, confidence (0..1), rationale, and evidence bullets.",
  "",
  "If context is insufficient or ambiguous, return fewer proposals with lower confidence and explain uncertainty.",
  "",
  "If required context is missing, return a structured error object instead of inventing output.",
].join("\n");

export function createPiProposalRunner(env: NodeJS.ProcessEnv = process.env): ProposalRunner {
  return async (input) => {
    const executable = (env.MEMEX_PI_BIN || "pi").trim();
    const model = formatModel(input.agent);
    const prompt = buildPrompt(input);

    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await execFile(
        executable,
        [
          "--print",
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--model",
          model,
          "--append-system-prompt",
          BASELINE_PROMPT,
          prompt,
        ],
        {
          env,
          maxBuffer: 1024 * 1024,
        },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProposalAgentConfigError(
        "MEMEX_AGENT_UNAVAILABLE",
        `MEMEX_AGENT_UNAVAILABLE: failed to execute Pi proposal agent '${input.agent.name}' with model '${input.agent.model}': ${message}`,
      );
    }

    const output = String(stdout || "").trim();
    if (!output) {
      throw new ProposalAgentConfigError(
        "MEMEX_AGENT_UNAVAILABLE",
        `MEMEX_AGENT_UNAVAILABLE: Pi proposal agent '${input.agent.name}' returned empty output${stderr ? ` (${stderr.trim()})` : ""}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new ProposalAgentConfigError(
        "MEMEX_AGENT_UNAVAILABLE",
        `MEMEX_AGENT_UNAVAILABLE: Pi proposal agent '${input.agent.name}' returned non-JSON output`,
      );
    }

    if (isErrorEnvelope(parsed)) {
      throw new ProposalAgentConfigError(
        "MEMEX_AGENT_UNAVAILABLE",
        `MEMEX_AGENT_UNAVAILABLE: ${parsed.error}`,
      );
    }

    const proposals = extractProposals(parsed);
    return { proposals };
  };
}

export async function ensurePiProposalRuntimeAvailable(
  agent: ProposalAgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const executable = (env.MEMEX_PI_BIN || "pi").trim();
  try {
    await execFile(executable, ["--version"], { env, maxBuffer: 128 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProposalAgentConfigError(
      "MEMEX_AGENT_UNAVAILABLE",
      `MEMEX_AGENT_UNAVAILABLE: unable to resolve configured proposal agent '${agent.name}' with model '${agent.model}' because Pi runtime '${executable}' is unavailable (${message})`,
    );
  }
}

function formatModel(agent: ProposalAgentConfig): string {
  return `${agent.model}:${agent.thinking}`;
}

function buildPrompt(input: Parameters<ProposalRunner>[0]): string {
  return JSON.stringify(
    {
      agentName: input.agent.name,
      instruction: "Return JSON only with either { proposals: [...] } or { error: string }.",
      card: {
        slug: input.card.slug,
        path: input.card.path,
        frontmatter: input.card.data,
        content: input.card.content,
      },
      rules: input.rules,
      existingProposals: input.existingProposals,
      sourceEvent: input.sourceEvent,
    },
    null,
    2,
  );
}

function isErrorEnvelope(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string";
}

function extractProposals(value: unknown): Array<{
  kind: ProposalKind;
  confidence: number;
  rationale: string;
  evidence: string[];
  payload?: Record<string, unknown>;
  autoSafe?: boolean;
}> {
  if (!value || typeof value !== "object") return [];

  const proposals = (value as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return [];

  return proposals
    .map((proposal) => normalizeProposal(proposal))
    .filter((proposal): proposal is NonNullable<typeof proposal> => proposal !== null);
}

function normalizeProposal(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  const confidence = typeof obj.confidence === "number" ? obj.confidence : Number(obj.confidence ?? 0);
  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!isProposalKind(kind) || !rationale) return null;

  return {
    kind,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    rationale,
    evidence,
    payload: isPlainRecord(obj.payload) ? obj.payload : undefined,
    autoSafe: obj.autoSafe === true,
  };
}

function isProposalKind(value: string): value is ProposalKind {
  return value === "classify" || value === "route" || value === "related-link" || value === "moc-suggestion" || value === "split-suggestion";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
