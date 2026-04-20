import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sinclair/typebox", () => {
  const identity = <T>(value: T) => value;
  return {
    Type: {
      Object: identity,
      Optional: identity,
      String: identity,
      Number: identity,
    },
  };
});

async function loadExtension() {
  const mod = await import("../../pi-extension/index.ts");
  return mod.default;
}

type HookHandler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
};

type RegisteredCommand = {
  description?: string;
  handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void>;
};

class MockPi {
  private handlers = new Map<string, HookHandler[]>();
  private tools = new Map<string, RegisteredTool>();
  private commands = new Map<string, RegisteredCommand>();
  public sendMessageCalls: Array<{ message: unknown; options: unknown }> = [];
  public sentUserMessages: string[] = [];

  on(event: string, handler: HookHandler) {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  registerTool(tool: RegisteredTool) {
    this.tools.set(tool.name, tool);
  }

  registerCommand(name: string, command: RegisteredCommand) {
    this.commands.set(name, command);
  }

  sendMessage(message: unknown, options: unknown) {
    this.sendMessageCalls.push({ message, options });
  }

  sendUserMessage(message: string) {
    this.sentUserMessages.push(message);
  }

  getHook(event: string): HookHandler {
    const handlers = this.handlers.get(event) ?? [];
    if (handlers.length !== 1) {
      throw new Error(`Expected exactly one handler for ${event}, found ${handlers.length}`);
    }
    return handlers[0];
  }

  getTool(name: string): RegisteredTool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    return tool;
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  getCommand(name: string): RegisteredCommand {
    const command = this.commands.get(name);
    if (!command) throw new Error(`Command not registered: ${name}`);
    return command;
  }
}

const originalDepth = process.env.PI_SUBAGENT_DEPTH;

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
});

afterEach(() => {
  if (originalDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
  else process.env.PI_SUBAGENT_DEPTH = originalDepth;
});

describe("memex pi-extension reminder injection", () => {
  it("injects recall reminder for top-level agent turns", async () => {
    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    const beforeAgentStart = pi.getHook("before_agent_start");
    const result = await beforeAgentStart({}, {});

    expect(result).toMatchObject({
      message: {
        customType: "memex-recall-reminder",
        display: false,
      },
    });
  });

  it("does not inject recall reminder for subagent turns", async () => {
    process.env.PI_SUBAGENT_DEPTH = "1";

    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    const beforeAgentStart = pi.getHook("before_agent_start");
    const result = await beforeAgentStart({}, {});

    expect(result).toBeUndefined();
  });

  it("does not send retro reminder for subagent turns", async () => {
    process.env.PI_SUBAGENT_DEPTH = "1";

    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    // Set recallDone=true through the tool path to exercise the subagent guard specifically.
    const recall = pi.getTool("memex_recall");
    await recall.execute("tool-call-id", {});

    const agentEnd = pi.getHook("agent_end");
    await agentEnd({}, {});

    expect(pi.sendMessageCalls).toHaveLength(0);
  });

  it("registers memex-ingest slash command", async () => {
    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    expect(pi.hasCommand("memex-ingest")).toBe(true);
  });

  it("memex-ingest command has URL-only usage", async () => {
    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    const command = pi.getCommand("memex-ingest");
    expect(command.description).toContain("/memex-ingest <url>");

    const notifications: Array<{ message: string; level: string }> = [];
    await command.handler("", {
      ui: {
        notify: (message: string, level: string) => notifications.push({ message, level }),
      },
    });

    expect(notifications.some((n) => n.message.includes("Usage: /memex-ingest <url>"))).toBe(true);
  });

  it("/memex supports ingest subcommand with inferred type", async () => {
    const memexExtension = await loadExtension();
    const pi = new MockPi();
    memexExtension(pi as never);

    const command = pi.getCommand("memex");
    expect(command.description).toContain("/memex ingest <url>");
  });
});
