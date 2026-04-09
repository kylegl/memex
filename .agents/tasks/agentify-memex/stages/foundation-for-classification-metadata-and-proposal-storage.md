---
plan_id: agentify-memex
title: foundation for classification metadata and proposal storage
status: idle
updated: 2026-04-09T00:00:00Z
---

Establish the durable organization model, git-tracked proposal/rule storage, and explicit Pi-agent/model access contract before any AI-backed flow writes proposals.

## Steps
- [ ] Step 1:
  - Extend frontmatter parsing/stringifying so optional organization fields (`type`, `project`, `package`, `domain`) and legacy unknown keys round-trip without data loss.
  - Keep all parser changes in `src/lib/parser.ts`; do not add a separate YAML dependency.
  - Update `docs/ARCHITECTURE.md` data model notes to reflect the new optional organization metadata and operational-state boundary.
- [ ] Step 2:
  - Add deterministic storage helpers in `src/lib/` for proposal records and accepted routing rules.
  - Persist proposals under a git-tracked operational directory in the Memex home tree and store accepted rules in a single deterministic JSON file.
  - Make writes canonical and stable: sorted keys, normalized timestamps, explicit record IDs, and no transient cache semantics.
  - Keep path validation and cache invalidation in the library layer.
- [ ] Step 3:
  - Add shared classification/routing helpers that combine explicit path, frontmatter, rules, and existing card metadata into one precedence model.
  - Add explicit Pi-agent configuration fields for agent name and model, plus a resolver/validator that returns a clear error when either is missing or unavailable.
  - Keep AI-access checks reusable from classify, review, maintain, and any proposal-producing hook.
- [ ] Step 4:
  - Add unit tests for parse/stringify round-trips, proposal/rule persistence, deterministic serialization, Pi-agent/model validation, and unsafe path rejection.

## Success Criteria
- [ ] Existing cards still parse and write successfully with no frontmatter regressions.
- [ ] Organization fields and legacy unknown keys survive a read/write round trip.
- [ ] Proposal and rule helpers read and write deterministic git-trackable files in the expected operational location.
- [ ] Pi-agent/model access requirements are validated explicitly and missing access yields a clear, actionable error.
- [ ] Unsafe or traversal-like paths are rejected in the library layer.
- [ ] The targeted parser, store, config, and docs test subset passes.
