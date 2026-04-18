import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("serve-ui graph stability guards", () => {
  it("filters self-links and guards zero-distance springs", () => {
    const html = readFileSync(join(process.cwd(), "src/commands/serve-ui.html"), "utf-8");

    // Self-link guard when building graph edges
    expect(html).toContain("if (l !== c.slug && slugSet.has(l)) gAllEdges.push([c.slug, l]);");

    // Zero-distance / non-finite distance guard in spring phase
    expect(html).toContain("if (!Number.isFinite(dist) || dist < 1e-6) return;");

    // Non-finite node state healing to prevent NaN cascades
    expect(html).toContain("if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.vx) || !Number.isFinite(n.vy))");
  });
});
