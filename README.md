# Pi Subagents

Pi Subagents adds native, in-process delegation to [Pi](https://github.com/earendil-works/pi). It exposes three tools, `Agent`, `get_subagent_result`, and `steer_subagent`, plus an `/agents` configuration menu.

## Install

From GitHub:

```sh
pi install git:github.com/Gabriel-Cervo/Pi-Subagents
```

From a checkout:

```sh
pi install /Users/gabrielcervo/Documents/projects/Pi-Subagents
# or, from the checkout:
pi install .
```

The package is loaded directly from `src/index.ts`. Pi supplies the peer dependencies at runtime.

## Architecture

Each child uses Pi's SDK `createAgentSession` with `SessionManager.inMemory()` and the parent registry's live `ModelRuntime` when available. The resolved Model object is retained and passed directly to the child, including dynamically registered/custom-provider models. Children run in the same Node process. They don't load extensions, skills, prompt templates, themes, or context files. Their resource loader supplies only a short isolated system prompt. Their tool allowlist contains only validated built-in tools.

The manager keeps session-local run records. It owns a FIFO queue, default concurrency of four, abort controllers, child-session disposal, result promises, and partial output. A background call returns immediately with a run id. `get_subagent_result` awaits that run's promise instead of polling. `steer_subagent` works while a child is queued or running. A steer received before initialization is attached to the first prompt.

Foreground calls stream text updates through Pi's tool update API. Results are capped at 50 KiB for model-visible output. Full lifecycle state is kept only in memory. Session replacement, reload, and shutdown abort queued and running work and dispose child sessions.

## Usage

Ask Pi to use an agent, or call the tools directly:

```json
{
  "prompt": "Find the authentication entry points and summarize them.",
  "description": "Map authentication",
  "subagent_type": "Explore",
  "run_in_background": true,
  "inherit_context": false
}
```

Then call `get_subagent_result` with the returned `agent_id` (optionally `wait` and `verbose`). Use `steer_subagent` with `agent_id` and `message` to add an instruction. `inherit_context` is opt-in. When enabled, Pi copies a defensive snapshot of the parent message context into the child. Mutable parent state is never shared.

Run `/agents` to manage:

- Active and recent runs. View, steer, or stop them.
- Agents, their source, enabled state, effective model, and tools.
- Create a new agent through a guided wizard: name, description, functionality/instructions, tool selection, model, and project/global source.
- Per-agent model selection.
- Project-agent approval and revocation.
- Definition reloads.

Agents created from the menu are written immediately to `.pi/agents/<name>.md` for project scope or `~/.pi/agent/agents/<name>.md` for global scope, then dynamically reloaded. Choosing `Inherit parent model` omits the model pin so future runs follow the current parent model.

The model picker includes `Inherit/default` and authenticated models known by Pi's registry. Changes affect future runs. A resumed run keeps its original model and thinking configuration.

## Built-in agent types

| Name | Purpose | Tools | Default model |
| --- | --- | --- | --- |
| `general-purpose` | General coding and research | all seven | parent model |
| `Explore` | Read-only reconnaissance | `read`, `grep`, `find`, `ls` | parent model |
| `Plan` | Actionable planning | `read`, `grep`, `find`, `ls` | parent model |
| `implementer` | Implement code and tests, then verify | all seven | parent model |

The implementer is instructed to inspect before editing, make focused changes, run relevant checks, and report changed files and tests.

## Agent files

Global definitions live in `~/.pi/agent/agents/*.md`. The nearest trusted project's `.pi/agents/*.md` directory is also supported. Project definitions override global and default definitions with the same name.

```md
---
name: reviewer
display_name: Reviewer
description: Reviews focused changes for correctness and tests.
tools: read, grep, find, ls, bash
model: openai-codex/gpt-5.6-luna
thinking: medium
max_turns: 8
enabled: true
---
Inspect the change, identify concrete problems, and report paths and tests. Do not edit files.
```

Supported frontmatter fields are `description`, `display_name`, `tools`, `model`, `thinking`, `max_turns`, and `enabled`. The body becomes the system prompt. Unknown legacy fields produce a warning once per parent session. Invalid or unsupported tools are ignored rather than granted.

Project agents are untrusted code-adjacent configuration. Pi project trust is required. Interactive use asks once before the first project agent runs. Headless use errors instead of silently approving project prompts.

## Model precedence

For a new run, the precedence is:

1. Caller `Agent.model`, only when `allowCallerModelOverride` is true.
2. Session override.
3. Project `agentModels` entry.
4. Global `agentModels` entry.
5. Agent-file `model`.
6. Parent model.
7. The first authenticated model in Pi's registry.

Explicit model choices must use canonical `provider/model` syntax and must resolve through Pi's model registry. Unresolved choices fail with an actionable error. There is no silent fallback for an explicit choice. Resuming a run rejects conflicting model or thinking overrides.

## Smart join

`joinMode` defaults to `smart`. Pi's `turn_start` and `turn_end` events define a group, so background agents launched in one parent turn do not rely on a debounce timer. For groups with at least two runs, the manager waits for the first completed batch for up to `groupTimeoutMs`. If all finish, Pi receives one concise plain-text follow-up. On timeout, completed runs are delivered together and later stragglers are delivered separately. `async` delivers each background result separately.

There is one join timer per smart group. The extension does not schedule work, create a FleetView, keep a live widget, write transcripts, or emulate Claude XML notifications.

## Settings

Settings are versioned JSON. Global settings are stored at `~/.pi/agent/subagents.json`. Project settings are stored at `<cwd>/.pi/subagents.json`. Global values merge first. Project values override them. Session overrides are in memory and override both. Writes are atomic and preserve unknown keys where practical.

```json
{
  "version": 1,
  "maxConcurrent": 4,
  "joinMode": "smart",
  "groupTimeoutMs": 30000,
  "allowCallerModelOverride": false,
  "defaultMaxTurns": 12,
  "graceTurns": 2,
  "agentModels": {
    "Explore": "openai-codex/gpt-5.6-luna",
    "Plan": "openai-codex/gpt-5.6-sol",
    "implementer": "openai-codex/gpt-5.6-luna"
  }
}
```

`defaultMaxTurns` and `max_turns` use `0` for unlimited. At the limit, the child receives one wrap-up steer, then gets `graceTurns` additional turns before abort and partial-result return. `maxConcurrent` is bounded to a safe positive range. `/agents` mutations can be persisted globally or to the project. Session-only model changes are not written to disk.

## Security and trust

Pi extensions run with the host process's permissions. Review this package before installing it. Child agents can use the built-in tools allowed by their definition, including `bash`, `write`, and `edit` when enabled. Project agent files are repository-controlled prompts and require trust plus approval. The package never loads child extensions, skills, prompts, themes, or context files.

## Migration from `@tintinweb/pi-subagents`

This package intentionally uses Pi's in-process SDK instead of spawning `pi --mode json` subprocesses. Existing files can be reused after converting their frontmatter to the format above. The old `subagent` tool is not registered. This replacement intentionally preserves the `Agent`, `get_subagent_result`, and `steer_subagent` argument compatibility of `@tintinweb/pi-subagents`: use `Agent` with `prompt`, required `description` and `subagent_type`, then use `get_subagent_result` with `agent_id` and `steer_subagent` with `agent_id` plus `message`. Parallel and chain workflows should be expressed as separate `Agent` calls. This keeps queueing, resume, steering, and model selection session-local.

## Limitations

- Child sessions are in-memory and are not resumable across Pi process restarts.
- Run records are session-local and are cleared on reload or replacement.
- This package does not provide worktrees, scheduling, persistent memory, transcripts, cross-extension RPC, or a live dashboard.
- Child output is intentionally truncated before it is returned to the model.
- Project agent approval is not available in headless mode.

## Development

```sh
npm install
npm run typecheck
npm test
```

The implementation is split between discovery (`src/discovery.ts`), settings (`src/settings.ts`), model resolution (`src/models.ts`), lifecycle and queue management (`src/manager.ts`), and the Pi extension entry point (`src/index.ts`).

## Sources

- [Pi SDK documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/sdk.md)
- [Pi extension documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/extensions.md)
- [Pi package documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/packages.md)
