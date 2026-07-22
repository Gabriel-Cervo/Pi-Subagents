import { test, expect, vi } from "vitest";
import { SubagentManager } from "../src/manager.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { HerdrCommandAdapter, type HerdrAgentInfo } from "../src/herdr.ts";

const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;

class ProgressHerdr extends HerdrCommandAdapter {
  reads = 0;
  marker = "";
  promptStatus: HerdrAgentInfo["status"] = "idle";
  releasePrompt?: () => void;

  constructor() {
    super(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }), env);
  }

  override assertAvailable(): string { return "w1:p1"; }
  override async splitPane(): Promise<{ paneId: string }> { return { paneId: "w1:p2" }; }
  override async startAgent(): Promise<void> {}
  override async prompt(_target: string, text: string): Promise<HerdrAgentInfo> {
    this.marker = text.match(/(__PI_SUBAGENT_RESULT_[^\s]+__)/)?.[1] ?? "";
    await new Promise<void>((resolve) => { this.releasePrompt = resolve; });
    return { status: this.promptStatus, raw: {} };
  }
  override async wait(): Promise<HerdrAgentInfo> { return { status: "idle", raw: {} }; }
  override async read(): Promise<string> {
    this.reads++;
    return this.reads === 1 ? "live terminal progress" : `${this.marker}\nfinal answer\n${this.marker}/`;
  }
  override async closePane(): Promise<boolean> { return true; }
}

function testContext(model: any): any {
  return {
    cwd: process.cwd(),
    model,
    modelRegistry: { find: vi.fn(() => model), getAvailable: vi.fn(() => [model]) },
    isProjectTrusted: () => false,
    hasUI: false,
    ui: { notify: vi.fn(), confirm: vi.fn() },
    sessionManager: { buildContextEntries: () => [] },
  };
}

test("forwards live Herdr terminal output through onUpdate", async () => {
  const herdr = new ProgressHerdr();
  const model = { provider: "provider", id: "model" };
  const pi = { on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any;
  const manager = new SubagentManager(pi, testContext(model), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  const updates: Array<{ output: string; status: string }> = [];
  const runPromise = manager.launch(
    { prompt: "Inspect the repository.", description: "Inspect", subagent_type: "Explore" },
    (output, result) => updates.push({ output, status: result.status }),
  );

  const deadline = Date.now() + 2000;
  while (!updates.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(updates[0]).toMatchObject({ output: "live terminal progress", status: "running" });

  herdr.releasePrompt?.();
  const result = await runPromise;
  expect(result.status).toBe("completed");
  expect(result.output).toBe("final answer");
  expect(updates.at(-1)).toMatchObject({ output: "final answer", status: "running" });
  const updateCount = updates.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(updates).toHaveLength(updateCount);
  await manager.cleanup();
});

test("does not emit progress after a background tool call returns", async () => {
  const herdr = new ProgressHerdr();
  const model = { provider: "provider", id: "model" };
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext(model), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };
  const updates: string[] = [];

  const queued = await manager.launch(
    { prompt: "Inspect the repository.", description: "Inspect", subagent_type: "Explore", run_in_background: true },
    (output) => updates.push(output),
  );
  const deadline = Date.now() + 2000;
  while (!herdr.releasePrompt && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(updates).toEqual([]);
  herdr.releasePrompt?.();
  const result = await manager.result(queued.id);
  expect(result.status).toBe("completed");
  expect(updates).toEqual([]);
  await manager.cleanup();
});
