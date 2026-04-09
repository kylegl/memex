import { describe, it, expect } from "vitest";
import { HookRegistry } from "../../src/core/hooks.js";

describe("HookRegistry", () => {
  it("runs pre hooks in order", async () => {
    const registry = new HookRegistry();
    const log: string[] = [];
    registry.on("pre:recall", async () => { log.push("a"); });
    registry.on("pre:recall", async () => { log.push("b"); });
    await registry.run("pre", "recall");
    expect(log).toEqual(["a", "b"]);
  });

  it("runs post hooks in order", async () => {
    const registry = new HookRegistry();
    const log: string[] = [];
    registry.on("post:retro", async () => { log.push("x"); });
    await registry.run("post", "retro");
    expect(log).toEqual(["x"]);
  });

  it("does nothing when no hooks registered", async () => {
    const registry = new HookRegistry();
    await registry.run("pre", "organize");
  });

  it("swallows hook errors silently", async () => {
    const registry = new HookRegistry();
    registry.on("pre:recall", async () => { throw new Error("fail"); });
    await registry.run("pre", "recall");
  });
});
