import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Container, type SelectItem, SelectList, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { CONFIG_DIR_NAME, DynamicBorder, type ExtensionAPI, type ExtensionContext, getAgentDir, getSettingsListTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { SubagentManager, agentSchema, resultSchema, steerSchema } from "./manager.ts";
import type { AgentRequest, RunResult } from "./types.ts";

function asError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function outputText(result: RunResult, verbose = false): string {
  const output = result.output || result.partialOutput || result.error || `(run ${result.id}: ${result.status})`;
  return verbose ? `[${result.id}] ${result.agent} (${result.status}, model ${result.model} via ${result.modelSource}, ${result.turns} turns)\n${output}` : output;
}
function requireManager(manager: SubagentManager | undefined): SubagentManager { if (!manager) throw new Error("Subagent manager is not initialized."); return manager; }
function failedRunMessage(result: RunResult): string {
  const partial = result.output || result.partialOutput;
  return `${result.error || `Subagent ${result.status}.`}${partial ? `\n\nPartial output:\n${partial}` : ""}`;
}

interface DetailedChoice {
  value: string;
  label: string;
  details: string[];
}

async function selectDetailed(ctx: ExtensionContext, title: string, choices: DetailedChoice[]): Promise<string | undefined> {
  if (choices.length === 0) {
    ctx.ui.notify(`No ${title.toLocaleLowerCase()} available.`, "info");
    return undefined;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

    const items: SelectItem[] = choices.map(({ value, label }) => ({ value, label }));
    const list = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    }, { minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 48 });
    container.addChild(list);

    const details = new Text("", 1, 1);
    const showDetails = (value: string) => {
      const choice = choices.find((candidate) => candidate.value === value);
      details.setText(choice ? choice.details.map((line) => theme.fg("muted", line)).join("\n") : "");
    };
    showDetails(choices[0].value);
    container.addChild(details);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc back"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    list.onSelectionChange = (item) => { showDetails(item.value); tui.requestRender(); };
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
    };
  });
}

const AGENT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

async function selectAgentTools(ctx: ExtensionContext): Promise<string[] | undefined> {
  const selected = new Set<string>(AGENT_TOOLS);
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Select agent tools")), 1, 0));
    container.addChild(new Text(theme.fg("dim", "Change values with ←/→ or Enter. Press Esc when finished."), 1, 0));
    const items: SettingItem[] = AGENT_TOOLS.map((tool) => ({ id: tool, label: tool, currentValue: "enabled", values: ["enabled", "disabled"] }));
    const list = new SettingsList(items, items.length + 1, getSettingsListTheme(), (id, value) => {
      if (value === "enabled") selected.add(id); else selected.delete(id);
    }, () => done(undefined));
    container.addChild(list);
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { list.handleInput?.(data); tui.requestRender(); },
    };
  });
  if (selected.size === 0) {
    const keep = await ctx.ui.confirm("Create tool-less agent?", "No tools are selected. The agent will only be able to respond with text.");
    if (!keep) return undefined;
  }
  return [...selected];
}

function yamlString(value: string): string { return JSON.stringify(value); }

async function createAgent(ctx: ExtensionContext, manager: SubagentManager): Promise<void> {
  const name = (await ctx.ui.input("Agent name", "e.g. reviewer"))?.trim();
  if (!name) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Agent names must be 1–64 characters and use only letters, numbers, dots, underscores, or hyphens.");
  }

  const description = (await ctx.ui.input("Short description", "What this agent does"))?.trim();
  if (!description) return;
  const functionality = (await ctx.ui.editor("Agent functionality and instructions", `You are ${name}.\n\nDescribe the work you should perform, constraints to follow, and the output you should return.`))?.trim();
  if (!functionality) return;

  const tools = await selectAgentTools(ctx);
  if (!tools) return;
  const availableModels = ctx.modelRegistry.getAvailable();
  const model = await ctx.ui.select("Agent model", ["Inherit parent model", ...availableModels.map((item) => `${item.provider}/${item.id}`)]);
  if (!model) return;

  const source = await ctx.ui.select("Agent source", ["Project (.pi/agents)", "Global (~/.pi/agent/agents)"]);
  if (!source) return;
  const isProject = source.startsWith("Project");
  if (isProject && !ctx.isProjectTrusted()) throw new Error("Creating a project agent requires a trusted project.");

  const existing = manager.definitionsForUI().find((agent) => agent.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const selectedSource = isProject ? "project" : "global";
  const defaultPath = join(isProject ? join(ctx.cwd, CONFIG_DIR_NAME, "agents") : join(getAgentDir(), "agents"), `${name}.md`);
  const filePath = existing?.source === selectedSource && existing.filePath ? existing.filePath : defaultPath;
  let fileExists = false;
  try { await access(filePath); fileExists = true; } catch { /* new file */ }
  if (existing || fileExists) {
    const action = existing?.source === selectedSource ? "replace" : "override";
    const confirmed = await ctx.ui.confirm(`${action === "replace" ? "Replace" : "Override"} agent?`, `An agent named “${existing?.name ?? name}” already exists from ${existing?.source ?? selectedSource}. Create this ${selectedSource} definition?`);
    if (!confirmed) return;
  }

  const frontmatter = [
    "---",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    `tools: ${yamlString(tools.join(", "))}`,
    ...(model === "Inherit parent model" ? [] : [`model: ${yamlString(model)}`]),
    "enabled: true",
    "---",
    "",
    functionality,
    "",
  ].join("\n");

  await withFileMutationQueue(filePath, async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, frontmatter, { encoding: "utf8", mode: 0o600 });
  });
  await manager.reload();
  ctx.ui.notify(`Created ${selectedSource} agent “${name}” at ${filePath}.`, "info");
}

export default async function (pi: ExtensionAPI): Promise<void> {
  let manager: SubagentManager | undefined;
  pi.on("session_start", async (_event, ctx) => { manager?.cleanup(); manager = new SubagentManager(pi, ctx); await manager.start(); });
  pi.on("session_shutdown", async () => { manager?.cleanup(); manager = undefined; });

  pi.registerTool({
    name: "Agent", label: "Agent", description: "Run an isolated in-process Pi subagent. Background runs return an id; use get_subagent_result to wait.", parameters: agentSchema,
    async execute(_id, params, _signal, onUpdate) {
      const active = requireManager(manager);
      try {
        const result = await active.launch(params as unknown as AgentRequest, (partial) => onUpdate?.({ content: [{ type: "text", text: partial }], details: { status: "running" } }), _signal);
        if (result.status === "failed" || result.status === "aborted") throw new Error(failedRunMessage(result));
        return { content: [{ type: "text", text: result.status === "queued" || result.status === "running" ? `Queued ${result.agent} as ${result.id}. Use get_subagent_result to wait.` : outputText(result) }], details: result };
      } catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "Agent")} ${theme.fg("accent", args.subagent_type)} ${theme.fg("dim", args.description)}`, 0, 0); },
    renderResult(result, _options, theme) { const text = (result as any).content?.find((part: any) => part.type === "text")?.text ?? ""; return new Text(theme.fg("toolOutput", text.slice(0, 500)), 0, 0); },
  });
  pi.registerTool({
    name: "get_subagent_result", label: "Get subagent result", description: "Wait for a session-local subagent run without polling and return its partial or final output.", parameters: resultSchema,
    async execute(_id, params) {
      try { const result = await requireManager(manager).result(params.agent_id, params.wait !== false, params.verbose === true); if (result.status === "failed" || result.status === "aborted") throw new Error(failedRunMessage(result)); return { content: [{ type: "text", text: outputText(result, params.verbose === true) }], details: result }; }
      catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "get_subagent_result")} ${theme.fg("accent", args.agent_id)}`, 0, 0); },
  });
  pi.registerTool({
    name: "steer_subagent", label: "Steer subagent", description: "Add an instruction to a queued or running session-local subagent.", parameters: steerSchema,
    async execute(_id, params) {
      try { const result = await requireManager(manager).steer(params.agent_id, params.message); return { content: [{ type: "text", text: `Steering sent to ${result.id}.` }], details: result }; }
      catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "steer_subagent")} ${theme.fg("accent", args.agent_id)} ${theme.fg("dim", args.message.slice(0, 80))}`, 0, 0); },
  });

  pi.registerCommand("agents", { description: "Inspect and configure Pi subagents", handler: async (_args, ctx) => {
    const active = manager; if (!active) return;
    try {
      while (true) {
        const choice = await ctx.ui.select("Subagents", ["Active/recent runs", "Agents", "Create new agent", "Settings", "Approve/revoke project agents", "Reload definitions", "Close"]);
        if (!choice || choice === "Close") return;
        if (choice === "Reload definitions") { await active.reload(); ctx.ui.notify("Agent definitions reloaded.", "info"); continue; }
        if (choice === "Create new agent") { await createAgent(ctx, active); continue; }
        if (choice === "Approve/revoke project agents") { const action = await ctx.ui.select("Project agents", ["Approve", "Revoke", "Back"]); if (action === "Approve") { const approved = await active.approveProject(); ctx.ui.notify(approved ? "Project agents approved for this session." : "Project agents not approved.", approved ? "info" : "warning"); } else if (action === "Revoke") { active.revokeProject(); ctx.ui.notify("Project agents revoked for this session.", "info"); } continue; }
        if (choice === "Settings") {
          const settings = active.settingsForUI();
          const options = [`maxConcurrent: ${settings.maxConcurrent}`, `joinMode: ${settings.joinMode}`, `groupTimeoutMs: ${settings.groupTimeoutMs}`, `allowCallerModelOverride: ${settings.allowCallerModelOverride}`, `defaultMaxTurns: ${settings.defaultMaxTurns}`, `graceTurns: ${settings.graceTurns}`, "Back"];
          const setting = await ctx.ui.select("Settings", options); if (!setting || setting === "Back") continue;
          const match = setting.match(/^(\w+):/); if (!match) continue; const name = match[1];
          let parsed: unknown;
          if (name === "allowCallerModelOverride") { const selected = await ctx.ui.select("Allow caller model override?", ["true", "false"]); if (!selected) continue; parsed = selected === "true"; }
          else { const value = await ctx.ui.input(`New ${name}`, String(settings[name])); if (value === undefined) continue; parsed = name === "joinMode" ? value : Number(value); if (name === "joinMode" && parsed !== "async" && parsed !== "smart") { ctx.ui.notify("joinMode must be async or smart.", "error"); continue; } if (name !== "joinMode" && (!Number.isInteger(parsed) || (name !== "graceTurns" && (parsed as number) < 0))) { ctx.ui.notify("Enter a valid non-negative integer.", "error"); continue; } }
          const scope = await ctx.ui.select("Persist setting", ["session", "project", "global", "Back"]); if (!scope || scope === "Back") continue;
          await active.saveSetting(name, parsed, scope as "global" | "project" | "session"); ctx.ui.notify(scope === "session" ? "Saved for this parent session." : "Saved for future runs.", "info"); continue;
        }
        if (choice === "Active/recent runs") {
          const runs = active.list();
          const selected = await selectDetailed(ctx, "Active and recent runs", runs.map((run) => ({
            value: run.id,
            label: `${run.status === "running" ? "◉" : run.status === "completed" ? "✓" : run.status === "queued" ? "○" : "✗"} ${run.agent} — ${run.status}`,
            details: [
              run.description,
              `ID: ${run.id}`,
              `Model: ${run.model} (${run.modelSource})`,
              `Thinking: ${run.thinking}  •  Turns: ${run.turns}`,
            ],
          })));
          const run = runs.find((candidate) => candidate.id === selected); if (!run) continue;
          const action = await ctx.ui.select(`${run.agent}: ${run.status}`, ["View result", "Steer", "Stop", "Resume", "Remove", "Back"]); if (action === "View result") ctx.ui.notify(outputText(run, true).slice(0, 4000), "info"); if (action === "Steer") { const text = await ctx.ui.input("Steer instruction"); if (text) await active.steer(run.id, text); } if (action === "Stop") await active.stop(run.id); if (action === "Resume") { const prompt = await ctx.ui.input("Resume prompt", "Continue the task"); if (prompt) await active.resume(run.id, prompt); } if (action === "Remove") active.remove(run.id); continue;
        }
        if (choice === "Agents") {
          const defs = active.definitionsForUI();
          const selected = await selectDetailed(ctx, "Agents", defs.map((def) => ({
            value: def.name,
            label: `${def.enabled ? "●" : "○"} ${def.displayName}`,
            details: [
              def.description,
              `Source: ${def.source}  •  Status: ${def.enabled ? "enabled" : "disabled"}`,
              `Model: ${def.effectiveModel ?? "inherit/default"}`,
              `Model source: ${def.effectiveModelSource ?? "unresolved"}`,
              `Tools: ${def.tools.join(", ") || "none"}`,
            ],
          })));
          const def = defs.find((candidate) => candidate.name === selected); if (!def) continue;
          const action = await ctx.ui.select(def.name, ["Configure model", "View definition", "Back"]); if (action === "View definition") ctx.ui.notify(`${def.description}\nSource: ${def.source}${def.filePath ? `\n${def.filePath}` : ""}\nEffective model: ${def.effectiveModel ?? "inherit/default"} (${def.effectiveModelSource ?? "unresolved"})\nTools: ${def.tools.join(", ")}`, "info"); if (action === "Configure model") { const available = ctx.modelRegistry.getAvailable(); const options = ["Inherit/default", ...available.map((m) => `${m.provider}/${m.id}`), "Back"]; const chosen = await ctx.ui.select(`Model for ${def.name}`, options); if (!chosen || chosen === "Back") continue; const modelScope = await ctx.ui.select("Persist model", ["session", "project", "global", "Back"]); if (!modelScope || modelScope === "Back") continue; await active.setModel(def.name, chosen === "Inherit/default" ? undefined : chosen, modelScope as "session" | "project" | "global"); ctx.ui.notify(modelScope === "session" ? "Saved for this parent session." : "Saved for future runs.", "info"); }
        }
      }
    } catch (error) { ctx.ui.notify(asError(error), "error"); }
  }});
}
