import { truncate } from "./util.ts";

/** Kinds supported by Herdr 0.7.5. Keep this list in lockstep with the CLI. */
export const HERDR_KINDS = [
  "pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "omp", "mastracode",
  "opencode", "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "maki",
] as const;
export type HerdrKind = (typeof HERDR_KINDS)[number];

export interface HerdrExecOptions { signal?: AbortSignal; timeout?: number; cwd?: string }
export interface HerdrExecResult { stdout: string; stderr: string; code: number; killed: boolean }
export type HerdrExec = (command: string, args: string[], options?: HerdrExecOptions) => Promise<HerdrExecResult>;

export class HerdrCommandError extends Error {
  constructor(message: string, readonly diagnostics: string, readonly code?: number) {
    super(message);
    this.name = "HerdrCommandError";
  }
}

export function isHerdrError(error: unknown, token: string): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(token.toLowerCase());
}
/** Parse the JSON envelope emitted by Herdr, tolerating harmless terminal noise. */
export function parseHerdrJson<T = any>(text: string): T {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed) as T; } catch { /* find the envelope below */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) as T; } catch { /* report the original output */ }
  }
  throw new Error(`Invalid Herdr JSON output: ${truncate(trimmed || "(empty)", 4000)}`);
}

export interface HerdrTab { tabId: string; rootPaneId: string }
export interface HerdrAgentInfo { status: "idle" | "working" | "blocked" | "done" | "unknown"; message?: string; raw: any }

function value(root: any, ...keys: string[]): any {
  let current = root;
  for (const key of keys) current = current?.[key];
  return current;
}

export function herdrAgentStatus(payload: any): HerdrAgentInfo {
  const agent = value(payload, "result", "agent") ?? value(payload, "agent") ?? payload;
  const raw = String(agent?.agent_status ?? agent?.status ?? "unknown").toLowerCase();
  const status = (["idle", "working", "blocked", "done", "unknown"] as const).includes(raw as any) ? raw as HerdrAgentInfo["status"] : "unknown";
  return { status, message: typeof agent?.message === "string" ? agent.message : undefined, raw: agent };
}

export class HerdrCommandAdapter {
  lastDiagnostics = "";
  constructor(private readonly exec: HerdrExec, private readonly env: NodeJS.ProcessEnv = process.env) {}

  assertAvailable(): string {
    if (this.env.HERDR_ENV !== "1") throw new Error("Pi Subagents requires a Herdr-managed pane (HERDR_ENV=1).");
    const workspace = this.env.HERDR_WORKSPACE_ID;
    if (!workspace) throw new Error("Pi Subagents requires HERDR_WORKSPACE_ID in the Herdr-managed pane.");
    return workspace;
  }

  private async execute(args: string[], options?: HerdrExecOptions): Promise<HerdrExecResult> {
    let result: HerdrExecResult;
    try { result = await this.exec("herdr", args, options); }
    catch (error) {
      this.lastDiagnostics = truncate(error instanceof Error ? error.message : String(error), 12000);
      throw error;
    }
    const diagnostics = truncate([result.stdout, result.stderr].filter(Boolean).join("\n"), 12000);
    this.lastDiagnostics = diagnostics;
    if (result.code !== 0) {
      const message = result.stderr || result.stdout || (result.killed ? "herdr command timed out" : `herdr exited with code ${result.code}`);
      throw new HerdrCommandError(message.trim(), diagnostics, result.code);
    }
    return result;
  }

  private async command(args: string[], options?: HerdrExecOptions): Promise<any> {
    const result = await this.execute(args, options);
    return parseHerdrJson(result.stdout);
  }

  async createTab(cwd: string, label: string): Promise<HerdrTab> {
    const workspace = this.assertAvailable();
    const payload = await this.command(["tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", label, "--no-focus"]);
    const tab = value(payload, "result", "tab");
    const pane = value(payload, "result", "root_pane");
    const tabId = typeof tab === "string" ? tab : tab?.tab_id;
    const rootPaneId = typeof pane === "string" ? pane : pane?.pane_id;
    if (!tabId || !rootPaneId) throw new Error("Herdr tab create returned no tab or root pane ID.");
    return { tabId, rootPaneId };
  }

  async startAgent(name: string, kind: HerdrKind, paneId: string, args: string[] = [], signal?: AbortSignal): Promise<void> {
    const argv = ["agent", "start", name, "--kind", kind, "--pane", paneId];
    if (args.length) argv.push("--", ...args);
    const retries = 30;
    for (let attempt = 0; ; attempt++) {
      try { await this.command(argv, { signal }); return; }
      catch (error) {
        if (!(error instanceof HerdrCommandError) || !isHerdrError(error, "agent_pane_busy") || attempt >= retries) throw error;
        await new Promise<void>((resolve, reject) => {
          let abort: (() => void) | undefined;
          const timer = setTimeout(() => { if (abort) signal?.removeEventListener("abort", abort); resolve(); }, 100);
          abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort!); reject(new Error("Herdr agent start aborted.")); };
          if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
        });
      }
    }
  }

  async prompt(target: string, text: string, options: { wait?: boolean; until?: HerdrAgentInfo["status"]; timeout?: number; signal?: AbortSignal } = {}): Promise<HerdrAgentInfo> {
    const argv = ["agent", "prompt", target, text];
    if (options.wait !== false) argv.push("--wait");
    if (options.until && options.until !== "unknown") argv.push("--until", options.until);
    if (options.timeout !== undefined && options.timeout > 0) argv.push("--timeout", String(options.timeout));
    return herdrAgentStatus(await this.command(argv, { signal: options.signal, timeout: options.timeout }));
  }

  async wait(target: string, timeout?: number, until: HerdrAgentInfo["status"][] = ["idle", "done"], signal?: AbortSignal): Promise<HerdrAgentInfo> {
    const argv = ["agent", "wait", target];
    for (const state of until) argv.push("--until", state);
    if (timeout !== undefined && timeout > 0) argv.push("--timeout", String(timeout));
    return herdrAgentStatus(await this.command(argv, { timeout, signal }));
  }

  async get(target: string): Promise<HerdrAgentInfo> {
    return herdrAgentStatus(await this.command(["agent", "get", target]));
  }

  async read(target: string, lines = 300): Promise<string> {
    // `agent read` is intentionally a raw terminal snapshot in Herdr 0.7.5,
    // unlike the JSON control commands.
    const result = await this.execute(["agent", "read", target, "--source", "recent-unwrapped", "--lines", String(lines)]);
    return truncate(result.stdout, 50 * 1024);
  }

  async sendKeys(target: string, ...keys: string[]): Promise<void> { await this.command(["agent", "send-keys", target, ...keys]); }
  async focus(target: string): Promise<void> { await this.command(["agent", "focus", target]); }
  async closeTab(tabId: string): Promise<void> {
    try { await this.command(["tab", "close", tabId]); } catch (error) { this.lastDiagnostics = truncate(`${this.lastDiagnostics}\n${error instanceof Error ? error.message : String(error)}`, 12000); }
  }
}
