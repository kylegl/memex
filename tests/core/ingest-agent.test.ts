import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveIngestAgentConfig,
  IngestAgentConfigError,
  createPiIngestWorkflow,
  resolveIngestAgentExtensionSource,
} from "../../src/core/ingest-agent.js";

async function withPiSettings(
  settings: Record<string, unknown>,
  run: (settingsPath: string) => Promise<void> | void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memex-ingest-agent-settings-test-"));
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify(settings), "utf8");
  try {
    await run(settingsPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("ingest-agent config", () => {
  it("resolves legacy defaults when env/config and settings are missing", () => {
    const config = resolveIngestAgentConfig(
      {},
      {
        MEMEX_PI_SETTINGS_PATH: join(tmpdir(), "missing-memex-settings.json"),
      } as NodeJS.ProcessEnv,
    );
    expect(config.name).toBe("memex-ingest-agent");
    expect(config.model).toBe("openai-codex/gpt-3-codex");
    expect(config.thinking).toBe("medium");
  });

  it("uses pi settings default provider/model when explicit ingest model is missing", async () => {
    await withPiSettings(
      {
        defaultProvider: "multicodex",
        defaultModel: "gpt-5.3-codex",
      },
      (settingsPath) => {
        const config = resolveIngestAgentConfig(
          {},
          {
            MEMEX_PI_SETTINGS_PATH: settingsPath,
          } as NodeJS.ProcessEnv,
        );

        expect(config.model).toBe("multicodex/gpt-5.3-codex");
      },
    );
  });

  it("prefers env over config and settings", async () => {
    await withPiSettings(
      {
        defaultProvider: "multicodex",
        defaultModel: "gpt-5.3-codex",
      },
      (settingsPath) => {
        const config = resolveIngestAgentConfig(
          {
            memexIngestAgentName: "cfg-name",
            memexIngestAgentModel: "cfg-model",
            memexIngestAgentThinking: "low",
          },
          {
            MEMEX_PI_SETTINGS_PATH: settingsPath,
            MEMEX_INGEST_AGENT_NAME: "env-name",
            MEMEX_INGEST_AGENT_MODEL: "env-model",
            MEMEX_INGEST_AGENT_THINKING: "high",
          } as NodeJS.ProcessEnv,
        );

        expect(config.name).toBe("env-name");
        expect(config.model).toBe("env-model");
        expect(config.thinking).toBe("high");
      },
    );
  });

  it("rejects invalid thinking", () => {
    expect(() =>
      resolveIngestAgentConfig(
        { memexIngestAgentThinking: "extreme" },
        {
          MEMEX_PI_SETTINGS_PATH: join(tmpdir(), "missing-memex-settings.json"),
        } as NodeJS.ProcessEnv,
      ),
    ).toThrow(IngestAgentConfigError);
  });
});

describe("ingest-agent extension selection", () => {
  it("picks matching extension from pi settings for multicodex provider", async () => {
    await withPiSettings(
      {
        extensions: ["/home/linkdevk/repos/kg-multicodex"],
      },
      (settingsPath) => {
        const extension = resolveIngestAgentExtensionSource(
          "multicodex/gpt-5.3-codex",
          {
            MEMEX_PI_SETTINGS_PATH: settingsPath,
          } as NodeJS.ProcessEnv,
        );

        expect(extension).toBe("/home/linkdevk/repos/kg-multicodex");
      },
    );
  });

  it("prefers explicit MEMEX_INGEST_AGENT_EXTENSION override", async () => {
    await withPiSettings(
      {
        extensions: ["/home/linkdevk/repos/kg-multicodex"],
      },
      (settingsPath) => {
        const extension = resolveIngestAgentExtensionSource(
          "multicodex/gpt-5.3-codex",
          {
            MEMEX_PI_SETTINGS_PATH: settingsPath,
            MEMEX_INGEST_AGENT_EXTENSION: "/custom/ext/path",
          } as NodeJS.ProcessEnv,
        );

        expect(extension).toBe("/custom/ext/path");
      },
    );
  });
});

describe("createPiIngestWorkflow runtime errors", () => {
  it("throws MEMEX_AGENT_UNAVAILABLE when pi runtime cannot execute", async () => {
    const workflow = createPiIngestWorkflow(
      { name: "ingest", model: "model", thinking: "low" },
      {
        MEMEX_PI_BIN: "/nonexistent/pi",
        MEMEX_PI_SETTINGS_PATH: join(tmpdir(), "missing-memex-settings.json"),
      } as NodeJS.ProcessEnv,
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
