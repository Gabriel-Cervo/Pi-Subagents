import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Container, matchesKey, Key, type SelectItem, SelectList, type SettingItem, SettingsList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { CONFIG_DIR_NAME, DynamicBorder, type ExtensionAPI, type ExtensionContext, getAgentDir, getSettingsListTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { SubagentManager, agentSchema, resultSchema, steerSchema } from "./manager.ts";
import { AGENT_TOOL_DESCRIPTION, AGENT_TOOL_PROMPT_GUIDELINES, AGENT_TOOL_PROMPT_SNIPPET } from "./agent-tool-metadata.ts";
import { agentResultViewModel, statusColorRole, statusIcon, SubagentNotificationComponent, ThemedLines, type ThemedLine } from "./rendering.ts";
import { BUILTIN_TOOLS, type AgentRequest, type RunResult } from "./types.ts";
import { HERDR_KINDS } from "./herdr.ts";

export { AGENT_TOOL_DESCRIPTION, AGENT_TOOL_PROMPT_GUIDELINES, AGENT_TOOL_PROMPT_SNIPPET } from "./agent-tool-metadata.ts";

function asError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function outputText(result: RunResult, verbose = false): string {
  const output = result.output || result.partialOutput || result.error || `(run ${result.id}: ${result.status})`;
  return verbose ? `[${result.id}] ${result.agent} (${result.status}, model ${result.model} via ${result.modelSource}, ${result.prompts} prompts)\n${output}` : output;
}
function requireManager(manager: SubagentManager | undefined): SubagentManager { if (!manager) throw new Error("Subagent manager is not initialized."); return manager; }
function failedRunMessage(result: RunResult): string {
  const partial = result.output || result.partialOutput;
  return `${result.error || `Subagent ${result.status}.`}${partial ? `\n\nPartial output:\n${partial}` : ""}`;
}

function resultText(result: any): string {
  return result?.content?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") ?? "";
}

function renderRunResult(result: any, options: { isPartial: boolean }, theme: any, context: any): Text {
  const view = agentResultViewModel(result?.details, resultText(result), options.isPartial, context.isError, context.args?.subagent_type);
  const icon = theme.fg(statusColorRole(view.status), statusIcon(view.status));
  const name = theme.fg("toolTitle", theme.bold(view.agent));
  const status = theme.fg(statusColorRole(view.status), view.status);
  const meta = result?.details?.id
    ? theme.fg("dim", ` ${result.details.id} · ${result.details.model ?? "model?"} · ${result.details.prompts ?? 0} prompts`)
    : "";

  if (view.loading) return new Text(`${icon} ${name} ${theme.fg("warning", "running")}${meta}`, 0, 0);
  if (view.error || view.status === "failed" || view.status === "aborted") {
    return new Text(`${icon} ${name} ${status}${meta}\n${theme.fg("error", view.error || `Subagent ${view.status}.`)}`, 0, 0);
  }
  const output = view.output || "(no output)";
  return new Text(`${icon} ${name} ${status}${meta}\n${theme.fg("toolOutput", output.slice(0, 500))}`, 0, 0);
}

interface DetailedChoice {
  value: string;
  label: string;
  details: ThemedLine[];
}

async function selectDetailed(ctx: ExtensionContext, title: string, choices: DetailedChoice[]): Promise<string | undefined> {
  if (choices.length === 0) {
    ctx.ui.notify(`No ${title.toLocaleLowerCase()} available.`, "info");
    return undefined;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new ThemedLines(theme, [[{ text: title, role: "accent", bold: true }]]));

    const items: SelectItem[] = choices.map(({ value, label }) => ({ value, label }));
    const list = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    }, { minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 48 });
    container.addChild(list);

    const details = new ThemedLines(theme);
    const showDetails = (value: string) => {
      const choice = choices.find((candidate) => candidate.value === value);
      details.setLines(choice ? choice.details : []);
    };
    showDetails(choices[0].value);
    container.addChild(details);
    container.addChild(new ThemedLines(theme, [[{ text: "↑↓ navigate • enter select • esc back", role: "dim" }]]));
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

const AGENT_TOOLS = BUILTIN_TOOLS;

async function selectAgentTools(ctx: ExtensionContext): Promise<string[] | undefined> {
  const selected = new Set<string>(AGENT_TOOLS);
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new ThemedLines(theme, [[{ text: "Select agent tools", role: "accent", bold: true }]]));
    container.addChild(new ThemedLines(theme, [[{ text: "Change values with ←/→ or Enter. Press Esc when finished.", role: "dim" }]]));
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

  const kind = await ctx.ui.select("Herdr agent kind", [...HERDR_KINDS]);
  if (!kind) return;
  let tools: string[] | undefined;
  let model: string | undefined;
  if (kind === "pi") {
    tools = await selectAgentTools(ctx);
    if (!tools) return;
    const availableModels = ctx.modelRegistry.getAvailable();
    model = await ctx.ui.select("Agent model", ["Inherit parent model", ...availableModels.map((item) => `${item.provider}/${item.id}`)]);
    if (!model) return;
  }

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
    ...(kind === "pi" ? [`tools: ${yamlString(tools?.join(", ") ?? "")}`] : []),
    `kind: ${yamlString(kind)}`,
    ...(kind === "pi" && model !== "Inherit parent model" ? [`model: ${yamlString(model ?? "")}`] : []),
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
  pi.registerMessageRenderer("subagents", (message, { expanded }, theme) => {
    const details = message.details as { type?: string; kind?: string; runs?: unknown[] } | undefined;
    if (details?.type !== "subagent-notification" || !Array.isArray(details.runs)) return undefined;
    return new SubagentNotificationComponent(details as any, expanded, theme);
  });
  pi.on("session_start", async (_event, ctx) => { if (manager) await manager.cleanup(); manager = new SubagentManager(pi, ctx); await manager.start(); });
  pi.on("session_shutdown", async () => { if (manager) await manager.cleanup(); manager = undefined; });

  pi.registerTool({
    name: "Agent", label: "Agent", description: AGENT_TOOL_DESCRIPTION, promptSnippet: AGENT_TOOL_PROMPT_SNIPPET, promptGuidelines: AGENT_TOOL_PROMPT_GUIDELINES, parameters: agentSchema,
    async execute(_id, params, _signal, onUpdate) {
      const active = requireManager(manager);
      try {
        const result = await active.launch(params as unknown as AgentRequest, (partial, snapshot) => onUpdate?.({
          content: [{ type: "text", text: partial }],
          details: { ...snapshot, output: partial, partialOutput: partial, status: "running" },
        }), _signal);
        if (result.status === "failed" || result.status === "aborted") throw new Error(failedRunMessage(result));
        return { content: [{ type: "text", text: result.status === "queued" || result.status === "running" ? `Queued ${result.agent} as ${result.id}. Use get_subagent_result to wait.` : outputText(result) }], details: result };
      } catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "Agent")} ${theme.fg("accent", args.subagent_type)} ${theme.fg("dim", args.description)}`, 0, 0); },
    renderResult(result, options, theme, context) { return renderRunResult(result, options, theme, context); },
  });
  pi.registerTool({
    name: "get_subagent_result", label: "Get subagent result", description: "Wait for a session-local subagent run without polling and return its partial or final output.", parameters: resultSchema,
    async execute(_id, params) {
      try { const result = await requireManager(manager).result(params.agent_id, params.wait !== false, params.verbose === true); if (result.status === "failed" || result.status === "aborted") throw new Error(failedRunMessage(result)); return { content: [{ type: "text", text: outputText(result, params.verbose === true) }], details: result }; }
      catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "get_subagent_result")} ${theme.fg("accent", args.agent_id)}`, 0, 0); },
    renderResult(result, options, theme, context) { return renderRunResult(result, options, theme, context); },
  });
  pi.registerTool({
    name: "steer_subagent", label: "Steer subagent", description: "Add an instruction to a queued or running session-local subagent.", parameters: steerSchema,
    async execute(_id, params) {
      try { const result = await requireManager(manager).steer(params.agent_id, params.message); return { content: [{ type: "text", text: `Steering sent to ${result.id}.` }], details: result }; }
      catch (error) { throw new Error(asError(error), { cause: error }); }
    },
    renderCall(args, theme) { return new Text(`${theme.fg("toolTitle", "steer_subagent")} ${theme.fg("accent", args.agent_id)} ${theme.fg("dim", args.message.slice(0, 80))}`, 0, 0); },
    renderResult(result, options, theme, context) { return renderRunResult(result, options, theme, context); },
  });

  interface MenuItem { value: string; label: string; description: string; }
  interface MenuSection { heading: string; items: MenuItem[]; }

  async function mainMenu(ctx: ExtensionContext): Promise<string | undefined> {
    const sections: MenuSection[] = [
      {
        heading: "Monitor",
        items: [{ value: "runs", label: "Active & recent runs", description: "View, focus, steer, and stop running subagents" }],
      },
      {
        heading: "Agents",
        items: [
          { value: "agents", label: "Browse definitions", description: "Inspect, configure models, and view agent definitions" },
          { value: "create", label: "Create new agent", description: "Define a new agent with instructions, tools, and model" },
        ],
      },
      {
        heading: "Configuration",
        items: [
          { value: "settings", label: "Settings", description: "Concurrency, join mode, timeouts, and model overrides" },
          { value: "trust", label: "Project trust", description: "Approve or revoke project-level agent definitions" },
          { value: "reload", label: "Reload definitions", description: "Reload agent definitions from disk" },
        ],
      },
    ];

    const allItems: MenuItem[] = sections.flatMap((s) => s.items);
    const SEPARATOR_LABEL = "─".repeat(24);

    return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      let selectedIdx = 0;
      let cachedWidth = 0;
      let cachedLines: string[] = [];

      const HEADING_INDENT = "  ";
      const ITEM_INDENT = "    ";
      const CLOSE_INDENT = "  ";
      const PREFIX_GAP = " ";

      function selectedPrefix(): string { return theme.fg("accent", "●"); }
      function unselectedPrefix(): string { return theme.fg("dim", "○"); }
      function headingStyle(text: string): string { return theme.fg("accent", theme.bold(text)); }
      function itemStyle(text: string, selected: boolean): string { return selected ? theme.fg("accent", text) : theme.fg("text", text); }
      function descStyle(text: string): string { return theme.fg("muted", text); }
      function separatorStyle(text: string): string { return theme.fg("dim", text); }

      function getChoiceValue(index: number): string | undefined {
        if (index < allItems.length) return allItems[index].value;
        return "close";
      }

      function renderAll(width: number): string[] {
        const lines: string[] = [];
        let itemIdx = 0;

        for (const section of sections) {
          lines.push(truncateToWidth(HEADING_INDENT + headingStyle(section.heading.toUpperCase()), width));
          for (const item of section.items) {
            const selected = itemIdx === selectedIdx;
            const prefix = selected ? selectedPrefix() : unselectedPrefix();
            const styled = itemStyle(item.label, selected);
            lines.push(truncateToWidth(ITEM_INDENT + prefix + PREFIX_GAP + styled, width));
            if (selected) {
              lines.push(truncateToWidth(ITEM_INDENT + "   " + descStyle(item.description), width));
            }
            itemIdx++;
          }
          lines.push("");
        }

        lines.push(truncateToWidth(separatorStyle(SEPARATOR_LABEL), width));
        const closeSelected = selectedIdx === allItems.length;
        const closePrefix = closeSelected ? selectedPrefix() : unselectedPrefix();
        const closeStyled = closeSelected ? theme.fg("accent", "Close") : theme.fg("text", "Close");
        lines.push(truncateToWidth(CLOSE_INDENT + closePrefix + PREFIX_GAP + closeStyled, width));
        if (closeSelected) {
          lines.push(truncateToWidth(CLOSE_INDENT + "   " + descStyle("Exit the subagents menu"), width));
        }

        lines.push("");
        lines.push(truncateToWidth(theme.fg("dim", "↑↓ navigate  ·  enter select  ·  esc back"), width));

        return lines;
      }

      return {
        render(width: number): string[] {
          if (cachedWidth === width && cachedLines.length > 0) return cachedLines;
          cachedLines = renderAll(width);
          cachedWidth = width;
          return cachedLines;
        },
        invalidate(): void {
          cachedWidth = 0;
          cachedLines = [];
        },
        handleInput(data: string): void {
          const total = allItems.length + 1; // items + close

          if (matchesKey(data, Key.up)) {
            selectedIdx = (selectedIdx - 1 + total) % total;
            cachedWidth = 0;
            cachedLines = [];
            tui.requestRender();
          } else if (matchesKey(data, Key.down)) {
            selectedIdx = (selectedIdx + 1) % total;
            cachedWidth = 0;
            cachedLines = [];
            tui.requestRender();
          } else if (matchesKey(data, Key.enter)) {
            const value = getChoiceValue(selectedIdx);
            if (value !== undefined) done(value);
          } else if (matchesKey(data, Key.escape)) {
            done(undefined);
          }
        },
      };
    });
  }

  pi.registerCommand("agents", { description: "Inspect and configure Pi subagents", handler: async (_args, ctx) => {
    const active = manager; if (!active) return;
    try {
      if (!active.herdrAvailable()) ctx.ui.notify(`Herdr unavailable: ${active.herdrUnavailableMessage()}`, "warning");
      while (true) {
        const choice = await mainMenu(ctx);
        if (!choice || choice === "close") return;
        if (choice === "reload") { await active.reload(); ctx.ui.notify("Agent definitions reloaded.", "info"); continue; }
        if (choice === "create") { await createAgent(ctx, active); continue; }
        if (choice === "trust") { const action = await ctx.ui.select("Project agents", ["Approve", "Revoke", "Back"]); if (action === "Approve") { const approved = await active.approveProject(); ctx.ui.notify(approved ? "Project agents approved for this session." : "Project agents not approved.", approved ? "info" : "warning"); } else if (action === "Revoke") { active.revokeProject(); ctx.ui.notify("Project agents revoked for this session.", "info"); } continue; }
        if (choice === "settings") {
          const settings = active.settingsForUI();
          const options = [`maxConcurrent: ${settings.maxConcurrent}`, `joinMode: ${settings.joinMode}`, `groupTimeoutMs: ${settings.groupTimeoutMs}`, `allowCallerModelOverride: ${settings.allowCallerModelOverride}`, `runTimeoutMs: ${settings.runTimeoutMs}`, "Back"];
          const setting = await ctx.ui.select("Settings", options); if (!setting || setting === "Back") continue;
          const match = setting.match(/^(\w+):/); if (!match) continue; const name = match[1];
          let parsed: unknown;
          if (name === "allowCallerModelOverride") { const selected = await ctx.ui.select("Allow caller model override?", ["true", "false"]); if (!selected) continue; parsed = selected === "true"; }
          else { const value = await ctx.ui.input(`New ${name}`, String(settings[name])); if (value === undefined) continue; parsed = name === "joinMode" ? value : Number(value); if (name === "joinMode" && parsed !== "async" && parsed !== "smart") { ctx.ui.notify("joinMode must be async or smart.", "error"); continue; } if (name !== "joinMode" && (!Number.isInteger(parsed) || (parsed as number) < 0)) { ctx.ui.notify("Enter a valid non-negative integer.", "error"); continue; } }
          const scope = await ctx.ui.select("Persist setting", ["session", "project", "global", "Back"]); if (!scope || scope === "Back") continue;
          await active.saveSetting(name, parsed, scope as "global" | "project" | "session"); ctx.ui.notify(scope === "session" ? "Saved for this parent session." : "Saved for future runs.", "info"); continue;
        }
        if (choice === "runs") {
          const runs = active.list();
          const selected = await selectDetailed(ctx, "Active and recent runs", runs.map((run) => ({
            value: run.id,
            label: `${statusIcon(run.status)} ${run.agent} — ${run.status}`,
            details: [
              [{ text: run.description, role: "text" }],
              [{ text: "Status: ", role: "muted" }, { text: `${statusIcon(run.status)} ${run.status}`, role: statusColorRole(run.status) }],
              [{ text: "ID: ", role: "muted" }, { text: run.id, role: "dim" }],
              [{ text: "Model: ", role: "muted" }, { text: `${run.model} (${run.modelSource})`, role: "dim" }],
              [{ text: "Thinking: ", role: "muted" }, { text: `${run.thinking}  •  Prompts: ${run.prompts}`, role: "dim" }],
            ],
          })));
          const run = runs.find((candidate) => candidate.id === selected); if (!run) continue;
          const live = run.status === "queued" || run.status === "running" || run.status === "blocked";
          const actions = live ? ["Focus", "Read", "Steer", "Stop", "Back"] : ["View result", "Resume", "Remove", "Back"];
          const action = await ctx.ui.select(`${run.agent}: ${run.status}`, actions);
          if (action === "View result") ctx.ui.notify(outputText(run, true).slice(0, 4000), "info");
          if (action === "Focus") await active.focus(run.id);
          if (action === "Read") ctx.ui.notify((await active.readLive(run.id)).slice(0, 4000), "info");
          if (action === "Steer") { const text = await ctx.ui.input("Steer instruction"); if (text) await active.steer(run.id, text); }
          if (action === "Stop") await active.stop(run.id);
          if (action === "Resume") { const prompt = await ctx.ui.input("Resume prompt", "Continue the task"); if (prompt) await active.resume(run.id, prompt); }
          if (action === "Remove") active.remove(run.id);
          continue;
        }
        if (choice === "agents") {
          const defs = active.definitionsForUI();
          const selected = await selectDetailed(ctx, "Agents", defs.map((def) => ({
            value: def.name,
            label: `${def.enabled ? "●" : "○"} ${def.displayName}`,
            details: ([
              [{ text: def.description, role: "text" }],
              [{ text: "Source: ", role: "muted" }, { text: `${def.source}  •  `, role: "dim" }, { text: def.enabled ? "● enabled" : "○ disabled", role: def.enabled ? "success" : "muted" }],
              [{ text: "Kind: ", role: "muted" }, { text: def.kind, role: "dim" }],
              ...(def.kind === "pi" ? [
                [{ text: "Model: ", role: "muted" }, { text: def.effectiveModel ?? "inherit/default", role: "dim" }],
                [{ text: "Model source: ", role: "muted" }, { text: def.effectiveModelSource ?? "unresolved", role: "dim" }],
                [{ text: "Tools: ", role: "muted" }, { text: def.tools.join(", ") || "none", role: "dim" }],
              ] : [[{ text: "Args: ", role: "muted" }, { text: def.args?.join(" ") || "none", role: "dim" }]]),
            ] as ThemedLine[]),
          })));
          const def = defs.find((candidate) => candidate.name === selected); if (!def) continue;
          const actions = def.kind === "pi" ? ["Configure model", "View definition", "Back"] : ["View definition", "Back"];
          const action = await ctx.ui.select(def.name, actions);
          if (action === "View definition") ctx.ui.notify(`${def.description}\nSource: ${def.source}${def.filePath ? `\n${def.filePath}` : ""}\nKind: ${def.kind}\n${def.kind === "pi" ? `Effective model: ${def.effectiveModel ?? "inherit/default"} (${def.effectiveModelSource ?? "unresolved"})\nTools: ${def.tools.join(", ")}` : `Args: ${def.args?.join(" ") || "none"}`}`, "info");
          if (action === "Configure model") { const available = ctx.modelRegistry.getAvailable(); const options = ["Inherit/default", ...available.map((m) => `${m.provider}/${m.id}`), "Back"]; const chosen = await ctx.ui.select(`Model for ${def.name}`, options); if (!chosen || chosen === "Back") continue; const modelScope = await ctx.ui.select("Persist model", ["session", "project", "global", "Back"]); if (!modelScope || modelScope === "Back") continue; await active.setModel(def.name, chosen === "Inherit/default" ? undefined : chosen, modelScope as "session" | "project" | "global"); ctx.ui.notify(modelScope === "session" ? "Saved for this parent session." : "Saved for future runs.", "info"); }
        }
      }
    } catch (error) { ctx.ui.notify(asError(error), "error"); }
  }});
}
