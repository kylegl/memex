# memex

Persistent memory for AI coding agents. Your agent remembers what it learned across sessions.

![memex timeline view](screenshot.png)

## What it does

Every time your AI agent finishes a task, it saves insights as atomic knowledge cards with `[[bidirectional links]]`. Next session, it recalls relevant cards before starting work — building on what it already knows instead of starting from scratch.

```
Session 1: Agent fixes auth bug → saves insight about JWT revocation
Session 2: Agent works on session management → recalls JWT card, builds on prior knowledge
Session 3: Agent organizes card network → detects orphans, rebuilds keyword index
```

No vector database, no embeddings — just markdown files your agent (and you) can read.

## Install

| Platform | Command |
|----------|---------|
| **Any editor** | `npx add-mcp @touchskyer/memex -- mcp` |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex` then `/plugin install memex@memex` |
| **VS Code / Copilot** | [Install from MCP Registry](https://registry.modelcontextprotocol.io) or `code --add-mcp '{"name":"memex","command":"npx","args":["-y","@touchskyer/memex","mcp"]}'` |
| **Cursor** | [One-click install](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB0b3VjaHNreWVyL21lbWV4IiwibWNwIl19) |
| **Codex** | `codex mcp add memex -- npx -y @touchskyer/memex mcp` |
| **Windsurf / others** | Add MCP server: command `npx`, args `["-y", "@touchskyer/memex", "mcp"]` |

**Then, in your project directory:**

```bash
npx @touchskyer/memex init
```

This adds a memex section to `AGENTS.md` that teaches your agent when to recall and retro. Works with Cursor, Copilot, Codex, and Windsurf. Claude Code users don't need this — the plugin handles it.

## Upgrade

| Platform | How |
|----------|-----|
| **npx users** (VS Code, Cursor, Windsurf) | Automatic — `npx -y` always fetches latest |
| **Claude Code** | `npm update -g @touchskyer/memex` (plugin updates from marketplace) |
| **Codex / global install** | `npm update -g @touchskyer/memex` |

## Browse your memory

```bash
memex serve
```

Opens a visual timeline of all your cards at `localhost:3939`.

## Sync across devices

```bash
memex sync --init git@github.com:you/memex-cards.git
memex sync on      # enable auto-sync after every write
memex sync         # manual sync
memex sync off     # disable auto-sync
```

Cards are plain markdown — git handles merging and history.

## CLI reference

```bash
memex search [query]          # search cards, or list all
memex read <slug>             # read a card
memex write <slug>            # write a card (stdin)
memex links [slug]            # link graph stats
memex archive <slug>          # archive a card
memex serve                   # visual timeline UI
memex sync                    # sync via git
memex mcp                     # start MCP server (stdio)
memex init                    # add memex section to AGENTS.md
```

## How it works

Based on Niklas Luhmann's Zettelkasten method — the system behind 70 books from 90,000 handwritten cards:

- **Atomic notes** — one idea per card
- **Own words** — forces understanding (the Feynman method)
- **Links in context** — "this relates to [[X]] because..." not just tags
- **Keyword index** — curated entry points to the card network

Cards are stored as markdown in `~/.memex/cards/`. Open them in Obsidian, edit with vim, grep from terminal. Your memory is never locked in.

## License

MIT
