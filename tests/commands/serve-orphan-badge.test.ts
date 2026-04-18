import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("serve-ui orphan badge logic", () => {
  it("excludes generated navigation indexes from orphan count", () => {
    const html = readFileSync(join(process.cwd(), "src/commands/serve-ui.html"), "utf-8");

    // Ensure the helper exists
    expect(html).toContain("const isGeneratedNavIndex = (card)");
    expect(html).toContain("source === 'organize' && generated === 'navigation-index'");

    // Ensure orphan metric uses actionableCards, not raw cards.length
    expect(html).toContain("const actionableCards = cards.filter(c => !isGeneratedNavIndex(c));");
    expect(html).toContain("const actionableConnectedCount = actionableCards.filter(c => connected.has(c.slug)).length;");
    expect(html).toContain("const orphanCount = Math.max(0, actionableCards.length - actionableConnectedCount);");

    // Guard against old implementation
    expect(html).not.toContain("const orphanCount = cards.length - connected.size;");
  });
});
