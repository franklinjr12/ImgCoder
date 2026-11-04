/**
 * Snapshot-based undo/redo. States are immutable values (structural sharing keeps snapshots
 * cheap). Consecutive pushes with the same `coalesce` key within `windowMs` merge into one
 * entry (typing in a field, nudging with arrow keys, dragging a slider).
 */
export interface HistoryPushOptions {
  coalesce?: string;
  label?: string;
}

export class History<T> {
  private past: { state: T; label?: string }[] = [];
  private future: { state: T; label?: string }[] = [];
  private lastKey: string | undefined;
  private lastTime = 0;

  constructor(
    private present: T,
    private limit = 200,
    private windowMs = 800,
    private now: () => number = () => Date.now(),
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  get size(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }

  /** Record a new state. Returns false when it equals the present (no-op). */
  push(next: T, opts: HistoryPushOptions = {}): boolean {
    if (Object.is(next, this.present)) return false;
    const t = this.now();
    const merge = !!opts.coalesce && opts.coalesce === this.lastKey && t - this.lastTime < this.windowMs && this.past.length > 0;
    if (!merge) {
      this.past.push({ state: this.present, label: opts.label });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = next;
    this.future = [];
    this.lastKey = opts.coalesce;
    this.lastTime = t;
    return true;
  }

  /** Replace the present without creating an entry (e.g. transient previews). */
  replace(next: T): void {
    this.present = next;
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ state: this.present, label: prev.label });
    this.present = prev.state;
    this.lastKey = undefined;
    return this.present;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ state: this.present, label: next.label });
    this.present = next.state;
    this.lastKey = undefined;
    return this.present;
  }

  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.present = state;
    this.lastKey = undefined;
  }

  /** Break coalescing so the next push starts a new entry. */
  seal(): void {
    this.lastKey = undefined;
  }
}
