# High-Level Operations & Hook System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat MCP tool surface with a two-tier architecture: high-level operations (recall, retro, organize, show, pull, push, init) with pre/post hooks, backed by low-level atomic tools.

**Architecture:** Add `src/lib/hooks.ts` for the hook system, `src/mcp/operations.ts` for high-level operations. Each operation declares pre/post hooks. `autoFetch` (pull) and `autoSync` (push) are registered as hooks, not hardcoded. MCP server exposes high-level tools; low-level tools remain for direct use. Skills and AGENTS.md simplified to just call high-level operations.

**Tech Stack:** Existing — TypeScript, MCP SDK, zod, vitest

---

## File Structure

| File | Role |
|------|------|
| `src/lib/hooks.ts` | **Create** — Hook registry: `runHooks(phase, operation, home)` |
| `src/lib/sync.ts` | **Modify** — Extract `pull()` and `push()` from `sync()`, add `autoFetch()` |
| `src/mcp/operations.ts` | **Create** — High-level operations: recall, retro, organize, show, pull, push, init |
| `src/mcp/server.ts` | **Modify** — Register high-level tools, keep low-level tools, remove old `memex_sync` |
| `src/commands/init.ts` | **Modify** — Simplify AGENTS.md template to use high-level operations |
| `hooks/hooks.json` | **Modify** — Add autoFetch to SessionStart hook |
| `skills/memex-recall/SKILL.md` | **Modify** — Remove `source: retro` references, card format uses `source: <client>` |
| `skills/memex-retro/SKILL.md` | **Modify** — Remove `source: retro`, update card format |
| `tests/lib/hooks.test.ts` | **Create** — Hook system tests |
| `tests/mcp/operations.test.ts` | **Create** — High-level operation tests |

---

### Task 1: Hook system (`src/lib/hooks.ts`)

**Files:**
- Create: `src/lib/hooks.ts`
- Test: `tests/lib/hooks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/hooks.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HookRegistry } from "../../src/lib/hooks.js";

describe("HookRegistry", () => {
  it("runs pre hooks in order", async () => {
    const registry = new HookRegistry();
    const log: string[] = [];
    registry.on("pre:recall", async () => { log.push("a"); });
    registry.on("pre:recall", async () => { log.push("b"); });
    await registry.run("pre", "recall");
    expect(log).toEqual(["a", "b"]);
  });

  it("runs post hooks in order", async () => {
    const registry = new HookRegistry();
    const log: string[] = [];
    registry.on("post:retro", async () => { log.push("x"); });
    await registry.run("post", "retro");
    expect(log).toEqual(["x"]);
  });

  it("does nothing when no hooks registered", async () => {
    const registry = new HookRegistry();
    await registry.run("pre", "organize"); // should not throw
  });

  it("swallows hook errors silently", async () => {
    const registry = new HookRegistry();
    registry.on("pre:recall", async () => { throw new Error("fail"); });
    await registry.run("pre", "recall"); // should not throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/hooks.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement hook system**

Create `src/lib/hooks.ts`:

```typescript
type Phase = "pre" | "post";
type Operation = "recall" | "retro" | "organize" | "show" | "pull" | "push" | "init";
type HookKey = `${Phase}:${Operation}`;
type HookFn = () => Promise<void>;

export class HookRegistry {
  private hooks = new Map<HookKey, HookFn[]>();

  on(key: HookKey, fn: HookFn): void {
    const existing = this.hooks.get(key) || [];
    existing.push(fn);
    this.hooks.set(key, existing);
  }

  async run(phase: Phase, operation: Operation): Promise<void> {
    const key: HookKey = `${phase}:${operation}`;
    for (const fn of this.hooks.get(key) || []) {
      try {
        await fn();
      } catch {
        // hooks fail silently — they're infrastructure, not business logic
      }
    }
  }
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run tests/lib/hooks.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks.ts tests/lib/hooks.test.ts
git commit -m "feat: add hook registry for pre/post operation lifecycle"
```

---

### Task 2: Extract pull/push from sync (`src/lib/sync.ts`)

**Files:**
- Modify: `src/lib/sync.ts`
- Test: `tests/lib/sync.test.ts` (existing, add cases)

- [ ] **Step 1: Write the failing test**

Add to existing sync tests or create `tests/lib/sync-pull-push.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GitAdapter, readSyncConfig } from "../../src/lib/sync.js";

describe("GitAdapter.pull", () => {
  it("returns success false when not configured", async () => {
    const adapter = new GitAdapter("/tmp/nonexistent-memex-test");
    const result = await adapter.pull();
    expect(result.success).toBe(false);
  });
});

describe("GitAdapter.push", () => {
  it("returns success false when not configured", async () => {
    const adapter = new GitAdapter("/tmp/nonexistent-memex-test");
    const result = await adapter.push();
    expect(result.success).toBe(false);
  });
});

describe("autoFetch", () => {
  it("is a no-op when sync not configured", async () => {
    const { autoFetch } = await import("../../src/lib/sync.js");
    // Should not throw, should silently return
    await autoFetch("/tmp/nonexistent-memex-test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/sync-pull-push.test.ts
```

Expected: FAIL — `pull`, `push`, `autoFetch` don't exist

- [ ] **Step 3: Refactor sync.ts**

Split `GitAdapter.sync()` into `pull()`, `push()`, and keep `sync()` as the composition:

```typescript
// Add to GitAdapter class:

async pull(): Promise<SyncResult> {
  const config = await readSyncConfig(this.home);
  if (!config.remote) {
    return { success: false, message: "Not configured." };
  }

  try {
    await execFile("git", ["-C", this.home, "fetch", "origin"]);
  } catch {
    return { success: true, message: "Offline, using local data." };
  }

  try {
    await execFile("git", ["-C", this.home, "merge", "origin/main", "--no-edit"]);
  } catch {
    try {
      await execFile("git", ["-C", this.home, "merge", "--abort"]);
    } catch { /* ignore */ }
    return { success: false, message: "Merge conflict. Resolve manually in " + this.home };
  }

  return { success: true, message: "Pulled latest." };
}

async push(): Promise<SyncResult> {
  const config = await readSyncConfig(this.home);
  if (!config.remote) {
    return { success: false, message: "Not configured." };
  }

  await execFile("git", ["-C", this.home, "add", "-A"]);
  try {
    const ts = new Date().toISOString();
    await execFile("git", ["-C", this.home, "commit", "-m", `memex sync ${ts}`]);
  } catch {
    // Nothing to commit
  }

  try {
    await execFile("git", ["-C", this.home, "push", "origin", "HEAD"]);
  } catch (err) {
    return { success: false, message: `Push failed: ${(err as Error).message}` };
  }

  config.lastSync = new Date().toISOString();
  await writeSyncConfig(this.home, config);
  return { success: true, message: "Pushed." };
}

// Rewrite sync() to compose pull + push:
async sync(): Promise<SyncResult> {
  const pullResult = await this.pull();
  if (!pullResult.success) return pullResult;

  const pushResult = await this.push();
  return pushResult;
}
```

Add `autoFetch` alongside existing `autoSync`:

```typescript
export async function autoFetch(home: string): Promise<void> {
  const config = await readSyncConfig(home);
  if (!config.remote) return; // silent no-op
  try {
    const adapter = new GitAdapter(home);
    await adapter.pull();
  } catch {
    // silent — infrastructure, not business logic
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: ALL pass (existing sync tests + new pull/push tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync.ts tests/lib/sync-pull-push.test.ts
git commit -m "refactor: extract pull/push from sync, add autoFetch"
```

---

### Task 3: High-level operations (`src/mcp/operations.ts`)

**Files:**
- Create: `src/mcp/operations.ts`
- Test: `tests/mcp/operations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/operations.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemexServer } from "../../src/mcp/server.js";
import { CardStore } from "../../src/lib/store.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    await writeFile(join(cardsDir, `${slug}.md`), content);
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

    // Verify card was written
    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "my-insight" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("My Insight");
    expect(text).toContain("architecture");
    expect(text).toContain("test-client"); // auto-injected source from clientInfo
  });

  it("memex_retro returns upsell when sync not configured", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: { slug: "test", title: "Test", body: "Content" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("memex init"); // upsell
  });

  it("memex_organize returns link stats", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: claude-code\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: claude-code\n---\nStandalone",
    });
    const result = await client.callTool({ name: "memex_organize", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("a");
    expect(text).toContain("b");
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
    expect(names).toContain("memex_init");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/operations.test.ts
```

Expected: FAIL — operations don't exist yet

- [ ] **Step 3: Implement operations**

Create `src/mcp/operations.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { HookRegistry } from "../lib/hooks.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { initCommand } from "../commands/init.js";
import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { GitAdapter, readSyncConfig } from "../lib/sync.js";
import { z } from "zod";

export function registerOperations(
  server: McpServer,
  store: CardStore,
  hooks: HookRegistry,
  home: string,
  getClientName: () => string,
): void {
  // ---- recall ----
  server.registerTool("memex_recall", {
    description: "Recall relevant memory before starting a task. Returns the keyword index (if exists) or card list. Optionally search by query. Always call this at the start of a task.",
    inputSchema: z.object({
      query: z.string().optional().describe("Optional search query to find specific cards"),
    }),
  }, async ({ query }) => {
    await hooks.run("pre", "recall");

    if (query) {
      const result = await searchCommand(store, query, { limit: 10 });
      return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
    }

    // Try index first, fall back to card list
    const indexResult = await readCommand(store, "index");
    if (indexResult.success) {
      return { content: [{ type: "text" as const, text: indexResult.content! }] };
    }

    const listResult = await searchCommand(store, undefined, {});
    return { content: [{ type: "text" as const, text: listResult.output || "No cards yet." }] };
  });

  // ---- retro ----
  server.registerTool("memex_retro", {
    description: "Save an insight after completing a task. Handles frontmatter, source injection, and sync automatically. Call this at the end of a task when you learned something worth remembering.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case"),
      title: z.string().describe("Card title"),
      body: z.string().describe("Card body in markdown with [[wikilinks]]"),
      category: z.string().optional().describe("Category (e.g. frontend, architecture, devops, bugfix)"),
    }),
  }, async ({ slug, title, body, category }) => {
    await hooks.run("pre", "retro");

    const today = new Date().toISOString().split("T")[0];
    const data: Record<string, unknown> = {
      title,
      created: today,
      source: getClientName(),
    };
    if (category) data.category = category;
    const content = stringifyFrontmatter(body, data);

    const result = await writeCommand(store, slug, content);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }

    await hooks.run("post", "retro");

    // Upsell init if sync not configured
    const config = await readSyncConfig(home);
    const tip = !config.remote
      ? "\n\nTip: Run `memex init` to enable cross-device sync."
      : "";

    return { content: [{ type: "text" as const, text: `Card '${slug}' saved.${tip}` }] };
  });

  // ---- organize ----
  server.registerTool("memex_organize", {
    description: "Analyze the card network for maintenance. Returns link stats, orphans, and hubs. Call periodically to keep the knowledge graph healthy.",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "organize");

    const result = await linksCommand(store, undefined);

    await hooks.run("post", "organize");

    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  // ---- pull ----
  server.registerTool("memex_pull", {
    description: "Pull latest cards from remote. Use to get changes from other devices.",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "pull");

    const config = await readSyncConfig(home);
    if (!config.remote) {
      return { content: [{ type: "text" as const, text: "Sync not configured. Run `memex init` to set up." }] };
    }
    const adapter = new GitAdapter(home);
    const result = await adapter.pull();

    await hooks.run("post", "pull");

    return { content: [{ type: "text" as const, text: result.message }], isError: !result.success };
  });

  // ---- push ----
  server.registerTool("memex_push", {
    description: "Push local cards to remote. Use after writing cards to sync to other devices.",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "push");

    const config = await readSyncConfig(home);
    if (!config.remote) {
      return { content: [{ type: "text" as const, text: "Sync not configured. Run `memex init` to set up." }] };
    }
    const adapter = new GitAdapter(home);
    const result = await adapter.push();

    await hooks.run("post", "push");

    return { content: [{ type: "text" as const, text: result.message }], isError: !result.success };
  });

  // ---- init ----
  server.registerTool("memex_init", {
    description: "Set up memex in the current project. Creates AGENTS.md with memory workflow instructions.",
    inputSchema: z.object({
      dir: z.string().optional().describe("Project directory (defaults to cwd)"),
    }),
  }, async ({ dir }) => {
    const result = await initCommand(dir || process.cwd());
    return { content: [{ type: "text" as const, text: result.output || result.error || "" }], isError: !result.success };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/mcp/operations.test.ts
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/operations.ts tests/mcp/operations.test.ts
git commit -m "feat: add high-level operations with hook lifecycle"
```

---

### Task 4: Rewire MCP server (`src/mcp/server.ts`)

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Rewrite server.ts**

Replace `src/mcp/server.ts` to:
1. Keep low-level tools (search, read, write, links, archive)
2. Remove old `memex_sync` tool
3. Register high-level operations via `registerOperations()`
4. Wire hooks: `pre:recall → autoFetch`, `pre:retro → autoFetch`, `pre:organize → autoFetch`, `post:retro → autoSync`, `post:organize → autoSync`
5. Call `autoFetch` on connect

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { archiveCommand } from "../commands/archive.js";
import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { autoFetch, autoSync } from "../lib/sync.js";
import { HookRegistry } from "../lib/hooks.js";
import { registerOperations } from "./operations.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

export function createMemexServer(store: CardStore, home?: string): McpServer {
  const server = new McpServer({
    name: "memex",
    version: pkg.version,
  });

  // Capture client name from MCP initialize handshake
  let clientName = "mcp";
  const origConnect = server.connect.bind(server);
  server.connect = async (transport) => {
    const origOnMessage = transport.onmessage;
    transport.onmessage = (msg: any) => {
      if (msg?.method === "initialize" && msg?.params?.clientInfo?.name) {
        clientName = msg.params.clientInfo.name.toLowerCase().replace(/\s+/g, "-");
      }
      if (origOnMessage) origOnMessage(msg);
    };

    const result = origConnect(transport);

    // Auto-fetch on connect (session start)
    if (home) {
      autoFetch(home).catch(() => {});
    }

    return result;
  };

  // ---- Low-level tools (unchanged) ----

  server.registerTool("memex_search", {
    description: "Search memory cards by keyword, or list all. Low-level tool — prefer memex_recall for task-start workflows.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search keyword. Omit to list all cards."),
      limit: z.number().optional().describe("Max results (default 10)"),
    }),
  }, async ({ query, limit }) => {
    const result = await searchCommand(store, query, { limit });
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_read", {
    description: "Read a card's full content. Low-level tool — use after memex_recall to drill into specific cards.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug (e.g. 'my-card-name')"),
    }),
  }, async ({ slug }) => {
    const result = await readCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: result.content! }] };
  });

  server.registerTool("memex_write", {
    description: "Write or update a card. Low-level tool — prefer memex_retro for task-end workflows (handles frontmatter and sync automatically).",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case"),
      content: z.string().describe("Full card content: YAML frontmatter + markdown body"),
      category: z.string().optional().describe("Card category"),
    }),
  }, async ({ slug, content, category }) => {
    const { data, content: body } = parseFrontmatter(content);
    if (!data.source) data.source = clientName;
    if (category && !data.category) data.category = category;
    const enrichedContent = stringifyFrontmatter(body, data);
    const result = await writeCommand(store, slug, enrichedContent);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' written.` }] };
  });

  server.registerTool("memex_links", {
    description: "Show link graph stats or specific card links. Low-level tool — prefer memex_organize for maintenance workflows.",
    inputSchema: z.object({
      slug: z.string().optional().describe("Card slug. Omit for global stats."),
    }),
  }, async ({ slug }) => {
    const result = await linksCommand(store, slug);
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_archive", {
    description: "Move a card to the archive.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug to archive"),
    }),
  }, async ({ slug }) => {
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' archived.` }] };
  });

  // ---- High-level operations (with hooks) ----

  if (home) {
    const hooks = new HookRegistry();

    // Wire hooks: pull before read-heavy ops, push after write-heavy ops
    hooks.on("pre:recall", () => autoFetch(home));
    hooks.on("pre:retro", () => autoFetch(home));
    hooks.on("pre:organize", () => autoFetch(home));
    hooks.on("post:retro", () => autoSync(home));
    hooks.on("post:organize", () => autoSync(home));

    registerOperations(server, store, hooks, home, () => clientName);
  }

  return server;
}
```

- [ ] **Step 2: Update existing server tests**

Update `tests/mcp/server.test.ts`:
- Change tool count from 6 to 11 (5 low-level + 6 high-level: recall, retro, organize, pull, push, init)
- Remove `memex_sync` test (replaced by pull/push)
- Keep all other low-level tool tests

- [ ] **Step 3: Run all tests**

```bash
npm run build && npx vitest run
```

Expected: ALL tests pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "refactor: rewire MCP server with high-level operations and hook lifecycle"
```

---

### Task 5: Update AGENTS.md template, skills, and hooks

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `skills/memex-recall/SKILL.md`
- Modify: `skills/memex-retro/SKILL.md`
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Simplify AGENTS.md template**

Update `AGENTS_SECTION` in `src/commands/init.ts`:

```typescript
const AGENTS_SECTION = `## Memory (memex)

- **Task start**: Call memex_recall to retrieve relevant prior knowledge
- **Task end**: Call memex_retro to save non-obvious insights
`;
```

- [ ] **Step 2: Update retro skill card format**

In `skills/memex-retro/SKILL.md`, change the card format example:
- Remove `source: retro` from the template (source is now auto-injected as client name)
- Remove the "Preserve source on update" rule (source is auto-managed)

- [ ] **Step 3: Add autoFetch to SessionStart hook**

In `hooks/hooks.json`, add `memex sync 2>/dev/null;` at the beginning of the SessionStart command (after the CLI check), so cards are pulled at session start for Claude Code users.

- [ ] **Step 4: Run all tests**

```bash
npm run build && npx vitest run
```

Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts skills/ hooks/hooks.json
git commit -m "feat: simplify AGENTS.md to two lines, update skills and hooks"
```

---

### Task 6: Full regression + cleanup

- [ ] **Step 1: Run full test suite**

```bash
npm run build && npm test
```

Expected: ALL tests pass

- [ ] **Step 2: Verify MCP server smoke test**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/cli.js mcp
```

Expected: JSON response with server info

- [ ] **Step 3: Verify existing CLI commands**

```bash
memex search
memex read index
memex links
```

Expected: Same output as before

- [ ] **Step 4: Commit any fixups**

```bash
git add -p
git commit -m "chore: regression fixups"
```
