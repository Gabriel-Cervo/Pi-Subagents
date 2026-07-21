import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
        const choice = await ctx.ui.select("Subagents", ["Active/recent runs", "Agent types", "Settings", "Approve/revoke project agents", "Reload definitions", "Close"]);
        if (!choice || choice === "Close") return;
        if (choice === "Reload definitions") { await active.reload(); ctx.ui.notify("Agent definitions reloaded.", "info"); continue; }
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
          const runs = active.list(); const selected = await ctx.ui.select("Runs", [...runs.map((r) => `${r.id} — ${r.agent} — ${r.status} — ${r.model} (${r.modelSource})`), "Back"]); const run = runs.find((r) => selected?.startsWith(r.id)); if (!run) continue;
          const action = await ctx.ui.select(`${run.agent}: ${run.status}`, ["View result", "Steer", "Stop", "Resume", "Remove", "Back"]); if (action === "View result") ctx.ui.notify(outputText(run, true).slice(0, 4000), "info"); if (action === "Steer") { const text = await ctx.ui.input("Steer instruction"); if (text) await active.steer(run.id, text); } if (action === "Stop") await active.stop(run.id); if (action === "Resume") { const prompt = await ctx.ui.input("Resume prompt", "Continue the task"); if (prompt) await active.resume(run.id, prompt); } if (action === "Remove") active.remove(run.id); continue;
        }
        if (choice === "Agent types") {
          const defs = active.definitionsForUI(); const selected = await ctx.ui.select("Agent types", [...defs.map((d) => `${d.name} — ${d.source} — ${d.enabled ? "enabled" : "disabled"} — model ${d.effectiveModel ?? "inherit/default"} (${d.effectiveModelSource ?? "unresolved"})`), "Back"]); const def = defs.find((d) => selected?.startsWith(`${d.name} —`)); if (!def) continue;
          const action = await ctx.ui.select(def.name, ["Configure model", "View definition", "Back"]); if (action === "View definition") ctx.ui.notify(`${def.description}\nSource: ${def.source}${def.filePath ? `\n${def.filePath}` : ""}\nEffective model: ${def.effectiveModel ?? "inherit/default"} (${def.effectiveModelSource ?? "unresolved"})\nTools: ${def.tools.join(", ")}`, "info"); if (action === "Configure model") { const available = ctx.modelRegistry.getAvailable(); const options = ["Inherit/default", ...available.map((m) => `${m.provider}/${m.id}`), "Back"]; const chosen = await ctx.ui.select(`Model for ${def.name}`, options); if (!chosen || chosen === "Back") continue; const modelScope = await ctx.ui.select("Persist model", ["session", "project", "global", "Back"]); if (!modelScope || modelScope === "Back") continue; await active.setModel(def.name, chosen === "Inherit/default" ? undefined : chosen, modelScope as "session" | "project" | "global"); ctx.ui.notify(modelScope === "session" ? "Saved for this parent session." : "Saved for future runs.", "info"); }
        }
      }
    } catch (error) { ctx.ui.notify(asError(error), "error"); }
  }});
}
