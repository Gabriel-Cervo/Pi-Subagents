# Pi Subagents

Pi Subagents delegates work to [Herdr](https://herdr.dev), keeping one isolated, unfocused Herdr tab per run in the parent workspace. It exposes `Agent`, `get_subagent_result`, `steer_subagent`, and `/agents`.

## Requirements

The extension must run inside Herdr 0.7.5 (`HERDR_ENV=1` and `HERDR_WORKSPACE_ID`). Outside Herdr, the tools fail with a clear error and `/agents` reports Herdr as unavailable. There is no in-process or Pi fallback.

## Usage

```json
{
  "prompt": "Find the authentication entry points and summarize them.",
  "description": "Map authentication",
  "subagent_type": "Explore",
  "run_in_background": true
}
```

Use `get_subagent_result` with the returned `agent_id`, and `steer_subagent` to send a new prompt. `kind` optionally overrides the definition's Herdr kind for one call. `resume` retains the original run ID, opens a fresh tab, and prepends the previous result to the new prompt. `inherit_context` prepends readable, image-free parent Markdown capped at 50 KiB.

Background runs retain FIFO scheduling and smart joins. Status metadata reports Herdr prompt count (`prompts`), not internal LLM turns. Results are delimited, read from the settled Herdr agent, capped at 50 KiB, and the owned tab is closed after success, failure, abort, or timeout. The default timeout is 1,800,000 ms; `runTimeoutMs: 0` disables it. On incomplete terminal output the agent is asked to write Markdown to a temporary path. Approval/question states are returned as `blocked`, notified to the parent, and left open for inspection or steering.

## Agent definitions

Global definitions live in `~/.pi/agent/agents/*.md`; trusted project definitions live in the nearest `.pi/agents/*.md` and override defaults. Built-ins are `general-purpose`, `Explore`, `Plan`, and `implementer`, all defaulting to Herdr's `pi` kind.

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
