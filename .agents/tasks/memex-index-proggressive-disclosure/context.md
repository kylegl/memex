---
id: memex-index-proggressive-disclosure
status: active
updated: 2026-04-20T05:32:13Z
---

# Context

## Task Context Index

### Objective
The goal is to reduce the size of `memex` root `index.md` so it contains top-level links only, while generating nested MOC-style index files where hierarchy exists.

### References
- Spec: `.agents/tasks/memex-index-proggressive-disclosure/spec.md`
- Plan: `.agents/tasks/memex-index-proggressive-disclosure/plan.md`
- Detailed proposal/spec artifact: `.agents/tasks/memex-index-proggressive-disclosure/spec/progressive-disclosure-index.md`

### Scope notes
- Keep root `index` as the default recall entrypoint.
- Generate nested MOCs only when slug hierarchy is available (`nestedSlugs`).
- Keep CLI/MCP wrappers thin; command/lib layers hold behavior.
