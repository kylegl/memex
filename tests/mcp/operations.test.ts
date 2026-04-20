import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemexServer } from "../../src/mcp/server.js";
import { CardStore } from "../../src/core/store.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let client: Client;

async function setup(cards: Record<string, string> = {}) {
  tmpDir = await mkdtemp(join(tmpdir(), "memex-ops-"));
  const cardsDir = join(tmpDir, "cards");
  const archiveDir = join(tmpDir, "archive");
  await mkdir(cardsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  for (const [slug, content] of Object.entries(cards)) {
    const path = join(cardsDir, `${slug}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  const store = new CardStore(cardsDir, archiveDir);
  const server = createMemexServer(store, tmpDir);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
}

async function teardown() {
  await client.close();
  await rm(tmpDir, { recursive: true });
}

describe("High-level operations", () => {
  afterEach(teardown);

  it("memex_recall returns index content", async () => {
    await setup({
      "index": "---\ntitle: Keyword Index\ncreated: 2026-01-01\nsource: organize\n---\n## Topic\n- [[card-a]] — desc",
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nSome content",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Keyword Index");
    expect(text).toContain("[[card-a]]");
  });

  it("memex_recall prefers root index over stale nested generated indexes in flat mode", async () => {
    await setup({
      "index": "---\ntitle: Keyword Index\ncreated: 2026-01-01\nsource: organize\ngenerated: navigation-index\n---\n## Root\n- [[card-a]] — Card A",
      "notes/index": "---\ntitle: Notes Index\ncreated: 2026-01-01\nsource: organize\ngenerated: navigation-index\n---\n## Navigation\n- [[notes/sub/index]]",
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nSome content",
    });

    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("## Root");
    expect(text).not.toContain("[[notes/sub/index]]");
  });

  it("memex_recall falls back to semantic top-level hub when root index is absent", async () => {
    await setup({
      "core/core": "---\ntitle: Core Hub\ncreated: 2026-01-01\nsource: organize\ngenerated: navigation-index\n---\n## Navigation\n- [[core/system/system]]",
      "core/system/system": "---\ntitle: System Hub\ncreated: 2026-01-01\nsource: organize\ngenerated: navigation-index\n---\n## Cards\n- [[card-a]]",
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nSome content",
    });

    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("core    Core Hub");
    expect(text).toContain("system  System Hub");
  });

  it("memex_recall returns card list when no index", async () => {
    await setup({
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nContent",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("card-a");
  });

  it("memex_recall with query searches cards", async () => {
    await setup({
      "auth-card": "---\ntitle: Auth\ncreated: 2026-01-01\nsource: claude-code\n---\nJWT authentication",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: { query: "JWT" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("auth-card");
  });

  it("memex_retro writes a card with auto-source", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: {
        slug: "my-insight",
        title: "My Insight",
        body: "Something I learned about [[related-topic]].",
        category: "architecture",
      },
    });
    expect(result.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "my-insight" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("My Insight");
    expect(text).toContain("architecture");
    expect(text).toContain("test-client");
  });

  it("memex_retro returns upsell when sync not configured", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: { slug: "test", title: "Test", body: "Content" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("memex sync --init");
  });

  it("memex_organize returns link stats and index rebuild summary", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: claude-code\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: claude-code\n---\nStandalone",
    });
    const result = await client.callTool({ name: "memex_organize", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("a");
    expect(text).toContain("b");
    expect(text).toContain("## Index Rebuild");
    expect(text).toContain("- created:");
  });

  it("memex_recall reads rebuilt root index after memex_organize", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: claude-code\ncategory: architecture\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: claude-code\ncategory: project\n---\nStandalone",
    });

    await client.callTool({ name: "memex_organize", arguments: {} });

    const recall = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (recall.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Keyword Index");
    expect(text).toContain("[[a]]");
    expect(text).toContain("[[b]]");
  });

  it("has all expected high-level tools", async () => {
    await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("memex_recall");
    expect(names).toContain("memex_retro");
    expect(names).toContain("memex_organize");
    expect(names).toContain("memex_pull");
    expect(names).toContain("memex_push");
    expect(names).toContain("memex_ingest_url");
    expect(names).not.toContain("memex_init");

    const organizeTool = tools.find((t) => t.name === "memex_organize");
    expect(organizeTool?.description).toContain("refresh generated navigation indexes");
  });

  it("memex_ingest_url writes card content", async () => {
    await setup();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><head><meta name="citation_title" content="MCP Ingest Paper"><meta name="citation_abstract" content="This paper is used to verify memex_ingest_url."><meta name="citation_doi" content="10.1234/mcp-test"></head><body><p>Fallback body.</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );

    try {
      const result = await client.callTool({
        name: "memex_ingest_url",
        arguments: { url: "https://example.org/mcp-paper", agent_mode: "off" },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Detected content type: research-paper");

      const cards = await readdir(join(tmpDir, "cards"));
      const slug = cards.find((name) => name.startsWith("paper-mcp-ingest-paper"));
      expect(slug).toBeDefined();

      const raw = await readFile(join(tmpDir, "cards", slug!), "utf-8");
      expect(raw).toContain("title: MCP Ingest Paper");
      expect(raw).toContain("category: research");
      expect(raw).toContain("ingestedType: research-paper");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
