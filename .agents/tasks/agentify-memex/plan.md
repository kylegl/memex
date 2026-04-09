---
id: agentify-memex
spec: .agents/tasks/agentify-memex/spec.md
status: ready
updated: 2026-04-09T00:00:00Z
---

AI-assisted Memex organization delivered in additive stages: first establish durable git-tracked proposal/rule state plus explicit Pi-agent/model validation, then capture proposals from lifecycle events, then make organize/indexing deterministic over approved structure, and finally expose review/maintain flows with rollout gates. Canonical markdown stays the source of truth throughout.

## Stages
- [ ] Stage 1:
  - Title: Foundation for classification metadata and proposal storage
  - Instructions: [foundation-for-classification-metadata-and-proposal-storage.md](./stages/foundation-for-classification-metadata-and-proposal-storage.md)
  - Depends On:

- [ ] Stage 2:
  - Title: Capture proposals from write, import, and retro flows
  - Instructions: [capture-proposals-from-write-import-and-retro-flows.md](./stages/capture-proposals-from-write-import-and-retro-flows.md)
  - Depends On: 1

- [ ] Stage 3:
  - Title: Make organize deterministic over proposals and routing rules
  - Instructions: [make-organize-deterministic-over-proposals-and-routing-rules.md](./stages/make-organize-deterministic-over-proposals-and-routing-rules.md)
  - Depends On: 2

- [ ] Stage 4:
  - Title: Add review and maintain commands with rollout gates
  - Instructions: [add-review-and-maintain-commands-with-rollout-gates.md](./stages/add-review-and-maintain-commands-with-rollout-gates.md)
  - Depends On: 3

## Sequencing rationale
- Stage 1 must land first because later stages need the organization schema, git-tracked operational storage, and Pi-agent/model validation contract before any AI-backed flow can run.
- Stage 2 depends on Stage 1 because hooks and commands need concrete proposal/rule records, explicit failure behavior when the Pi agent/model is missing, and idempotent persistence before they can enqueue anything.
- Stage 3 depends on Stage 2 because `organize` must reconcile the same proposal/rule records that lifecycle hooks create.
- Stage 4 is last because review and maintenance flows only make sense once proposals can be captured, reconciled, and deterministically applied.

## Parallelizable work
- In Stage 1, frontmatter compatibility, storage helpers, and config validation can be built in parallel behind shared tests.
- In Stage 2, command surfaces and hook wiring can proceed in parallel once the event contract is fixed.
- In Stage 3, routing precedence, index rendering, and safe auto-apply rules can be split across files but must converge on shared helpers.
- In Stage 4, CLI help text, thin MCP wrappers, and integration tests can be built in parallel after the proposal lifecycle is stable.

## Rollout checkpoints
- Checkpoint 1: organization fields round-trip, proposal/rule files are git-tracked deterministic state, and Pi-agent/model errors are explicit.
- Checkpoint 2: write/import/retro paths enqueue proposals once per change without recursive writes.
- Checkpoint 3: organize reconciles proposals and rebuilds indexes while preserving flat/nested guardrails and compare-before-write behavior.
- Checkpoint 4: review/maintain flows operate on bounded proposal sets and the full test suite stays green.

## Risks
- Recursive automation can loop if generated artifacts are reclassified; guard by tagging generated output and ignoring proposal-owned records.
- Proposal or rule drift can create competing sources of truth; keep markdown canonical and treat proposal/rule JSON as git-tracked audited operational state, not scratch cache.
- Pi-agent or model access can fail at runtime; all AI-backed flows must surface a clear, actionable error instead of silently degrading.
- Index regeneration can overwrite user-authored navigation files; preserve existing overwrite guards and collision reporting.
- Broad heuristics can get noisy; prefer explicit path/frontmatter/rules first and keep fallback heuristics narrow.
- New commands can expand surface area; keep MCP wrappers thin and reuse the same command modules from the CLI.

## Validation plan
- Add focused unit tests for parser, storage helpers, and config validation before wiring automation, including Pi-agent/model access checks.
- Add command tests for classify/review/maintain paths with dry-run, idempotency, and explicit AI-unavailable failure cases.
- Extend organize and index tests to cover precedence, related-link generation, and mixed flat/nested modes.
- Add storage tests to ensure proposal/rule files are stable, deterministic, and safe to git-track without noisy churn.
- Keep a final `npm test` checkpoint after every stage; do not begin the next stage until the current one passes.
