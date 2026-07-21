import { describe, expect, test } from "vitest";
import { HerdrCommandAdapter, HerdrCommandError, herdrAgentStatus, parseHerdrJson } from "../src/herdr.ts";

const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w9" } as NodeJS.ProcessEnv;

test("constructs explicit, unfocused tab and agent argv", async () => {
  const calls: string[][] = [];
  const adapter = new HerdrCommandAdapter(async (_command, args) => {
    calls.push(args);
    if (args[0] === "tab") return { stdout: JSON.stringify({ result: { tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p3" } } }), stderr: "", code: 0, killed: false };
    return { stdout: JSON.stringify({ result: {} }), stderr: "", code: 0, killed: false };
  }, env);
  expect(await adapter.createTab("/repo", "subagent run")).toEqual({ tabId: "w9:t2", rootPaneId: "w9:p3" });
  await adapter.startAgent("subagent_123", "pi", "w9:p3", ["--model", "a/b"]);
  expect(calls[0]).toEqual(["tab", "create", "--workspace", "w9", "--cwd", "/repo", "--label", "subagent run", "--no-focus"]);
  expect(calls[1]).toEqual(["agent", "start", "subagent_123", "--kind", "pi", "--pane", "w9:p3", "--", "--model", "a/b"]);
});

test("retries only agent_pane_busy and preserves the final error", async () => {
  let attempts = 0;
  const adapter = new HerdrCommandAdapter(async () => {
    attempts++;
    return { stdout: "", stderr: "agent_pane_busy: shell is still starting", code: 1, killed: false };
  }, env);
  await expect(adapter.startAgent("subagent_123", "pi", "w9:p3")).rejects.toMatchObject({ message: "agent_pane_busy: shell is still starting" });
  expect(attempts).toBe(31);
  expect(adapter.lastDiagnostics).toContain("agent_pane_busy");
});

test("does not retry unrelated Herdr start failures", async () => {
  let attempts = 0;
  const adapter = new HerdrCommandAdapter(async () => { attempts++; return { stdout: "", stderr: "agent_start_failed", code: 1, killed: false }; }, env);
  await expect(adapter.startAgent("subagent_123", "pi", "w9:p3")).rejects.toMatchObject({ message: "agent_start_failed" });
  expect(attempts).toBe(1);
});

test("completion wait excludes blocked and working states", async () => {
  let captured: string[] = [];
  const adapter = new HerdrCommandAdapter(async (_command, args) => {
    captured = args;
    return { stdout: JSON.stringify({ result: { agent: { agent_status: "working" } } }), stderr: "", code: 0, killed: false };
  }, env);
  expect((await adapter.wait("w9:p3", 5000)).status).toBe("working");
  expect(captured).toEqual(["agent", "wait", "w9:p3", "--until", "idle", "--until", "done", "--timeout", "5000"]);
});

test("requires Herdr only when a command is launched", () => {
  const adapter = new HerdrCommandAdapter(async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }), {});
  expect(() => adapter.assertAvailable()).toThrow(/HERDR_ENV=1/);
});

test("parses JSON envelopes, statuses, and preserves Herdr errors", async () => {
  expect(parseHerdrJson("noise\n{\"result\":{\"ok\":true}}\n").result.ok).toBe(true);
  expect(herdrAgentStatus({ result: { agent: { agent_status: "blocked", message: "Approve?" } } })).toMatchObject({ status: "blocked", message: "Approve?" });
  const adapter = new HerdrCommandAdapter(async () => ({ stdout: "{\"error\":\"bad\"}", stderr: "exact herdr error", code: 1, killed: false }), env);
  await expect(adapter.get("w9:p3")).rejects.toMatchObject({ message: "exact herdr error", diagnostics: expect.stringContaining("exact herdr error") });
  expect(adapter.lastDiagnostics).toContain("exact herdr error");
  expect(HerdrCommandError).toBeDefined();
});

describe("blocked state is a valid parsed state", () => {
  test("unknown values do not become approval", () => expect(herdrAgentStatus({ result: { agent: { agent_status: "???" } } }).status).toBe("unknown"));
});
