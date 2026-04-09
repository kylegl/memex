import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddingProviderType } from "./embeddings.js";

export interface MemexConfig {
  nestedSlugs: boolean;
  searchDirs?: string[];
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  embeddingModel?: string;
  /** Embedding provider: "openai" | "local" | "ollama". Auto-detected if omitted. */
  embeddingProvider?: EmbeddingProviderType;
  /** Ollama model name (default: "nomic-embed-text"). */
  ollamaModel?: string;
  /** Ollama base URL (default: "http://localhost:11434"). */
  ollamaBaseUrl?: string;
  /** Local GGUF model path or HuggingFace URI for node-llama-cpp. */
  localModelPath?: string;
  /** Configured proposal agent name (AI organization layer). */
  memexProposalAgentName?: string;
  /** Configured proposal model identifier. */
  memexProposalAgentModel?: string;
  /** Configured proposal reasoning effort. */
  memexProposalAgentThinking?: "low" | "medium" | "high";
}

/**
 * Read config from $MEMEX_HOME/.memexrc
 * Returns default config if file doesn't exist or is invalid.
 */
export async function readConfig(memexHome: string): Promise<MemexConfig> {
  const configPath = join(memexHome, ".memexrc");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    return {
      nestedSlugs: parsed.nestedSlugs === true,
      searchDirs: Array.isArray(parsed.searchDirs) ? parsed.searchDirs : undefined,
      openaiApiKey: typeof parsed.openaiApiKey === "string" ? parsed.openaiApiKey : undefined,
      openaiBaseUrl: typeof parsed.openaiBaseUrl === "string" ? parsed.openaiBaseUrl : undefined,
      embeddingModel: typeof parsed.embeddingModel === "string" ? parsed.embeddingModel : undefined,
      embeddingProvider: isValidProvider(parsed.embeddingProvider) ? parsed.embeddingProvider : undefined,
      ollamaModel: typeof parsed.ollamaModel === "string" ? parsed.ollamaModel : undefined,
      ollamaBaseUrl: typeof parsed.ollamaBaseUrl === "string" ? parsed.ollamaBaseUrl : undefined,
      localModelPath: typeof parsed.localModelPath === "string" ? parsed.localModelPath : undefined,
      memexProposalAgentName: typeof parsed.memexProposalAgentName === "string" ? parsed.memexProposalAgentName : undefined,
      memexProposalAgentModel: typeof parsed.memexProposalAgentModel === "string" ? parsed.memexProposalAgentModel : undefined,
      memexProposalAgentThinking: isValidThinking(parsed.memexProposalAgentThinking)
        ? parsed.memexProposalAgentThinking
        : undefined,
    };
  } catch {
    // File doesn't exist or invalid JSON - return defaults
    return {
      nestedSlugs: false,
    };
  }
}

function isValidProvider(value: unknown): value is EmbeddingProviderType {
  return value === "openai" || value === "local" || value === "ollama";
}

function isValidThinking(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}
