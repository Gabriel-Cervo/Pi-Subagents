import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "./util.ts";
import type { SessionOverrides, Settings } from "./types.ts";

export const DEFAULT_SETTINGS: Settings = { version: 1, maxConcurrent: 4, joinMode: "smart", groupTimeoutMs: 30000, allowCallerModelOverride: false, defaultMaxTurns: 12, graceTurns: 2, agentModels: {} };
function read(file: string): Partial<Settings> & Record<string, unknown> {
  if (!existsSync(file)) return {};
  try { const value = JSON.parse(readFileSync(file, "utf8")); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
function valid(input: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (Number.isInteger(input.maxConcurrent) && (input.maxConcurrent as number) > 0) out.maxConcurrent = Math.min(input.maxConcurrent as number, 32);
  if (input.joinMode === "async" || input.joinMode === "smart") out.joinMode = input.joinMode;
  if (Number.isInteger(input.groupTimeoutMs) && (input.groupTimeoutMs as number) >= 0) out.groupTimeoutMs = input.groupTimeoutMs as number;
  if (typeof input.allowCallerModelOverride === "boolean") out.allowCallerModelOverride = input.allowCallerModelOverride;
  if (Number.isInteger(input.defaultMaxTurns) && (input.defaultMaxTurns as number) >= 0) out.defaultMaxTurns = input.defaultMaxTurns as number;
  if (Number.isInteger(input.graceTurns) && (input.graceTurns as number) >= 0) out.graceTurns = input.graceTurns as number;
  if (input.agentModels && typeof input.agentModels === "object" && !Array.isArray(input.agentModels)) {
    const models: Record<string, string> = {};
    for (const [name, spec] of Object.entries(input.agentModels as Record<string, unknown>)) if (typeof spec === "string") models[name] = spec;
    out.agentModels = models;
  }
  return out;
}
function layer(raw: Record<string, unknown>): Settings { return { ...DEFAULT_SETTINGS, ...valid(raw), agentModels: { ...(valid(raw).agentModels ?? {}) } } as Settings; }
function mergeModels(...layers: Record<string, string | undefined>[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const layer of layers) for (const [name, spec] of Object.entries(layer)) {
    const old = Object.keys(result).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (old) delete result[old];
    if (spec !== undefined) result[name] = spec;
  }
  return result;
}

export interface SettingsStore {
  globalPath: string;
  projectPath: string;
  global: Settings;
  project: Settings;
  effective(overrides?: SessionOverrides): Settings;
  save(scope: "global" | "project", patch: Partial<Settings>): Promise<void>;
  saveModel(scope: "global" | "project", name: string, spec?: string): Promise<void>;
}

export async function loadSettings(cwd: string, agentDir = path.join(os.homedir(), ".pi", "agent")): Promise<SettingsStore> {
  const globalPath = path.join(agentDir, "subagents.json");
  let current = path.resolve(cwd);
  let projectPath = path.join(current, ".pi", "subagents.json");
  while (current !== path.dirname(current)) {
    const candidate = path.join(current, ".pi", "subagents.json");
    if (existsSync(candidate)) { projectPath = candidate; break; }
    current = path.dirname(current);
  }
  const globalRaw = read(globalPath);
  const projectRaw = read(projectPath);
  const global = layer(globalRaw);
  const project = layer(projectRaw);
  const projectKeys = new Set(Object.keys(valid(projectRaw)));
  const effective = (overrides?: SessionOverrides): Settings => {
    const projectValues: Record<string, unknown> = {};
    for (const name of projectKeys) projectValues[name] = (project as any)[name];
    return {
      ...DEFAULT_SETTINGS, ...global, ...projectValues, ...overrides,
      agentModels: mergeModels(global.agentModels, projectKeys.has("agentModels") ? project.agentModels : {}, overrides?.agentModels ?? {}),
    } as Settings;
  };
  return {
    globalPath, projectPath, global, project, effective,
    async save(scope, patch) {
      const file = scope === "global" ? globalPath : projectPath;
      const target = scope === "global" ? global : project;
      const existing = read(file);
      const next = { ...existing, version: 1, ...patch } as Record<string, unknown>;
      if (patch.agentModels) next.agentModels = { ...(existing.agentModels as Record<string, string> ?? {}), ...patch.agentModels };
      Object.assign(target, patch, patch.agentModels ? { agentModels: { ...target.agentModels, ...patch.agentModels } } : {});
      if (scope === "project") for (const name of Object.keys(patch)) projectKeys.add(name);
      await atomicWrite(file, next);
    },
    async saveModel(scope, name, spec) {
      const file = scope === "global" ? globalPath : projectPath;
      const target = scope === "global" ? global : project;
      const existing = read(file);
      const models = { ...(existing.agentModels as Record<string, string> ?? {}) };
      const existingKey = Object.keys(models).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existingKey && existingKey !== name) delete models[existingKey];
      if (spec) models[name] = spec; else delete models[name];
      target.agentModels = { ...models }; projectKeys.add("agentModels");
      await atomicWrite(file, { ...existing, version: 1, agentModels: models });
    },
  };
}
