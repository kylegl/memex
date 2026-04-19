import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("serve-ui graph layout", () => {
  it("seeds nodes with deterministic spiral layout instead of strict ring", () => {
    const html = readFileSync(join(process.cwd(), "src/commands/serve-ui.html"), "utf-8");

    expect(html).toContain("function hash01(str)");
    expect(html).toContain("const golden = 2.399963229728653;");
    expect(html).toContain("const angle = i * golden + jitterA * 0.9;");
    expect(html).toContain("const baseRadius = 28 + Math.sqrt(i + 1) * 10;");
    expect(html).toContain("gNodeById = new Map(gNodes.map(n => [n.id, n]));");
  });
});
