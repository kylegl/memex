import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../core/store.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { archiveCommand } from "../commands/archive.js";
import { parseFrontmatter, stringifyFrontmatter } from "../core/parser.js";
import { readConfig } from "../core/config.js";
import { HookRegistry } from "../core/hooks.js";
import { autoFetch, autoSync } from "../core/sync.js";
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
    // Listen for messages to capture client info
    const origOnMessage = transport.onmessage;
    transport.onmessage = (msg: any) => {
      if (msg?.method === "initialize" && msg?.params?.clientInfo?.name) {
        clientName = msg.params.clientInfo.name.toLowerCase().replace(/\s+/g, "-");
      }
      if (origOnMessage) origOnMessage(msg);
    };
    await origConnect(transport);
    if (home) await autoFetch(home);
  };

  server.registerTool("memex_search", {
    description: "Low-level search. Prefer memex_recall for task-start workflows.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search keyword. Omit to list all cards."),
      limit: z.number().optional().describe("Max results (default 10)"),
      semantic: z.boolean().optional().describe("Use embedding-based semantic search"),
    }),
  }, async ({ query, limit, semantic }) => {
    const config = home ? await readConfig(home) : undefined;
    const result = await searchCommand(store, query, { limit, semantic, config, memexHome: home });
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_read", {
    description: "Low-level read. Use after memex_recall to drill into specific cards.",
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
    description: "Low-level write. Prefer memex_retro for task-end workflows (handles frontmatter and sync automatically).",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case (e.g. 'my-insight')"),
      content: z.string().describe("Full card content: YAML frontmatter + markdown body. Title must be ≤60 chars, noun phrase not full sentence."),
      category: z.string().optional().describe("Card category (e.g. 'frontend', 'architecture', 'devops', 'bugfix')"),
    }),
  }, async ({ slug, content, category }) => {
    // Auto-inject source (client name) if not in frontmatter
    const { data, content: body } = parseFrontmatter(content);
    if (!data.source) data.source = clientName;
    if (category && !data.category) data.category = category;
    const enrichedContent = stringifyFrontmatter(body, data);
    const result = await writeCommand(store, slug, enrichedContent);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' written successfully.` }] };
  });

  server.registerTool("memex_links", {
    description: "Low-level link stats. Prefer memex_organize for maintenance workflows.",
    inputSchema: z.object({
      slug: z.string().optional().describe("Card slug. Omit for global stats."),
    }),
  }, async ({ slug }) => {
    const result = await linksCommand(store, slug);
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_archive", {
    description: "Move a card to the archive. Use for outdated or superseded cards.",
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

  if (home) {
    const hooks = new HookRegistry();
    hooks.on("pre:recall", () => autoFetch(home));
    hooks.on("pre:retro", () => autoFetch(home));
    hooks.on("pre:organize", () => autoFetch(home));
    hooks.on("post:retro", () => autoSync(home));
    hooks.on("post:organize", () => autoSync(home));
    registerOperations(server, store, hooks, home, () => clientName);
  }

  return server;
}
