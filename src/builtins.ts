import type { AgentDefinition, BuiltinTool, ThinkingLevel } from "./types.ts";
import { BUILTIN_TOOLS } from "./types.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const satisfies readonly BuiltinTool[];
const INSPECTION_TOOLS = ["read", "grep", "find", "ls"] as const satisfies readonly BuiltinTool[];

export interface BuiltinAgentCatalogEntry {
  name: string;
  displayName: string;
  category: string;
  description: string;
  tools: readonly BuiltinTool[];
  thinking: ThinkingLevel;
  prompt: string;
  dispatchGuidance: string;
}

/**
 * The default agents exposed to the parent model through the Agent tool.
 *
 * Keep this catalog opinionated. A useful default agent has a narrow job,
 * the smallest tool set that can do that job, and a prompt that defines a
 * predictable workflow and final report.
 */
export const BUILTIN_AGENT_CATALOG = [
  {
    name: "general-purpose",
    displayName: "General-purpose",
    category: "core",
    description: "A capable general coding and research agent.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Be concise and solve the assigned task. Inspect relevant files before acting. Make the smallest safe change, run relevant checks, and report changed files, verification, and any remaining uncertainty.",
    dispatchGuidance: "Use otherwise as the fallback when no specialist is a better fit.",
  },
  {
    name: "Explore",
    displayName: "Explore",
    category: "core",
    description: "Fast, read-only codebase reconnaissance.",
    tools: READ_ONLY_TOOLS,
    thinking: "low",
    prompt: "Explore the repository without changing files. Trace relevant entry points, data flow, conventions, dependencies, and risks. Return precise findings with file paths and line references when useful. Do not propose guesses as facts.",
    dispatchGuidance: "Use for broad, read-only repository reconnaissance and finding entry points.",
  },
  {
    name: "Plan",
    displayName: "Plan",
    category: "core",
    description: "Produces an actionable implementation plan.",
    tools: READ_ONLY_TOOLS,
    thinking: "high",
    prompt: "Inspect the repository and produce a focused, ordered implementation plan. Identify files to change, existing patterns to follow, tests to add or run, risks, and verification steps. Do not edit files and do not hide important assumptions.",
    dispatchGuidance: "Use for planning before implementation when the task spans several files or the design is unclear.",
  },
  {
    name: "implementer",
    displayName: "Implementer",
    category: "delivery",
    description: "Implements code and tests with focused verification.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Implement the assigned change. Inspect before editing, follow local conventions, keep the diff focused, and add or update tests when behavior changes. Run the most relevant checks and report changed files, test results, and any follow-up work.",
    dispatchGuidance: "Use for focused coding, testing, and verification when no narrower specialist fits.",
  },
  {
    name: "reviewer",
    displayName: "Reviewer",
    category: "quality",
    description: "Read-only review for correctness, maintainability, and regressions.",
    tools: INSPECTION_TOOLS,
    thinking: "high",
    prompt: "Review the requested change without modifying files. Inspect the diff and surrounding code using the available read-only tools, and prioritize actionable findings by severity. For each finding include the file, location, impact, and a concrete fix. If there are no findings, say what was checked and note residual risk.",
    dispatchGuidance: "Use after implementation for an independent correctness and regression review.",
  },
] as const satisfies readonly BuiltinAgentCatalogEntry[];

export function defaultAgentDefinitions(): AgentDefinition[] {
  return BUILTIN_AGENT_CATALOG.map((agent) => ({
    ...agent,
    tools: [...agent.tools],
    kind: "pi",
    enabled: true,
    source: "default" as const,
    legacyFields: [],
  }));
}

export function builtinAgentSummary(): string {
  return BUILTIN_AGENT_CATALOG.map((agent) => `- ${agent.name} [${agent.category}]: ${agent.description}`).join("\n");
}

export function builtinDispatchGuidance(): string {
  const specialized = BUILTIN_AGENT_CATALOG.filter((agent) => agent.name !== "general-purpose")
    .map((agent) => `${agent.name} — ${agent.dispatchGuidance}`)
    .join("; ");
  const fallback = BUILTIN_AGENT_CATALOG.find((agent) => agent.name === "general-purpose");
  return `Choose proactively by task: ${specialized}; ${fallback?.name} — ${fallback?.dispatchGuidance ?? "use otherwise"}`;
}
