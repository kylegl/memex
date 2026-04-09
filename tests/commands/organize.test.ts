import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { CardStore } from "../../src/core/store.js";
import { organizeCommand } from "../../src/commands/organize.js";

function card(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe("organize command", () => {
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
    tmpDir = await mkdtemp(join(tmpdir(), "memex-organize-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty message for no cards", async () => {
    const result = await organizeCommand(store, null);
    expect(result.output).toBe("No cards yet.");
  });

  it("detects orphans", async () => {
    await writeCard(
      "lonely.md",
      card(
        "title: Lonely Card\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test",
        "No links here.",
      ),
    );

    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Orphans");
    expect(result.output).toContain("lonely");
    expect(result.output).toContain("## Index Rebuild");
  });

  it("detects conflict status cards", async () => {
    await writeCard(
      "disputed.md",
      card(
        "title: Disputed\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\nstatus: conflict",
        "Conflicting info.",
      ),
    );

    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Unresolved Conflicts");
    expect(result.output).toContain("disputed");
  });

  it("pairs recently modified cards with neighbors", async () => {
    await writeCard(
      "card-a.md",
      card(
        "title: Card A\ncreated: 2026-03-20\nmodified: 2026-03-25\nsource: test",
        "See [[card-b]] for details.",
      ),
    );
    await writeCard(
      "card-b.md",
      card(
        "title: Card B\ncreated: 2026-03-20\nmodified: 2026-03-20\nsource: test",
        "Some other info.",
      ),
    );

    const result = await organizeCommand(store, "2026-03-24");
    expect(result.output).toContain("card-a ↔ card-b");
  });

  it("includes cards with no modified date when since is provided", async () => {
    await writeCard(
      "no-date.md",
      card("title: No Date\ncreated: 2026-01-01\nsource: test", "No modified field. See [[other]]."),
    );
    await writeCard(
      "other.md",
      card(
        "title: Other\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test",
        "Some info.",
      ),
    );

    const result = await organizeCommand(store, "2026-03-24");
    expect(result.output).toContain("no-date ↔ other");
  });

  it("detects hubs with >= 10 inbound links", async () => {
    await writeCard(
      "hub.md",
      card(
        "title: Hub Card\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test",
        "Central concept.",
      ),
    );

    for (let i = 0; i < 10; i++) {
      await writeCard(
        `linker-${i}.md`,
        card(
          `title: Linker ${i}\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test`,
          "See [[hub]] for details.",
        ),
      );
    }

    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Hubs");
    expect(result.output).toContain("hub (10 inbound)");
  });

  it("skips old cards when since is provided", async () => {
    await writeCard(
      "old.md",
      card(
        "title: Old\ncreated: 2026-01-01\nmodified: 2026-01-01\nsource: test",
        "Old stuff. See [[new]].",
      ),
    );
    await writeCard(
      "new.md",
      card(
        "title: New\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test",
        "New stuff.",
      ),
    );

    const result = await organizeCommand(store, "2026-03-24");
    expect(result.output).not.toContain("old ↔ new");
  });

  it("builds nested root-only navigation indexes", async () => {
    store = new CardStore(cardsDir, archiveDir, true);

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
      card("title: Roadmap\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "A roadmap."),
    );
    await writeCard(
      "readme.md",
      card("title: Readme\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "Project overview."),
    );

    const result = await organizeCommand(store, null);

    const rootIndex = await store.readCard("index");
    expect(rootIndex).toContain("[[notes/index]]");
    expect(rootIndex).toContain("[[project/index]]");
    expect(rootIndex).toContain("[[readme]]");
    expect(rootIndex).not.toContain("[[notes/topic-a]]");
    expect(rootIndex).not.toContain("[[notes/sub/deep]]");

    const notesIndex = await store.readCard("notes/index");
    expect(notesIndex).toContain("[[notes/sub/index]]");
    expect(notesIndex).toContain("[[notes/topic-a]]");
    expect(notesIndex).not.toContain("[[notes/sub/deep]]");

    const subIndex = await store.readCard("notes/sub/index");
    expect(subIndex).toContain("[[notes/sub/deep]]");

    expect(result.output).toContain("## Index Rebuild");
    expect(result.output).toContain("- mode: nested");
    expect(result.output).toContain("- created: 4");
  });

  it("builds virtual nested navigation for flat hyphen slugs in nested mode", async () => {
    store = new CardStore(cardsDir, archiveDir, true);

    await writeCard(
      "core-project-intent.md",
      card("title: Project Intent\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "intent body"),
    );
    await writeCard(
      "core-system-guide.md",
      card("title: System Guide\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "guide body"),
    );
    await writeCard(
      "memex-mirror-tests-can-fail-global-suite.md",
      card("title: Mirror tests\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "testing body"),
    );
    await writeCard(
      "sdge-fetch-patchwright-entrypoint-shim.md",
      card("title: Patchwright shim\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "shim body"),
    );
    await writeCard(
      "green-button-is-nearline-not-realtime.md",
      card("title: Green Button is nearline\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "gb body"),
    );

    await organizeCommand(store, null);

    const rootIndex = await store.readCard("index");
    expect(rootIndex).toContain("[[core/index]]");
    expect(rootIndex).toContain("[[memex/index]]");
    expect(rootIndex).toContain("[[project/index]]");
    expect(rootIndex).not.toContain("[[core-project-intent]]");

    const coreIndex = await store.readCard("core/index");
    expect(coreIndex).toContain("[[core/project/index]]");
    expect(coreIndex).toContain("[[core/system/index]]");

    const coreProjectIndex = await store.readCard("core/project/index");
    expect(coreProjectIndex).toContain("[[core-project-intent]]");

    const memexIndex = await store.readCard("memex/index");
    expect(memexIndex).toContain("[[memex-mirror-tests-can-fail-global-suite]]");

    const projectIndex = await store.readCard("project/index");
    expect(projectIndex).toContain("[[project/home-assistant-da/index]]");

    const haDaIndex = await store.readCard("project/home-assistant-da/index");
    expect(haDaIndex).toContain("[[project/home-assistant-da/sdge/index]]");

    const sdgeIndex = await store.readCard("project/home-assistant-da/sdge/index");
    expect(sdgeIndex).toContain("[[project/home-assistant-da/sdge/green-button/index]]");
    expect(sdgeIndex).toContain("[[reference/patchright/index]]");

    const greenButtonIndex = await store.readCard("project/home-assistant-da/sdge/green-button/index");
    expect(greenButtonIndex).toContain("[[green-button-is-nearline-not-realtime]]");

    const patchrightIndex = await store.readCard("reference/patchright/index");
    expect(patchrightIndex).toContain("[[sdge-fetch-patchwright-entrypoint-shim]]");
  });

  it("builds flat grouped root index only", async () => {
    await writeCard(
      "alpha.md",
      card(
        "title: Alpha\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test\ncategory: architecture",
        "Alpha body.",
      ),
    );
    await writeCard(
      "beta.md",
      card(
        "title: Beta\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test\ncategory: project",
        "Beta body.",
      ),
    );
    await writeCard(
      "misc.md",
      card("title: Misc\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "Misc body."),
    );

    const result = await organizeCommand(store, null);
    const rootIndex = await readFile(join(cardsDir, "index.md"), "utf-8");

    expect(rootIndex).toContain("## architecture");
    expect(rootIndex).toContain("## project");
    expect(rootIndex).toContain("## Uncategorized");

    const architecturePos = rootIndex.indexOf("## architecture");
    const projectPos = rootIndex.indexOf("## project");
    const uncategorizedPos = rootIndex.indexOf("## Uncategorized");
    expect(architecturePos).toBeLessThan(projectPos);
    expect(projectPos).toBeLessThan(uncategorizedPos);

    expect(result.output).toContain("- mode: flat");
    expect(result.output).toContain("- mixed-mode artifacts: 0");
  });

  it("skips non-generated nested index collisions and reports them", async () => {
    store = new CardStore(cardsDir, archiveDir, true);

    await writeCard(
      "notes/topic.md",
      card("title: Topic\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "topic body"),
    );

    const userIndex = card(
      "title: User Notes Index\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test",
      "Manual index body",
    );
    await writeCard("notes/index.md", userIndex);

    const result = await organizeCommand(store, null);

    const notesIndex = await readFile(join(cardsDir, "notes", "index.md"), "utf-8");
    expect(notesIndex).toBe(userIndex);
    expect(result.output).toContain("- skipped: 1");
    expect(result.output).toContain("notes/index — existing non-generated nested index");
  });

  it("reports mixed-mode generated nested index artifacts in flat mode", async () => {
    await writeCard(
      "topic.md",
      card("title: Topic\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "Topic body"),
    );

    await writeCard(
      "notes/index.md",
      card(
        "title: Notes Index\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: organize\ngenerated: navigation-index",
        "Generated nested index",
      ),
    );

    const result = await organizeCommand(store, null);
    expect(result.output).toContain("- mixed-mode artifacts: 1");
    expect(result.output).toContain("### Mixed-mode Artifacts");
    expect(result.output).toContain("- notes/index");
  });

  it("does not rewrite generated indexes on no-op rerun", async () => {
    store = new CardStore(cardsDir, archiveDir, true);

    await writeCard(
      "notes/topic.md",
      card("title: Topic\ncreated: 2026-03-01\nmodified: 2026-03-01\nsource: test", "topic body"),
    );

    const writeSpy = vi.spyOn(store, "writeCard");

    const first = await organizeCommand(store, null);
    const beforeRoot = await store.readCard("index");
    const beforeNotes = await store.readCard("notes/index");

    expect(writeSpy).toHaveBeenCalledTimes(2);
    writeSpy.mockClear();

    const second = await organizeCommand(store, null);
    const afterRoot = await store.readCard("index");
    const afterNotes = await store.readCard("notes/index");

    expect(first.output).toContain("- created: 2");
    expect(second.output).toContain("- created: 0");
    expect(second.output).toContain("- updated: 0");
    expect(second.output).toContain("- unchanged: 2");
    expect(writeSpy).not.toHaveBeenCalled();
    expect(beforeRoot).toBe(afterRoot);
    expect(beforeNotes).toBe(afterNotes);
  });

  it("excludes generated navigation indexes from hub and recent-pair noise", async () => {
    store = new CardStore(cardsDir, archiveDir, true);

    await writeCard(
      "notes/index.md",
      card(
        "title: Notes Index\ncreated: 2026-03-01\nmodified: 2026-03-25\nsource: organize\ngenerated: navigation-index",
        "Generated nav card",
      ),
    );

    for (let i = 0; i < 10; i++) {
      await writeCard(
        `notes/linker-${i}.md`,
        card(
          `title: Linker ${i}\ncreated: 2026-03-01\nmodified: 2026-03-25\nsource: test`,
          "See [[notes/index]].",
        ),
      );
    }

    const result = await organizeCommand(store, null);
    expect(result.output).not.toContain("notes/index (10 inbound)");
    expect(result.output).not.toContain("linker-0 ↔ notes/index");
  });
});
