import { test, expect } from "vitest";
import { applyTurnPolicy } from "../src/turn-policy.ts";

test("turn policy steers once, grants grace, then aborts", () => {
  const state = { wrapUpSent: false, abortRequested: false };
  expect(applyTurnPolicy(state, 3, 3, 2)).toEqual(["steer"]);
  expect(applyTurnPolicy(state, 4, 3, 2)).toEqual([]);
  expect(applyTurnPolicy(state, 5, 3, 2)).toEqual(["abort"]);
  expect(applyTurnPolicy(state, 6, 3, 2)).toEqual([]);
});
test("zero means unlimited", () => {
  const state = { wrapUpSent: false, abortRequested: false };
  expect(applyTurnPolicy(state, 1000, 0, 0)).toEqual([]);
});
