import { test, expect } from "vitest";
import { agentSchema, resultSchema, steerSchema } from "../src/manager.ts";
import { BUILTIN_AGENT_CATALOG } from "../src/builtins.ts";
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
