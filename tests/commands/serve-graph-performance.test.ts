import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("serve-ui graph performance guards", () => {
  it("disables physics simulation for large graphs and conditionally renders labels", () => {
    const html = readFileSync(join(process.cwd(), "src/commands/serve-ui.html"), "utf-8");

    expect(html).toContain("const MAX_PHYSICS_NODES = 500;");
    expect(html).toContain("physicsActive = gNodes.length <= MAX_PHYSICS_NODES;");

    expect(html).toContain("const renderLabels = gNodes.length <= 600 || !!selectedId || !!hoverNode || !!graphSearchQuery;");
    expect(html).toContain("if (renderLabels) {");
  });
});
