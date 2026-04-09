---
plan_id: agentify-memex
title: capture proposals from write import and retro flows
status: completed
updated: 2026-04-09T20:34:00Z
---

Add bounded automation entrypoints that capture proposals without mutating durable notes directly.

## Steps
- [ ] Step 1:
  - Create `src/commands/classify.ts` with classify one, all, and recent behavior plus `--dry-run`, `--apply-safe`, and `--explain`.
  - Make the command read only through the storage, routing, and Pi-agent helpers introduced in Stage 1.
- [ ] Step 2:
  - Wire post-success classification hooks into the shared write, import, and retro execution paths so successful note creation can enqueue proposals without duplicating business logic in CLI or MCP wrappers.
  - Update `src/commands/import.ts` to return imported note identifiers needed for post-import classification instead of doing the classification work itself.
  - Extend `src/core/hooks.ts` only as far as needed to model the new lifecycle events; keep hooks silent and side-effect bounded.
- [ ] Step 3:
  - Add recursion guards so generated proposals, generated indexes, and review or maintain outputs do not re-trigger proposal creation.
  - Use stable idempotency keys based on card path, content hash, and event type.
  - Fail clearly when a proposal-producing path needs the configured Pi agent or model and it is unavailable.
- [ ] Step 4:
  - Add command and integration tests for proposal creation, dry-run and explain output, idempotency, AI-unavailable failure handling, and CLI/MCP parity.

## Skill alignment
- Use `quality-engineer` to design idempotency/recursion test cases before coding hooks.
- Use `memex-organize` to validate generated-artifact guardrails against organize output.
- Use `memex-retro` if a non-obvious hook/idempotency pattern is discovered.

## Success Criteria
- [ ] A write, import, or retro event creates proposals only once per input change.
- [ ] Dry-run and explain mode return deterministic output without changing canonical markdown.
- [ ] Generated artifacts do not recursively schedule new proposals.
- [ ] Missing Pi-agent/model access causes the classify/proposal path to fail with a clear error.
- [ ] Existing write, import, and retro tests still pass, and new classify coverage is green.
