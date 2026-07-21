import { test, expect } from "vitest";
import { agentSchema, resultSchema, steerSchema } from "../src/manager.ts";

test("public tool schemas use the required names and fields", () => {
  expect(agentSchema.properties.prompt).toBeDefined();
  expect(agentSchema.properties.inherit_context).toBeDefined();
  expect(resultSchema.properties.agent_id).toBeDefined();
  expect(resultSchema.properties.wait).toBeDefined();
  expect(resultSchema.properties.verbose).toBeDefined();
  expect(steerSchema.properties.agent_id).toBeDefined();
  expect(steerSchema.properties.message).toBeDefined();
});
