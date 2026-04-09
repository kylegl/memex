---
name: memex-organize
description: Periodic maintenance of the Zettelkasten card network.
whenToUse: When the user asks to organize, maintain, or clean up memory cards, or when running periodic maintenance checks.
---

# Memory Organize

`memex organize` is the primary maintenance entrypoint. It now does two things in one pass:

1. analyzes graph health (orphans, hubs, conflicts, recent-pair checks)
2. rebuilds generated navigation indexes (root `index`, plus nested MOCs when nested slugs are enabled)

Use the command/tool output as your source of truth, then apply human judgment only where needed.

## Tools Available

Two equivalent interfaces exist — use whichever your environment supports:

| CLI | MCP tool |
|-----|----------|
| `memex organize [--since YYYY-MM-DD]` | `memex_organize` with optional `since` |
| `memex read <slug>` | `memex_read` |
| `memex search <query>` | `memex_search` |
| `memex write <slug>` | `memex_write` |
| `memex archive <slug>` | `memex_archive` |

## Recommended Workflow

1. Run organize:
   - full pass: `memex organize`
   - targeted pass: `memex organize --since 2026-04-01`
2. Review report sections in order:
   - Link Stats
   - Orphans
   - Hubs
   - Unresolved Conflicts
   - Recently Modified Cards + Neighbors
   - Index Rebuild
3. Take action only on true maintenance items:
   - add links for meaningful orphan integration
   - split or refactor over-broad hubs
   - resolve true contradictions with user input
   - archive superseded cards when appropriate

## Index Behavior (Tool-managed)

Do **not** manually rebuild index cards as a default workflow.

`memex organize` manages generated navigation indexes with markers:

- `source: organize`
- `generated: navigation-index`

Mode behavior:
- **nestedSlugs: true** → compact root `index` + generated nested `.../index` MOCs
- **nestedSlugs: false** → root `index` only (flat/category fallback)

Guardrails:
- non-generated nested `.../index` cards are not overwritten
- flat mode reports stale nested generated indexes as mixed-mode artifacts
- unchanged generated indexes are not rewritten (no-op write avoidance)

## Important Notes

- There is no `.last-organize` persistence workflow here; pass `--since`/`since` explicitly when you want incremental scope.
- Be conservative: if unsure, leave content unchanged and surface decisions to the user.
- Keep edits minimal and reversible.
