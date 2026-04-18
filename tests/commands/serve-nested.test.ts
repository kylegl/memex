import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { serveCommand } from "../../src/commands/serve.js";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

describe("serve API with nestedSlugs", () => {
  let tmpDir: string;
  let port: number;
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-serve-nested-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(join(cardsDir, "sub"), { recursive: true });

    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));

    await writeFile(
      join(cardsDir, "sub", "item.md"),
      "---\ntitle: Nested Item\ncreated: 2026-01-01\nsource: manual\n---\nSee [[sub/other]]."
    );
    await writeFile(
      join(cardsDir, "sub", "other.md"),
      "---\ntitle: Nested Other\ncreated: 2026-01-01\nsource: manual\n---\nBack link."
    );

    process.env.MEMEX_HOME = tmpDir;
    process.env.MEMEX_NO_OPEN = "1";

    port = 10000 + Math.floor(Math.random() * 50000);
    baseUrl = `http://localhost:${port}`;

    server = await serveCommand(port);
  }, 10000);

  afterAll(async () => {
    server?.close();
    delete process.env.MEMEX_HOME;
    delete process.env.MEMEX_NO_OPEN;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nested slugs from /api/cards when nestedSlugs is enabled", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    expect(res.status).toBe(200);
    const cards = JSON.parse(res.body);
    const slugs = cards.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("sub/item");
    expect(slugs).toContain("sub/other");
  });
});
