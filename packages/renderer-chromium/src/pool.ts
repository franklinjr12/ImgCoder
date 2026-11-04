/**
 * Tiny concurrency-safe resource pool (acquire / release with a FIFO wait queue).
 * Resources are created lazily up to `size`; `prefer` lets callers pick an idle resource
 * that is already configured the way they need (e.g. same device scale factor).
 */
export interface PoolStats {
  size: number;
  created: number;
  idle: number;
  busy: number;
  waiting: number;
  acquisitions: number;
}

interface Waiter<T> {
  prefer?: (item: T) => boolean;
  resolve: (item: T) => void;
  reject: (err: Error) => void;
}

export class Pool<T> {
  private idle: T[] = [];
  private busy = new Set<T>();
  private waiters: Waiter<T>[] = [];
  private creating = 0;
  private closed = false;
  private acquisitions = 0;

  constructor(
    readonly size: number,
    private readonly factory: () => Promise<T>,
    private readonly destroyer: (item: T) => Promise<void> = async () => {},
  ) {
    if (!(size >= 1)) throw new Error('Pool size must be >= 1');
  }

  get stats(): PoolStats {
    return { size: this.size, created: this.idle.length + this.busy.size, idle: this.idle.length, busy: this.busy.size, waiting: this.waiters.length, acquisitions: this.acquisitions };
  }

  private get total(): number {
    return this.idle.length + this.busy.size + this.creating;
  }

  /** Create resources up to `count` (pre-warming). */
  async warm(count = this.size): Promise<void> {
    const n = Math.min(count, this.size) - this.total;
    const made = await Promise.all(Array.from({ length: Math.max(0, n) }, () => this.create()));
    for (const item of made) this.hand(item);
  }

  private async create(): Promise<T> {
    this.creating++;
    try {
      return await this.factory();
    } finally {
      this.creating--;
    }
  }

  /** Give an available item to the first waiter, or park it as idle. */
  private hand(item: T): void {
    if (this.closed) {
      void this.destroyer(item).catch(() => {});
      return;
    }
    if (this.waiters.length) {
      const i = Math.max(0, this.waiters.findIndex((w) => w.prefer?.(item)));
      const [w] = this.waiters.splice(i, 1);
      this.busy.add(item);
      this.acquisitions++;
      w.resolve(item);
      return;
    }
    this.idle.push(item);
  }

  acquire(prefer?: (item: T) => boolean): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Pool is closed'));
    if (this.idle.length) {
      let i = prefer ? this.idle.findIndex(prefer) : -1;
      if (i < 0) i = this.idle.length - 1;
      const [item] = this.idle.splice(i, 1);
      this.busy.add(item);
      this.acquisitions++;
      return Promise.resolve(item);
    }
    const p = new Promise<T>((resolve, reject) => this.waiters.push({ prefer, resolve, reject }));
    if (this.total < this.size) {
      this.create().then(
        (item) => this.hand(item),
        (err) => {
          const w = this.waiters.shift();
          w?.reject(err);
        },
      );
    }
    return p;
  }

  /** Return an item. Pass `broken` to destroy it (a replacement is created on demand). */
  release(item: T, broken = false): void {
    if (!this.busy.delete(item)) return;
    if (broken) {
      void this.destroyer(item).catch(() => {});
      if (this.waiters.length && !this.closed) {
        this.create().then(
          (n) => this.hand(n),
          (err) => this.waiters.shift()?.reject(err),
        );
      }
      return;
    }
    this.hand(item);
  }

  /** Run `fn` with a pooled item, releasing it afterwards (destroying it if `fn` throws and `isBroken` says so). */
  async use<R>(fn: (item: T) => Promise<R>, opts: { prefer?: (item: T) => boolean; isBroken?: (err: unknown, item: T) => boolean } = {}): Promise<R> {
    const item = await this.acquire(opts.prefer);
    let broken = false;
    try {
      return await fn(item);
    } catch (e) {
      broken = opts.isBroken?.(e, item) ?? false;
      throw e;
    } finally {
      this.release(item, broken);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w.reject(new Error('Pool is closed'));
    const all = [...this.idle, ...this.busy];
    this.idle = [];
    this.busy.clear();
    await Promise.all(all.map((i) => this.destroyer(i).catch(() => {})));
  }
}
