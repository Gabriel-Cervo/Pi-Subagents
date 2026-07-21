import { test, expect, vi, afterEach } from "vitest";
import { BoundedScheduler, FifoQueue, SmartJoinCoordinator, completedBatch, shouldJoin } from "../src/scheduler.ts";

test("queue is FIFO", () => {
  const queue = new FifoQueue<number>(); queue.push(1); queue.push(2); queue.push(3);
  expect(queue.shift()).toBe(1); expect(queue.shift()).toBe(2); expect(queue.length).toBe(1);
});
test("background scheduler is bounded FIFO while foreground bypasses it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = new BoundedScheduler<number>(() => 1);
  const started: number[] = [];
  scheduler.enqueue(1, async () => { started.push(1); await gate; });
  scheduler.enqueue(2, async () => { started.push(2); });
  await vi.waitFor(() => expect(started).toEqual([1]));
  await scheduler.runForeground(async () => { started.push(99); });
  expect(started).toEqual([1, 99]);
  release(); await vi.waitFor(() => expect(started).toEqual([1, 99, 2]));
});
test("smart join waits for a parent turn and can deliver a partial batch", () => {
  const batch = { id: "t", runIds: ["a", "b", "c"], ended: false };
  expect(shouldJoin(batch, new Set(["a"]), "smart")).toBe(false);
  batch.ended = true;
  expect(shouldJoin(batch, new Set(["a"]), "smart")).toBe(true);
  expect(completedBatch(batch, new Set(["a", "c"]))).toEqual(["a", "c"]);
  expect(shouldJoin(batch, new Set(["a"]), "async")).toBe(false);
});

afterEach(() => vi.useRealTimers());
test("smart join notifies a solo run after the turn", () => {
  const events: unknown[] = []; const join = new SmartJoinCoordinator(30, (event) => events.push(event));
  join.add("a"); join.complete("a"); expect(events).toEqual([]); join.end();
  expect(events).toEqual([{ type: "individual", ids: ["a"] }]);
});
test("smart join delivers all complete members immediately", () => {
  const events: unknown[] = []; const join = new SmartJoinCoordinator(30, (event) => events.push(event));
  join.add("a"); join.add("b"); join.complete("a"); join.complete("b");
  expect(events).toEqual([{ type: "batch", ids: ["a", "b"] }]);
});
test("smart join starts timeout only after first completion and sends stragglers alone", () => {
  vi.useFakeTimers(); const events: unknown[] = []; const join = new SmartJoinCoordinator(30, (event) => events.push(event));
  join.add("a"); join.add("b"); join.add("c"); join.end(); vi.advanceTimersByTime(100); expect(events).toEqual([]);
  join.complete("a"); vi.advanceTimersByTime(29); expect(events).toEqual([]); vi.advanceTimersByTime(1);
  expect(events).toEqual([{ type: "batch", ids: ["a"] }]); join.complete("b");
  expect(events).toEqual([{ type: "batch", ids: ["a"] }, { type: "individual", ids: ["b"] }]);
});
