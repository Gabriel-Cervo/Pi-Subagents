import type { Model } from "@earendil-works/pi-ai";
import type { HerdrKind } from "./herdr.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];
export type AgentSource = "default" | "global" | "project";
export type JoinMode = "async" | "smart";

export interface AgentDefinition {
  name: string;
  description: string;
  displayName: string;
  category?: string;
  tools: BuiltinTool[];
  model?: string;
  thinking?: ThinkingLevel;
  kind: HerdrKind;
  args?: string[];
  enabled: boolean;
  prompt: string;
  source: AgentSource;
  filePath?: string;
  project?: boolean;
  legacyFields: string[];
  effectiveModel?: string;
  effectiveModelSource?: string;
}

export interface Settings {
  version: 2;
  maxConcurrent: number;
  joinMode: JoinMode;
  groupTimeoutMs: number;
  allowCallerModelOverride: boolean;
  runTimeoutMs: number;
  agentModels: Record<string, string>;
  [key: string]: unknown;
}

export interface SessionOverrides {
  maxConcurrent?: number;
  joinMode?: JoinMode;
  groupTimeoutMs?: number;
  allowCallerModelOverride?: boolean;
  runTimeoutMs?: number;
  agentModels?: Record<string, string | undefined>;
}

export interface AgentRequest {
  prompt: string;
  description: string;
  subagent_type: string;
  run_in_background?: boolean;
  resume?: string;
  model?: string;
  thinking?: ThinkingLevel;
  kind?: HerdrKind;
  inherit_context?: boolean;
}

export interface RunResult {
  id: string;
  agent: string;
  description: string;
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "aborted";
  output: string;
  partialOutput?: string;
  error?: string;
  diagnostics?: string;
  model: string;
  modelSource: string;
  thinking: ThinkingLevel;
  prompts: number;
  createdAt: number;
  completedAt?: number;
  groupId?: string;
}

export interface ModelChoice {
  key: string;
  label: string;
  model: Model<any>;
}
