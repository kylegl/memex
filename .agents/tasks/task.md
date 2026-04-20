# Task Index

Last updated: 2026-04-08

## Task structure

- `.agents/tasks/task.md` is the task index.
- Active tasks live directly under `.agents/tasks/` in a folder named after the task.
- Each task folder contains its associated files such as `spec.md`, `plan.md`, `progress.md`, and related artifacts.
- Completed tasks live under `.agents/tasks/.completed/`.

## Task state rules

- Read `spec.md` first.
- If a task has `spec.md` and no `plan.md`, it is still in the **planning phase** and is **active**.
- If a task has `spec.md` and `plan.md`, it is **ready to be implemented** and is **active**.
- If `plan.md` frontmatter has `status: completed`, the task is **completed**.
- Keep the **Active / Unsorted** section updated with active tasks, sorted by last updated.
- Completed tasks should be moved into `.agents/tasks/.completed/`, and this index should be updated.

## Active / Unsorted

- `memex-index-proggressive-disclosure` — `.agents/tasks/memex-index-proggressive-disclosure/` (spec + plan ready)

## Completed

- `agentify-memex` — `.agents/tasks/.completed/agentify-memex/` (plan completed)
