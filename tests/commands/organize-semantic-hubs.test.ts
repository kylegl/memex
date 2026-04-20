import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { CardStore } from "../../src/core/store.js";
import { organizeCommand } from "../../src/commands/organize.js";

function card(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe("organize semantic hub slugs", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;
  let store: CardStore;

  async function writeCard(relativePath: string, content: string): Promise<void> {
    const path = join(cardsDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-organize-semantic-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    // nested + semantic hubs enabled
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true, semanticHubSlugs: true }));

    store = new CardStore(cardsDir, archiveDir, true);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates semantic hub notes and legacy redirect aliases", async () => {
    await writeCard(
      "notes/topic-a.md",
      card("title: Topic A\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "A note."),
    );
    await writeCard(
      "notes/sub/deep.md",
      card("title: Deep\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "A deep note."),
    );
    await writeCard(
      "project/roadmap.md",
      card("title: Roadmap\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "Roadmap."),
    );

    const result = await organizeCommand(store, null, { memexHome: tmpDir });

    expect(result.output).toContain("- mode: nested");
    expect(result.output).toContain("- hub slugs: semantic");

    const rootIndex = await store.readCard("index");
    expect(rootIndex).toContain("[[notes/notes]]");
    expect(rootIndex).toContain("[[project/project]]");

    const notesHub = await readFile(join(cardsDir, "notes", "notes.md"), "utf-8");
    expect(notesHub).toContain("[[notes/sub/sub]]");
    expect(notesHub).toContain("[[notes/topic-a]]");

    const notesLegacyAlias = await store.readCard("notes/index");
    expect(notesLegacyAlias).toContain("type: redirect");
    expect(notesLegacyAlias).toContain("Relocated to [[notes/notes]].");

    const subLegacyAlias = await store.readCard("notes/sub/index");
    expect(subLegacyAlias).toContain("Relocated to [[notes/sub/sub]].");
  });

  it("flat mode reports semantic hub artifacts as mixed-mode artifacts", async () => {
    // simulate stale semantic hub artifacts after turning nested off
    await writeCard(
      "notes/notes.md",
      card(
        "title: Notes Hub\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: organize\ngenerated: navigation-index",
        "Generated semantic hub",
      ),
    );

    const flatStore = new CardStore(cardsDir, archiveDir, false);
    const result = await organizeCommand(flatStore, null, { memexHome: tmpDir });

    expect(result.output).toContain("- mode: flat");
    expect(result.output).toContain("- mixed-mode artifacts: 1");
    expect(result.output).toContain("- notes/notes");
  });
});
