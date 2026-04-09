---
plan_id: agentify-memex
title: make organize deterministic over proposals and routing rules
status: idle
updated: 2026-04-09T00:00:00Z
---

Teach organize to consume the proposal layer while keeping the deterministic index builder authoritative.

## Steps
- [ ] Step 1:
  - Update `src/commands/organize.ts` so signal precedence is explicit: path, frontmatter, accepted rules, approved or auto-safe proposals, then fallback heuristics.
  - Keep all reconciliation logic in `src/commands/`, not in MCP or CLI wrappers.
- [ ] Step 2:
  - Refactor `src/commands/rebuild-index.ts` to use the shared routing helpers and to render primary placement plus related placement from approved proposals.
  - Preserve the current flat and nested behavior, collision guards, and compare-before-write no-op behavior.
- [ ] Step 3:
  - Add bounded auto-apply handling only for the safe classes defined in the spec; leave title rewrites, moves, archives, and body merges as review-only proposals.
  - Keep root navigation compact and nested MOCs shallow.
  - If organize needs fresh AI-backed suggestions, require the explicit Pi agent/model resolver and fail clearly when unavailable.
- [ ] Step 4:
  - Add regression tests that cover precedence, index rendering, mixed-mode artifacts, safe auto-apply, no-op writes, and the explicit AI-unavailable contract.

## Success Criteria
- [ ] `organize` reports proposal reconciliation and index rebuild status with the current guardrails intact.
- [ ] Explicit path and frontmatter overrides win over proposals and heuristics.
- [ ] User-authored indexes are never overwritten.
- [ ] Related links and compact navigation are generated only from approved or safe inputs.
- [ ] The organize and rebuild-index test suites pass in both flat and nested modes.
