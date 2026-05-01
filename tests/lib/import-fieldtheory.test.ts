import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";
import matter from "gray-matter";
import {
  FieldTheoryImporter,
  buildImportedCard,
  buildImporterSlug,
} from "../../src/importers/fieldtheory.js";
import { CardStore } from "../../src/core/store.js";

const SAMPLE_EXPORT = `---
author: "@omarsar0"
author_name: "elvis"
posted_at: 2026-04-19
category: tool
domain: ai
categories: [tool, opinion]
domains: [ai]
source_url: https://x.com/omarsar0/status/2045949517921652855
tweet_id: "2045949517921652855"
---

# @omarsar0

LLM Artifacts are becoming a new way to consume knowledge.

## Links
- https://example.com/demo

## Related
- [[categories/tool]]
- [[domains/ai]]

[Original tweet](https://x.com/omarsar0/status/2045949517921652855)
`;

describe("buildImporterSlug", () => {
  it("prefixes flat slugs with fieldtheory-", () => {
    expect(buildImporterSlug(false, "2026-04-19-omarsar0-llm-artifacts.md")).toBe(
      "fieldtheory-2026-04-19-omarsar0-llm-artifacts",
    );
  });

  it("places nested slugs under imports/fieldtheory", () => {
    expect(buildImporterSlug(true, "2026-04-19-omarsar0-llm-artifacts.md")).toBe(
      "imports/fieldtheory/2026-04-19-omarsar0-llm-artifacts",
    );
  });
});

describe("buildImportedCard", () => {
  it("creates a memex reference card from a Field Theory export", () => {
    const imported = buildImportedCard(SAMPLE_EXPORT, "2026-04-19-omarsar0-llm-artifacts.md");
    expect(imported).not.toBeNull();

    const { data, content } = matter(imported!.content);
    expect(data.source).toBe("fieldtheory");
    expect(data.category).toBe("reference");
    expect(data.url).toBe("https://x.com/omarsar0/status/2045949517921652855");
    expect(data.fieldtheory_category).toBe("tool");
    expect(data.tags).toEqual(["fieldtheory", "bookmark", "x-bookmark", "tool", "opinion", "ai"]);
    expect(data.posted_at).toBeInstanceOf(Date);
    expect(content).toContain("Imported from a Field Theory bookmark export.");
    expect(content).toContain("LLM Artifacts are becoming a new way to consume knowledge.");
  });

  it("removes Field Theory wiki links and original tweet footer from the source body", () => {
    const imported = buildImportedCard(SAMPLE_EXPORT, "2026-04-19-omarsar0-llm-artifacts.md");
    expect(imported).not.toBeNull();

    const { content } = matter(imported!.content);
    expect(content).not.toContain("[[categories/tool]]");
    expect(content).not.toContain("[Original tweet](");
    expect(content).not.toContain("## Related");
    expect(content).toContain("## Links");
  });

  it("returns null when source_url is missing", () => {
    const imported = buildImportedCard(SAMPLE_EXPORT.replace(/source_url:.*\n/, ""), "x.md");
    expect(imported).toBeNull();
  });
});

describe("FieldTheoryImporter (integration)", () => {
  let memexHome: string;
  let exportDir: string;
  let store: InstanceType<typeof CardStore>;
  const importer = new FieldTheoryImporter();

  beforeEach(async () => {
    memexHome = await mkdtemp(join(tmpdir(), "memex-fieldtheory-"));
    exportDir = await mkdtemp(join(tmpdir(), "fieldtheory-export-"));
    await mkdir(join(memexHome, "cards"), { recursive: true });
    await mkdir(join(memexHome, "archive"), { recursive: true });
    store = new CardStore(join(memexHome, "cards"), join(memexHome, "archive"));
  });

  afterEach(async () => {
    await rm(memexHome, { recursive: true, force: true });
    await rm(exportDir, { recursive: true, force: true });
  });

  it("imports exported bookmark markdown files", async () => {
    await writeFile(join(exportDir, "2026-04-19-omarsar0-llm-artifacts.md"), SAMPLE_EXPORT);

    const result = await importer.run({
      store,
      sourceDir: exportDir,
      onLog: () => {},
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    const cards = readdirSync(join(memexHome, "cards"));
    expect(cards).toContain("fieldtheory-2026-04-19-omarsar0-llm-artifacts.md");

    const raw = await readFile(join(memexHome, "cards", cards[0]), "utf-8");
    const { data } = matter(raw);
    expect(data.source).toBe("fieldtheory");
    expect(data.tags).toEqual(["fieldtheory", "bookmark", "x-bookmark", "tool", "opinion", "ai"]);
  });

  it("is idempotent for existing imported cards", async () => {
    await writeFile(join(exportDir, "2026-04-19-omarsar0-llm-artifacts.md"), SAMPLE_EXPORT);

    await importer.run({ store, sourceDir: exportDir, onLog: () => {} });
    const second = await importer.run({ store, sourceDir: exportDir, onLog: () => {} });

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("writes nested import paths when nestedSlugs is enabled", async () => {
    store = new CardStore(join(memexHome, "cards"), join(memexHome, "archive"), true);
    await writeFile(join(exportDir, "2026-04-19-omarsar0-llm-artifacts.md"), SAMPLE_EXPORT);

    await importer.run({ store, sourceDir: exportDir, onLog: () => {} });

    const raw = await readFile(
      join(memexHome, "cards", "imports", "fieldtheory", "2026-04-19-omarsar0-llm-artifacts.md"),
      "utf-8",
    );
    const { data } = matter(raw);
    expect(data.source).toBe("fieldtheory");
    expect(data.tags).toEqual(["fieldtheory", "bookmark", "x-bookmark", "tool", "opinion", "ai"]);
  });
});
