---
id: memex-index-proggressive-disclosure
spec: .agents/tasks/memex-index-proggressive-disclosure/spec.md
status: ready
updated: 2026-04-08T00:00:00Z
---

Implement code-driven progressive-disclosure index rebuilding so `memex organize` keeps the root `index` compact while generating nested MOC-style indexes only when slug hierarchy is available.

## Prerequisites
- Baseline `npm test` must be green before edits.
- Keep business logic in `src/commands/*` and helper logic in `src/lib/*`.
- Do not add new dependencies.
- Do not add `.last-organize` persistence; `since` stays explicit.

## Sequencing / dependencies
- Stage 1 must land first: the builder and store guardrails are the foundation for every other change.
- Stage 2 depends on Stage 1: `organize` can only rebuild indexes once the builder exists.
- Stage 3 depends on Stage 2: CLI/MCP surfaces should expose the finalized command contract.
- Stage 4 and Stage 5 can proceed after Stage 3 and may run in parallel: docs/skills can be updated while tests are being expanded, as long as the output contract is stable.

## Risks
- Flat-mode stale nested `*/index.md` files can hijack recall if `index` resolution still walks recursively.
- Generated nested indexes can collide with user-authored nested `index` cards.
- Volatile timestamps in generated cards will cause no-op churn and hide the compare-before-write optimization.
- Wrapper logic can easily drift into CLI/MCP; keep generation in the command layer.

## Stages
- [ ] Stage 1: Build deterministic index generation and store guardrails
  - Title: Foundation: index builder + store resolution
  - Instructions: [foundation-index-builder.md](./stages/foundation-index-builder.md)
  - Depends On: none
  - Files:
    - `src/commands/rebuild-index.ts` new internal builder for root + nested navigation indexes
    - `src/lib/store.ts` add `isNestedSlugsEnabled()` and make flat-mode `index` resolve only the root `cards/index.md`
  - Test checkpoint:
    - add/adjust unit coverage for root `index` resolution in flat mode and path-preserving resolution in nested mode

- [ ] Stage 2: Fold index rebuilding into organize
  - Title: Organize orchestration and maintenance filtering
  - Instructions: [organize-integration.md](./stages/organize-integration.md)
  - Depends On: Stage 1
  - Files:
    - `src/commands/organize.ts` keep graph analysis, invoke the new builder, and append an `## Index Rebuild` summary
    - `src/lib/parser.ts` only if helper reuse is needed; no parsing-semantics changes
  - Test checkpoint:
    - update `tests/commands/organize.test.ts` for root-only nested navigation, flat-mode category grouping, collision skips, mixed-mode warnings, and no-op rewrites

- [ ] Stage 3: Expose the command through CLI and MCP
  - Title: Surface wiring
  - Instructions: [surface-wiring.md](./stages/surface-wiring.md)
  - Depends On: Stage 2
  - Files:
    - `src/cli.ts` register `memex organize` with optional `--since`
    - `src/mcp/operations.ts` keep the wrapper thin and update the organize description to mention navigation-index refresh
    - `pi-extension/index.ts` no code change; verify the existing shell call now resolves because the CLI exists
  - Test checkpoint:
    - update `tests/integration/cli.test.ts` and `tests/mcp/operations.test.ts` for CLI success, `--since` passthrough, and organize summary text

- [ ] Stage 4: Update operator-facing docs and skills
  - Title: Documentation alignment
  - Instructions: [docs-and-skills.md](./stages/docs-and-skills.md)
  - Depends On: Stage 3
  - Files:
    - `docs/ARCHITECTURE.md` document generated navigation indexes, flat-mode fallback, mixed-mode guardrail, and remove `.last-organize` claims
    - `README.md` add `memex organize` to the CLI reference
    - `skills/memex-organize/SKILL.md` replace manual rebuild steps with tool-driven organize guidance
    - `skills/memex-recall/SKILL.md` clarify compact root `index` plus nested MOCs
  - Test checkpoint:
    - manual review only; verify the docs match the implemented command output and tool behavior

- [ ] Stage 5: Expand regression coverage and run full validation
  - Title: Tests and verification
  - Instructions: [tests-and-validation.md](./stages/tests-and-validation.md)
  - Depends On: 3, 4
  - Files:
    - `tests/commands/organize.test.ts`
    - `tests/lib/store.test.ts`
    - `tests/mcp/operations.test.ts`
    - `tests/integration/cli.test.ts`
  - Test checkpoints:
    - targeted run for `tests/lib/store.test.ts` and `tests/commands/organize.test.ts`
    - targeted run for `tests/mcp/operations.test.ts` and `tests/integration/cli.test.ts` after `npm run build`
    - final `npm test`
    - final `npm run build`

## Checklist
- [ ] Baseline `npm test` is green before changes
- [ ] `src/commands/rebuild-index.ts` exists and builds deterministic root + nested navigation indexes
- [ ] `CardStore` exposes nested-slug state and resolves `index` to the root file only in flat mode
- [ ] `organize` rebuilds indexes, skips no-op writes, and reports collisions and mixed-mode artifacts
- [ ] `memex organize` exists in the CLI with `--since`
- [ ] `memex_organize` remains a thin wrapper with updated description text
- [ ] Docs and skills describe the code-driven workflow and no longer imply `.last-organize` persistence
- [ ] Unit, MCP, CLI, and integration tests cover root-only, nested, flat, collision, and no-op cases
- [ ] `npm test` passes
- [ ] `npm run build` passes
