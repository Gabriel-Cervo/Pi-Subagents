# Herdr Subagents

Herdr Subagents delegates work to [Herdr](https://herdr.dev), keeping one unfocused sibling pane per run in the caller's current tab. It exposes `Agent`, `get_subagent_result`, `steer_subagent`, and `/agents`.

## Requirements

The extension must run inside Herdr 0.7.5 (`HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, and `HERDR_PANE_ID`). Runs use `herdr pane split --current --direction right --cwd <cwd> --no-focus`, so the caller keeps focus while each agent runs in a sibling pane in the current tab. Outside Herdr, or without `HERDR_PANE_ID`, the tools fail with a clear error and `/agents` reports Herdr as unavailable. There is no in-process or Pi fallback.

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

Background runs retain FIFO scheduling and smart joins. Status metadata reports Herdr prompt count (`prompts`), not internal LLM turns. Results are delimited, read from the settled Herdr agent, capped at 50 KiB, and only the owned sibling pane is closed after success, failure, abort, or timeout; the caller's parent pane and tab are never closed. The default timeout is 1,800,000 ms; `runTimeoutMs: 0` disables it. On incomplete terminal output the agent is asked to write Markdown to a temporary path. Approval/question states are returned as `blocked`, notified to the parent, and left open for inspection or steering.

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

`kind` accepts every installed Herdr 0.7.5 kind: `pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, and `maki`. Optional frontmatter `args` is a string array. For the definition's default kind, those arguments are passed unchanged. A per-call kind override ignores definition args. Pi receives safe generated flags for model, thinking, tools, isolation, and system prompt; non-Pi kinds receive only explicit definition args.

Project definitions remain subject to Pi project trust and one-time approval. `/agents` can inspect live and blocked runs (Focus, Read, Steer, Stop), view/resume/remove completed records, create definitions with a kind selector, configure Pi models, and migrate settings. The creation wizard asks for tools and model only for `kind: pi`; other kinds use their explicit args.

### Default agent catalog

The extension includes a broad, focused catalog in [`src/builtins.ts`](src/builtins.ts). Definitions use the parent model by default. Read-only roles do not receive `edit` or `write`, while implementation roles receive the full built-in tool set.

| Agent | Best use |
| --- | --- |
| `general-purpose` | Default coding or research fallback |
| `Explore` | Read-only repository reconnaissance |
| `Plan` | Ordered plans for multi-file work |
| `implementer` | Focused implementation and verification |
| `debugger` | Reproducing failures and fixing root causes |
| `reviewer` | Independent read-only code review |
| `test-engineer` | Test design, implementation, and coverage gaps |
| `refactorer` | Behavior-preserving structural changes |
| `architect` | System boundaries and design trade-offs |
| `frontend-engineer` | UI components, styling, and interaction states |
| `ux-designer` | User flows, interface requirements, and acceptance criteria |
| `backend-engineer` | Services, business logic, and integrations |
| `api-designer` | API and event contract design |
| `security-auditor` | Threat modeling and vulnerability review |
| `performance-engineer` | Evidence-based latency, memory, and scale work |
| `accessibility-auditor` | Keyboard, screen-reader, and inclusive UI audits |
| `docs-writer` | README, guides, API docs, and runbooks |
| `devops-engineer` | CI, deployment, packaging, and observability |
| `data-engineer` | Schemas, queries, pipelines, and data quality |
| `migration-engineer` | Version, schema, and compatibility migrations |
| `release-engineer` | Release readiness, versioning, and rollback checks |
| `researcher` | Evidence gathering about code and dependencies |
| `product-analyst` | Requirements, edge cases, and acceptance criteria |

Every built-in prompt tells the agent what to inspect first, what it may change, how to verify the work, and what to include in its final report. Choose a specialist for its named job, use `Explore` or `Plan` before uncertain work, and use `general-purpose` only when no specialist fits.

## Settings

Global settings are `~/.pi/agent/subagents.json`; project settings are `.pi/subagents.json`. Version 2 settings are:

```json
{
  "version": 2,
  "maxConcurrent": 4,
  "joinMode": "smart",
  "groupTimeoutMs": 30000,
  "allowCallerModelOverride": true,
  "runTimeoutMs": 1800000,
  "agentModels": {}
}
```

Version 1 files retain relevant values, drop `defaultMaxTurns` and `graceTurns`, and are written as version 2. Model precedence remains caller override (when enabled), settings, definition, parent/default.

## Development

```sh
npm install
npm run typecheck
npm test
```
