type Phase = "pre" | "post";
type Operation = "recall" | "retro" | "organize" | "show" | "pull" | "push" | "init";
type HookKey = `${Phase}:${Operation}`;
type HookFn = () => Promise<void>;

export class HookRegistry {
  private hooks = new Map<HookKey, HookFn[]>();

  on(key: HookKey, fn: HookFn): void {
    const existing = this.hooks.get(key) || [];
    existing.push(fn);
    this.hooks.set(key, existing);
  }

  async run(phase: Phase, operation: Operation): Promise<void> {
    const key: HookKey = `${phase}:${operation}`;
    for (const fn of this.hooks.get(key) || []) {
      try {
        await fn();
      } catch {
        // hooks fail silently — they're infrastructure, not business logic
      }
    }
  }
}
