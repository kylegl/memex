import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/core/store.js";

describe("CardStore semantic hub compatibility", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-store-semantic-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves legacy nested index links to semantic hub file when alias is absent", async () => {
    await mkdir(join(cardsDir, "notes"), { recursive: true });
    await writeFile(
      join(cardsDir, "notes", "notes.md"),
      "---\ntitle: Notes Hub\ncreated: 2026-03-01\nsource: organize\ngenerated: navigation-index\n---\nHub body",
    );

    const store = new CardStore(cardsDir, archiveDir, true);
    const resolved = await store.resolve("notes/index");
    expect(resolved).toBe(join(cardsDir, "notes", "notes.md"));
  });
});
