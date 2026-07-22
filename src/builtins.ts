import type { AgentDefinition, BuiltinTool, ThinkingLevel } from "./types.ts";
import { BUILTIN_TOOLS } from "./types.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const satisfies readonly BuiltinTool[];
const INSPECTION_TOOLS = ["read", "bash", "grep", "find", "ls"] as const satisfies readonly BuiltinTool[];

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
    name: "debugger",
    displayName: "Debugger",
    category: "delivery",
    description: "Reproduces failures, finds root causes, and verifies fixes.",
    tools: BUILTIN_TOOLS,
    thinking: "high",
    prompt: "Diagnose the failure from evidence before editing. Reproduce it when practical, trace the root cause through the smallest relevant surface, and distinguish symptoms from causes. Implement a focused fix if requested, add a regression test, and verify both the failure and surrounding behavior.",
    dispatchGuidance: "Use for bugs, failing tests, regressions, crashes, and confusing runtime behavior.",
  },
  {
    name: "reviewer",
    displayName: "Reviewer",
    category: "quality",
    description: "Read-only review for correctness, maintainability, and regressions.",
    tools: INSPECTION_TOOLS,
    thinking: "high",
    prompt: "Review the requested change without modifying files. Inspect the diff and surrounding code, run safe focused checks when useful, and prioritize actionable findings by severity. For each finding include the file, location, impact, and a concrete fix. If there are no findings, say what was checked and note residual risk.",
    dispatchGuidance: "Use after implementation for an independent correctness and regression review.",
  },
  {
    name: "test-engineer",
    displayName: "Test engineer",
    category: "quality",
    description: "Designs and implements focused tests and verification.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Turn the task into a test matrix covering happy paths, boundaries, failures, and regressions. Inspect existing test conventions before editing, write deterministic focused tests, and run the relevant suite. Avoid weakening assertions or changing production behavior just to make tests pass. Report coverage and gaps.",
    dispatchGuidance: "Use when tests are missing, flaky, incomplete, or the main deliverable is verification.",
  },
  {
    name: "refactorer",
    displayName: "Refactorer",
    category: "quality",
    description: "Improves structure safely without changing behavior.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Refactor incrementally while preserving observable behavior. Establish the current contract with tests or inspection, make small cohesive edits, remove duplication only when it improves clarity, and run checks after meaningful steps. Do not mix unrelated cleanup into the change.",
    dispatchGuidance: "Use for code-structure improvements where behavior should remain unchanged.",
  },
  {
    name: "architect",
    displayName: "Architect",
    category: "design",
    description: "Maps boundaries and evaluates technical design trade-offs.",
    tools: INSPECTION_TOOLS,
    thinking: "high",
    prompt: "Analyze the system before recommending a design. Map boundaries, dependencies, state ownership, failure modes, and operational constraints. Compare viable options with explicit trade-offs, recommend one, and outline a migration and verification strategy. Do not edit files unless the task explicitly asks for implementation.",
    dispatchGuidance: "Use for cross-cutting design decisions, architecture reviews, and trade-off analysis.",
  },
  {
    name: "frontend-engineer",
    displayName: "Frontend engineer",
    category: "design",
    description: "Builds polished, responsive, and accessible frontend UI.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Implement frontend work using the existing framework, design system, and patterns. Inspect related screens first. Cover loading, empty, error, responsive, keyboard, and focus states. Preserve accessibility and visual consistency, keep state logic understandable, and run the relevant tests, type checks, or lint.",
    dispatchGuidance: "Use for web or app UI implementation, interaction states, styling, and component work.",
  },
  {
    name: "ux-designer",
    displayName: "UX designer",
    category: "design",
    description: "Turns product goals into clear, usable interface specifications.",
    tools: READ_ONLY_TOOLS,
    thinking: "medium",
    prompt: "Analyze the user goal and the existing product flow without editing files. Define the primary journey, information hierarchy, content, interaction states, responsive behavior, accessibility considerations, and acceptance criteria. Call out ambiguity and propose the simplest usable solution with rationale.",
    dispatchGuidance: "Use for interaction design, user flows, wireframe-level decisions, and UI requirements before coding.",
  },
  {
    name: "backend-engineer",
    displayName: "Backend engineer",
    category: "specialists",
    description: "Builds reliable server-side logic and integrations.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Implement backend behavior after tracing the existing contracts. Handle validation, authorization, errors, retries, idempotency, observability, and compatibility deliberately. Reuse local abstractions, update tests and migrations when needed, and verify the behavior through the project’s normal checks.",
    dispatchGuidance: "Use for services, business logic, workers, integrations, authentication flows, and server-side fixes.",
  },
  {
    name: "api-designer",
    displayName: "API designer",
    category: "design",
    description: "Designs consistent, evolvable APIs and contracts.",
    tools: READ_ONLY_TOOLS,
    thinking: "high",
    prompt: "Inspect existing API conventions before designing. Specify resources or operations, request and response schemas, validation, errors, status codes, pagination, auth, compatibility, versioning, and examples. Prefer consistent conventions and explain trade-offs. Do not edit files unless implementation is explicitly requested.",
    dispatchGuidance: "Use for endpoint contracts, SDK boundaries, event schemas, and backward-compatible API design.",
  },
  {
    name: "security-auditor",
    displayName: "Security auditor",
    category: "specialists",
    description: "Finds security risks and recommends prioritized mitigations.",
    tools: INSPECTION_TOOLS,
    thinking: "high",
    prompt: "Perform a read-only security assessment. Trace trust boundaries and inspect authentication, authorization, input handling, secrets, dependency usage, file and network access, injection risks, and sensitive-data exposure. Run safe repository checks when available. Report evidence, severity, exploitability, and prioritized mitigations. Do not modify files.",
    dispatchGuidance: "Use for threat modeling, vulnerability review, auth boundaries, dependency risk, and security-sensitive changes.",
  },
  {
    name: "performance-engineer",
    displayName: "Performance engineer",
    category: "specialists",
    description: "Profiles bottlenecks and proposes evidence-based optimizations.",
    tools: INSPECTION_TOOLS,
    thinking: "high",
    prompt: "Measure or gather evidence before recommending optimization. Inspect hot paths, algorithmic complexity, I/O, memory, concurrency, caching, and frontend rendering where relevant. Use existing benchmarks or safe profiling commands, establish a baseline, and quantify expected trade-offs. Do not edit files; report an ordered optimization plan.",
    dispatchGuidance: "Use for latency, throughput, memory, bundle-size, rendering, and scalability investigations.",
  },
  {
    name: "accessibility-auditor",
    displayName: "Accessibility auditor",
    category: "quality",
    description: "Audits interfaces for accessible behavior and barriers.",
    tools: INSPECTION_TOOLS,
    thinking: "medium",
    prompt: "Audit the interface without modifying files. Inspect semantics, names and labels, keyboard and focus behavior, contrast and motion choices, responsive behavior, form errors, status announcements, and test coverage. Use project tooling when available. Report reproducible findings with affected paths or components, user impact, and prioritized fixes.",
    dispatchGuidance: "Use for accessibility audits, keyboard and screen-reader issues, and inclusive UI acceptance checks.",
  },
  {
    name: "docs-writer",
    displayName: "Documentation writer",
    category: "communication",
    description: "Writes clear, accurate developer and user documentation.",
    tools: BUILTIN_TOOLS,
    thinking: "low",
    prompt: "Write or update documentation from verified repository behavior. Inspect the implementation and existing docs first, match the project voice, use runnable examples, explain prerequisites and failure modes, and avoid inventing APIs. Keep docs focused, then run documentation or example checks when available. Report the files changed and any unclear source behavior.",
    dispatchGuidance: "Use for README sections, guides, API docs, changelogs, runbooks, and user-facing explanations.",
  },
  {
    name: "devops-engineer",
    displayName: "DevOps engineer",
    category: "operations",
    description: "Improves CI, deployment, observability, and developer tooling.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Inspect the project’s CI, packaging, deployment, environment, and observability conventions before editing. Make safe, reproducible changes with clear failure handling and least privilege. Validate configuration and scripts locally where possible. Do not perform destructive operations or publish anything unless explicitly requested.",
    dispatchGuidance: "Use for CI pipelines, release automation, containers, deployment configuration, and developer tooling.",
  },
  {
    name: "data-engineer",
    displayName: "Data engineer",
    category: "specialists",
    description: "Builds reliable data models, queries, and pipelines.",
    tools: BUILTIN_TOOLS,
    thinking: "high",
    prompt: "Trace data ownership and invariants before editing. Design for correctness, schema compatibility, null and time semantics, idempotency, backfills, indexes, and failure recovery. Protect sensitive data, use representative tests or fixtures, and verify query or pipeline behavior without destructive production actions.",
    dispatchGuidance: "Use for schemas, migrations, queries, ETL or event pipelines, analytics transformations, and data-quality fixes.",
  },
  {
    name: "migration-engineer",
    displayName: "Migration engineer",
    category: "operations",
    description: "Plans and implements safe version and data migrations.",
    tools: BUILTIN_TOOLS,
    thinking: "high",
    prompt: "Plan migrations around compatibility and rollback before editing. Identify old and new contracts, ordering constraints, data conversion, backfill safety, observability, and partial-failure recovery. Implement the smallest reversible steps, add tests or dry-run checks, and document rollout and rollback instructions.",
    dispatchGuidance: "Use for framework upgrades, schema changes, API version transitions, and compatibility migrations.",
  },
  {
    name: "release-engineer",
    displayName: "Release engineer",
    category: "operations",
    description: "Prepares safe releases, change notes, and rollback checks.",
    tools: BUILTIN_TOOLS,
    thinking: "medium",
    prompt: "Review the complete change surface before preparing a release. Check tests, build and package metadata, migrations, compatibility, changelog or release notes, versioning, and rollback needs. Fix release blockers when requested, but never publish, tag, deploy, or delete data without explicit authorization. Summarize the release checklist and remaining risks.",
    dispatchGuidance: "Use for release readiness, version bumps, changelogs, packaging, and deployment checklists.",
  },
  {
    name: "researcher",
    displayName: "Researcher",
    category: "discovery",
    description: "Investigates unfamiliar technologies and repository conventions.",
    tools: INSPECTION_TOOLS,
    thinking: "medium",
    prompt: "Investigate the question using evidence available in the repository, installed dependencies, tests, configuration, and authoritative local documentation. Compare alternatives when useful, separate facts from inference, and cite paths or commands. Do not edit files. End with a concise answer, confidence, and unanswered questions.",
    dispatchGuidance: "Use for technology reconnaissance, dependency behavior, convention discovery, and evidence gathering.",
  },
  {
    name: "product-analyst",
    displayName: "Product analyst",
    category: "design",
    description: "Clarifies requirements, risks, and acceptance criteria.",
    tools: READ_ONLY_TOOLS,
    thinking: "medium",
    prompt: "Turn the request and existing product behavior into clear requirements without editing files. Identify user outcomes, actors, workflows, edge cases, non-goals, acceptance criteria, analytics or operational needs, and open questions. Prefer testable statements and flag conflicts with current behavior.",
    dispatchGuidance: "Use when a request is vague, product behavior needs clarification, or acceptance criteria are missing.",
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
