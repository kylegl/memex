import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/core/store.js";
import { maintainCommand } from "../../src/commands/maintain.js";
import { reviewCommand } from "../../src/commands/review.js";

describe("review + maintain commands", () => {
  let memexHome: string;
  let store: CardStore;

  beforeEach(async () => {
    memexHome = await mkdtemp(join(tmpdir(), "memex-review-maintain-test-"));
    await mkdir(join(memexHome, "cards"), { recursive: true });
    await mkdir(join(memexHome, "archive"), { recursive: true });
    store = new CardStore(join(memexHome, "cards"), join(memexHome, "archive"));
  });

  afterEach(async () => {
    await rm(memexHome, { recursive: true, force: true });
  });

  it("maintain dry-run summarizes bounded suggestions", async () => {
    await writeFile(
      join(memexHome, "cards", "alpha.md"),
      `---\ntitle: Alpha\ncreated: 2026-01-01\nsource: test\n---\n${Array.from({ length: 20 }).map(() => "line").join("\n")}`,
    );

    const result = await maintainCommand(store, { memexHome, dryRun: true, maxBodyLines: 5 });
    expect(result.success).toBe(true);
    expect(result.output).toContain("dry-run");
    expect(result.created).toBeGreaterThan(0);
  });

  it("creates redirect classify proposals for legacy relocation stubs", async () => {
    await writeFile(
      join(memexHome, "cards", "legacy-stub.md"),
      "---\ntitle: Legacy Stub\ncreated: 2026-01-01\nsource: test\n---\nRelocated to [[project/new-home]].",
    );

    const result = await maintainCommand(store, { memexHome, dryRun: false });
    expect(result.success).toBe(true);
    expect(result.output).toContain("proposals=1");

    const proposalsDir = join(memexHome, ".memex", "proposals");
    const files = await readdir(proposalsDir);
    expect(files).toHaveLength(1);

    const proposal = JSON.parse(await readFile(join(proposalsDir, files[0]), "utf-8")) as {
      kind: string;
      payload?: Record<string, unknown>;
      autoSafe?: boolean;
      targetPath?: string;
    };

    expect(proposal.kind).toBe("classify");
    expect(proposal.payload?.type).toBe("redirect");
    expect(proposal.autoSafe).toBe(true);
    expect(proposal.targetPath).toBe("cards/legacy-stub.md");
  });

  it("auto-applies safe redirect classification when requested", async () => {
    await writeFile(
      join(memexHome, "cards", "legacy-stub.md"),
      "---\ntitle: Legacy Stub\ncreated: 2026-01-01\nsource: test\n---\nRelocated to [[project/new-home]].",
    );

    const result = await maintainCommand(store, { memexHome, dryRun: false, applySafe: true });
    expect(result.success).toBe(true);
    expect(result.applied).toBe(1);

    const card = await readFile(join(memexHome, "cards", "legacy-stub.md"), "utf-8");
    expect(card).toContain("type: redirect");
  });

  it("review lists and approves proposals", async () => {
    await writeFile(
      join(memexHome, "cards", "alpha.md"),
      "---\ntitle: Alpha\ncreated: 2026-01-01\nsource: test\n---\nBody\nMore\nLines",
    );

    await maintainCommand(store, { memexHome, dryRun: false, maxBodyLines: 1 });

    const listed = await reviewCommand({ memexHome });
    expect(listed.success).toBe(true);
    expect(listed.output).toContain("Organization proposals");
    expect(listed.output).toContain("cards/alpha.md");

    const id = listed.output.split("\n").find((line) => line.startsWith("- "))?.split(" ")[1];
    expect(id).toBeTruthy();

    const approved = await reviewCommand({ memexHome, action: "approve", proposalId: id });
    expect(approved.success).toBe(true);
    expect(approved.output).toContain("approved");
  });
});
