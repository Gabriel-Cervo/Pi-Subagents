import { test, expect } from "vitest";
import { agentSchema, resultSchema, steerSchema, buildAgentArgs, buildPiArgs, validateKindOverrides, validateResumeStatus } from "../src/manager.ts";
import type { AgentDefinition } from "../src/types.ts";
import { BUILTIN_AGENT_CATALOG, defaultAgentDefinitions } from "../src/builtins.ts";
import { AGENT_TOOL_DESCRIPTION, AGENT_TOOL_PROMPT_GUIDELINES, AGENT_TOOL_PROMPT_SNIPPET } from "../src/agent-tool-metadata.ts";

test("public tool schemas use the required names and fields", () => {
  expect(agentSchema.properties.prompt).toBeDefined();
  expect(agentSchema.properties.inherit_context).toBeDefined();
  expect(resultSchema.properties.agent_id).toBeDefined();
  expect(resultSchema.properties.wait).toBeDefined();
  expect(resultSchema.properties.verbose).toBeDefined();
  expect(steerSchema.properties.agent_id).toBeDefined();
  expect(steerSchema.properties.message).toBeDefined();
});

test("kind overrides ignore definition args while default kinds retain them", () => {
  const definition = { name: "x", description: "x", displayName: "x", tools: ["read"], enabled: true, prompt: "x", source: "global", legacyFields: [], kind: "claude", args: ["--flag"] } as AgentDefinition;
  expect(buildAgentArgs(definition, "claude", "provider/model", "medium", "system", false)).toEqual(["--flag"]);
  expect(buildAgentArgs(definition, "pi", "provider/model", "medium", "system", true)).not.toContain("--flag");
});

test("Pi agents stay interactive for Herdr prompt and wait", () => {
  const definition = { name: "x", description: "x", displayName: "x", tools: ["read"], enabled: true, prompt: "x", source: "default", legacyFields: [], kind: "pi" } as AgentDefinition;
  const args = buildPiArgs(definition, "provider/model", "medium", "system");
  expect(args).not.toContain("--print");
  expect(args).toContain("--no-session");
  expect(args).toContain("--system-prompt");
});

test("default catalog exposes five distinct, prompted roles with least-privilege tools", () => {
  const names = BUILTIN_AGENT_CATALOG.map((agent) => agent.name.toLocaleLowerCase());
  expect(names).toEqual(["general-purpose", "explore", "plan", "implementer", "reviewer"]);
  expect(new Set(names).size).toBe(names.length);
  expect(BUILTIN_AGENT_CATALOG).toHaveLength(5);
  for (const agent of BUILTIN_AGENT_CATALOG) {
    expect(agent.category).toBeTruthy();
    expect(agent.prompt.length).toBeGreaterThan(40);
    expect(agent.dispatchGuidance.length).toBeGreaterThan(20);
  }

  const readOnly = new Set(["explore", "plan", "reviewer"]);
  for (const agent of defaultAgentDefinitions()) {
    if (readOnly.has(agent.name.toLocaleLowerCase())) {
      expect(agent.tools).not.toContain("edit");
      expect(agent.tools).not.toContain("write");
    }
  }
});

test("non-Pi kinds reject model and thinking overrides", () => {
  expect(() => validateKindOverrides("claude", { model: "provider/model" })).toThrow(/only valid for Pi/);
  expect(() => validateKindOverrides("codex", { thinking: "high" })).toThrow(/only valid for Pi/);
  expect(() => validateKindOverrides("pi", { model: "provider/model", thinking: "high" })).not.toThrow();
});

test("blocked and live runs cannot be resumed", () => {
  expect(() => validateResumeStatus("blocked")).toThrow(/cannot be resumed/);
  expect(() => validateResumeStatus("running")).toThrow(/cannot be resumed/);
  expect(() => validateResumeStatus("completed")).not.toThrow();
});

test("Agent tool metadata describes every built-in and its dispatch role", () => {
  for (const agent of BUILTIN_AGENT_CATALOG) {
    expect(AGENT_TOOL_DESCRIPTION).toContain(agent.name);
    expect(AGENT_TOOL_DESCRIPTION).toContain(agent.description);
  }

  expect(AGENT_TOOL_PROMPT_SNIPPET).toMatch(/substantial work/i);
  const guidelines = AGENT_TOOL_PROMPT_GUIDELINES.join(" ");
  expect(guidelines).toMatch(/Explore.*broad.*read-only/i);
  expect(guidelines).toMatch(/Plan.*planning|produce a plan/i);
  expect(guidelines).toMatch(/implementer.*focused.*coding.*testing/i);
  expect(guidelines).toMatch(/general-purpose.*otherwise/i);
  expect(guidelines).toMatch(/run_in_background/);
  expect(guidelines).toMatch(/trivial/);
});
