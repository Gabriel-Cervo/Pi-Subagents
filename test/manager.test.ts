import { test, expect, vi } from "vitest";
import { SubagentManager } from "../src/manager.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { HerdrCommandAdapter, type HerdrAgentInfo } from "../src/herdr.ts";

const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;

class ProgressHerdr extends HerdrCommandAdapter {
  reads = 0;
  marker = "";
  promptTargets: string[] = [];
  readTargets: string[] = [];
  closeTargets: string[] = [];
  lastPrompt = "";
  promptStatus: HerdrAgentInfo["status"] = "idle";
  releasePrompt?: () => void;
  holdWait = false;
  releaseWait?: () => void;
  holdRead = false;
  releaseRead?: () => void;
  paneLookup = "w1:p2";
  paneLookupError = false;

  constructor() {
    super(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }), env);
  }

  override assertAvailable(): string { return "w1:p1"; }
  override async splitPane(): Promise<{ paneId: string }> { return { paneId: "w1:p2" }; }
  override async startAgent(): Promise<void> {}
  override async prompt(target: string, text: string): Promise<HerdrAgentInfo> {
    this.promptTargets.push(target);
    this.lastPrompt = text;
    this.marker = text.match(/(__PI_SUBAGENT_RESULT_[^\s]+__)/)?.[1] ?? "";
    await new Promise<void>((resolve) => { this.releasePrompt = resolve; });
    return { status: this.promptStatus, raw: {} };
  }
  override async wait(): Promise<HerdrAgentInfo> {
    if (this.holdWait) await new Promise<void>((resolve) => { this.releaseWait = resolve; });
    return { status: "idle", raw: {} };
  }
  override async agentPaneId(): Promise<string | undefined> {
    if (this.paneLookupError) throw new Error("agent lookup failed");
    return this.paneLookup;
  }
  override async read(target: string): Promise<string> {
    this.readTargets.push(target);
    if (this.holdRead) await new Promise<void>((resolve) => { this.releaseRead = resolve; });
    this.reads++;
    return this.reads === 1 ? "live terminal progress" : `${this.marker}\nfinal answer\n${this.marker}/`;
  }
  override async closePane(pane: string): Promise<boolean> { this.closeTargets.push(pane); return true; }
}

class InstantHerdr extends HerdrCommandAdapter {
  private readonly markers = new Map<string, string>();
  private pane = 1;

  constructor() { super(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }), env); }
  override assertAvailable(): string { return "w1:p1"; }
  override async splitPane(): Promise<{ paneId: string }> { this.pane++; return { paneId: `w1:p${this.pane}` }; }
  override async startAgent(): Promise<void> {}
  override async prompt(target: string, text: string): Promise<HerdrAgentInfo> {
    this.markers.set(target, text.match(/(__PI_SUBAGENT_RESULT_[^\s]+__)/)?.[1] ?? "");
    return { status: "idle", raw: {} };
  }
  override async read(target: string): Promise<string> { const marker = this.markers.get(target) ?? ""; return `${marker}\nresult\n${marker}/`; }
  override async agentPaneId(): Promise<string | undefined> { return "w1:p2"; }
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

test("passes definition instructions to native Herdr kinds and uses the stable agent name", async () => {
  const herdr = new ProgressHerdr();
  const model = { provider: "provider", id: "model" };
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext(model), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  const runPromise = manager.launch({ prompt: "Review this change.", description: "Review", subagent_type: "reviewer", kind: "claude" });
  const deadline = Date.now() + 2000;
  while (!herdr.releasePrompt && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(herdr.promptTargets[0]).toMatch(/^subagent_/);
  expect(herdr.marker).toBeTruthy();
  herdr.releasePrompt?.();
  await expect(runPromise).resolves.toMatchObject({ status: "completed", output: "final answer" });
  expect(herdr.lastPrompt).toContain("Review the requested change");
  expect(herdr.lastPrompt).toContain("Review this change.");
  expect(herdr.readTargets.every((target) => target.startsWith("subagent_"))).toBe(true);
  await manager.cleanup();
});

test("allows an explicit re-approval after a project approval denial or revoke", async () => {
  const model = { provider: "provider", id: "model" };
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const context = { ...testContext(model), isProjectTrusted: () => true, hasUI: true, ui: { notify: vi.fn(), confirm } };
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, context, new ProgressHerdr());
  await expect(manager.approveProject()).resolves.toBe(false);
  await expect(manager.approveProject()).rejects.toThrow(/not approved/);
  manager.revokeProject();
  await expect(manager.approveProject(true)).resolves.toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
});

test("smart join coordinates only background runs in the production manager", async () => {
  const sendMessage = vi.fn();
  const manager = new SubagentManager({ on: vi.fn(), sendMessage, exec: vi.fn() } as any, testContext({ provider: "provider", id: "model" }), new InstantHerdr());
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };
  (manager as any).startTurn();
  const background = await manager.launch({ prompt: "background", description: "Background", subagent_type: "Explore", run_in_background: true });
  await vi.waitFor(() => expect(manager.list().find((run) => run.id === background.id)?.status).toBe("completed"));
  await manager.launch({ prompt: "foreground", description: "Foreground", subagent_type: "Explore" });
  expect(sendMessage).not.toHaveBeenCalled();
  (manager as any).endTurn();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage.mock.calls[0][0].details.runs.map((run: { id: string }) => run.id)).toEqual([background.id]);
  await manager.cleanup();
});

test("does not trust an unknown Herdr lifecycle state as completion", async () => {
  const herdr = new ProgressHerdr();
  herdr.promptStatus = "unknown";
  const model = { provider: "provider", id: "model" };
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext(model), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  const runPromise = manager.launch({ prompt: "Inspect.", description: "Inspect", subagent_type: "Explore" });
  const deadline = Date.now() + 2000;
  while (!herdr.releasePrompt && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  herdr.releasePrompt?.();
  await expect(runPromise).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("could not determine") });
  expect(herdr.closeTargets).toContain("w1:p2");
  await manager.cleanup();
});

test("recreates the completion promise when a blocked run resumes", async () => {
  const herdr = new ProgressHerdr();
  herdr.promptStatus = "blocked";
  herdr.holdWait = true;
  herdr.holdRead = true;
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext({ provider: "provider", id: "model" }), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  const queued = await manager.launch({ prompt: "Approve and continue.", description: "Blocked", subagent_type: "Explore", run_in_background: true });
  await vi.waitFor(() => expect(herdr.releasePrompt).toBeDefined());
  herdr.releasePrompt?.();
  await vi.waitFor(() => expect(manager.list().find((run) => run.id === queued.id)?.status).toBe("blocked"));

  await vi.waitFor(() => expect(herdr.releaseWait).toBeDefined());
  herdr.releaseWait?.();
  await vi.waitFor(() => expect(manager.list().find((run) => run.id === queued.id)?.status).toBe("running"));
  await vi.waitFor(() => expect(herdr.releaseRead).toBeDefined());
  const resultPromise = manager.result(queued.id);
  let resolved = false;
  void resultPromise.then(() => { resolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(resolved).toBe(false);
  herdr.holdRead = false;
  herdr.releaseRead?.();
  await expect(resultPromise).resolves.toMatchObject({ status: "completed", output: "final answer" });
  await manager.cleanup();
});

test("fails closed when the agent pane cannot be reconfirmed after start", async () => {
  const herdr = new ProgressHerdr();
  herdr.paneLookupError = true;
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext({ provider: "provider", id: "model" }), herdr);
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  const runPromise = manager.launch({ prompt: "Inspect.", description: "Inspect", subagent_type: "Explore" });
  await vi.waitFor(() => expect(herdr.releasePrompt).toBeDefined());
  herdr.releasePrompt?.();
  const result = await runPromise;
  expect(result.status).toBe("completed");
  expect(herdr.closeTargets).toEqual([]);
  expect(result.diagnostics).toMatch(/cleanup failed closed/);
  await manager.cleanup();
});

test("disposes completed turn groups after their runs are no longer needed", async () => {
  const manager = new SubagentManager({ on: vi.fn(), sendMessage: vi.fn(), exec: vi.fn() } as any, testContext({ provider: "provider", id: "model" }), new InstantHerdr());
  (manager as any).settings = { effective: () => ({ ...DEFAULT_SETTINGS }) };

  for (let index = 0; index < 20; index++) {
    (manager as any).startTurn();
    await manager.launch({ prompt: `Foreground ${index}`, description: "Foreground", subagent_type: "Explore" });
    (manager as any).endTurn();
  }
  expect((manager as any).groups.size).toBe(0);
  await manager.cleanup();
});
