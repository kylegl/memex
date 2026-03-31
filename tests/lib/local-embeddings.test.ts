import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalEmbeddingProvider,
  OllamaEmbeddingProvider,
  isNodeLlamaCppAvailable,
  createEmbeddingProvider,
} from "../../src/lib/embeddings.js";

describe("isNodeLlamaCppAvailable", () => {
  it("returns true when node-llama-cpp is installed", async () => {
    // node-llama-cpp is installed as an optional dep in this project
    const available = await isNodeLlamaCppAvailable();
    expect(available).toBe(true);
  });
});

describe("createEmbeddingProvider", () => {
  let origApiKey: string | undefined;
  let origProvider: string | undefined;

  beforeEach(() => {
    origApiKey = process.env.OPENAI_API_KEY;
    origProvider = process.env.MEMEX_EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    if (origApiKey !== undefined) {
      process.env.OPENAI_API_KEY = origApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (origProvider !== undefined) {
      process.env.MEMEX_EMBEDDING_PROVIDER = origProvider;
    } else {
      delete process.env.MEMEX_EMBEDDING_PROVIDER;
    }
  });

  it("creates OpenAI provider when API key is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.MEMEX_EMBEDDING_PROVIDER;

    const provider = await createEmbeddingProvider();
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("creates OpenAI provider when type is explicitly openai", async () => {
    const provider = await createEmbeddingProvider({
      type: "openai",
      openaiApiKey: "sk-test-key",
    });
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("creates local provider when type is explicitly local", async () => {
    const provider = await createEmbeddingProvider({ type: "local" });
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("creates ollama provider when type is explicitly ollama", async () => {
    const provider = await createEmbeddingProvider({ type: "ollama" });
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.model).toBe("nomic-embed-text");
  });

  it("falls back to local when no API key and node-llama-cpp is available", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMEX_EMBEDDING_PROVIDER;

    const provider = await createEmbeddingProvider();
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("respects MEMEX_EMBEDDING_PROVIDER env var", async () => {
    process.env.MEMEX_EMBEDDING_PROVIDER = "ollama";
    const provider = await createEmbeddingProvider();
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("explicit type overrides env var", async () => {
    process.env.MEMEX_EMBEDDING_PROVIDER = "ollama";
    const provider = await createEmbeddingProvider({ type: "local" });
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });
});

describe("LocalEmbeddingProvider", () => {
  it("constructs with default model", () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.model).toContain("embeddinggemma");
  });

  it("constructs with custom model path", () => {
    const provider = new LocalEmbeddingProvider("/path/to/model.gguf");
    expect(provider.model).toBe("model");
  });

  it("returns empty array for empty input", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  // Slow test: actually loads the model and generates embeddings
  it("generates embeddings for text", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(["hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(768); // embeddinggemma-300m produces 768-dim vectors

    // Should be normalized (unit vector)
    const magnitude = Math.sqrt(result[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 2);
  }, 60000); // 60s timeout for model loading

  it("generates different embeddings for different texts", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(["hello world", "goodbye moon"]);

    expect(result).toHaveLength(2);
    expect(result[0]).not.toEqual(result[1]);
  }, 60000);

  it("generates consistent embeddings for the same text", async () => {
    const provider = new LocalEmbeddingProvider();
    const [v1] = await provider.embed(["test consistency"]);
    const [v2] = await provider.embed(["test consistency"]);

    // Vectors should be identical
    expect(v1).toEqual(v2);
  }, 60000);
});

describe("OllamaEmbeddingProvider", () => {
  it("constructs with default model", () => {
    const provider = new OllamaEmbeddingProvider();
    expect(provider.model).toBe("nomic-embed-text");
  });

  it("constructs with custom model and base URL", () => {
    const provider = new OllamaEmbeddingProvider({
      model: "all-minilm",
      baseUrl: "http://custom:8080",
    });
    expect(provider.model).toBe("all-minilm");
  });

  it("returns empty array for empty input", async () => {
    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("respects MEMEX_OLLAMA_MODEL env var", () => {
    const orig = process.env.MEMEX_OLLAMA_MODEL;
    process.env.MEMEX_OLLAMA_MODEL = "custom-model";
    try {
      const provider = new OllamaEmbeddingProvider();
      expect(provider.model).toBe("custom-model");
    } finally {
      if (orig !== undefined) {
        process.env.MEMEX_OLLAMA_MODEL = orig;
      } else {
        delete process.env.MEMEX_OLLAMA_MODEL;
      }
    }
  });

  it("provides helpful error when Ollama is not running", async () => {
    // Connect to a port that's definitely not running Ollama
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://localhost:1",
    });

    await expect(provider.embed(["test"])).rejects.toThrow("Cannot connect to Ollama");
  });
});
