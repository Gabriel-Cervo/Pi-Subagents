import { describe, expect, test } from "vitest";
import { notificationContent, notificationDetails, statusColorRole, statusIcon } from "../src/rendering.ts";
import type { RunResult } from "../src/types.ts";

const run = (overrides: Partial<RunResult> = {}): RunResult => ({
  id: "run-1",
  agent: "Explore",
  description: "Inspect the repository",
  status: "completed",
  output: "Found the entry point.",
  model: "provider/model",
  modelSource: "parent",
  thinking: "medium",
  prompts: 2,
  createdAt: 1,
  ...overrides,
});

describe("subagent rendering view models", () => {
  test.each([
    ["queued", "accent", "○"],
    ["running", "warning", "●"],
    ["blocked", "warning", "!"],
    ["completed", "success", "✓"],
    ["failed", "error", "✗"],
    ["aborted", "error", "✗"],
  ] as const)("maps %s to its semantic role and icon", (status, role, icon) => {
    expect(statusColorRole(status)).toBe(role);
    expect(statusIcon(status)).toBe(icon);
  });

  test("shapes an individual notification without presentation text", () => {
    const details = notificationDetails("individual", [run({ status: "failed", output: "partial", error: "rate limited" })]);
    expect(details).toEqual({
      type: "subagent-notification",
      kind: "individual",
      ids: ["run-1"],
      runs: [{
        id: "run-1",
        agent: "Explore",
        description: "Inspect the repository",
        status: "failed",
        model: "provider/model",
        modelSource: "parent",
        prompts: 2,
        result: "partial",
        error: "rate limited",
      }],
    });
    const content = notificationContent(details);
    expect(content).toContain("Subagent Explore (run-1) failed");
    expect(content).toContain("Error: rate limited");
    expect(content).toContain("Partial output: partial");
    expect(content).not.toContain("\u001b[");
  });

  test("shapes a smart-joined batch with per-run metadata and ids", () => {
    const details = notificationDetails("batch", [
      run(),
      run({ id: "run-2", agent: "Plan", status: "aborted", output: "", partialOutput: "Partial plan", prompts: 4, error: "stopped" }),
    ]);
    expect(details.kind).toBe("batch");
    expect(details.ids).toEqual(["run-1", "run-2"]);
    expect(details.runs[1]).toMatchObject({
      id: "run-2",
      agent: "Plan",
      description: "Inspect the repository",
      status: "aborted",
      prompts: 4,
      result: "Partial plan",
      error: "stopped",
    });
    const content = notificationContent(details);
    expect(content).toContain("Plan (run-2) aborted (4 prompts):");
    expect(content).toContain("Error: stopped");
    expect(content).toContain("Partial output: Partial plan");
  });

  test("keeps blocked recovery guidance and batch notifications bounded", () => {
    const blocked = notificationContent(notificationDetails("individual", [run({ status: "blocked", output: "", error: "Approve?" })]));
    expect(blocked).toContain("Resolve the interaction");
    const batch = notificationContent(notificationDetails("batch", Array.from({ length: 20 }, (_, index) => run({ id: `run-${index}`, output: "x".repeat(5000) }))));
    expect(Buffer.byteLength(batch, "utf8")).toBeLessThanOrEqual(20000);
  });
});
