import type { AgentDefinition, BuiltinTool } from "./types.ts";
import { BUILTIN_TOOLS } from "./types.ts";

export interface BuiltinAgentCatalogEntry {
  name: string;
  displayName: string;
  description: string;
  tools: readonly BuiltinTool[];
  prompt: string;
  dispatchGuidance: string;
}

/** The built-in definitions exposed to the parent model through the Agent tool. */
export const BUILTIN_AGENT_CATALOG = [
  {
    name: "general-purpose",
    displayName: "General-purpose",
    description: "A capable general coding and research agent.",
    tools: BUILTIN_TOOLS,
    prompt: "Be concise and solve the assigned task. Inspect relevant files before acting.",
    dispatchGuidance: "Use otherwise for tasks that do not fit a more specialized type.",
  },
  {
    name: "Explore",
    displayName: "Explore",
    description: "Fast, read-only codebase reconnaissance.",
    tools: ["read", "grep", "find", "ls"],
    prompt: "Explore the repository without changing files. Return precise findings and paths.",
    dispatchGuidance: "Use for broad or read-only repository exploration and reconnaissance.",
  },
  {
    name: "Plan",
    displayName: "Plan",
    description: "Produces an actionable implementation plan.",
    tools: ["read", "grep", "find", "ls"],
    prompt: "Inspect the repository and produce a focused, ordered plan. Do not edit files.",
    dispatchGuidance: "Use when the task is to inspect the codebase and produce a plan before implementation.",
  },
  {
    name: "implementer",
    displayName: "Implementer",
    description: "Implements code and tests with focused verification.",
    tools: BUILTIN_TOOLS,
    prompt: "Implement code and tests. Inspect before editing, make focused changes, run relevant checks, and report changed files and tests.",
    dispatchGuidance: "Use for focused coding, editing, testing, and verification.",
  },
] as const satisfies readonly BuiltinAgentCatalogEntry[];

export function defaultAgentDefinitions(): AgentDefinition[] {
  return BUILTIN_AGENT_CATALOG.map((agent) => ({
    ...agent,
    tools: [...agent.tools],
    enabled: true,
    source: "default" as const,
    legacyFields: [],
  }));
}

export function builtinAgentSummary(): string {
  return BUILTIN_AGENT_CATALOG.map((agent) => `- ${agent.name}: ${agent.description}`).join("\n");
}

export function builtinDispatchGuidance(): string {
  const specialized = BUILTIN_AGENT_CATALOG.filter((agent) => agent.name !== "general-purpose")
    .map((agent) => `${agent.name} — ${agent.dispatchGuidance}`)
    .join("; ");
  const fallback = BUILTIN_AGENT_CATALOG.find((agent) => agent.name === "general-purpose");
  return `Choose proactively by task: ${specialized}; ${fallback?.name} — ${fallback?.dispatchGuidance ?? "use otherwise"}`;
}
