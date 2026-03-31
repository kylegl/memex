import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { join, dirname } from "node:path";
import type { CardStore } from "./store.js";

/**
 * Generic embedding provider interface.
 * Implementations convert text arrays into vector arrays.
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

// --- Provider type ---

export type EmbeddingProviderType = "openai" | "local" | "ollama";

/**
 * OpenAI embedding provider using text-embedding-3-small (1536 dims).
 * Uses native Node `https` module — no external dependencies.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model = "text-embedding-3-small";
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key required: pass to constructor or set OPENAI_API_KEY"
      );
    }
    this.apiKey = key;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    // OpenAI allows up to 2048 inputs per request
    const batchSize = 2048;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.requestEmbeddings(batch);
      results.push(...vectors);
    }

    return results;
  }

  private requestEmbeddings(texts: string[]): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        input: texts,
      });

      const req = httpsRequest(
        {
          hostname: "api.openai.com",
          path: "/v1/embeddings",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                reject(
                  new Error(`OpenAI API error: ${parsed.error.message}`)
                );
                return;
              }
              // Sort by index to guarantee order matches input
              const sorted = (
                parsed.data as Array<{ index: number; embedding: number[] }>
              ).sort((a, b) => a.index - b.index);
              resolve(sorted.map((d) => d.embedding));
            } catch (e) {
              reject(new Error(`Failed to parse OpenAI response: ${e}`));
            }
          });
        }
      );

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

// --- Local Embedding Provider (node-llama-cpp + GGUF) ---

const DEFAULT_LOCAL_MODEL =
  "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";

/**
 * Normalize a vector to unit length.
 * Handles NaN/Infinity values by replacing them with 0.
 */
function normalizeVector(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((v) => v / magnitude);
}

/**
 * Check whether node-llama-cpp is available (installed and importable).
 */
export async function isNodeLlamaCppAvailable(): Promise<boolean> {
  try {
    await import("node-llama-cpp");
    return true;
  } catch {
    return false;
  }
}

/**
 * Local embedding provider using node-llama-cpp with a GGUF model.
 *
 * - Lazily loads node-llama-cpp and the model on first embed() call
 * - Downloads the model automatically on first use (~328 MB)
 * - Produces 768-dimensional vectors (with embeddinggemma-300m)
 * - Requires node-llama-cpp as an optional dependency
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private modelPath: string;
  private context: unknown | null = null;
  private initPromise: Promise<unknown> | null = null;

  constructor(modelPath?: string) {
    this.modelPath = modelPath ?? DEFAULT_LOCAL_MODEL;
    // Use a cache-friendly model name for the EmbeddingCache file key
    this.model = this.modelPath.includes("/")
      ? this.modelPath.split("/").pop()!.replace(/\.gguf$/i, "")
      : this.modelPath;
  }

  private async ensureContext(): Promise<{
    getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array }>;
  }> {
    if (this.context) {
      return this.context as Awaited<ReturnType<typeof this.ensureContext>>;
    }
    if (this.initPromise) {
      return this.initPromise as Promise<Awaited<ReturnType<typeof this.ensureContext>>>;
    }

    this.initPromise = (async () => {
      try {
        // Dynamic import — fails gracefully if node-llama-cpp is not installed
        const { getLlama, resolveModelFile, LlamaLogLevel } = await import(
          "node-llama-cpp"
        );

        const resolved = await resolveModelFile(this.modelPath);
        const llama = await getLlama({ logLevel: LlamaLogLevel.error });
        const model = await llama.loadModel({ modelPath: resolved });
        const ctx = await model.createEmbeddingContext();

        this.context = ctx;
        return ctx;
      } catch (err) {
        this.initPromise = null;
        const message =
          err instanceof Error ? err.message : String(err);
        if (message.includes("Cannot find package")) {
          throw new Error(
            "node-llama-cpp is not installed. Install it with: npm install node-llama-cpp"
          );
        }
        throw new Error(`Failed to initialize local embedding model: ${message}`);
      }
    })();

    return this.initPromise as Promise<Awaited<ReturnType<typeof this.ensureContext>>>;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const ctx = await this.ensureContext();
    const results: number[][] = [];

    for (const text of texts) {
      const embedding = await ctx.getEmbeddingFor(text);
      results.push(normalizeVector(Array.from(embedding.vector)));
    }

    return results;
  }
}

// --- Ollama Embedding Provider ---

/**
 * Ollama embedding provider — calls a local Ollama server's /api/embed endpoint.
 *
 * Lightweight alternative that requires only a running Ollama instance.
 * No native dependencies needed.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private baseUrl: string;

  constructor(options?: { model?: string; baseUrl?: string }) {
    this.model = options?.model ?? process.env.MEMEX_OLLAMA_MODEL ?? "nomic-embed-text";
    this.baseUrl =
      options?.baseUrl ??
      process.env.MEMEX_OLLAMA_BASE_URL ??
      process.env.OLLAMA_HOST ??
      "http://localhost:11434";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Ollama /api/embed supports batch input
    const body = JSON.stringify({
      model: this.model,
      input: texts,
    });

    const url = new URL("/api/embed", this.baseUrl);
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 11434),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                reject(new Error(`Ollama API error: ${parsed.error}`));
                return;
              }
              if (!parsed.embeddings || !Array.isArray(parsed.embeddings)) {
                reject(
                  new Error(
                    "Unexpected Ollama response: missing embeddings array"
                  )
                );
                return;
              }
              resolve(
                (parsed.embeddings as number[][]).map((v) =>
                  normalizeVector(v)
                )
              );
            } catch (e) {
              reject(new Error(`Failed to parse Ollama response: ${e}`));
            }
          });
        }
      );

      req.on("error", (err) => {
        reject(
          new Error(
            `Cannot connect to Ollama at ${this.baseUrl}: ${err.message}. ` +
              "Is Ollama running? Start it with: ollama serve"
          )
        );
      });
      req.write(body);
      req.end();
    });
  }
}

// --- Provider factory ---

export interface CreateProviderOptions {
  type?: EmbeddingProviderType;
  openaiApiKey?: string;
  localModelPath?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
}

/**
 * Create an embedding provider based on the requested type.
 *
 * Resolution order when type is not specified:
 * 1. If OPENAI_API_KEY is available → OpenAI
 * 2. If node-llama-cpp is installed → Local
 * 3. Error with helpful message
 */
export async function createEmbeddingProvider(
  options: CreateProviderOptions = {}
): Promise<EmbeddingProvider> {
  const requestedType =
    options.type ??
    (process.env.MEMEX_EMBEDDING_PROVIDER as EmbeddingProviderType | undefined);

  // Explicit provider requested
  if (requestedType === "openai") {
    return new OpenAIEmbeddingProvider(options.openaiApiKey);
  }
  if (requestedType === "local") {
    return new LocalEmbeddingProvider(options.localModelPath);
  }
  if (requestedType === "ollama") {
    return new OllamaEmbeddingProvider({
      model: options.ollamaModel,
      baseUrl: options.ollamaBaseUrl,
    });
  }

  // Auto-detect: try OpenAI first, then local, then ollama
  const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    return new OpenAIEmbeddingProvider(apiKey);
  }

  // Try local (node-llama-cpp)
  if (await isNodeLlamaCppAvailable()) {
    return new LocalEmbeddingProvider(options.localModelPath);
  }

  // No provider available — provide helpful error
  throw new Error(
    "No embedding provider available.\n" +
      "Options:\n" +
      "  1. Set OPENAI_API_KEY for OpenAI embeddings\n" +
      "  2. Install node-llama-cpp for local embeddings: npm install node-llama-cpp\n" +
      "  3. Run Ollama locally and set MEMEX_EMBEDDING_PROVIDER=ollama\n" +
      "Configure via .memexrc { \"embeddingProvider\": \"local\" } or MEMEX_EMBEDDING_PROVIDER env var."
  );
}

// --- Cache ---

interface CacheEntry {
  vector: number[];
  contentHash: string;
  updatedAt: string;
}

interface CacheData {
  model: string;
  version: number;
  entries: Record<string, CacheEntry>;
}

/**
 * File-backed embedding cache.
 * Stores vectors keyed by card slug with content-hash invalidation.
 */
export class EmbeddingCache {
  private data: CacheData;
  private filePath: string;

  constructor(
    private memexHome: string,
    private cacheModel: string
  ) {
    this.filePath = join(
      memexHome,
      ".memex",
      "embeddings",
      `${cacheModel}.json`
    );
    this.data = { model: cacheModel, version: 1, entries: {} };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as CacheData;
      if (parsed.model === this.cacheModel && parsed.version === 1) {
        this.data = parsed;
      }
    } catch {
      // File missing or corrupt — start fresh
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  get(slug: string): CacheEntry | undefined {
    return this.data.entries[slug];
  }

  set(slug: string, vector: number[], contentHash: string): void {
    this.data.entries[slug] = {
      vector,
      contentHash,
      updatedAt: new Date().toISOString(),
    };
  }

  remove(slug: string): void {
    delete this.data.entries[slug];
  }

  needsUpdate(slug: string, currentHash: string): boolean {
    const entry = this.data.entries[slug];
    return !entry || entry.contentHash !== currentHash;
  }

  /** Returns all cached slugs (for stale-entry detection). */
  slugs(): string[] {
    return Object.keys(this.data.entries);
  }
}

// --- Utilities ---

/** Compute SHA-256 hex digest of a string. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Cosine similarity between two vectors of equal length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// --- Orchestrator ---

export interface EmbedCardsResult {
  embedded: number;
  removed: number;
  total: number;
}

/**
 * Scan all cards, embed new/changed ones, remove stale cache entries.
 */
export async function embedCards(
  store: CardStore,
  provider: EmbeddingProvider,
  cache: EmbeddingCache
): Promise<EmbedCardsResult> {
  const cards = await store.scanAll();
  const currentSlugs = new Set<string>();
  const toEmbed: Array<{ slug: string; hash: string; text: string }> = [];

  // Identify new/changed cards
  for (const card of cards) {
    currentSlugs.add(card.slug);
    const raw = await store.readCard(card.slug);
    const hash = contentHash(raw);

    if (cache.needsUpdate(card.slug, hash)) {
      toEmbed.push({ slug: card.slug, hash, text: raw });
    }
  }

  // Batch-embed changed cards
  if (toEmbed.length > 0) {
    const vectors = await provider.embed(toEmbed.map((c) => c.text));
    for (let i = 0; i < toEmbed.length; i++) {
      cache.set(toEmbed[i].slug, vectors[i], toEmbed[i].hash);
    }
  }

  // Remove stale entries (cards that no longer exist)
  let removed = 0;
  for (const slug of cache.slugs()) {
    if (!currentSlugs.has(slug)) {
      cache.remove(slug);
      removed++;
    }
  }

  return {
    embedded: toEmbed.length,
    removed,
    total: cards.length,
  };
}
