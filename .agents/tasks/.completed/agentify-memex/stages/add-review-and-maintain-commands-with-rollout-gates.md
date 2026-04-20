---
plan_id: agentify-memex
title: add review and maintain commands with rollout gates
status: completed
updated: 2026-04-09T20:34:00Z
---

Expose proposal lifecycle control and slower maintenance analysis only after the core automation path is stable.

## Steps
- [ ] Step 1:
  - Add `src/commands/review.ts` and `src/commands/maintain.ts`.
  - Register `memex review` and `memex maintain` in `src/cli.ts`, and add thin MCP wrappers only if remote clients need them.
- [ ] Step 2:
  - Implement proposal listing, approve or reject transitions, and bounded maintenance scans for clustering, MOC suggestions, duplicate candidates, and split candidates.
  - Keep the actual state transitions in command and library code; wrappers should only marshal input and output.
  - Ensure any AI-backed maintenance suggestion path uses the explicit Pi agent/model config and fails clearly when unavailable.
- [ ] Step 3:
  - Update docs and tool descriptions so the new commands are discoverable, and confirm the command surface does not bypass the proposal gate or mutate canonical markdown directly.
- [ ] Step 4:
  - Run end-to-end smoke tests for classify → review → organize, then finish with the full `npm test` gate.

## Success Criteria
- [ ] `memex review` can list and transition proposals without unintended note edits.
- [ ] `memex maintain` emits bounded suggestions instead of bulk rewrites.
- [ ] Any added MCP surface remains a thin wrapper around the same command modules.
- [ ] The classify, review, and organize flow works end to end in tests.
- [ ] The full test suite passes at the end of the stage.

## Skill alignment
- Use `quality-engineer` to gate rollout criteria and end-to-end assertions.
- Use `memex-organize` to verify review outcomes flow cleanly into deterministic organize behavior.
- Use `agent-prompts-warmup` if command/docs changes require synchronized agent instruction updates.
- Use `memex-retro` for any enduring operational lessons from rollout gates.
