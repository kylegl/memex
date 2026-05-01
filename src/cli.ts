#!/usr/bin/env node
import { Command } from "commander";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { CardStore } from "./lib/store.js";
import { readConfig, resolveMemexHome, warnIfEmptyCards } from "./lib/config.js";
import { writeCommand } from "./commands/write.js";
import { readCommand } from "./commands/read.js";
import { searchCommand } from "./commands/search.js";
import { linksCommand } from "./commands/links.js";
import { archiveCommand } from "./commands/archive.js";
import { serveCommand } from "./commands/serve.js";
import { syncCommand } from "./commands/sync.js";
import { importCommand } from "./commands/import.js";
import { doctorCommand } from "./commands/doctor.js";
import { migrateCommand } from "./commands/migrate.js";
import { backlinksCommand } from "./commands/backlinks.js";
import { organizeCommand } from "./commands/organize.js";
import { classifyCommand, classifyRecentCommand, classifySlugsForEvent, isAutoClassifyEnabled } from "./commands/classify.js";
import { reviewCommand } from "./commands/review.js";
import { maintainCommand } from "./commands/maintain.js";
import { flomoConfigCommand, flomoPushCommand, flomoImportCommand } from "./commands/flomo.js";
import { ingestUrlCommand, type IngestKindSelection } from "./commands/ingest.js";

async function getStore(opts?: { nested?: boolean }): Promise<CardStore> {
  const home = await resolveMemexHome();
  await warnIfEmptyCards(home);
  const config = await readConfig(home);
  const nestedSlugs = opts?.nested ?? config.nestedSlugs;
  return new CardStore(join(home, "cards"), join(home, "archive"), nestedSlugs);
}

/** Flush stdout before exiting to avoid pipe-buffer truncation (Node.js issue). */
function exit(code: number): void {
  if (process.stdout.writableLength === 0) {
    process.exit(code);
  } else {
    process.stdout.once("drain", () => process.exit(code));
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const program = new Command();
program.name("memex").description("Zettelkasten agent memory CLI").version(pkg.version);

program
  .command("search [query]")
  .description("Full-text search cards (body only), or list all if no query")
  .option("-l, --limit <n>", "Max results to return", "10")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .option("--all", "Search across all configured searchDirs in addition to cards/")
  .option("-s, --semantic", "Use embedding-based semantic search")
  .option("-c, --compact", "Compact output (one line per result)")
  .option("--category <value>", "Filter by frontmatter category")
  .option("--tag <value>", "Filter by frontmatter tag")
  .option("--author <value>", "Filter by frontmatter author/source")
  .option("--since <date>", "Only cards created/modified after this date (YYYY-MM-DD)")
  .option("--before <date>", "Only cards created/modified before this date (YYYY-MM-DD)")
  .action(async (query: string | undefined, opts: { limit: string; nested?: boolean; all?: boolean; semantic?: boolean; compact?: boolean; category?: string; tag?: string; author?: string; since?: string; before?: string }) => {
    const home = await resolveMemexHome();
    const config = await readConfig(home);
    const store = await getStore({ nested: opts.nested });
    const filter = (opts.category || opts.tag || opts.author || opts.since || opts.before)
      ? { category: opts.category, tag: opts.tag, author: opts.author, since: opts.since, before: opts.before }
      : undefined;
    const result = await searchCommand(store, query, { limit: parseInt(opts.limit, 10), all: opts.all, config, memexHome: home, semantic: opts.semantic, compact: opts.compact, filter });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("read <slug>")
  .description("Read a card's full content")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .action(async (slug: string, opts: { nested?: boolean }) => {
    const store = await getStore({ nested: opts.nested });
    const result = await readCommand(store, slug);
    if (result.success) {
      process.stdout.write(result.content! + "\n");
    } else {
      process.stderr.write(result.error! + "\n");
      exit(1);
    }
  });

program
  .command("write <slug>")
  .description("Write a card (content via stdin)")
  .action(async (slug: string) => {
    const home = await resolveMemexHome();
    const store = await getStore();
    const input = await readStdin();

    try {
      const result = await writeCommand(store, slug, input, {
        afterWrite: async ({ slug: writtenSlug }) => {
          if (!isAutoClassifyEnabled()) return;
          const classify = await classifySlugsForEvent(store, home, [writtenSlug], "post-write");
          if (!classify.success) throw new Error(classify.output);
        },
      });
      if (!result.success) {
        process.stderr.write(result.error! + "\n");
        exit(1);
      }
    } catch (error) {
      process.stderr.write((error as Error).message + "\n");
      exit(1);
    }
  });

program
  .command("links [slug]")
  .description("Show link graph stats or specific card links")
  .action(async (slug?: string) => {
    const store = await getStore();
    const result = await linksCommand(store, slug);
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("backlinks <slug>")
  .description("Show all cards that link to <slug> via [[wiki-links]]")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .option("--all", "Search across all configured searchDirs in addition to cards/")
  .action(async (slug: string, opts: { nested?: boolean; all?: boolean }) => {
    const home = await resolveMemexHome();
    const config = await readConfig(home);
    const store = await getStore({ nested: opts.nested });
    const result = await backlinksCommand(store, slug, { all: opts.all, config, memexHome: home });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("archive <slug>")
  .description("Move a card to archive")
  .action(async (slug: string) => {
    const store = await getStore();
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      process.stderr.write(result.error! + "\n");
      exit(1);
    }
  });

program
  .command("serve")
  .description("Start web UI for browsing cards")
  .option("-p, --port <n>", "Port number", "3939")
  .action(async (opts: { port: string }) => {
    await serveCommand(parseInt(opts.port, 10));
  });

program
  .command("sync")
  .description("Sync cards across devices via git")
  .option("--init", "Initialize sync")
  .option("--status", "Show sync status")
  .argument("[arg]", "Remote URL (for --init) or on/off (toggle auto-sync)")
  .action(
    async (
      arg: string | undefined,
      opts: { init?: boolean; status?: boolean }
    ) => {
      const home = await resolveMemexHome();

      // memex sync on / memex sync off
      if (arg === "on" || arg === "off") {
        const result = await syncCommand(home, { auto: arg });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      // memex sync push / memex sync pull
      if (arg === "push" || arg === "pull") {
        const result = await syncCommand(home, { action: arg as "push" | "pull" });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      // memex sync status (positional alias)
      if (arg === "status") {
        const result = await syncCommand(home, { status: true });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      const result = await syncCommand(home, {
        ...opts,
        remote: opts.init ? arg : undefined,
        init: opts.init,
      });
      if (result.output) process.stdout.write(result.output + "\n");
      if (result.error) {
        process.stderr.write(result.error + "\n");
        exit(1);
      }
    }
  );

program
  .command("organize")
  .description("Analyze card network: orphans, hubs, conflicts, and contradiction pairs")
  .option("--since <date>", "Only check cards modified since this date (YYYY-MM-DD)")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .action(async (opts: { since?: string; nested?: boolean }) => {
    const home = await resolveMemexHome();
    const store = await getStore({ nested: opts.nested });
    const result = await organizeCommand(store, opts.since ?? null, { memexHome: home });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .action(async () => {
    const { createMemexServer } = await import("./mcp/server.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const home = await resolveMemexHome();
    const store = await getStore();
    const server = createMemexServer(store, home);
    const transport = new StdioServerTransport();
    console.error("memex MCP server running on stdio");
    await server.connect(transport);
  });

program
  .command("import [source]")
  .description("Import memories from other tools (openclaw, fieldtheory, ...)")
  .option("--dry-run", "Preview without writing")
  .option("--dir <path>", "Override source directory")
  .action(async (source: string | undefined, opts: { dryRun?: boolean; dir?: string }) => {
    const home = await resolveMemexHome();
    const store = await getStore();

    try {
      const result = await importCommand(store, source, {
        ...opts,
        afterImport: async ({ importedSlugs }) => {
          if (!isAutoClassifyEnabled()) return;
          if (importedSlugs.length === 0) return;
          const classify = await classifySlugsForEvent(store, home, importedSlugs, "post-import");
          if (!classify.success) throw new Error(classify.output);
        },
      });
      if (result.output) process.stdout.write(result.output + "\n");
      if (!result.success) {
        if (result.error) process.stderr.write(result.error + "\n");
        exit(1);
      }
    } catch (error) {
      process.stderr.write((error as Error).message + "\n");
      exit(1);
    }
  });

program
  .command("ingest-url <url>")
  .description("Ingest a URL and create a memory card with detected content type and key points")
  .option("--dry-run", "Preview inferred metadata and card content without writing")
  .option("--slug <slug>", "Override target slug")
  .option("--title <title>", "Override extracted title")
  .option("--kind <kind>", "Content kind: auto|research-paper|article|youtube-video|web-page", "auto")
  .option("--agent-mode <mode>", "Agent mode: optional|required|off", "optional")
  .action(async (url: string, opts: { dryRun?: boolean; slug?: string; title?: string; kind?: string; agentMode?: string; agent_mode?: string }) => {
    const home = await resolveMemexHome();
    const store = await getStore();

    const kind = parseIngestKind(opts.kind);
    if (!kind) {
      process.stderr.write(`Invalid --kind value '${opts.kind}'. Use one of: auto, research-paper, article, youtube-video, web-page\n`);
      exit(1);
      return;
    }

    const agentMode = parseIngestAgentMode(opts.agentMode ?? opts.agent_mode);
    if (!agentMode) {
      process.stderr.write(`Invalid --agent-mode value '${opts.agentMode}'. Use one of: required, optional, off\n`);
      exit(1);
      return;
    }

    try {
      const result = await ingestUrlCommand(store, url, {
        dryRun: opts.dryRun,
        slug: opts.slug,
        title: opts.title,
        kind,
        source: "ingest-url",
        memexHome: home,
        agentMode,
        afterWrite: async ({ slug: writtenSlug }) => {
          if (!isAutoClassifyEnabled()) return;
          const classify = await classifySlugsForEvent(store, home, [writtenSlug], "post-import");
          if (!classify.success) throw new Error(classify.output);
        },
      });
      if (result.output) process.stdout.write(result.output + "\n");
      exit(result.exitCode);
    } catch (error) {
      process.stderr.write((error as Error).message + "\n");
      exit(1);
    }
  });

program
  .command("doctor")
  .description("Check memex health and configuration")
  .option("--check-collisions", "Check for slug collisions in basename mode")
  .action(async (opts: { checkCollisions?: boolean }) => {
    const home = await resolveMemexHome();
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.checkCollisions) {
      const result = await doctorCommand(cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      exit(result.exitCode);
    } else {
      process.stderr.write("No check specified. Use --check-collisions to check for slug collisions.\n");
      exit(1);
    }
  });

program
  .command("migrate")
  .description("Migrate memex configuration")
  .option("--enable-nested", "Enable nestedSlugs in config")
  .action(async (opts: { enableNested?: boolean }) => {
    const home = await resolveMemexHome();
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.enableNested) {
      const result = await migrateCommand(home, cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      if (!result.success) {
        if (result.error) process.stderr.write(result.error + "\n");
        exit(1);
      }
    } else {
      process.stderr.write("No migration specified. Use --enable-nested to enable nestedSlugs.\n");
      exit(1);
    }
  });

program
  .command("classify")
  .description("Classify one/all/recent cards into bounded organization proposals")
  .option("--slug <slug>", "Classify one card by slug")
  .option("--recent <date>", "Classify recently modified cards since date (YYYY-MM-DD)")
  .option("--dry-run", "Preview proposals without writing proposal files")
  .option("--apply-safe", "Auto-apply safe high-confidence classify proposals")
  .option("--explain", "Include rationale in output")
  .action(async (opts: { slug?: string; recent?: string; dryRun?: boolean; applySafe?: boolean; explain?: boolean }) => {
    const home = await resolveMemexHome();
    const store = await getStore();
    const result = opts.recent
      ? await classifyRecentCommand(store, {
        memexHome: home,
        since: opts.recent,
        slug: opts.slug,
        dryRun: opts.dryRun,
        applySafe: opts.applySafe,
        explain: opts.explain,
      })
      : await classifyCommand(store, {
        memexHome: home,
        slug: opts.slug,
        dryRun: opts.dryRun,
        applySafe: opts.applySafe,
        explain: opts.explain,
      });

    const stream = result.success ? process.stdout : process.stderr;
    stream.write(result.output + "\n");
    if (!result.success) exit(1);
  });

program
  .command("review")
  .description("Review organization proposals (list, approve, reject)")
  .option("--status <status>", "Filter list by status")
  .option("--approve <id>", "Approve a proposal id")
  .option("--reject <id>", "Reject a proposal id")
  .action(async (opts: { status?: string; approve?: string; reject?: string }) => {
    const home = await resolveMemexHome();
    const action = opts.approve ? "approve" : opts.reject ? "reject" : "list";
    const proposalId = opts.approve || opts.reject;

    const result = await reviewCommand({
      memexHome: home,
      action,
      proposalId,
      status: (opts.status as "pending" | "approved" | "rejected" | "applied" | undefined),
    });

    const stream = result.success ? process.stdout : process.stderr;
    stream.write(result.output + "\n");
    if (!result.success) exit(1);
  });

program
  .command("maintain")
  .description("Generate bounded maintenance proposals (duplicate/split/MOC/redirect suggestions)")
  .option("--dry-run", "Preview proposals without writing")
  .option("--apply-safe", "Auto-apply safe redirect classify proposals")
  .option("--max-body-lines <n>", "Split-suggestion threshold", "220")
  .action(async (opts: { dryRun?: boolean; applySafe?: boolean; maxBodyLines: string }) => {
    const home = await resolveMemexHome();
    const store = await getStore();
    const result = await maintainCommand(store, {
      memexHome: home,
      dryRun: opts.dryRun,
      applySafe: opts.applySafe,
      maxBodyLines: parseInt(opts.maxBodyLines, 10),
    });

    const stream = result.success ? process.stdout : process.stderr;
    stream.write(result.output + "\n");
    if (!result.success) exit(1);
  });

const flomo = program
  .command("flomo")
  .description("Flomo integration (push/import/config)");

flomo
  .command("config")
  .description("Configure flomo webhook URL")
  .option("--set-webhook <url>", "Set the flomo webhook URL")
  .option("--show", "Show current configuration")
  .action(async (opts: { setWebhook?: string; show?: boolean }) => {
    const home = await resolveMemexHome();
    const result = await flomoConfigCommand(home, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

flomo
  .command("push [slug]")
  .description("Push card(s) to flomo")
  .option("--all", "Push all matching cards")
  .option("--source <value>", "Filter by source")
  .option("--tag <value>", "Filter by tag or category")
  .option("--dry-run", "Preview without pushing")
  .action(async (slug: string | undefined, opts: { all?: boolean; source?: string; tag?: string; dryRun?: boolean }) => {
    if (!slug && !opts.all && !opts.source && !opts.tag) {
      process.stderr.write("Error: specify a slug or use --all/--source/--tag to filter.\n");
      exit(1);
    }
    const home = await resolveMemexHome();
    const store = await getStore();
    const result = await flomoPushCommand(store, home, slug, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

flomo
  .command("import <file>")
  .description("Import memos from flomo HTML export")
  .option("--dry-run", "Preview without writing cards")
  .action(async (file: string, opts: { dryRun?: boolean }) => {
    const store = await getStore();
    const result = await flomoImportCommand(store, file, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program.parse();

function parseIngestKind(value: string | undefined): IngestKindSelection | null {
  if (!value) return "auto";
  if (value === "auto" || value === "research-paper" || value === "article" || value === "youtube-video" || value === "web-page") {
    return value;
  }
  return null;
}

function parseIngestAgentMode(value: string | undefined): "required" | "optional" | "off" | null {
  if (!value) return "optional";
  if (value === "required" || value === "optional" || value === "off") return value;
  return null;
}
