import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("serve-ui graph performance guards", () => {
  it("uses adaptive physics modes and context-aware labels for large graphs", () => {
    const html = readFileSync(join(process.cwd(), "src/commands/serve-ui.html"), "utf-8");

    expect(html).toContain("const FULL_PHYSICS_NODES = 450;");
    expect(html).toContain("const SAMPLED_PHYSICS_NODES = 4000;");
    expect(html).toContain("if (gNodes.length <= FULL_PHYSICS_NODES) physicsMode = 'full';");
    expect(html).toContain("else if (gNodes.length <= SAMPLED_PHYSICS_NODES) physicsMode = 'sampled';");
    expect(html).toContain("physicsActive = physicsMode !== 'off';");

    expect(html).toContain("const sampleCount = Math.min(24, Math.max(10, Math.floor(Math.sqrt(nodeCount) * 0.5)));");

    expect(html).toContain("const renderAllLabels = gNodes.length <= 250;");
    expect(html).toContain("const shouldLabel = renderAllLabels || isSel || isHov || isN || (graphSearchQuery && isM);");
  });
});
