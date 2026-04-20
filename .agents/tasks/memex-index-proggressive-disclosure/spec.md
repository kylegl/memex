---
id: memex-index-proggressive-disclosure
status: draft
updated: 2026-04-20T05:32:13Z
---

# Task Spec

## Progressive-Disclosure Index Generation

## Summary
Implement first-class, code-driven index rebuilding so `memex organize` refreshes a compact root `index` plus nested MOC-style `.../index` cards when hierarchical slug identity is available.

The root `index` remains the default recall entrypoint and becomes top-level-only navigation. Full progressive disclosure is provided by generated nested index cards in nested-slug mode. In flat-slug mode, organize generates only a compact root index and must not synthesize nested MOCs.

All business logic stays in `src/commands/*` plus small supporting helpers in `src/lib/*`. CLI and MCP remain thin wrappers.

## Goals
- Keep root `index` compact and stable as the recall entrypoint.
- Make index rebuilding code-driven instead of skill-only/manual.
- Generate deterministic nested MOCs when `nestedSlugs` preserves folder identity.
- Preserve backward compatibility for flat-slug users.
- Keep wrapper layers thin and architecture-aligned.
- Minimize file churn by skipping no-op writes.
- Prevent generated navigation cards from polluting organize maintenance output.

## Non-Goals
- Do not redesign wikilink parsing, aliases, or section-link semantics.
- Do not change archive behavior or card authoring rules for normal user cards.
- Do not introduce LLM-curated topic inference into core index generation.
- Do not broaden this task into a full organize workflow redesign.
- Do not add heavy dependencies.
- Do not make `organize` a write-mode override surface via `--nested`; v1 should respect configured slug mode only.

## Current State
- `memex_recall` in `src/mcp/operations.ts` prefers reading `index` and falls back to search when `index` is absent.
- `src/commands/organize.ts` currently analyzes the graph only; it does not rebuild any index cards.
- `src/cli.ts` does not register an `organize` command.
- `pi-extension/index.ts` already shells out to `memex organize`, so the CLI surface is currently inconsistent with integrations.
- `CardStore` supports nested slugs when configured, but flat mode collapses path identity to basenames.
- `extractLinks()` returns raw link targets, so generated links must use exact raw slugs.
- The bundled `memex-organize` skill still describes manual index rebuilding.

## Decision Summary
1. Root `index` remains the recall entrypoint.
2. In nested-slug mode, root `index` becomes top-level-only navigation and delegates detail to generated `.../index` cards.
3. In flat-slug mode, organize generates only root `index`, grouped deterministically by category.
4. Generated nested MOCs must be explicitly marked as generated; slug shape alone is not sufficient ownership detection.
5. Generated index writes must compare before writing and must not route through `writeCommand()`.
6. Generated navigation cards are excluded from orphan/hub/contradiction noise only when they are confirmed generated cards.
7. Automatic `.last-organize` persistence remains out of scope for this task; callers continue to pass `since` explicitly, and docs/skills must stop implying otherwise.

## Generated Card Ownership and Safety Rules

### Generated-card marker
Generated navigation cards must carry:

```yaml
source: organize
generated: navigation-index
```

This applies to:
- root `index`
- nested `.../index` cards created by this feature

### Legacy adoption rule
For backward compatibility, an existing root `index` may be adopted and rewritten as generated if all are true:
- slug is `index`
- title is `Keyword Index`
- source is `organize`

On rewrite, the implementation should add `generated: navigation-index`.

### Collision rule
If a nested target path such as `notes/index` already exists and is **not** a generated navigation card:
- do not overwrite it
- do not exclude it from maintenance as “generated”
- skip generated MOC creation for that subtree
- report the skipped slug in the organize output summary

This prevents the feature from hijacking user-authored nested `index` cards.

### Mixed-mode guardrail
When `nestedSlugs` is disabled:
- never generate nested `.../index` cards
- prefer root `cards/index.md` when resolving slug `index`
- if generated nested `*/index.md` files are present on disk from a prior nested-mode run, ignore them for root-index resolution and report them as mixed-mode artifacts in organize output

This preserves the root-index-first recall contract even if a vault contains stale nested generated indexes.

## Rendering Contract

### Root `index`
- slug: `index`
- title: `Keyword Index`
- source: `organize`
- generated: `navigation-index`

#### Nested-slug mode body
Root `index` contains only top-level navigation:
- immediate child folder MOCs, rendered as `[[<top-level>/index]]`
- root-level non-index cards, if any

It must not directly enumerate deep descendants.

Recommended deterministic layout:

```md
## Navigation
- [[notes/index]] — Notes Index
- [[project/index]] — Project Index

## Root Cards
- [[readme]] — Readme
```

Omit empty sections.

#### Flat-slug mode body
Root `index` contains stable category sections:
- use frontmatter `category` when present
- otherwise use `Uncategorized`
- categories sort alphabetically, with `Uncategorized` last
- cards within a section sort alphabetically by slug

Recommended format:

```md
## architecture
- [[card-a]] — Card A
- [[card-b]] — Card B

## Uncategorized
- [[misc-card]] — Misc Card
```

### Nested `.../index` MOCs
For each folder with direct cards or child folders, generate `<folder>/index`.

Body rules:
- link only to immediate child folder indexes
- link only to direct cards in the same folder
- never skip levels to deep descendants
- omit self-links
- omit empty sections

Recommended layout:

```md
## Navigation
- [[notes/neuratri/index]] — Neuratri Index

## Cards
- [[notes/project-x]] — Project X
```

### Title derivation
- root title is fixed: `Keyword Index`
- nested index title is deterministic: `Title Case(last path segment) + " Index"`
  - examples:
    - `notes/index` → `Notes Index`
    - `notes/neuratri/index` → `Neuratri Index`

### Link format
Generated links must use exact raw slugs only:
- allowed: `[[slug]]`
- not allowed: `[[slug|label]]`
- not allowed: `[[slug#section]]`

Text after the link may include `— <title>` for readability.

### Ordering
All generated output must be deterministic:
- top-level folders alphabetical by slug
- child folders alphabetical by slug
- direct cards alphabetical by slug
- section presence and order fixed by contract
- no dependence on filesystem traversal order

## Proposed Changes by File

### `src/commands/rebuild-index.ts` (new)
Create a dedicated internal command-layer module for deterministic navigation-index generation.

Suggested API:

```ts
type BuildIndexResult = {
  rootSlug: "index";
  nested: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: Array<{ slug: string; reason: string }>;
  mixedModeArtifacts: string[];
};

buildIndexCommand(store: CardStore): Promise<BuildIndexResult>
```

Responsibilities:
- scan active cards from `store.scanAll()`
- parse frontmatter for title/category/generated-marker metadata
- build a tree from slugs when nested mode is enabled
- render root `index`
- render nested `.../index` MOCs only in nested mode
- preserve existing `created` for generated cards
- mark generated cards with `source: organize` and `generated: navigation-index`
- compare rendered output against existing card content and skip unchanged writes
- never overwrite non-generated nested `.../index` cards
- report skipped collisions and mixed-mode artifacts

Write-path rules:
- do not use `writeCommand()`
- do use `store.writeCard()` after content comparison
- only change `modified` when the file content actually changes
- do not trigger per-card sync; organize-level hooks remain the sync boundary

Stale generated nested indexes:
- v1 should be additive plus overwrite-for-owned-generated-cards
- if previously generated nested MOCs become obsolete, report them as stale candidates
- auto-delete can be deferred to a follow-up task

### `src/commands/organize.ts`
Keep existing graph-analysis behavior, then invoke `buildIndexCommand(store)`.

Required changes:
- preserve current report sections where practical
- append a final `## Index Rebuild` summary with counts:
  - created
  - updated
  - unchanged
  - skipped
  - mixed-mode artifacts
- continue returning `{ output, exitCode }`

Noise-reduction rules:
- continue excluding root `index` from orphan reporting
- exclude nested generated navigation cards from orphan/hub/recent-pair output only when they are confirmed generated (`generated: navigation-index`)
- do not exclude user-authored nested `index` cards merely because their slug ends with `/index`

### `src/cli.ts`
Add the missing `memex organize` command.

CLI surface:
- `memex organize`
- `memex organize --since <date>`

Rules:
- respect configured `nestedSlugs`
- do not add a `--nested` override in v1
- resolve store/config
- pass explicit `since` through to `organizeCommand()`
- print command output and exit with command exit code

### `src/mcp/operations.ts`
Keep wrappers thin.

Changes:
- `memex_recall` contract remains root-index-first
- `memex_organize` continues calling `organizeCommand(store, since ?? null)`
- update tool description to mention navigation-index refresh
- no new MCP tool is required

### `src/lib/store.ts`
Add only the minimal library support required for safe command behavior.

Required additions:
- public accessor: `isNestedSlugsEnabled(): boolean`
- flat-mode root-index precedence:
  - when resolving slug `index` in flat mode, prefer `<cardsDir>/index.md`
  - this guards recall against basename collisions from stale nested `*/index.md` files

Constraints to preserve:
- atomic writes
- path safety
- no directory traversal regressions

### `src/lib/parser.ts`
No parsing-semantics change.

Constraint:
- generated output must remain compatible with current `extractLinks()` behavior by emitting exact raw slugs only.

### `skills/memex-organize/SKILL.md`
Update the skill to reflect code-driven index rebuilding.

Changes:
- replace manual “read all cards and rebuild index yourself” guidance with “run organize and interpret the report”
- describe root `index` + nested MOCs as tool-managed
- remove or rewrite `.last-organize` instructions so they match actual code behavior
- keep human-judgment guidance for true organization tasks

### `skills/memex-recall/SKILL.md`
Update recall guidance without changing the workflow.

Changes:
- keep root `index` as the first card to read
- clarify that root `index` is intentionally compact and may route through nested `.../index` MOCs
- preserve hop/read guardrails

### `docs/ARCHITECTURE.md`
Update the organize and CLI sections:
- `organize` now analyzes + rebuilds generated navigation indexes
- document generated-card marker
- document flat-mode fallback and mixed-mode guardrail
- remove or correct any `.last-organize` claim that no longer matches code

### `README.md`
If CLI command list is documented, add `memex organize` and briefly explain:
- analyze graph health
- refresh navigation indexes

### `pi-extension/index.ts`
No business-logic change required.

Expected outcome:
- existing `memex organize` shell call becomes valid once CLI wiring lands

## Acceptance Criteria
1. `memex organize` exists in the CLI and succeeds from the built binary.
2. Running organize with no cards still returns `No cards yet.`.
3. Running organize with active cards creates or refreshes root `index`.
4. Root `index` remains the recall entrypoint.
5. In nested-slug mode, root `index` contains only top-level folder MOCs plus root-level direct cards.
6. In nested-slug mode, each generated `<folder>/index` links only to immediate child folder indexes and direct cards in that folder.
7. In flat-slug mode, organize writes only root `index`; it does not create nested `.../index` cards.
8. Generated links use exact raw slugs only.
9. Generated navigation cards are marked with `generated: navigation-index`.
10. Non-generated nested `.../index` cards are never overwritten.
11. Generated nested MOCs do not appear as actionable orphans/hubs/contradiction noise.
12. Re-running organize without relevant content changes skips writes for unchanged generated cards.
13. In flat mode, root `index` resolution still prefers `cards/index.md` even if stale nested generated `*/index.md` files exist.
14. Existing tests continue to pass unless intentionally updated for the new behavior.

## Test Plan

### `tests/commands/organize.test.ts`
Add coverage for:
- root `index` created when missing
- nested mode creates `top/index` and `top/child/index`
- root `index` contains only top-level links in nested mode
- nested index contains only immediate child folder indexes and direct cards
- flat mode creates only root `index`
- generated nested MOCs are excluded from orphan/hub output
- user-authored nested `.../index` is not overwritten and is reported as skipped
- repeated organize runs do not rewrite unchanged generated cards
- mixed-mode artifact warning appears in flat mode when stale nested generated indexes exist

### `tests/mcp/operations.test.ts`
Add coverage for:
- `memex_recall` still returns root `index` after organize rebuilds
- `memex_organize` output includes index rebuild summary
- flat-mode root recall still prefers root `index` when nested generated indexes exist on disk

### `tests/integration/cli.test.ts`
Add coverage for:
- `node dist/cli.js organize` succeeds
- running organize creates `cards/index.md`
- nested-slug config causes nested `.../index.md` generation
- flat-slug config does not generate nested `.../index.md`

### `tests/lib/store.test.ts`
Add coverage for:
- in flat mode, resolving `index` prefers root `cards/index.md` over nested `*/index.md`

### Regression checks
Keep existing behavior green for:
- `tests/commands/serve.test.ts` index-first ordering assumptions
- existing read/search/store tests
- current recall fallback behavior

## Risks and Mitigations

### Risk: flat mode cannot represent true hierarchy
- **Mitigation:** generate only root `index` in flat mode; no synthetic nested MOCs.

### Risk: generated nested indexes collide with user-authored nested `index` cards
- **Mitigation:** explicit generated marker plus skip/warn collision handling.

### Risk: stale nested generated indexes break root recall in flat mode
- **Mitigation:** root `index` path preference in flat mode plus mixed-mode artifact reporting.

### Risk: repeated rebuilds churn `modified` and git history
- **Mitigation:** compare-before-write and avoid `writeCommand()`.

### Risk: wrapper layers accrete business logic
- **Mitigation:** keep generation in command/lib layers; CLI/MCP only orchestrate.

### Risk: stale generated nested indexes linger
- **Mitigation:** report stale candidates in v1; defer auto-delete to a follow-up.

## Rollout Notes
1. Add index-builder command module.
2. Integrate builder into organize.
3. Add CLI organize command.
4. Update skills and docs to match code-backed behavior.
5. Defer auto-deletion of stale generated nested indexes to a later task.

This rollout is additive and preserves the root `index` slug, root-index-first recall behavior, and thin-wrapper architecture.
