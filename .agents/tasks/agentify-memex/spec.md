---
id: agentify-memex
status: draft
updated: 2026-04-08T00:00:00Z
---

# Agentify Memex

Design and stage an implementation for AI-assisted Memex organization that keeps markdown canonical while using AI reasoning on the most logical hooks and commands. The system should remain as automated as possible while preserving repeatability, bounded mutation, and reviewability.

## Goals
- Add AI-assisted note classification and organization to Memex.
- Keep markdown cards as the source of truth.
- Separate AI reasoning/proposals from deterministic mutation/application.
- Run AI on the most logical hooks/commands with high automation.
- Keep root and nested indexes compact via explicit routing, accepted rules, and generated related links.
- Support broad note/file types, not just the current repo’s slug heuristics.

## Product requirements

### Core principles
- AI proposes and enriches; deterministic Memex infrastructure applies bounded, auditable structure automatically.
- Durable structure must be deterministic, repeatable, and safe.
- AI should be used as a classification/planning layer, not as an unconstrained write path.
- Classification should eventually rely on path, frontmatter, accepted routing rules, and fallback heuristics.

### Desired architecture
#### 1. Durable note store
Markdown remains canonical. Frontmatter should support optional stable organization fields such as:
- `type`
- `project`
- `package`
- `domain`
- existing `tags`

#### 2. AI organization proposal layer
Add durable proposal storage for organization suggestions, including:
- classify
- route
- related-link
- MOC suggestion
- split suggestion
- rationale/evidence/confidence/status metadata

#### 3. Deterministic routing/index engine
`organize` should apply ordering of signals:
1. explicit path
2. explicit frontmatter
3. accepted routing rules
4. approved/auto-safe proposals
5. fallback heuristics

Indexes should support:
- primary placement
- related placement / generated related links
- compact root navigation
- nested MOCs

## Automation / event hooks
AI should run on the most logical events:
- `post-retro`: classify newly created notes
- `post-write`: re-evaluate manually written or updated notes
- `post-import`: batch classify imported notes
- `organize`: reconcile pending classifications/proposals and rebuild indexes

Keep automation as high as possible, but bounded.

## Commands to introduce
- `memex classify`
  - classify one/all/recent notes
  - dry-run/apply-safe/explain options
- `memex review`
  - list/approve/reject proposals
- `memex maintain`
  - slower maintenance mode for clustering, MOCs, duplicate/split suggestions

`memex organize` remains the main deterministic orchestration entrypoint.

## Auto-apply policy
### Safe to auto-apply
- frontmatter enrichment
- generated index routing
- related-link generation
- type/project/package/domain inference when high confidence

### Review required
- title rewrite
- slug/file move
- archive
- merge/split body content

## Data/storage expectations
Potential storage areas:
- `~/.memex/.memex/proposals/*.json`
- optional accepted rules store such as `organization-rules.json`

Proposal storage policy:
- proposal and accepted-rule storage should be **git tracked**, not disposable local-only state
- markdown remains canonical knowledge, but proposal/rule state is durable audited operational state

Need explainability/auditability for why classification happened.

## AI execution requirements
- Memex should invoke a **Pi agent** for classification/reasoning work, not an implicit internal heuristic-only path.
- The agent name and model must be explicitly configured.
- If Memex cannot access the configured Pi agent or no model is configured/available, the command or hook path should error clearly rather than silently pretending AI classification succeeded.
- Deterministic organize/index behavior may continue without AI only where explicitly intended, but AI-backed classify/proposal flows must fail loudly when unavailable.

## CLI/MCP expectations
- CLI should expose classify/review/maintain commands.
- MCP/high-level operations should remain thin wrappers.
- Hook wiring should avoid recursive/unbounded writes.

## Rollout guidance
Implement in phases:
1. classification foundation
2. proposal-aware organize
3. review/explainability
4. heavier maintenance intelligence

## Constraints
- Keep wrappers thin; core logic belongs in `src/commands/*`.
- Keep data access in `src/lib/*`.
- No heavy dependencies.
- Maintain deterministic no-op behavior where possible.
- Prefer bounded, explainable automation over unconstrained AI mutation.
- Pi-agent/model access checks must be explicit and testable.
- Git-tracked proposal/rule storage must be stable and deterministic to avoid noisy churn.

## Deliverable for this task
Create a concrete implementation plan in `.agents/tasks/agentify-memex/plan.md` covering staged rollout, files to change, risks, validation, and sequencing. Then review that plan for completeness and risks.
