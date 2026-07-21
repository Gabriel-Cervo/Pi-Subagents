export interface TurnPolicyState { wrapUpSent: boolean; abortRequested: boolean; }
export type TurnPolicyAction = "steer" | "abort" | "none";

/** max=0 means unlimited. The wrap-up instruction is emitted at the limit once. */
export function applyTurnPolicy(state: TurnPolicyState, turns: number, max: number, graceTurns: number): TurnPolicyAction[] {
  if (max === 0 || state.abortRequested) return [];
  const actions: TurnPolicyAction[] = [];
  if (!state.wrapUpSent && turns >= max) {
    state.wrapUpSent = true;
    actions.push("steer");
  }
  if (state.wrapUpSent && turns >= max + Math.max(0, graceTurns)) {
    state.abortRequested = true;
    actions.push("abort");
  }
  return actions;
}
