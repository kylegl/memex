# Memex Architecture Reference

> Comprehensive technical documentation for contributors and AI coding agents.
> For quick-start instructions, see the root README.md.

## 1. Project Overview

**Memex** (`@touchskyer/memex`, v0.1.26) is a persistent Zettelkasten memory system for AI coding agents. It stores atomic knowledge cards as markdown files in `~/.memex/cards/`, using `[[wikilinks]]` for bidirectional linking. No vector database, no embeddings required (optional).

**Core philosophy**: Recall → Work → Retro. Every session starts by recalling prior knowledge, ends by saving new insights.

**Repository**: https://github.com/iamtouchskyer/memex
**License**: MIT

## 2. Architecture Layers

```
┌─────────────────────────────────────────────┐
│              Client Layer                   │
│  Claude Code │ VS Code │ Cursor │ Pi │ MCP │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           MCP Server (src/mcp/)             │
│  14 tools: recall, retro, organize,         │
│  search, read, write, ingest_url, links,    │
│  archive, classify, review, maintain,       │
│  pull, push                                 │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Command Layer (src/commands/)      │
│  search, read, write, links, backlinks,     │
│  archive, organize, classify, review,       │
│  maintain, serve, sync, import, doctor,     │
│  migrate                                    │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Library Layer (src/core/)           │
│  CardStore, Parser, Formatter, HookRegistry,│
│  GitAdapter, EmbeddingProvider, Config       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Storage (~/.memex/)               │
│  cards/  archive/  .sync.json  .memexrc     │
└─────────────────────────────────────────────┘
```

## 3. Source Code Map

```
src/
├── cli.ts                    # CLI entry point (commander)
├── mcp/
│   ├── server.ts             # MCP server factory, client-aware source tagging
│   └── operations.ts         # High-level MCP tools: recall, retro, organize, pull, push
├── commands/
│   ├── search.ts             # Keyword + semantic search, manifest pre-filter
│   ├── read.ts               # Read card by slug
│   ├── write.ts              # Write card (validates frontmatter, updates modified date)
│   ├── links.ts              # Link graph stats (single card or global)
│   ├── backlinks.ts          # Find cards linking TO a slug
│   ├── archive.ts            # Move card to archive/
│   ├── organize.ts           # Network analysis + proposal reconciliation + index rebuild
│   ├── rebuild-index.ts      # Deterministic root/nested navigation index builder
│   ├── classify.ts           # AI proposal capture (one/all/recent + dry-run/explain)
│   ├── review.ts             # Proposal lifecycle transitions (list/approve/reject)
│   ├── maintain.ts           # Bounded maintain suggestions (split/MOC candidates)
│   ├── serve.ts              # Web UI server (serve-ui.html)
│   ├── sync.ts               # CLI sync orchestrator (init, pull, push, auto toggle)
│   ├── import.ts             # Import dispatcher
│   ├── ingest.ts             # Agentic URL ingestion orchestration (classify -> raw -> synthesize)
│   ├── doctor.ts             # Health checks (slug collision detection)
│   └── migrate.ts            # Config migration (enable nestedSlugs)
├── core/
│   ├── store.ts              # CardStore: scan, resolve, read, write, archive (atomic writes)
│   ├── parser.ts             # Frontmatter parse/stringify, wikilink extraction
│   ├── formatter.ts          # Output formatters (card list, search result, link stats)
│   ├── hooks.ts              # HookRegistry: pre/post lifecycle hooks
│   ├── sync.ts               # GitAdapter, SyncConfig, autoSync/autoFetch
│   ├── config.ts             # .memexrc reader
│   ├── organization.ts       # Proposal/rule persistence + routing precedence + agent config
│   ├── ingest-agent.ts       # Pi runtime bridge for ingest classifier/synthesizer agent workflow (timeouts + optional targeted extension load)
│   ├── embeddings.ts         # OpenAI/Local/Ollama providers, cache, cosine similarity
│   └── utils.ts              # semverSort utility
├── importers/
│   ├── index.ts              # Importer registry
│   └── openclaw.ts           # OpenClaw importer
skills/                       # Claude Code skills (bundled in plugin)
├── memex-recall/SKILL.md
├── memex-retro/SKILL.md
├── memex-organize/SKILL.md
├── memex-sync/SKILL.md
└── memex-best-practices/SKILL.md
hooks/
└── hooks.json                # Claude Code SessionStart hook
.claude-plugin/
├── plugin.json               # Plugin metadata
└── marketplace.json          # Claude Code marketplace registration
pi-extension/
└── index.ts                  # Pi agent extension (8 tools, lifecycle hooks)
vscode-extension/             # VS Code extension (bundles MCP server)
tests/                        # Vitest test suite
```

## 4. Data Model

### Card Format

File: `~/.memex/cards/<slug>.md`

```yaml
---
title: Short Noun Phrase (<=60 chars)
created: 2025-01-15
modified: 2025-01-16
source: claude-code
category: backend
tags: [typescript, gotcha]
status: conflict
---

Atomic insight in own words, with [[wikilinks]] to related cards.

This connects to [[jwt-revocation]] because stateless tokens
need server-side revocation via [[blacklist-pattern]].
```

**Required fields**: `title`, `created`, `source`
**Auto-managed**: `modified` (updated on every write), `source` (injected by MCP server from clientInfo)

### Slug Rules

- **Format**: kebab-case, lowercase English, 3-60 chars
- **Validation** (`store.ts:validateSlug`):
  - No empty/whitespace-only slugs
  - No reserved chars: `: * ? " < > |`
  - No empty path segments, no `..` traversal
  - Path-safe assertion: must resolve within `cardsDir`
- **Special prefixes**: `adr-*`, `gotcha-*`, `pattern-*`, `tool-*`

### Storage Layout

```
~/.memex/
├── cards/              # Active cards (.md)
├── archive/            # Archived cards
├── .sync.json          # Sync config (remote, auto, lastSync)
├── .memexrc            # User config (JSON)
├── .memex/embeddings/  # Embedding cache (per-model JSON)
├── .memex/proposals/   # Git-tracked organization proposals (.json)
├── .memex/organization-rules.json  # Accepted routing rules
└── .git/               # Git repo (if sync initialized)
```

## 5. MCP Tools (13 total)

### High-Level (with hooks)

| Tool | Purpose | Hooks |
|------|---------|-------|
| `memex_recall` | Load prior knowledge at task start. Returns index card or card list. | `pre:recall` (autoFetch) |
| `memex_retro` | Save atomic insight at task end. Auto-injects source, date, syncs. | `pre:retro` (autoFetch), `post:retro` (autoSync) |
| `memex_organize` | Analyze network + refresh generated navigation indexes (root `index` + nested MOCs in nested mode). | `pre:organize` (autoFetch), `post:organize` (autoSync) |
| `memex_pull` | Pull remote changes. | `pre:pull`, `post:pull` |
| `memex_push` | Push local changes. | `pre:push`, `post:push` |

### Low-Level (no hooks)

| Tool | Purpose |
|------|---------|
| `memex_search` | Full-text keyword search (AND logic) or list all cards |
| `memex_read` | Read card by slug |
| `memex_write` | Write/update card with full content |
| `memex_links` | Link stats (per-card or global) |
| `memex_archive` | Move card to archive |
| `memex_ingest_url` | Agentic URL ingest (media classify -> raw-data interpretation -> synthesized card). Runtime can isolate extensions with `--no-extensions` and selectively re-enable one via `--extension` (e.g., kg-multicodex). |
| `memex_classify` | Generate bounded organization proposals |
| `memex_review` | List/approve/reject organization proposals |
| `memex_maintain` | Emit bounded maintenance proposals |

## 6. Hook System

**Registry** (`src/core/hooks.ts`): `Map<HookKey, HookFn[]>` where `HookKey = "${Phase}:${Operation}"`.

- **Phase**: `pre` | `post`
- **Operation**: `recall` | `retro` | `organize` | `show` | `pull` | `push` | `init`
- **Behavior**: hooks fail silently (infrastructure, not business logic)

**Default hooks** (registered in `server.ts`):

```
pre:recall   → autoFetch (pull latest)
pre:retro    → autoFetch
pre:organize → autoFetch
post:retro   → autoSync (commit + push if auto=true)
post:organize → autoSync
```

## 7. Sync System

**Adapter**: `GitAdapter` (`src/core/sync.ts`)

- **Init**: Creates/reuses `memex-cards` GitHub repo via `gh` CLI, or accepts custom URL
- **Pull**: `git fetch origin` → `git merge <remoteBranch> --no-edit`
- **Push**: `git add cards archive` → `git commit` → `git push origin HEAD`
- **Remote detection**: `origin/HEAD` → `origin/main` → `origin/master` → fallback `origin/main`
- **Auto-sync**: Enabled with `memex sync on`. Runs after retro/organize.
- **Offline tolerance**: autoFetch/autoSync silently fail when offline

## 8. Search

### Keyword Search (default)

- AND logic: ALL tokens must match
- Case-insensitive, searches title + body (frontmatter excluded)
- Ranked by token frequency

### Semantic Search (`--semantic`)

- Providers: OpenAI (`text-embedding-3-small`), Local (`node-llama-cpp` + GGUF), Ollama (`nomic-embed-text`)
- Hybrid scoring: `0.7 * semantic + 0.3 * keyword_normalized`
- Embedding cache: `~/.memex/.memex/embeddings/<model>.json`, invalidated by SHA-256 content hash
- Auto-detection: OpenAI API key → node-llama-cpp → Ollama → error

### Manifest Filters

`--category`, `--tag`, `--author/--source`, `--since`, `--before` (applied as pre-filter before search)

## 9. Organize

`organizeCommand` (`src/commands/organize.ts`) performs graph analysis and then rebuilds generated navigation indexes.

Graph analysis sections:
1. **Link stats**: outbound/inbound counts per card
2. **Orphan detection**: cards with 0 inbound (excluding root `index` and generated navigation indexes)
3. **Hub detection**: cards with ≥10 inbound (excluding root `index` and generated navigation indexes)
4. **Conflict cards**: frontmatter `status: conflict`
5. **Contradiction pairs**: recently modified cards + their neighbors (max 20 pairs, 300-char excerpts)
6. **Incremental scope**: explicit `--since` / tool `since` input only

Index rebuild behavior (`src/commands/rebuild-index.ts`):
- Generated marker on managed cards:
  - `source: organize`
  - `generated: navigation-index`
- **Nested mode (`nestedSlugs: true`)**:
  - root `index` is compact top-level navigation (`[[top/index]]`) + root cards
  - nested `<folder>/index` cards are generated as MOCs with immediate children only
- **Flat mode (`nestedSlugs: false`)**:
  - only root `index` is generated (category-grouped fallback)
  - nested `*/index` cards are never generated
- **Mixed-mode guardrail**:
  - in flat mode, `CardStore.resolve("index")` always prefers `cards/index.md`
  - stale generated nested indexes are reported as mixed-mode artifacts in organize output
- **Collision guardrail**:
  - user-authored nested `.../index` cards are not overwritten; organize reports skipped slugs
- **No-op writes**:
  - generated indexes are compare-before-write; unchanged cards are not rewritten

## 10. Platform Integrations

### Claude Code Plugin

- **SessionStart hook** (`hooks/hooks.json`): checks CLI install, runs sync, injects recall/retro reminders
- **5 skills**: recall, retro, organize, sync, best-practices
- **Install**: `/plugin install memex@memex`
- **Marketplace**: `.claude-plugin/marketplace.json`

### VS Code Extension

- **Location**: `vscode-extension/`
- Bundles `@touchskyer/memex` as dependency
- Registers MCP server via `vscode.lm.registerMcpServerDefinitionProvider`
- Node discovery: system PATH → common install paths → NVM (sorted by semver)

### Pi Extension

- **Location**: `pi-extension/index.ts`
- Single file, zero npm dependencies
- 8 tools (spawns `memex` CLI process)
- Lifecycle hooks: `before_agent_start` (recall reminder), `agent_end` (retro reminder)
- Slash commands: `/memex`, `/memex-serve`, `/memex-sync`

## 11. Build & Test

### Build

```bash
npm run build      # tsc → dist/
npm run postbuild  # copies serve-ui.html, share-card assets, syncs AGENTS.md → agent instruction files
```

**TypeScript**: ES2022, Node16 module resolution, strict mode, declarations, source maps.

### Dependencies

| Dep | Purpose |
|-----|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `commander` | CLI framework |
| `gray-matter` | YAML frontmatter parsing |
| `zod` | Schema validation (MCP tool inputs) |

**Optional**: `node-llama-cpp` (local embeddings)

### Test

```bash
npm test              # vitest run
npm run test:watch    # vitest watch mode
```

**Coverage**: v8 provider, 70% statement threshold, `src/cli.ts` excluded.

### Package Distribution

- **npm**: `@touchskyer/memex` (includes `dist/`, `skills/`, `pi-extension/`)
- **VS Code**: `touchskyer.memex-mcp` marketplace extension
- **Claude Code**: plugin via marketplace (`memex@memex`)
- **Binary**: `memex` (via `package.json` `bin` field → `dist/cli.js`)

## 12. Configuration Reference

### .memexrc (JSON)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `nestedSlugs` | boolean | false | Path-preserving slugs |
| `searchDirs` | string[] | — | Extra dirs for `--all` |
| `embeddingProvider` | "openai"\|"local"\|"ollama" | auto-detect | |
| `openaiApiKey` | string | env `OPENAI_API_KEY` | |
| `openaiBaseUrl` | string | `https://api.openai.com` | |
| `embeddingModel` | string | `text-embedding-3-small` | |
| `ollamaModel` | string | `nomic-embed-text` | |
| `ollamaBaseUrl` | string | `http://localhost:11434` | |
| `localModelPath` | string | HuggingFace URI | |
| `memexProposalAgentName` | string | `memex-proposal-agent` | AI proposal agent name |
| `memexProposalAgentModel` | string | `openai-codex/gpt-3-codex` | AI proposal model |
| `memexProposalAgentThinking` | `low\|medium\|high` | `medium` | AI proposal reasoning effort |

### Environment Variables

| Var | Purpose |
|-----|---------|
| `MEMEX_HOME` | Override home dir (default `~/.memex`) |
| `OPENAI_API_KEY` | OpenAI embeddings |
| `OPENAI_BASE_URL` | Custom OpenAI endpoint |
| `MEMEX_EMBEDDING_PROVIDER` | Force provider type |
| `MEMEX_OLLAMA_MODEL` | Ollama model override |
| `MEMEX_OLLAMA_BASE_URL` | Ollama endpoint override |
| `MEMEX_PROPOSAL_AGENT_NAME` | Override proposal agent name |
| `MEMEX_PROPOSAL_AGENT_MODEL` | Override proposal model |
| `MEMEX_PROPOSAL_AGENT_THINKING` | Override proposal thinking level |
| `MEMEX_AUTO_CLASSIFY` | Enable post-write/import/retro proposal capture hooks |

## 13. Key Implementation Details

### Atomic Writes

`CardStore.writeCard()` writes to `<path>.tmp` then `rename()` — prevents corruption on crash.

### Cache Invalidation

- `CardStore.scanCache`: invalidated after every write/archive
- `EmbeddingCache`: SHA-256 content hash per card, stale entries cleaned on `embedCards()`

### Client Source Tagging

MCP server intercepts `initialize` handshake, captures `clientInfo.name`, normalizes to kebab-case. Auto-injected into `source` frontmatter on writes via `memex_write` and `memex_retro`.

### Path Safety

- `assertSafePath()`: resolved path must be within `cardsDir` (or `archiveDir`)
- `validateSlug()`: rejects traversal, reserved chars, empty segments
- Windows normalization: `\` → `/` in slugs

### Frontmatter Stringification

Custom YAML generation (avoids `js-yaml` block scalars `>-`):
- Special chars quoted with single quotes
- Single quotes escaped: `'` → `''`
- Newlines replaced with spaces
