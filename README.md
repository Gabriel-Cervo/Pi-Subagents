# Herdr Subagents

Herdr Subagents delegates work to [Herdr](https://herdr.dev), keeping one unfocused sibling pane per run in the caller's current tab. It exposes `Agent`, `get_subagent_result`, `steer_subagent`, and `/agents`.

## Requirements

The extension must run inside Herdr 0.7.5 (`HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, and `HERDR_PANE_ID`). Before the first run, install Pi's Herdr detection manifest once per machine:

```sh
herdr integration install pi
herdr integration status
```

Runs use `herdr pane split --current --direction right --cwd <cwd> --no-focus`, so the caller keeps focus while each agent runs in a sibling pane in the current tab. Outside Herdr, or without `HERDR_PANE_ID`, the tools fail with a clear error and `/agents` reports Herdr as unavailable. There is no in-process or Pi fallback.

## Usage

```json
{
  "prompt": "Find the authentication entry points and summarize them.",
  "description": "Map authentication",
  "subagent_type": "Explore",
  "run_in_background": true
}
```

Use `get_subagent_result` with the returned `agent_id`, and `steer_subagent` to send a new prompt. `kind` optionally overrides the definition's Herdr kind for one call. `resume` retains the original run ID, opens a fresh sibling pane in the current tab, and prepends the previous result to the new prompt. `inherit_context` prepends readable, image-free parent Markdown capped at 50 KiB. Foreground runs stream live Herdr terminal snapshots through Pi tool progress updates; background calls return immediately, so their original tool callback cannot receive later updates.

Background runs retain FIFO scheduling and smart joins. `maxConcurrent` limits background runs; foreground runs remain interactive and are not queued behind them. Status metadata reports Herdr prompt count (`prompts`), not internal LLM turns. Results are delimited, read from the settled Herdr agent, capped at 50 KiB, and only the owned sibling pane is closed after success, failure, abort, or timeout; the caller's parent pane and tab are never closed. The default timeout is 1,800,000 ms; `runTimeoutMs: 0` disables it. On incomplete Pi terminal output the agent is asked to write Markdown to a temporary path; native kinds use their raw terminal output because their tool capabilities are not portable. Approval/question states are returned as `blocked`, include the run ID, notify the parent, and remain open for inspection or steering. Completed history is capped by `maxHistory` (100 by default).

Herdr subagents run as long-lived interactive agents. Herdr submits work through `agent prompt` and observes completion through `agent wait`, so the extension deliberately does not start Pi with `--print`. Print mode exits when no startup prompt is supplied and would release the Herdr agent name before the task was submitted.

## Agent definitions

Global definitions live in `~/.pi/agent/agents/*.md`; trusted project definitions live in the nearest `.pi/agents/*.md` and override defaults. Built-ins are defined in [`src/builtins.ts`](src/builtins.ts), and all default to Herdr's `pi` kind.

```md
---
name: reviewer
display_name: Reviewer
description: Reviews focused changes.
kind: pi
model: provider/model
thinking: medium
tools: read, grep, find, ls
enabled: true
---
Inspect the change and report actionable findings.
```

`kind` accepts every installed Herdr 0.7.5 kind: `pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, and `maki`. Optional frontmatter `args` is a string array. For the definition's default kind, those arguments are passed unchanged for native Herdr kinds; a per-call kind override ignores definition args. Pi receives safe generated flags for model, thinking, tools, isolation, session, and system prompt, and rejects definition args that conflict with those managed flags. Non-Pi kinds receive their explicit args and the definition instructions in the submitted task prompt.

Project definitions remain subject to Pi project trust and one-time approval. `/agents` can inspect live and blocked runs (Focus, Read, Steer, Stop), view/resume/remove completed records, create definitions with a kind selector, configure Pi models, and migrate settings. The creation wizard asks for tools and model only for `kind: pi`; other kinds accept native arguments as a JSON string array. Approval can be explicitly re-confirmed after a previous denial or revoke.

### Default agent catalog

The extension includes a focused five-agent catalog in [`src/builtins.ts`](src/builtins.ts). Definitions use the parent model by default. Read-only roles do not receive `edit` or `write`, while implementation roles receive the full built-in tool set.

| Agent | Best use |
| --- | --- |
| `general-purpose` | Default coding or research fallback |
| `Explore` | Read-only repository reconnaissance |
| `Plan` | Ordered plans for multi-file work |
| `implementer` | Focused implementation and verification |
| `reviewer` | Independent read-only code review |

Every built-in prompt tells the agent what to inspect first, what it may change, how to verify the work, and what to include in its final report. Choose a specialist for its named job, use `Explore` or `Plan` before uncertain work, and use `general-purpose` only when no specialist fits.

## Settings

Global settings are `~/.pi/agent/subagents.json`; project settings are `.pi/subagents.json`. Version 2 settings are:

```json
{
  "version": 2,
  "maxConcurrent": 4,
  "maxHistory": 100,
  "joinMode": "smart",
  "groupTimeoutMs": 30000,
  "allowCallerModelOverride": true,
  "runTimeoutMs": 1800000,
  "agentModels": {}
}
```

Version 1 files retain relevant values, drop `defaultMaxTurns` and `graceTurns`, and are written as version 2. Model precedence remains caller override (when enabled), settings, definition, parent/default. Timeout values are milliseconds; `/agents` displays friendly duration equivalents.

## Development

```sh
npm install
npm run typecheck
npm test
```

Development requires Node.js 22.19.0 or newer. The repository includes `.nvmrc` and checks the runtime before typechecking or testing.
