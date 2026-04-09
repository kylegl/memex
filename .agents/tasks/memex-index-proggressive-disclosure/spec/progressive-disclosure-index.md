# Progressive Disclosure Index Generation

## Summary
Implement first-class, code-driven index rebuilding so `memex organize` produces a compact root `index` and, when path hierarchy exists, nested MOC-style `.../index` cards for progressive disclosure. The root `index` remains the default recall entrypoint, but it should only expose top-level navigation. Business logic belongs in `src/commands/*` and supporting `src/lib/*` helpers; MCP and CLI remain thin wrappers.

## Goals
- Keep `index.md` compact and usable as the default recall entrypoint.
- Generate deterministic, MOC-style index cards for nested structures.
- Preserve backward compatibility for existing users, especially when `nestedSlugs` is disabled.
- Keep wrapper layers thin: CLI and MCP should delegate to commands.
- Preserve existing test expectations unless behavior is intentionally changed and documented.
- Make generated output stable enough for predictable diffs and repeatable tests.

## Non-Goals
- Do not redesign link parsing, wikilink semantics, or alias/section-link support.
- Do not change card authoring rules, required frontmatter, or archive behavior.
- Do not introduce LLM-curated topic inference as part of core index generation.
- Do not move business logic into `src/cli.ts`, `src/mcp/server.ts`, or `src/mcp/operations.ts`.
- Do not require users to enable `nestedSlugs`; progressive disclosure must degrade safely in flat-slug mode.

## Current State
- `memex_recall` in `src/mcp/operations.ts` is hardwired to prefer reading `index` and falls back to `searchCommand()` when `index` is absent.
- `src/commands/organize.ts` currently performs analysis only: link stats, orphan detection, hubs, conflicts, and recently modified neighbor pairs.
- There is no command-layer implementation that writes or rebuilds `index`.
- `skills/memex-organize/SKILL.md` currently instructs the agent to rebuild the index manually.
- `pi-extension/index.ts` already expects a CLI `memex organize` command, but `src/cli.ts` does not register one.
- `CardStore` supports nested slugs when configured, but slug identity differs significantly between flat and nested modes.
- `extractLinks()` returns raw `[[...]]` targets, so generated index links must use exact slug strings with no aliases or anchors.

## Proposed Changes (by file)

### `src/commands/index.ts` (new)
Create a dedicated command-layer module for deterministic index generation.

Proposed responsibilities:
- Scan active cards from `store.scanAll()`.
- Parse frontmatter as needed to collect titles and determine whether a card is a generated index card.
- Build a navigation tree from slugs.
- Render:
  - root `index`
  - nested `.../index` MOCs when hierarchical slugs are available
- Preserve existing `created` date for generated index cards when rewriting.
- Use `source: organize` for generated index cards.
- Skip writing unchanged generated cards to avoid noisy diffs and unnecessary `modified` churn.
- Return structured summary data for callers, e.g. counts of created/updated/unchanged index cards.

Generation rules:
1. **Active set only**
   - Use only cards in `cards/`; archived cards are excluded.
2. **Generated card detection**
   - Treat `index` and any slug ending in `/index` as system-generated navigation cards.
   - Exclude these from child-card listing to avoid self-reference loops.
3. **Root index contract**
   - Root slug is always `index`.
   - Root title remains `Keyword Index`.
   - In nested mode, root content must contain only top-level navigation:
     - links to top-level folder MOCs like `[[notes/index]]`
     - direct links to root-level non-index cards, if any
   - Root must not directly enumerate deep descendants like `notes/x/y/card`.
4. **Nested MOC contract**
   - For each folder that contains either direct cards or child folders, generate `<folder>/index`.
   - Each nested index links only to:
     - direct cards in that folder
     - immediate child folder indexes
   - Nested indexes must not skip levels by linking directly to deep descendants outside the current folder.
5. **Flat mode fallback**
   - When `nestedSlugs` is disabled, generate only the root `index`.
   - In this mode, the root remains compact via stable category sections:
     - use frontmatter `category` when present
     - otherwise use `Uncategorized`
   - No slash-based MOCs are generated in flat mode because slug identity collapses path structure.
6. **Deterministic ordering**
   - Section order is fixed.
   - Child folder indexes sort alphabetically by slug.
   - Direct cards sort alphabetically by slug.
   - Rendering should not depend on filesystem traversal order.
7. **Link format**
   - Use raw exact slug links only: `[[slug]]`.
   - Do not emit aliases (`[[slug|label]]`) or section links (`[[slug#section]]`).
8. **Frontmatter**
   - Generated cards must satisfy existing write requirements: `title`, `created`, `source`.
   - `modified` remains write-managed.

Suggested public API:
- `buildIndexCommand(store: CardStore): Promise<{ created: string[]; updated: string[]; unchanged: string[]; removed?: string[]; rootSlug: "index"; nested: boolean; }>`

Notes:
- If stale generated MOCs exist after the hierarchy shrinks, the command should remove or archive obsolete generated `.../index` cards only if they were previously system-generated. If safe deletion is too risky for the first implementation, mark removal as deferred and keep generation additive except for root overwrite. See Risks.

### `src/commands/organize.ts`
Keep existing analysis behavior, then integrate index rebuilding through the new command-layer builder.

Proposed behavior:
- Preserve existing report sections and wording where feasible.
- After analysis, invoke `buildIndexCommand(store)`.
- Append a short summary section such as `## Index Rebuild` with counts and key affected slugs.
- Keep the return shape `{ output, exitCode }`.

Intentional analysis updates:
- Continue excluding root `index` from orphan reporting.
- Also exclude generated nested MOCs (`slug.endsWith("/index")`) from orphan and hub reporting so system navigation cards do not pollute maintenance output.
- Exclude generated MOCs from recently modified contradiction-pair output.

Rationale:
- Once MOC cards are code-generated, reporting them as orphans/hubs creates noise and undermines the maintenance report.

### `src/cli.ts`
Add the missing CLI wiring for `memex organize`.

Proposed CLI surface:
- `memex organize`
- `memex organize --since <date>`
- Optional: `--nested` override for parity with other commands that expose nested-slug mode explicitly.

CLI responsibilities only:
- Resolve store/config.
- Pass arguments into `organizeCommand()`.
- Print returned output.
- Exit with returned exit code.

This closes the current mismatch where the Pi extension expects `memex organize` to exist.

### `src/mcp/operations.ts`
Keep MCP wrappers thin.

Proposed changes:
- `memex_recall` remains root-index-first; no contract change.
- `memex_organize` continues to call `organizeCommand(store, since ?? null)`.
- Description text may be updated to mention that organize also refreshes index navigation.

No new MCP tool is required for the initial rollout if `memex_organize` already covers the behavior.

### `src/lib/store.ts`
Preserve existing path-safety and nested slug behavior.

Proposed changes:
- Add a small public accessor for nested-slug mode so command code does not reach into private fields.
  - Example: `isNestedSlugsEnabled(): boolean`
- No changes to path validation, write safety, or archive safety.

Constraints to preserve:
- Atomic writes stay intact.
- Nested slug identity remains opt-in and unchanged.
- No directory traversal regressions.

### `src/lib/parser.ts`
No change to parsing semantics is required.

Implementation constraint:
- Generated index content must respect current exact-link extraction behavior.
- Because `extractLinks()` captures raw targets, index generation must emit plain exact slugs only.

### `skills/memex-organize/SKILL.md`
Update the skill to reflect code-driven index generation.

Proposed changes:
- Replace manual “read all cards and rebuild keyword index yourself” guidance with:
  - run `memex organize`
  - interpret the analysis report
  - optionally make human judgment calls for true organization tasks
- Clarify that root and nested MOCs are rebuilt automatically by the tool.
- Keep manual editing guidance only for exceptional curation, not the default maintenance path.

### `skills/memex-recall/SKILL.md`
Update recall guidance without changing its core workflow.

Proposed changes:
- Keep `index` as the first card to read.
- Clarify that the root index is intentionally compact and may route the agent through nested `.../index` MOCs.
- Preserve hop and card-read guardrails.

### `tests/commands/organize.test.ts`
Expand organize coverage to include rebuild behavior.

Add cases for:
- root `index` is created when missing
- nested mode creates `top/index` and deeper `top/child/index` files
- root `index` contains only top-level links in nested mode
- nested index contains only immediate child indexes and direct cards
- flat mode creates only root `index`
- generated MOCs are excluded from orphan/hub reporting
- repeated organize runs do not rewrite unchanged index content unnecessarily

### `tests/mcp/operations.test.ts`
Preserve recall behavior and validate new organize outcome.

Add cases for:
- `memex_recall` still returns root `index` after organize-generated rebuilds
- `memex_organize` output includes both analysis text and index rebuild summary
- nested MOC generation does not break default recall behavior

### `tests/integration/cli.test.ts`
Add CLI wiring coverage.

Add cases for:
- `node dist/cli.js organize` succeeds
- running organize creates `cards/index.md`
- when `nestedSlugs` is enabled in config, organize writes nested `.../index.md` files

### `pi-extension/index.ts`
No functional redesign required.

Expected outcome:
- Existing `memex organize` shell invocation becomes valid once CLI wiring lands.
- No extension-specific business logic should be added.

### Documentation updates
Update contributor-facing docs to match the new code-backed behavior.

Recommended updates:
- `docs/ARCHITECTURE.md`
- `README.md` command examples if `organize` becomes a supported CLI command

## Acceptance Criteria
1. Running organize with no cards still returns `No cards yet.` and does not fail.
2. Running organize with active cards creates or refreshes a root `index` card.
3. In nested-slug mode, root `index` contains only top-level navigation and any root-level direct cards.
4. In nested-slug mode, each generated `<folder>/index` links only to immediate child folder indexes and direct cards within that folder.
5. In flat-slug mode, organize generates only root `index`; no nested slash-based MOCs are written.
6. Generated links use exact raw slugs with no aliases or section fragments.
7. Existing recall behavior remains intact: `memex_recall` still returns the root `index` when it exists.
8. `memex organize` is registered in the CLI and works from the built binary.
9. Generated index cards do not appear as actionable orphans/hubs in organize output.
10. Re-running organize without relevant content changes produces stable output and minimizes file churn.
11. Existing tests keep passing unless intentionally updated to reflect the new organize/index behavior.

## Test Plan
### Unit / command-level
- `tests/commands/organize.test.ts`
  - no-card behavior unchanged
  - analysis sections still present
  - index rebuild summary present
  - nested and flat generation behavior
  - stable ordering assertions
  - exclusion of generated MOCs from orphan/hub sections

### MCP integration
- `tests/mcp/operations.test.ts`
  - `memex_recall` returns generated root index
  - `memex_organize` returns valid combined output

### CLI integration
- `tests/integration/cli.test.ts`
  - organize command registration
  - organize writes expected files under temporary `MEMEX_HOME`
  - nested config path generation

### Regression checks
- `tests/commands/serve.test.ts`
  - preserve `index` sorting-first behavior
- any existing read/search/store tests touching nested slugs should remain green
- verify no regression in tests asserting root index assumptions

## Risks & Mitigations
### Risk: flat mode cannot support true hierarchical MOCs
- **Why**: flat slug mode intentionally loses folder identity.
- **Mitigation**: document flat mode as a compatibility fallback that only generates a compact root index. Full progressive disclosure requires `nestedSlugs: true`.

### Risk: generated MOCs create noisy graph-analysis results
- **Why**: system-generated cards can look like hubs or maintenance targets.
- **Mitigation**: explicitly exclude `index` and `*/index` cards from orphan/hub/recent-pair analysis.

### Risk: repeated rebuilds churn `modified` and git history
- **Why**: generated files may be rewritten even when content is unchanged.
- **Mitigation**: compare rendered output with existing content and skip no-op writes.

### Risk: obsolete generated nested indexes linger after hierarchy changes
- **Why**: additive generation alone does not clean up removed branches.
- **Mitigation**: phase the rollout:
  1. initial version can track and report stale generated MOCs
  2. only auto-delete when the card is confidently identified as system-generated (`source: organize` plus expected title/shape)

### Risk: root index becomes too opinionated or unstable
- **Why**: semantic grouping heuristics can drift.
- **Mitigation**: keep grouping deterministic and structural. Prefer folder-path grouping in nested mode and frontmatter category fallback in flat mode.

### Risk: wrapper layers accrete logic
- **Why**: CLI/MCP fixes are tempting places to add behavior.
- **Mitigation**: keep all generation and orchestration in commands/lib; wrappers only parse args, invoke commands, and format responses.

## Rollout Notes
- Roll out additively:
  1. add command-layer index builder
  2. wire `organize` to call it
  3. expose CLI command
  4. update skills/docs
- Preserve the root `index` slug and root-index-first recall flow to avoid breaking existing users and tests.
- Treat full hierarchical progressive disclosure as enabled-by-configuration via existing `nestedSlugs`; do not force migration.
- If stale nested MOC cleanup is deferred, note that in release/docs so users understand the first version prioritizes safe generation over aggressive pruning.
- After implementation, update architecture docs to describe organize as both analyzer and deterministic navigation-index rebuilder.
