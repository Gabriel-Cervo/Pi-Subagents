import { test, expect } from "vitest";
import { precedence } from "../src/models.ts";
import type { AgentDefinition } from "../src/types.ts";
const def = { name: "Explore", description: "", displayName: "Explore", tools: ["read"], enabled: true, prompt: "", source: "default", legacyFields: [], model: "definition/model" } as AgentDefinition;
const settings = { version: 1, maxConcurrent: 4, joinMode: "smart", groupTimeoutMs: 1, allowCallerModelOverride: false, defaultMaxTurns: 1, graceTurns: 0, agentModels: { Explore: "global/model" } } as any;
test("model precedence honors the caller gate and settings", () => {
  expect(() => precedence(def, settings, "parent/model", "caller/model", false)).toThrow(/caller override is disabled/);
  expect(precedence(def, settings, "parent/model", "caller/model", true)).toBe("caller/model");
  expect(precedence({ ...def, model: undefined }, { ...settings, agentModels: {} }, "parent/model", undefined, false)).toBe("parent/model");
});
