import type { Component } from "@earendil-works/pi-tui";
import { Box, Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { RunResult } from "./types.ts";
import { truncate } from "./util.ts";

export type StatusColorRole = "accent" | "warning" | "success" | "error";
export type RenderColorRole = StatusColorRole | "text" | "muted" | "dim" | "toolTitle" | "toolOutput";

export function statusColorRole(status: RunResult["status"]): StatusColorRole {
  switch (status) {
    case "queued": return "accent";
    case "running": return "warning";
    case "completed": return "success";
    case "failed":
    case "aborted": return "error";
  }
}

export function statusIcon(status: RunResult["status"]): string {
  switch (status) {
    case "queued": return "○";
    case "running": return "●";
    case "completed": return "✓";
    case "failed":
    case "aborted": return "✗";
  }
}

export interface NotificationRun {
  id: string;
  agent: string;
  description: string;
  status: RunResult["status"];
  model: string;
  modelSource: string;
  turns: number;
  result?: string;
  error?: string;
}

export interface SubagentNotificationDetails {
  type: "subagent-notification";
  kind: "individual" | "batch";
  ids: string[];
  runs: NotificationRun[];
}

export function notificationRun(result: RunResult): NotificationRun {
  const output = result.output || result.partialOutput;
  return {
    id: result.id,
    agent: result.agent,
    description: result.description,
    status: result.status,
    model: result.model,
    modelSource: result.modelSource,
    turns: result.turns,
    result: output || undefined,
    error: result.error,
  };
}

export function notificationDetails(kind: SubagentNotificationDetails["kind"], results: RunResult[]): SubagentNotificationDetails {
  const runs = results.map(notificationRun);
  return { type: "subagent-notification", kind, ids: runs.map((run) => run.id), runs };
}

/** Plain text sent to the model. Presentation belongs in SubagentNotificationComponent. */
function notificationOutcome(run: NotificationRun, maxBytes: number): string {
  const parts: string[] = [];
  if (run.error) parts.push(`Error: ${run.error}`);
  if (run.result) parts.push(`${run.error ? "Partial output" : "Result"}: ${run.result}`);
  return truncate(parts.join("\n") || "(no output)", maxBytes);
}

export function notificationContent(details: SubagentNotificationDetails): string {
  if (details.kind === "individual") {
    const run = details.runs[0];
    if (!run) return "No subagent notification.";
    return `Subagent ${run.agent} (${run.id}) ${run.status}:\n${notificationOutcome(run, 5000)}`;
  }
  const lines = details.runs.map((run) => `${run.agent} (${run.id}) ${run.status}:\n${notificationOutcome(run, 4000)}`);
  return `Subagent results (${details.runs.length}):\n${lines.join("\n")}`;
}

export interface ThemedSegment {
  text: string;
  role?: RenderColorRole;
  bold?: boolean;
}
export type ThemedLine = string | ThemedSegment[];

/** Renders raw semantic segments on every render, so it never stores old ANSI strings. */
export class ThemedLines implements Component {
  private lines: ThemedLine[];

  constructor(private readonly theme: Theme, lines: ThemedLine[] = []) {
    this.lines = lines;
  }

  setLines(lines: ThemedLine[]): void { this.lines = lines; }

  render(width: number): string[] {
    return this.lines.map((line) => {
      if (typeof line === "string") return truncateToWidth(line, width);
      const text = line.map((segment) => {
        const value = segment.bold ? this.theme.bold(segment.text) : segment.text;
        return segment.role ? this.theme.fg(segment.role, value) : value;
      }).join("");
      return truncateToWidth(text, width);
    });
  }

  invalidate(): void {}
}

function compact(text: string | undefined, max = 1000): string {
  if (!text) return "(no output)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function statusLine(theme: Theme, run: NotificationRun, includeId: boolean): string {
  const icon = theme.fg(statusColorRole(run.status), statusIcon(run.status));
  const name = theme.fg("toolTitle", theme.bold(run.agent));
  const status = theme.fg(statusColorRole(run.status), run.status);
  const id = includeId ? ` ${theme.fg("muted", `(${run.id})`)}` : "";
  return `${icon} ${name} ${status}${id}`;
}

export class SubagentNotificationComponent extends Container {
  constructor(
    private readonly details: SubagentNotificationDetails,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) {
    super();
    this.rebuild();
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    const box = new Box(1, 1, (text: string) => this.theme.bg("customMessageBg", text));
    if (this.details.kind === "individual") {
      const run = this.details.runs[0];
      if (run) this.addRun(box, run, true);
    } else {
      box.addChild(new Text(
        `${this.theme.fg("toolTitle", this.theme.bold("Subagents"))} ${this.theme.fg("accent", `${this.details.runs.length} results`)}`,
        0,
        0,
      ));
      for (const run of this.details.runs) this.addRun(box, run, this.expanded);
    }
    this.addChild(box);
  }

  private addRun(box: Box, run: NotificationRun, expanded: boolean): void {
    box.addChild(new Text(statusLine(this.theme, run, true), 0, 0));
    if (expanded || this.details.kind === "individual") {
      box.addChild(new Text(this.theme.fg("text", run.description), 0, 0));
      box.addChild(new Text(
        `${this.theme.fg("muted", "model ")}${this.theme.fg("dim", run.model)} ${this.theme.fg("muted", `(${run.modelSource}) · ${run.turns} turns`)}`,
        0,
        0,
      ));
    }
    if (run.error) box.addChild(new Text(this.theme.fg("error", `Error: ${run.error}`), 0, 0));
    if (run.result) {
      const label = run.error ? this.theme.fg("muted", "Partial output: ") : "";
      box.addChild(new Text(label + this.theme.fg("toolOutput", compact(run.result, expanded ? 5000 : 1000)), 0, 0));
    } else if (!run.error) {
      box.addChild(new Text(this.theme.fg("muted", "(no output)"), 0, 0));
    }
  }
}

export interface AgentResultViewModel {
  status: RunResult["status"];
  agent: string;
  output?: string;
  error?: string;
  loading: boolean;
}

export function agentResultViewModel(
  details: unknown,
  content: string,
  isPartial: boolean,
  isError: boolean,
  fallbackAgent = "Agent",
): AgentResultViewModel {
  const candidate = details as Partial<RunResult> | undefined;
  const validStatus = candidate?.status && ["queued", "running", "completed", "failed", "aborted"].includes(candidate.status)
    ? candidate.status as RunResult["status"]
    : undefined;
  const status = validStatus ?? (isPartial ? "running" : isError ? "failed" : "completed");
  return {
    status,
    agent: typeof candidate?.agent === "string" ? candidate.agent : fallbackAgent,
    output: typeof candidate?.output === "string" ? candidate.output : content || undefined,
    error: typeof candidate?.error === "string" ? candidate.error : isError ? content || "Subagent failed." : undefined,
    loading: isPartial || status === "running",
  };
}