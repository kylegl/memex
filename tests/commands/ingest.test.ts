import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/core/store.js";
import { parseFrontmatter } from "../../src/core/parser.js";
import { ingestUrlCommand } from "../../src/commands/ingest.js";
import type { IngestAgentWorkflow } from "../../src/core/ingest-agent.js";

const ARTICLE_HTML = `
<!doctype html>
<html>
  <head>
    <title>Example Article</title>
    <meta property="og:type" content="article" />
    <meta name="description" content="This article explains a practical workflow for ingestion." />
  </head>
  <body>
    <article>
      <p>This article explains a practical workflow for ingestion and organization.</p>
      <p>It focuses on actionable implementation details.</p>
    </article>
  </body>
</html>
`;

const PAPER_HTML = `
<!doctype html>
<html>
  <head>
    <title>Memory in the Age of AI Agents</title>
    <meta name="citation_title" content="Memory in the Age of AI Agents" />
    <meta name="citation_author" content="Jane Smith" />
    <meta name="citation_author" content="Alex Doe" />
    <meta name="citation_abstract" content="This paper proposes a memory architecture for agents and evaluates retrieval tradeoffs." />
    <meta name="citation_doi" content="10.1000/test-doi" />
    <meta name="citation_publication_date" content="2026-03-20" />
  </head>
  <body>
    <p>Fallback paragraph content.</p>
  </body>
</html>
`;

function fetchWith(html: string, contentType = "text/html") {
  return async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": contentType },
    });
}

function fakeWorkflow(partial?: {
  mediaType?: "research-paper" | "article" | "youtube-video" | "web-page";
  summary?: string;
  keyPoints?: string[];
}): IngestAgentWorkflow {
  return {
    async classifyMedia(input) {
      return {
        mediaType: partial?.mediaType ?? input.detectedByHeuristic,
        rationale: "workflow-classifier",
        rawDataPlan: "use extracted html snapshot",
        rawDataHints: ["prefer abstract when available"],
      };
    },
    async synthesizeIngestion(input) {
      return {
        mediaType: partial?.mediaType ?? input.mediaType,
        summary: partial?.summary ?? "Agentic summary from workflow",
        keyPoints: partial?.keyPoints ?? ["Point A", "Point B", "Point C"],
        tags: ["agentic", "workflow"],
      };
    },
  };
}

describe("ingestUrlCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-ingest-test-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    store = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects invalid URLs", async () => {
    const result = await ingestUrlCommand(store, "not-a-url");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Invalid URL");
  });

  it("dry-run detects article and does not write a card", async () => {
    const result = await ingestUrlCommand(store, "https://example.com/blog/post", {
      dryRun: true,
      fetchFn: fetchWith(ARTICLE_HTML),
      workflow: fakeWorkflow({ mediaType: "article" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Detected content type: article");

    const cards = await store.scanAll();
    expect(cards).toHaveLength(0);
  });

  it("ingests research paper URLs and writes metadata-rich card", async () => {
    const result = await ingestUrlCommand(store, "https://example.org/papers/agent-memory", {
      fetchFn: fetchWith(PAPER_HTML),
      source: "test-suite",
      workflow: fakeWorkflow({ mediaType: "research-paper" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.ingestedSlugs).toHaveLength(1);
    expect(result.output).toContain("Detected content type: research-paper");

    const slug = result.ingestedSlugs[0];
    const raw = await store.readCard(slug);
    const { data, content } = parseFrontmatter(raw);

    expect(data.category).toBe("research");
    expect(data.source).toBe("test-suite");
    expect(data.ingestedType).toBe("research-paper");
    expect(data.ingestedWorkflow).toBe("agentic");
    expect(String(data.tags)).toContain("paper");
    expect(data.doi).toBe("10.1000/test-doi");
    expect(String(data.authors)).toContain("Jane Smith");
    expect(content).toContain("## Key Points");
    expect(content).toContain("## Metadata");
  });

  it("creates unique slugs on repeated ingestion", async () => {
    const first = await ingestUrlCommand(store, "https://example.com/blog/repeat", {
      fetchFn: fetchWith(ARTICLE_HTML),
      workflow: fakeWorkflow({ mediaType: "article" }),
    });
    const second = await ingestUrlCommand(store, "https://example.com/blog/repeat", {
      fetchFn: fetchWith(ARTICLE_HTML),
      workflow: fakeWorkflow({ mediaType: "article" }),
    });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.ingestedSlugs[0]).not.toBe(second.ingestedSlugs[0]);
    expect(second.ingestedSlugs[0]).toMatch(/-2$/);
  });

  it("uses nested target directories when nestedSlugs is enabled", async () => {
    const nestedStore = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"), true);

    const result = await ingestUrlCommand(nestedStore, "https://example.com/research/abc", {
      fetchFn: fetchWith(PAPER_HTML),
      workflow: fakeWorkflow({ mediaType: "research-paper" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.ingestedSlugs[0]).toMatch(/^reference\/papers\//);
  });

  it("honors explicit kind override", async () => {
    const result = await ingestUrlCommand(store, "https://example.com/random", {
      fetchFn: fetchWith(ARTICLE_HTML),
      kind: "web-page",
      dryRun: true,
      workflow: fakeWorkflow({ mediaType: "article" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Detected content type: web-page");
  });

  it("fails when agent mode is required and no ingest agent runtime is available", async () => {
    const env = { ...process.env, MEMEX_PI_BIN: join(tmpDir, "missing-pi") } as NodeJS.ProcessEnv;

    const result = await ingestUrlCommand(store, "https://example.com/needs-agent", {
      fetchFn: fetchWith(ARTICLE_HTML),
      memexHome: tmpDir,
      agentMode: "required",
      env,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("MEMEX_AGENT_UNAVAILABLE");
  });

  it("falls back deterministically when agent mode is optional", async () => {
    const env = { ...process.env, MEMEX_PI_BIN: join(tmpDir, "missing-pi") } as NodeJS.ProcessEnv;

    const result = await ingestUrlCommand(store, "https://example.com/fallback", {
      fetchFn: fetchWith(ARTICLE_HTML),
      memexHome: tmpDir,
      agentMode: "optional",
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Workflow mode: deterministic");
    expect(result.output).toContain("Warning:");
  });
});
