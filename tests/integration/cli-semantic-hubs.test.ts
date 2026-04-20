import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec as execCb } from "node:child_process";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");

function run(
  cmd: string,
  opts: { env: Record<string, string>; input?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execCb(cmd, { env: opts.env }, (err, stdout, stderr) => {
      if (err) {
        const e: any = err;
        e.stdout = stdout;
        e.stderr = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
    if (opts.input !== undefined) {
      child.stdin!.write(opts.input);
      child.stdin!.end();
    }
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf-8");
    return true;
  } catch {
    return false;
  }
}

describe("CLI organize with semantic hub slugs", () => {
  let tmpDir: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-cli-semantic-hubs-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    env = { ...process.env, MEMEX_HOME: tmpDir } as Record<string, string>;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates semantic hubs and legacy redirect aliases when enabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true, semanticHubSlugs: true }));

    await mkdir(join(tmpDir, "cards", "notes", "sub"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "notes", "topic.md"),
      "---\ntitle: Topic\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nTopic",
    );
    await writeFile(
      join(tmpDir, "cards", "notes", "sub", "deep.md"),
      "---\ntitle: Deep\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nDeep",
    );

    const { stdout } = await run(`node ${CLI_PATH} organize`, { env });
    expect(stdout).toContain("- mode: nested");
    expect(stdout).toContain("- hub slugs: semantic");

    const rootIndex = await readFile(join(tmpDir, "cards", "index.md"), "utf-8");
    const notesHub = await readFile(join(tmpDir, "cards", "notes", "notes.md"), "utf-8");
    const notesLegacy = await readFile(join(tmpDir, "cards", "notes", "index.md"), "utf-8");

    expect(rootIndex).toContain("[[notes/notes]]");
    expect(notesHub).toContain("[[notes/sub/sub]]");
    expect(notesLegacy).toContain("type: redirect");
    expect(notesLegacy).toContain("Relocated to [[notes/notes]].");
  });

  it("flat organize reports semantic hub artifacts as mixed-mode artifacts", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false, semanticHubSlugs: true }));

    await mkdir(join(tmpDir, "cards", "notes"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "notes", "notes.md"),
      "---\ntitle: Notes Hub\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: organize\ngenerated: navigation-index\n---\nHub",
    );
    await writeFile(
      join(tmpDir, "cards", "topic.md"),
      "---\ntitle: Topic\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nTopic",
    );

    const { stdout } = await run(`node ${CLI_PATH} organize`, { env });
    expect(stdout).toContain("- mode: flat");
    expect(stdout).toContain("- mixed-mode artifacts: 1");
    expect(stdout).toContain("- notes/notes");

    // flat mode should not create nested hubs
    expect(await fileExists(join(tmpDir, "cards", "notes", "index.md"))).toBe(false);
  });
});
