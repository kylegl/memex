import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export const INGEST_AGENT_THINKING_VALUES = ["low", "medium", "high"] as const;

export type IngestAgentThinking = typeof INGEST_AGENT_THINKING_VALUES[number];

export type IngestMediaType = "research-paper" | "article" | "youtube-video" | "web-page";

export interface IngestAgentConfig {
  name: string;
  model: string;
  thinking: IngestAgentThinking;
}

export interface IngestClassifyInput {
  url: string;
  detectedByHeuristic: IngestMediaType;
  contentType: string;
  host: string;
  title: string;
  description: string;
  abstractText: string;
  excerpt: string;
}

export interface IngestClassifyOutput {
  mediaType: IngestMediaType;
  rationale?: string;
  rawDataPlan?: string;
  rawDataHints?: string[];
}

export interface IngestSynthesizeInput {
  url: string;
  mediaType: IngestMediaType;
  classifyRationale?: string;
  rawData: {
    finalUrl: string;
    host: string;
    contentType: string;
    title: string;
    description: string;
    abstractText: string;
    firstParagraph: string;
    excerpt: string;
  };
}

export interface IngestSynthesizeOutput {
  mediaType?: IngestMediaType;
  title?: string;
  summary?: string;
  keyPoints?: string[];
  tags?: string[];
  category?: string;
  authors?: string[];
  published?: string;
  doi?: string;
  arxivId?: string;
  rawDataNotes?: string;
}

export interface IngestAgentWorkflow {
  classifyMedia(input: IngestClassifyInput): Promise<IngestClassifyOutput>;
  synthesizeIngestion(input: IngestSynthesizeInput): Promise<IngestSynthesizeOutput>;
}

export class IngestAgentConfigError extends Error {
  constructor(
    public readonly code:
      | "MEMEX_AGENT_CONFIG_MISSING"
      | "MEMEX_MODEL_CONFIG_MISSING"
      | "MEMEX_AGENT_THINKING_INVALID"
      | "MEMEX_AGENT_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "IngestAgentConfigError";
  }
}

const CLASSIFY_SYSTEM_PROMPT = [
  "You are Memex URL Ingest Classifier.",
  "",
  "You MUST output JSON only (no prose, no markdown).",
  "",
  "Task:",
  "1) Determine the most likely media type for this URL.",
  "2) Propose how raw data should be interpreted for ingestion.",
  "",
  "Allowed mediaType values:",
  "- research-paper",
  "- article",
  "- youtube-video",
  "- web-page",
  "",
  "Return shape:",
  "{",
  '  "mediaType": "research-paper|article|youtube-video|web-page",',
  '  "rationale": "short reason",',
  '  "rawDataPlan": "how raw data should be used",',
  '  "rawDataHints": ["optional hint", "optional hint"]',
  "}",
  "",
  "If uncertain, return the closest mediaType and explain uncertainty in rationale.",
].join("\n");

const SYNTHESIZE_SYSTEM_PROMPT = [
  "You are Memex URL Ingest Synthesizer.",
  "",
  "You MUST output JSON only (no prose, no markdown).",
  "",
  "Task:",
  "- Use the provided mediaType + raw data snapshot to produce a high-quality ingestion payload.",
  "- Keep summaries concise and factual.",
  "- Return 3-6 keyPoints as atomic bullets.",
  "",
  "Return shape:",
  "{",
  '  "mediaType": "optional override",',
  '  "title": "string",',
  '  "summary": "string",',
  '  "keyPoints": ["point 1", "point 2"],',
  '  "tags": ["tag"],',
  '  "category": "research|reference|...",',
  '  "authors": ["optional author"],',
  '  "published": "optional date",',
  '  "doi": "optional doi",',
  '  "arxivId": "optional id",',
  '  "rawDataNotes": "optional ingestion note"',
  "}",
  "",
  "Do not invent fields that are not inferable from input.",
].join("\n");

export function resolveIngestAgentConfig(
  config: {
    memexIngestAgentName?: string;
    memexIngestAgentModel?: string;
    memexIngestAgentThinking?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): IngestAgentConfig {
  const name = firstNonEmpty(env.MEMEX_INGEST_AGENT_NAME, config.memexIngestAgentName, "memex-ingest-agent");
  const model = firstNonEmpty(env.MEMEX_INGEST_AGENT_MODEL, config.memexIngestAgentModel, "openai-codex/gpt-3-codex");
  const thinking = firstNonEmpty(env.MEMEX_INGEST_AGENT_THINKING, config.memexIngestAgentThinking, "medium");

  if (!name) {
    throw new IngestAgentConfigError(
      "MEMEX_AGENT_CONFIG_MISSING",
      "MEMEX_AGENT_CONFIG_MISSING: memex ingest agent name is missing (set MEMEX_INGEST_AGENT_NAME or .memexrc memexIngestAgentName)",
    );
  }

  if (!model) {
    throw new IngestAgentConfigError(
      "MEMEX_MODEL_CONFIG_MISSING",
      "MEMEX_MODEL_CONFIG_MISSING: memex ingest model is missing (set MEMEX_INGEST_AGENT_MODEL or .memexrc memexIngestAgentModel)",
    );
  }

  if (!isThinking(thinking)) {
    throw new IngestAgentConfigError(
      "MEMEX_AGENT_THINKING_INVALID",
      "MEMEX_AGENT_THINKING_INVALID: expected low|medium|high",
    );
  }

  return { name, model, thinking };
}

export async function ensurePiIngestRuntimeAvailable(
  agent: IngestAgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const executable = (env.MEMEX_PI_BIN || "pi").trim();
  try {
    await execFile(executable, ["--version"], { env, maxBuffer: 128 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IngestAgentConfigError(
      "MEMEX_AGENT_UNAVAILABLE",
      `MEMEX_AGENT_UNAVAILABLE: unable to resolve ingest agent '${agent.name}' with model '${agent.model}' because Pi runtime '${executable}' is unavailable (${message})`,
    );
  }
}

export function createPiIngestWorkflow(
  agent: IngestAgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): IngestAgentWorkflow {
  return {
    async classifyMedia(input) {
      const payload = {
        instruction: "Return JSON only.",
        input,
      };
      const response = await runPiJson(agent, CLASSIFY_SYSTEM_PROMPT, payload, env);

      if (isErrorEnvelope(response)) {
        throw new IngestAgentConfigError("MEMEX_AGENT_UNAVAILABLE", `MEMEX_AGENT_UNAVAILABLE: ${response.error}`);
      }

      const mediaType = normalizeMediaType((response as Record<string, unknown>).mediaType) ?? input.detectedByHeuristic;

      return {
        mediaType,
        rationale: asShortString((response as Record<string, unknown>).rationale),
        rawDataPlan: asShortString((response as Record<string, unknown>).rawDataPlan),
        rawDataHints: asStringArray((response as Record<string, unknown>).rawDataHints, 6),
      };
    },

    async synthesizeIngestion(input) {
      const payload = {
        instruction: "Return JSON only.",
        input,
      };
      const response = await runPiJson(agent, SYNTHESIZE_SYSTEM_PROMPT, payload, env);

      if (isErrorEnvelope(response)) {
        throw new IngestAgentConfigError("MEMEX_AGENT_UNAVAILABLE", `MEMEX_AGENT_UNAVAILABLE: ${response.error}`);
      }

      const obj = response as Record<string, unknown>;

      return {
        mediaType: normalizeMediaType(obj.mediaType),
        title: asShortString(obj.title, 200),
        summary: asShortString(obj.summary, 2000),
        keyPoints: asStringArray(obj.keyPoints, 8),
        tags: asStringArray(obj.tags, 12),
        category: asShortString(obj.category, 80),
        authors: asStringArray(obj.authors, 12),
        published: asShortString(obj.published, 80),
        doi: asShortString(obj.doi, 120),
        arxivId: asShortString(obj.arxivId, 120),
        rawDataNotes: asShortString(obj.rawDataNotes, 500),
      };
    },
  };
}

async function runPiJson(
  agent: IngestAgentConfig,
  systemPrompt: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const executable = (env.MEMEX_PI_BIN || "pi").trim();
  const userPrompt = JSON.stringify(payload, null, 2);

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
        agent.model,
        "--thinking",
        agent.thinking,
        "--append-system-prompt",
        systemPrompt,
        userPrompt,
      ],
      {
        env,
        maxBuffer: 1024 * 1024,
      },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IngestAgentConfigError(
      "MEMEX_AGENT_UNAVAILABLE",
      `MEMEX_AGENT_UNAVAILABLE: failed to execute ingest agent '${agent.name}' with model '${agent.model}': ${message}`,
    );
  }

  const output = String(stdout || "").trim();
  if (!output) {
    throw new IngestAgentConfigError(
      "MEMEX_AGENT_UNAVAILABLE",
      `MEMEX_AGENT_UNAVAILABLE: ingest agent '${agent.name}' returned empty output${stderr ? ` (${stderr.trim()})` : ""}`,
    );
  }

  return parseJsonEnvelope(output);
}

function parseJsonEnvelope(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    // Try fenced JSON block
  }

  const fenced = output.match(/```json\s*([\s\S]*?)```/i) || output.match(/```\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }

  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = output.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new IngestAgentConfigError(
    "MEMEX_AGENT_UNAVAILABLE",
    "MEMEX_AGENT_UNAVAILABLE: ingest agent returned non-JSON output",
  );
}

function normalizeMediaType(value: unknown): IngestMediaType | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "research-paper" || value === "article" || value === "youtube-video" || value === "web-page") {
    return value;
  }
  return undefined;
}

function asShortString(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function asStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }

  return out.length > 0 ? out : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized.length > 0) return normalized;
  }
  return "";
}

function isThinking(value: string): value is IngestAgentThinking {
  return (INGEST_AGENT_THINKING_VALUES as readonly string[]).includes(value);
}

function isErrorEnvelope(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string";
}
