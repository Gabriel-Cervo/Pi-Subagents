/** Small, deterministic FIFO queue used by the background scheduler. */
export class FifoQueue<T> {
  private items: T[] = [];
  push(item: T): void { this.items.push(item); }
  shift(): T | undefined { return this.items.shift(); }
  get length(): number { return this.items.length; }
  clear(): T[] { const items = this.items; this.items = []; return items; }
}

export interface SchedulerSnapshot { active: number; queued: number; }

/**
 * Bounded FIFO work scheduler. Foreground work intentionally does not use this
 * class: callers invoke runForeground directly and therefore cannot be delayed
 * behind background work.
 */
export class BoundedScheduler<T> {
  private readonly queue = new FifoQueue<{ item: T; run: () => Promise<void> }>();
  private activeCount = 0;
  private pumping = false;
  private disposed = false;
  constructor(private readonly limit: () => number) {}

  enqueue(item: T, run: () => Promise<void>): void {
    if (this.disposed) throw new Error("Scheduler is disposed.");
    this.queue.push({ item, run });
    void this.pump();
  }

  async runForeground(run: () => Promise<void>): Promise<void> { await run(); }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.disposed && this.activeCount < Math.max(1, this.limit()) && this.queue.length) {
        const work = this.queue.shift()!;
        this.activeCount++;
        void work.run().catch(() => undefined).finally(() => {
          this.activeCount--;
          void this.pump();
        });
      }
    } finally { this.pumping = false; }
  }

  remove(item: T): boolean {
    // Rebuild without exposing queue internals; this is only used for aborting queued records.
    const kept: Array<{ item: T; run: () => Promise<void> }> = [];
    let removed = false;
    let next: { item: T; run: () => Promise<void> } | undefined;
    while ((next = this.queue.shift())) {
      if (next.item === item && !removed) removed = true;
      else kept.push(next);
    }
    for (const value of kept) this.queue.push(value);
    void this.pump();
    return removed;
  }

  snapshot(): SchedulerSnapshot { return { active: this.activeCount, queued: this.queue.length }; }
  dispose(): T[] { this.disposed = true; return this.queue.clear().map((work) => work.item); }
}

export type JoinNotification = { type: "batch"; ids: string[] } | { type: "individual"; ids: string[] };
/** Pure timer/state coordinator used to keep smart-join transitions testable. */
export class SmartJoinCoordinator {
  private readonly runs = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly delivered = new Set<string>();
  private ended = false;
  private timedOut = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  constructor(private readonly timeoutMs: number, private readonly emit: (notification: JoinNotification) => void) {}
  add(id: string): void { if (this.disposed) return; this.runs.add(id); this.maybeStartTimer(); }
  end(): void { if (this.disposed) return; this.ended = true; this.flushSolo(); this.maybeStartTimer(); this.flushAll(); }
  complete(id: string): void { if (this.disposed) return; if (!this.runs.has(id)) this.runs.add(id); this.completed.add(id); if (this.timedOut) { this.delivered.add(id); this.emit({ type: "individual", ids: [id] }); return; } this.flushSolo(); this.maybeStartTimer(); this.flushAll(); }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private maybeStartTimer(): void { if (!this.disposed && this.runs.size >= 2 && this.completed.size && !this.timer && !this.timedOut) this.timer = setTimeout(() => { this.timer = undefined; this.timedOut = true; this.emitBatch(); }, Math.max(0, this.timeoutMs)); }
  private flushSolo(): void { if (!this.disposed && this.runs.size === 1 && this.ended) for (const id of this.completed) if (!this.delivered.has(id)) { this.delivered.add(id); this.emit({ type: "individual", ids: [id] }); } }
  private flushAll(): void { if (!this.disposed && !this.timedOut && this.runs.size >= 2 && this.runs.size === this.completed.size) { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.emitBatch(); } }
  private emitBatch(): void { if (this.disposed) return; const ids = [...this.completed].filter((id) => !this.delivered.has(id)); if (!ids.length) return; ids.forEach((id) => this.delivered.add(id)); this.emit({ type: "batch", ids }); }
}

export interface JoinBatch { id: string; runIds: string[]; ended: boolean; }
export function shouldJoin(batch: JoinBatch, completed: Set<string>, mode: "async" | "smart"): boolean {
  return mode === "smart" && batch.ended && batch.runIds.length >= 2 && batch.runIds.some((id) => completed.has(id));
}
export function completedBatch(batch: JoinBatch, completed: Set<string>): string[] { return batch.runIds.filter((id) => completed.has(id)); }
