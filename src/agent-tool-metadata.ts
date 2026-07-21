import { builtinAgentSummary, builtinDispatchGuidance } from "./builtins.ts";

export const AGENT_TOOL_DESCRIPTION = [
  "Run an isolated Herdr-backed coding agent. Choose a built-in type that matches the task; custom configured definitions may also be available.",
  "Built-in agent definitions:",
  builtinAgentSummary(),
  "Background runs return an id; use get_subagent_result to wait for their results.",
].join("\n");

export const AGENT_TOOL_PROMPT_SNIPPET =
  `Delegate substantial work proactively to the built-in agent type that best matches the task. ${builtinDispatchGuidance()}.`;

export const AGENT_TOOL_PROMPT_GUIDELINES = [
  `Use Agent proactively for substantial work and dispatch by task. ${builtinDispatchGuidance()}.`,
  "For two or more independent, meaningful workstreams, consider separate Agent calls with run_in_background: true and then collect each id with get_subagent_result; keep dependent work sequential.",
  "Do not use Agent for trivial questions or work that is faster and clearer to do directly. Give each delegated agent a focused, self-contained prompt and description.",
];
