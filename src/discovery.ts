import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { defaultAgentDefinitions } from "./builtins.ts";
import { HERDR_KINDS, type HerdrKind } from "./herdr.ts";
import type { AgentDefinition, AgentSource, BuiltinTool, ThinkingLevel } from "./types.ts";
import { BUILTIN_TOOLS, THINKING_LEVELS } from "./types.ts";

const LEGACY = new Set(["agent", "scope", "color", "temperature", "permissions"]);
const key = (name: string) => name.toLocaleLowerCase();
function nearestAgents(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    try { if (statSync(candidate).isDirectory()) return candidate; } catch { /* the directory may disappear during discovery */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
function warnOnce(warnings: string[], warned: Set<string>, value: string): void { if (!warned.has(value)) { warned.add(value); warnings.push(value); } }
function list(dir: string, source: AgentSource, project: boolean, warnings: string[], warned: Set<string>): AgentDefinition[] {
  if (!existsSync(dir)) return [];
  const result: AgentDefinition[] = [];
  let entries: Array<{ name: string; isFile(): boolean }>;
  try { entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>; } catch (error) { warnOnce(warnings, warned, `Unable to read agent directory ${dir}: ${error instanceof Error ? error.message : String(error)}`); return []; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(filePath, "utf8"));
      const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : entry.name.slice(0, -3);
      const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      if (!description) { warnOnce(warnings, warned, `Ignoring ${filePath}: frontmatter.description must be a non-empty string.`); continue; }
      const rawTools = Array.isArray(frontmatter.tools) ? frontmatter.tools : typeof frontmatter.tools === "string" ? frontmatter.tools.split(/[ ,]+/) : [...BUILTIN_TOOLS];
      const tools = rawTools.filter((tool): tool is BuiltinTool => typeof tool === "string" && (BUILTIN_TOOLS as readonly string[]).includes(tool));
      const invalidTools = rawTools.filter((tool) => typeof tool !== "string" || !(BUILTIN_TOOLS as readonly string[]).includes(tool));
      if (invalidTools.length) warnOnce(warnings, warned, `Ignoring unsupported tool names in ${filePath}: ${invalidTools.map(String).join(", ")}.`);
      const thinking = frontmatter.thinking === undefined ? undefined : String(frontmatter.thinking);
      if (thinking !== undefined && !(THINKING_LEVELS as readonly string[]).includes(thinking)) { warnOnce(warnings, warned, `Ignoring ${filePath}: thinking must be one of ${THINKING_LEVELS.join(", ")}.`); continue; }
      const kind = frontmatter.kind === undefined ? "pi" : String(frontmatter.kind).trim().toLowerCase();
      if (!(HERDR_KINDS as readonly string[]).includes(kind)) { warnOnce(warnings, warned, `Ignoring ${filePath}: kind must be one of ${HERDR_KINDS.join(", ")}.`); continue; }
      let args: string[] | undefined;
      if (frontmatter.args !== undefined) {
        if (!Array.isArray(frontmatter.args) || !frontmatter.args.every((arg) => typeof arg === "string")) { warnOnce(warnings, warned, `Ignoring ${filePath}: args must be a string array.`); continue; }
        args = [...frontmatter.args] as string[];
      }
      const enabled = frontmatter.enabled === undefined ? true : frontmatter.enabled;
      if (typeof enabled !== "boolean") { warnOnce(warnings, warned, `Ignoring ${filePath}: enabled must be boolean.`); continue; }
      const model = frontmatter.model === undefined ? undefined : typeof frontmatter.model === "string" && frontmatter.model.trim() ? frontmatter.model.trim() : undefined;
      if (frontmatter.model !== undefined && !model) { warnOnce(warnings, warned, `Ignoring ${filePath}: model must be a non-empty string.`); continue; }
      const legacyFields = Object.keys(frontmatter).filter((field) => LEGACY.has(field));
      for (const field of legacyFields) warnOnce(warnings, warned, `Unsupported legacy agent field '${field}' in ${filePath}`);
      result.push({ name, displayName: typeof frontmatter.display_name === "string" && frontmatter.display_name.trim() ? frontmatter.display_name.trim() : name, description, tools, model, thinking: thinking as ThinkingLevel | undefined, kind: kind as HerdrKind, args, enabled, prompt: body.trim(), source, project, filePath, legacyFields });
    } catch (error) { warnOnce(warnings, warned, `Ignoring malformed agent definition ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}
export interface Discovery { agents: AgentDefinition[]; projectDir?: string; warnings: string[] }
export function discoverAgents(cwd: string, includeProject: boolean, warned = new Set<string>()): Discovery {
  const warnings: string[] = [];
  const merged = new Map<string, AgentDefinition>();
  const add = (agent: AgentDefinition) => {
    const normalized = key(agent.name);
    const previous = merged.get(normalized);
    if (previous && previous.name !== agent.name) warnOnce(warnings, warned, `Case-colliding agent definitions '${previous.name}' and '${agent.name}'; precedence is deterministic by source and file order.`);
    merged.set(normalized, agent);
  };
  for (const agent of defaultAgentDefinitions()) add(agent);
  for (const agent of list(path.join(getAgentDir(), "agents"), "global", false, warnings, warned)) add(agent);
  const projectDir = nearestAgents(cwd);
  if (includeProject && projectDir) for (const agent of list(projectDir, "project", true, warnings, warned)) add(agent);
  return { agents: [...merged.values()], projectDir, warnings };
}
export function defaultAgents(): AgentDefinition[] { return defaultAgentDefinitions(); }
