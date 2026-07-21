import path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, sessionEntryToContextMessages, type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { discoverAgents } from "./discovery.ts";
import { loadSettings, type SettingsStore } from "./settings.ts";
import { resolveAgentModel, resolveModelSpec, modelKey } from "./models.ts";
import { BoundedScheduler } from "./scheduler.ts";
import { applyTurnPolicy, type TurnPolicyState } from "./turn-policy.ts";
import { THINKING_LEVELS, type AgentDefinition, type AgentRequest, type RunResult, type SessionOverrides, type ThinkingLevel } from "./types.ts";
import { notificationContent, notificationDetails } from "./rendering.ts";
import { safeJson, truncate, textOf } from "./util.ts";

interface RecordState extends RunResult {
  request: AgentRequest;
  definition: AgentDefinition;
  resolvedModel: Model<any>;
  fullOutput: string;
  maxTurns: number;
  session?: any;
  sessionUnsubscribe?: () => void;
  abortListener?: () => void;
  onUpdate?: (output: string, result: RunResult) => void;
  controller: AbortController;
  pendingSteer?: string;
  promise: Promise<RunResult>;
  resolve: (result: RunResult) => void;
  settled: boolean;
  consumed: boolean;
  finalizedMessages: Set<object>;
  policy: TurnPolicyState;
  limitAbort: boolean;
}
interface Group { id: string; runs: Set<string>; ended: boolean; timer?: ReturnType<typeof setTimeout>; delivered: Set<string>; firstCompleted: boolean; timedOut: boolean; }
const terminal = (status: RunResult["status"]) => status === "completed" || status === "failed" || status === "aborted";

export class SubagentManager {
  private records = new Map<string, RecordState>();
  private scheduler = new BoundedScheduler<RecordState>(() => this.settings?.effective(this.sessionOverrides).maxConcurrent ?? 4);
  private groups = new Map<string, Group>();
  private currentTurn?: Group;
  private disposed = false;
  private warned = new Set<string>();
  private approved = false;
  private projectApprovalAsked = false;
  private settings?: SettingsStore;
  private sessionOverrides: SessionOverrides = {};
  private definitions: AgentDefinition[] = [];
  private runtime?: ModelRuntime;
  private runtimePromise?: Promise<ModelRuntime>;

  constructor(private readonly pi: ExtensionAPI, private readonly ctx: ExtensionContext) {}

  async start(): Promise<void> {
    this.settings = await loadSettings(this.ctx.cwd);
    this.definitions = discoverAgents(this.ctx.cwd, false, this.warned).agents;
    this.pi.on("turn_start", () => { if (!this.disposed) this.startTurn(); });
    this.pi.on("turn_end", () => { if (!this.disposed) this.endTurn(); });
  }
  // ExtensionAPI.on has no unsubscribe return in the current SDK. Lifecycle guards make
  // handlers inert after cleanup; child session subscriptions do have real unsubscribers.
  private startTurn(): void {
    if (this.currentTurn) return;
    const group: Group = { id: `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`, runs: new Set(), ended: false, delivered: new Set(), firstCompleted: false, timedOut: false };
    this.groups.set(group.id, group); this.currentTurn = group;
  }
  private endTurn(): void {
    const group = this.currentTurn; if (!group) return;
    group.ended = true; this.currentTurn = undefined; this.maybeNotify(group);
  }
  private completed(group: Group): RecordState[] { return [...group.runs].map((id) => this.records.get(id)).filter((r): r is RecordState => !!r && terminal(r.status)); }
  private notifyOne(record: RecordState): void {
    if (record.consumed || this.disposed) return;
    record.consumed = true;
    const details = notificationDetails("individual", [this.publicResult(record)]);
    this.pi.sendMessage({ customType: "subagents", content: notificationContent(details), display: true, details }, { triggerTurn: true, deliverAs: "followUp" });
  }
  private notifyBatch(records: RecordState[]): void {
    const deliverable = records.filter((r) => !r.consumed);
    if (!deliverable.length) return;
    for (const r of deliverable) r.consumed = true;
    const details = notificationDetails("batch", deliverable.map((record) => this.publicResult(record)));
    this.pi.sendMessage({ customType: "subagents", content: notificationContent(details), display: true, details }, { triggerTurn: true, deliverAs: "followUp" });
  }
  private maybeNotify(group: Group): void {
    const settings = this.settings?.effective(this.sessionOverrides);
    if (!settings || settings.joinMode !== "smart") {
      if (settings?.joinMode === "async") for (const record of this.completed(group)) if (record.request.run_in_background) this.notifyOne(record);
      return;
    }
    if (group.runs.size < 2) {
      if (group.ended) for (const record of this.completed(group)) if (record.request.run_in_background && !group.delivered.has(record.id)) { group.delivered.add(record.id); this.notifyOne(record); }
      return;
    }
    const done = this.completed(group);
    if (!done.length) return;
    if (group.timedOut) {
      for (const record of done) {
        if (!group.delivered.has(record.id)) {
          group.delivered.add(record.id);
          this.notifyOne(record);
        }
      }
      return;
    }
    if (!group.firstCompleted) { group.firstCompleted = true; group.timer = setTimeout(() => this.timeoutGroup(group), Math.max(0, settings.groupTimeoutMs)); }
    const allDone = group.runs.size > 0 && [...group.runs].every((id) => { const r = this.records.get(id); return !!r && terminal(r.status); });
    if (allDone) {
      if (group.timer) clearTimeout(group.timer);
      group.timer = undefined;
      const pending = done.filter((r) => !group.delivered.has(r.id));
      for (const r of pending) group.delivered.add(r.id);
      this.notifyBatch(pending);
    }
  }
  private timeoutGroup(group: Group): void {
    group.timer = undefined;
    group.timedOut = true;
    const pending = this.completed(group).filter((r) => !group.delivered.has(r.id));
    for (const r of pending) group.delivered.add(r.id);
    this.notifyBatch(pending);
  }
  private includeProject(): boolean { return this.ctx.isProjectTrusted() && this.approved; }
  private discover(): AgentDefinition[] {
    const d = discoverAgents(this.ctx.cwd, this.includeProject(), this.warned);
    for (const warning of d.warnings) this.ctx.ui.notify(warning, "warning");
    return d.agents;
  }
  private getDefinition(name: string): AgentDefinition {
    const defs = this.discover();
    const def = defs.find((a) => a.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!def) throw new Error(`Unknown subagent '${name}'. Available: ${defs.map((a) => a.name).join(", ")}`);
    if (!def.enabled) throw new Error(`Agent '${def.name}' is disabled.`);
    if (def.project && !this.includeProject()) throw new Error("Project-defined agents require project trust and one-time approval in /agents.");
    return def;
  }
  async approveProject(): Promise<boolean> {
    if (!this.ctx.isProjectTrusted()) throw new Error("Project agents require a trusted project.");
    if (this.approved) return true;
    if (this.projectApprovalAsked) throw new Error("Project agents were not approved for this parent session.");
    this.projectApprovalAsked = true;
    if (!this.ctx.hasUI) throw new Error("Project agents are not approved in headless mode.");
    this.approved = await this.ctx.ui.confirm("Approve project agents?", "Project .pi/agents files can run arbitrary prompts and tools.");
    return this.approved;
  }
  revokeProject(): void { this.approved = false; this.projectApprovalAsked = true; }
  async reload(): Promise<void> { this.definitions = this.discover(); }
  private async getRuntime(): Promise<ModelRuntime> {
    if (this.runtime) return this.runtime;
    // ModelRegistry is the current SDK's facade over the parent's live ModelRuntime.
    // Reuse it when available so custom providers and dynamic registrations remain valid.
    const parentRuntime = (this.ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
    this.runtime = parentRuntime ?? await (this.runtimePromise ??= ModelRuntime.create());
    return this.runtime;
  }
  private async createRecord(request: AgentRequest, onUpdate?: (output: string, result: RunResult) => void): Promise<RecordState> {
    if (!request.prompt?.trim()) throw new Error("Agent.prompt must be non-empty.");
    if (!request.description?.trim()) throw new Error("Agent.description must be non-empty.");
    if (!request.subagent_type?.trim()) throw new Error("Agent.subagent_type must be non-empty.");
    if (request.resume && (request.run_in_background || request.inherit_context)) throw new Error("resume cannot be combined with run_in_background or inherit_context.");
    const existing = request.resume ? this.records.get(request.resume) : undefined;
    if (request.resume) {
      if (!existing) throw new Error(`No session-local run '${request.resume}' is available to resume.`);
      if (request.model && request.model !== existing.model) throw new Error("Resume rejects a conflicting model override.");
      if (request.thinking && request.thinking !== existing.thinking) throw new Error("Resume rejects a conflicting thinking override.");
      if (existing.status === "running" || existing.status === "queued") throw new Error(`Run '${existing.id}' is already ${existing.status}.`);
      if (existing.groupId) this.groups.get(existing.groupId)?.runs.delete(existing.id);
      existing.groupId = undefined;
      const group = this.currentTurn;
      if (group) { existing.groupId = group.id; group.runs.add(existing.id); }
      existing.request = request; existing.description = request.description; existing.status = "queued"; existing.error = undefined; existing.output = ""; existing.fullOutput = ""; existing.partialOutput = ""; existing.completedAt = undefined; existing.controller = new AbortController(); existing.abortListener = undefined; existing.onUpdate = onUpdate; existing.pendingSteer = undefined; existing.settled = false; existing.consumed = false; existing.finalizedMessages = new Set(); existing.policy = { wrapUpSent: false, abortRequested: false }; existing.limitAbort = false;
      existing.promise = new Promise<RunResult>((resolve) => { existing.resolve = resolve; });
      return existing;
    }
    const projectCandidate = discoverAgents(this.ctx.cwd, true, this.warned).agents.find(
      (agent) => agent.name.toLocaleLowerCase() === request.subagent_type.toLocaleLowerCase() && agent.project,
    );
    if (projectCandidate && !this.includeProject()) await this.approveProject();
    const def = this.getDefinition(request.subagent_type);
    const settings = this.settings?.effective(this.sessionOverrides);
    if (!settings) throw new Error("Settings unavailable.");
    const resolved = resolveAgentModel(def, settings, this.ctx, request.model, settings.allowCallerModelOverride);
    const maxTurns = request.max_turns ?? def.maxTurns ?? settings.defaultMaxTurns;
    if (!Number.isInteger(maxTurns) || maxTurns < 0) throw new Error("max_turns must be a non-negative integer (0 means unlimited).");
    const thinking = request.thinking ?? def.thinking ?? "medium";
    if (!(THINKING_LEVELS as readonly string[]).includes(thinking)) throw new Error(`thinking must be one of ${THINKING_LEVELS.join(", ")}.`);
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let resolve!: (r: RunResult) => void;
    const promise = new Promise<RunResult>((res) => { resolve = res; });
    const record: RecordState = { id, agent: def.name, description: request.description, status: "queued", output: "", fullOutput: "", request, definition: def, resolvedModel: resolved.model, model: modelKey(resolved.model)!, modelSource: resolved.source, thinking: thinking as ThinkingLevel, turns: 0, createdAt: Date.now(), controller: new AbortController(), onUpdate, promise, resolve, settled: false, consumed: false, finalizedMessages: new Set(), policy: { wrapUpSent: false, abortRequested: false }, limitAbort: false, maxTurns };
    const group = this.currentTurn;
    if (group) { record.groupId = group.id; group.runs.add(id); }
    this.records.set(id, record);
    // A member may have completed before a second Agent call in this turn was
    // registered; this starts the smart timer at the first completion time.
    if (group && group.runs.size >= 2) this.maybeNotify(group);
    return record;
  }
  async launch(request: AgentRequest, onUpdate?: (output: string, result: RunResult) => void, signal?: AbortSignal): Promise<RunResult> {
    const record = await this.createRecord(request, onUpdate);
    if (signal) {
      const stop = () => { void this.stop(record.id); };
      if (signal.aborted) await this.stop(record.id); else { signal.addEventListener("abort", stop, { once: true }); record.abortListener = () => signal.removeEventListener("abort", stop); }
    }
    if (terminal(record.status)) return this.publicResult(record);
    if (request.run_in_background) { this.scheduler.enqueue(record, () => this.run(record)); return this.publicResult(record); }
    // Foreground work bypasses the background scheduler and its concurrency limit.
    await this.scheduler.runForeground(() => this.run(record));
    return this.publicResult(await record.promise);
  }
  private finish(record: RecordState, status: RunResult["status"], error?: string): void {
    if (record.settled) return;
    record.status = status; record.error = error; record.completedAt = Date.now(); record.output = truncate(record.fullOutput || record.output || record.partialOutput || ""); record.settled = true; record.abortListener?.(); record.abortListener = undefined; record.resolve(record);
    if (record.groupId) this.maybeNotify(this.groups.get(record.groupId)!);
    const settings = this.settings?.effective(this.sessionOverrides);
    if (record.request.run_in_background && settings?.joinMode === "async" && !record.groupId) this.notifyOne(record);
  }
  private enforceTurns(record: RecordState): void {
    const actions = applyTurnPolicy(record.policy, record.turns, record.maxTurns, this.settings?.effective(this.sessionOverrides).graceTurns ?? 0);
    if (actions.includes("steer") && record.session) void record.session.steer("The turn limit is reached. Wrap up now: report completed work, partial progress, blockers, and the most useful next steps concisely.").catch(() => undefined);
    if (actions.includes("abort")) { record.limitAbort = true; void record.session?.abort(); }
  }
  private async run(record: RecordState): Promise<void> {
    if (record.settled) return;
    if (record.controller.signal.aborted) { this.finish(record, "aborted", "Aborted before initialization."); return; }
    record.status = "running";
    try {
      const def = record.definition;
      if (!record.session) {
        const modelRuntime = await this.getRuntime();
        const loader = new DefaultResourceLoader({ cwd: this.ctx.cwd, agentDir: path.join(this.ctx.cwd, ".pi", "subagents"), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: `You are ${def.displayName}. ${def.prompt}` });
        await loader.reload();
        const created = await createAgentSession({ cwd: this.ctx.cwd, model: record.resolvedModel, modelRuntime, thinkingLevel: record.thinking, tools: def.tools, resourceLoader: loader, sessionManager: SessionManager.inMemory(this.ctx.cwd) });
        record.session = created.session;
        if (record.request.inherit_context) {
          const entries = this.ctx.sessionManager.buildContextEntries();
          const messages = entries.flatMap((entry: any) => sessionEntryToContextMessages(entry));
          const trailing = messages.at(-1) as any;
          if (trailing?.role === "assistant" && Array.isArray(trailing.content) && trailing.content.some((part: any) => part.type === "toolCall")) {
            messages.pop();
          }
          record.session.agent.state.messages = safeJson(messages) as any;
        }
        record.sessionUnsubscribe = record.session.subscribe((event: any) => {
          if (event.type === "message_start" && event.message?.role === "assistant") record.partialOutput = "";
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") { record.partialOutput = truncate(`${record.partialOutput ?? ""}${event.assistantMessageEvent.delta}`); record.onUpdate?.(record.partialOutput, this.publicResult(record)); }
          if (event.type === "message_end" && event.message?.role === "assistant" && event.message && !record.finalizedMessages.has(event.message)) {
            record.finalizedMessages.add(event.message);
            const text = textOf(event.message);
            if (text) {
              record.fullOutput = text;
              record.output = truncate(text);
            }
            record.onUpdate?.(record.output || record.partialOutput || "", this.publicResult(record));
          }
          if (event.type === "turn_end") { record.turns++; this.enforceTurns(record); }
        });
      }
      if (record.controller.signal.aborted) { this.finish(record, "aborted", "Aborted before prompt."); return; }
      if (record.pendingSteer) { const pending = record.pendingSteer; record.pendingSteer = undefined; await record.session.steer(pending); }
      await record.session.prompt(record.request.prompt);
      if (record.settled) return;
      this.finish(record, record.limitAbort || record.controller.signal.aborted ? "aborted" : "completed", record.limitAbort ? "Turn limit reached; partial output returned." : undefined);
    } catch (error) {
      if (record.settled) return;
      const message = record.limitAbort ? "Turn limit reached; partial output returned." : error instanceof Error ? error.message : String(error);
      this.finish(record, record.controller.signal.aborted || record.limitAbort ? "aborted" : "failed", message);
    }
  }
  private publicResult(r: RunResult): RunResult { return { id: r.id, agent: r.agent, description: r.description, status: r.status, output: r.output, partialOutput: r.partialOutput, error: r.error, model: r.model, modelSource: r.modelSource, thinking: r.thinking, turns: r.turns, createdAt: r.createdAt, completedAt: r.completedAt, groupId: r.groupId }; }
  async result(id: string, wait = true, _verbose = false): Promise<RunResult> { const r = this.records.get(id); if (!r) throw new Error(`Unknown subagent run '${id}'.`); r.consumed = true; return this.publicResult(wait && !terminal(r.status) ? await r.promise : r); }
  async steer(id: string, instruction: string): Promise<RunResult> { const r = this.records.get(id); if (!r) throw new Error(`Unknown subagent run '${id}'.`); if (!instruction.trim()) throw new Error("Steer instruction must be non-empty."); if (r.status === "queued" || (r.status === "running" && !r.session)) r.pendingSteer = `${r.pendingSteer ? `${r.pendingSteer}\n` : ""}${instruction}`; else if (r.status === "running") await r.session.steer(instruction); else throw new Error(`Run '${id}' is ${r.status} and cannot be steered.`); return this.publicResult(r); }
  async resume(id: string, prompt: string): Promise<RunResult> { const r = this.records.get(id); if (!r) throw new Error(`Unknown subagent run '${id}'.`); return this.launch({ prompt, description: r.description, subagent_type: r.agent, resume: id }); }
  remove(id: string): void { const r = this.records.get(id); if (!r) throw new Error(`Unknown subagent run '${id}'.`); if (!terminal(r.status)) throw new Error("Stop a run before removing it."); r.sessionUnsubscribe?.(); r.sessionUnsubscribe = undefined; r.session?.dispose(); this.records.delete(id); }
  async stop(id: string): Promise<RunResult> { const r = this.records.get(id); if (!r) throw new Error(`Unknown subagent run '${id}'.`); if (terminal(r.status)) return this.publicResult(r); r.controller.abort(); if (r.status === "queued") { this.scheduler.remove(r); this.finish(r, "aborted", "Stopped before initialization."); } else if (r.session) { try { await r.session.abort(); } catch { /* abort is idempotent in current SDK */ } } else this.finish(r, "aborted", "Stopped before initialization."); return this.publicResult(r); }
  list(): RunResult[] { return [...this.records.values()].map((r) => this.publicResult(r)); }
  definitionsForUI(): AgentDefinition[] {
    const settings = this.settings?.effective(this.sessionOverrides);
    return this.discover().map((def) => { try { const resolved = settings ? resolveAgentModel(def, settings, this.ctx) : undefined; return { ...def, effectiveModel: resolved ? modelKey(resolved.model) : undefined, effectiveModelSource: resolved?.source }; } catch { return { ...def }; } });
  }
  settingsForUI(): Record<string, unknown> { return { ...(this.settings?.effective(this.sessionOverrides) ?? {}) }; }
  async saveSetting(key: string, value: unknown, scope: "global" | "project" | "session"): Promise<void> {
    const allowed = new Set(["maxConcurrent", "joinMode", "groupTimeoutMs", "allowCallerModelOverride", "defaultMaxTurns", "graceTurns"]);
    if (!allowed.has(key)) throw new Error(`Unknown setting '${key}'.`);
    if (scope === "session") { (this.sessionOverrides as any)[key] = value; return; }
    await this.settings!.save(scope, { [key]: value } as any);
  }
  async setModel(name: string, spec: string | undefined, scope: "global" | "project" | "session"): Promise<void> {
    if (!this.settings) throw new Error("Settings unavailable");
    if (spec) resolveModelSpec(spec, this.ctx);
    if (scope === "session") { const models = this.sessionOverrides.agentModels ??= {}; const old = Object.keys(models).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase()); if (old) delete models[old]; if (spec) models[name] = spec; return; }
    await this.settings.saveModel(scope, name, spec);
  }
  cleanup(): void {
    if (this.disposed) return; this.disposed = true;
    for (const r of this.records.values()) {
      r.controller.abort(); r.abortListener?.(); r.abortListener = undefined; r.sessionUnsubscribe?.(); r.sessionUnsubscribe = undefined;
      if (!r.settled) this.finish(r, "aborted", "Extension shut down.");
      try { r.session?.abort(); } catch { /* best effort */ }
      try { r.session?.dispose(); } catch { /* best effort */ }
    }
    this.scheduler.dispose(); for (const g of this.groups.values()) if (g.timer) clearTimeout(g.timer); this.groups.clear();
  }
}

const thinkingSchema = StringEnum(THINKING_LEVELS, { description: "Thinking effort" });
export const agentSchema = Type.Object({ prompt: Type.String({ description: "Task for the subagent" }), description: Type.String({ description: "Short human-readable task label" }), subagent_type: Type.String({ description: "Named agent definition" }), run_in_background: Type.Optional(Type.Boolean()), resume: Type.Optional(Type.String()), model: Type.Optional(Type.String({ description: "Canonical provider/model; only if enabled in settings" })), thinking: Type.Optional(thinkingSchema), max_turns: Type.Optional(Type.Integer({ minimum: 0, description: "0 means unlimited" })), inherit_context: Type.Optional(Type.Boolean()) });
export const resultSchema = Type.Object({ agent_id: Type.String(), wait: Type.Optional(Type.Boolean({ default: true })), verbose: Type.Optional(Type.Boolean({ default: false })) });
export const steerSchema = Type.Object({ agent_id: Type.String(), message: Type.String() });
