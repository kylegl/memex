import { describe, it, expect } from "vitest";
import {
  resolveIngestAgentConfig,
  IngestAgentConfigError,
  createPiIngestWorkflow,
} from "../../src/core/ingest-agent.js";

describe("ingest-agent config", () => {
  it("resolves defaults when env/config missing", () => {
    const config = resolveIngestAgentConfig({}, {} as NodeJS.ProcessEnv);
    expect(config.name).toBe("memex-ingest-agent");
    expect(config.model).toBe("openai-codex/gpt-3-codex");
    expect(config.thinking).toBe("medium");
  });

  it("prefers env over config", () => {
    const config = resolveIngestAgentConfig(
      {
        memexIngestAgentName: "cfg-name",
        memexIngestAgentModel: "cfg-model",
        memexIngestAgentThinking: "low",
      },
      {
        MEMEX_INGEST_AGENT_NAME: "env-name",
        MEMEX_INGEST_AGENT_MODEL: "env-model",
        MEMEX_INGEST_AGENT_THINKING: "high",
      } as NodeJS.ProcessEnv,
    );

    expect(config.name).toBe("env-name");
    expect(config.model).toBe("env-model");
    expect(config.thinking).toBe("high");
  });

  it("rejects invalid thinking", () => {
    expect(() =>
      resolveIngestAgentConfig(
        { memexIngestAgentThinking: "extreme" },
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow(IngestAgentConfigError);
  });
});

describe("createPiIngestWorkflow runtime errors", () => {
  it("throws MEMEX_AGENT_UNAVAILABLE when pi runtime cannot execute", async () => {
    const workflow = createPiIngestWorkflow(
      { name: "ingest", model: "model", thinking: "low" },
      { MEMEX_PI_BIN: "/nonexistent/pi" } as NodeJS.ProcessEnv,
    );

    await expect(
      workflow.classifyMedia({
        url: "https://example.com",
        detectedByHeuristic: "article",
        contentType: "text/html",
        host: "example.com",
        title: "Example",
        description: "desc",
        abstractText: "",
        excerpt: "excerpt",
      }),
    ).rejects.toThrow("MEMEX_AGENT_UNAVAILABLE");
  });
});
