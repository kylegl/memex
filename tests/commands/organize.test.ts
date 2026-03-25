import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";
import { organizeCommand } from "../../src/commands/organize.js";

describe("organize command", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-organize-test-"));
    const cardsDir = join(tmpDir, "cards");
    const archiveDir = join(tmpDir, "archive");
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
    await writeFile(
      join(tmpDir, "cards", "lonely.md"),
      "---\ntitle: Lonely Card\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nNo links here.",
    );
    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Orphans");
    expect(result.output).toContain("lonely");
  });

  it("detects conflict status cards", async () => {
    await writeFile(
      join(tmpDir, "cards", "disputed.md"),
      "---\ntitle: Disputed\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\nstatus: conflict\n---\nConflicting info.",
    );
    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Unresolved Conflicts");
    expect(result.output).toContain("disputed");
  });

  it("pairs recently modified cards with neighbors", async () => {
    await writeFile(
      join(tmpDir, "cards", "card-a.md"),
      "---\ntitle: Card A\ncreated: 2026-03-20\nmodified: 2026-03-25\nsource: test\n---\nSee [[card-b]] for details.",
    );
    await writeFile(
      join(tmpDir, "cards", "card-b.md"),
      "---\ntitle: Card B\ncreated: 2026-03-20\nmodified: 2026-03-20\nsource: test\n---\nSome other info.",
    );
    const result = await organizeCommand(store, "2026-03-24");
    expect(result.output).toContain("card-a ↔ card-b");
  });

  it("skips old cards when since is provided", async () => {
    await writeFile(
      join(tmpDir, "cards", "old.md"),
      "---\ntitle: Old\ncreated: 2026-01-01\nmodified: 2026-01-01\nsource: test\n---\nOld stuff. See [[new]].",
    );
    await writeFile(
      join(tmpDir, "cards", "new.md"),
      "---\ntitle: New\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nNew stuff.",
    );
    const result = await organizeCommand(store, "2026-03-24");
    // Only "new" was modified after since, so pair should appear
    // "old" was not modified after since, so its outbound links shouldn't generate pairs
    expect(result.output).not.toContain("old ↔ new");
  });
});
