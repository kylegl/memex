import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/core/store.js";
import { classifyCommand } from "../../src/commands/classify.js";

function card(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe("classify command", () => {
  let memexHome: string;
  let cardsDir: string;
  let archiveDir: string;
  let store: CardStore;

  beforeEach(async () => {
    memexHome = await mkdtemp(join(tmpdir(), "memex-classify-test-"));
    cardsDir = join(memexHome, "cards");
    archiveDir = join(memexHome, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    store = new CardStore(cardsDir, archiveDir, true);
    process.env.MEMEX_PI_BIN = "/usr/bin/true";
  });

  afterEach(async () => {
    delete process.env.MEMEX_PI_BIN;
    await rm(memexHome, { recursive: true, force: true });
  });

  it("supports dry-run explain output", async () => {
    await mkdir(join(cardsDir, "notes"), { recursive: true });
    await writeFile(
      join(cardsDir, "notes", "alpha.md"),
      card("title: Alpha\ncreated: 2026-01-01\nsource: test", "body"),
    );

    const result = await classifyCommand(store, {
      memexHome,
      dryRun: true,
      explain: true,
      runner: async () => ({
        proposals: [{
          kind: "classify",
          confidence: 0.95,
          rationale: "path indicates notes",
          evidence: ["path:notes"],
          payload: { type: "notes" },
          autoSafe: true,
        }],
      }),
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("dry-run");
    expect(result.output).toContain("path indicates notes");
    expect(result.proposalsCreated).toBe(1);
  });

  it("writes idempotent proposals once with repo-relative target paths", async () => {
    await mkdir(join(cardsDir, "project"), { recursive: true });
    await writeFile(
      join(cardsDir, "project", "alpha.md"),
      card("title: Alpha\ncreated: 2026-01-01\nsource: test", "body"),
    );

    const runner = async () => ({
      proposals: [{
        kind: "classify" as const,
        confidence: 0.95,
        rationale: "project path",
        evidence: ["path:project"],
        payload: { type: "project" },
        autoSafe: true,
      }],
    });

    const first = await classifyCommand(store, { memexHome, runner });
    const second = await classifyCommand(store, { memexHome, runner });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.proposalsCreated).toBe(1);
    expect(second.proposalsCreated).toBe(0);
    expect(second.proposalsSkipped).toBeGreaterThanOrEqual(1);

    const proposalsDir = join(memexHome, ".memex", "proposals");
    const proposalFiles = await readdir(proposalsDir);
    const proposalJson = await readFile(join(proposalsDir, proposalFiles[0]), "utf-8");
    expect(proposalJson).toContain('"targetPath":"cards/project/alpha.md"');
  });

  it("uses the Pi runtime runner when no test runner is injected", async () => {
    await writeFile(
      join(cardsDir, "alpha.md"),
      card("title: Alpha\ncreated: 2026-01-01\nsource: test", "body"),
    );

    const fakePi = join(memexHome, "fake-pi.sh");
    await writeFile(
      fakePi,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo fake-pi-1.0\n  exit 0\nfi\nprintf '%s\n' '{\"proposals\":[{\"kind\":\"classify\",\"confidence\":0.96,\"rationale\":\"runtime proposal\",\"evidence\":[\"runtime\"],\"payload\":{\"type\":\"notes\"},\"autoSafe\":true}]}'\n",
      { mode: 0o755 },
    );
    await chmod(fakePi, 0o755);
    process.env.MEMEX_PI_BIN = fakePi;

    const result = await classifyCommand(store, {
      memexHome,
      explain: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("runtime proposal");
    expect(result.proposalsCreated).toBe(1);
  });

  it("skips generated artifacts to avoid recursion", async () => {
    await writeFile(
      join(cardsDir, "index.md"),
      card("title: Keyword Index\ncreated: 2026-01-01\nsource: organize\ngenerated: navigation-index", "index"),
    );

    const result = await classifyCommand(store, {
      memexHome,
      runner: async () => ({
        proposals: [{
          kind: "classify",
          confidence: 0.9,
          rationale: "should not run",
          evidence: ["test"],
        }],
      }),
    });

    expect(result.success).toBe(true);
    expect(result.proposalsCreated).toBe(0);
    expect(result.output).toContain("skipped generated artifact");
  });
});
