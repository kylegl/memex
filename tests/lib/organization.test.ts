import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OrganizationStore,
  ProposalAgentConfigError,
  proposalTargetPathToSlug,
  resolveOrganizationFields,
  resolveProposalAgentConfig,
  toProposalTargetPath,
  type OrganizationProposal,
  type RoutingRule,
} from "../../src/core/organization.js";

describe("organization core", () => {
  let memexHome: string;

  beforeEach(async () => {
    memexHome = await mkdtemp(join(tmpdir(), "memex-org-test-"));
  });

  afterEach(async () => {
    await rm(memexHome, { recursive: true, force: true });
  });

  it("resolves proposal agent config with defaults", () => {
    const config = resolveProposalAgentConfig({}, {} as NodeJS.ProcessEnv);
    expect(config.name).toBe("memex-proposal-agent");
    expect(config.model).toBe("openai-codex/gpt-3-codex");
    expect(config.thinking).toBe("medium");
  });

  it("env overrides config values", () => {
    const config = resolveProposalAgentConfig(
      {
        memexProposalAgentName: "from-config",
        memexProposalAgentModel: "config-model",
        memexProposalAgentThinking: "low",
      },
      {
        MEMEX_PROPOSAL_AGENT_NAME: "from-env",
        MEMEX_PROPOSAL_AGENT_MODEL: "env-model",
        MEMEX_PROPOSAL_AGENT_THINKING: "high",
      } as NodeJS.ProcessEnv,
    );

    expect(config).toEqual({
      name: "from-env",
      model: "env-model",
      thinking: "high",
    });
  });

  it("rejects invalid thinking values", () => {
    expect(() => resolveProposalAgentConfig({}, {
      MEMEX_PROPOSAL_AGENT_THINKING: "extreme",
    } as NodeJS.ProcessEnv)).toThrowError(ProposalAgentConfigError);
  });

  it("writes proposal records with deterministic idempotency semantics", async () => {
    const store = new OrganizationStore(memexHome);
    const proposal: OrganizationProposal = {
      id: "classify-abc",
      kind: "classify",
      targetPath: "cards/alpha.md",
      confidence: 0.95,
      rationale: "high confidence",
      evidence: ["path:cards/alpha.md"],
      status: "pending",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      sourceEvent: "manual",
      idempotencyKey: "same-key",
      payload: { type: "project" },
      autoSafe: true,
    };

    const first = await store.upsertProposal(proposal);
    const second = await store.upsertProposal({ ...proposal, id: "classify-def" });

    expect(first.written).toBe(true);
    expect(second.written).toBe(false);

    const proposals = await store.listProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe("classify-abc");
  });

  it("converts proposal target paths to repo-relative identity", () => {
    const absolutePath = join(memexHome, "cards", "project", "alpha.md");
    expect(toProposalTargetPath(join(memexHome, "cards"), absolutePath)).toBe("cards/project/alpha.md");
    expect(proposalTargetPathToSlug("cards/project/alpha.md")).toBe("project/alpha");
  });

  it("persists routing rules in deterministic order", async () => {
    const store = new OrganizationStore(memexHome);
    const rules: RoutingRule[] = [
      {
        id: "b-rule",
        matchPathPrefix: "cards/project/b",
        project: "b",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
      },
      {
        id: "a-rule",
        matchPathPrefix: "cards/project/a",
        project: "a",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
      },
    ];

    await store.writeRules(rules);
    const loaded = await store.readRules();
    expect(loaded.map((r) => r.id)).toEqual(["a-rule", "b-rule"]);
  });

  it("resolves organization fields with precedence", () => {
    const rules: RoutingRule[] = [{
      id: "rule-1",
      matchPathPrefix: "cards/project/home-assistant-da",
      project: "ha-da",
      type: "project",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }];

    const proposals: OrganizationProposal[] = [{
      id: "classify-1",
      kind: "classify",
      targetPath: "cards/project/home-assistant-da/runtime.md",
      confidence: 0.99,
      rationale: "proposal",
      evidence: ["proposal"],
      status: "approved",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      sourceEvent: "manual",
      idempotencyKey: "k1",
      payload: { project: "proposal-project", domain: "runtime" },
      autoSafe: true,
    }];

    const resolved = resolveOrganizationFields(
      "cards/project/home-assistant-da/runtime.md",
      { project: "frontmatter-project" },
      rules,
      proposals,
    );

    // Path wins for project/home-assistant-da
    expect(resolved.project).toBe("home-assistant-da");
    // path-derived type wins over rule/proposal
    expect(resolved.type).toBe("project");
    // proposal still fills unknown slots
    expect(resolved.domain).toBe("runtime");
  });
});
