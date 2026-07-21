import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition, Settings } from "./types.ts";

export function modelKey(model: Model<any> | undefined): string | undefined { return model ? `${model.provider}/${model.id}` : undefined; }

export function resolveModelSpec(spec: string, ctx: ExtensionContext): Model<any> {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`Model '${spec}' must use canonical provider/model syntax.`);
  const model = ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
  if (!model) throw new Error(`Model '${spec}' is not registered. Choose an available authenticated model or Inherit/default.`);
  return model;
}

function configuredModel(settings: Settings, name: string): string | undefined {
  const key = Object.keys(settings.agentModels).find((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase());
  return key ? settings.agentModels[key] || undefined : undefined;
}

export function resolveAgentModel(def: AgentDefinition, settings: Settings, ctx: ExtensionContext, caller?: string, allowCaller = false): { model: Model<any>; source: string } {
  if (caller && !allowCaller) throw new Error("Agent.model caller override is disabled by allowCallerModelOverride.");
  const configured = configuredModel(settings, def.name);
  const spec = caller && allowCaller ? caller : configured ?? def.model;
  if (spec) return { model: resolveModelSpec(spec, ctx), source: caller && allowCaller ? "caller" : configured ? "settings" : "definition" };
  if (ctx.model) return { model: ctx.model, source: "parent" };
  const available = ctx.modelRegistry.getAvailable()[0];
  if (available) return { model: available, source: "available" };
  throw new Error(`No model configured for agent '${def.name}'. Configure one in /agents or select an authenticated model.`);
}

export function precedence(def: AgentDefinition, settings: Settings, parent: string | undefined, caller: string | undefined, allowCaller: boolean): string {
  if (caller && !allowCaller) throw new Error("Agent.model caller override is disabled by allowCallerModelOverride.");
  const configured = configuredModel(settings, def.name);
  return caller && allowCaller ? caller : configured ?? def.model ?? parent ?? "available authenticated model";
}
