/** Minimal TTY progress bar with per-item timing (no dependencies). */
export class ProgressBar {
  private lastLen = 0;
  constructor(private total: number, private stream: NodeJS.WriteStream = process.stderr) {}

  update(done: number, failed: number, label: string, elapsedMs: number, etaMs: number): void {
    const width = 28;
    const ratio = this.total ? done / this.total : 1;
    const filled = Math.round(ratio * width);
    const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
    const line = `${bar} ${done}/${this.total} ${failed ? `\x1b[31m${failed} failed\x1b[0m ` : ''}${fmtMs(elapsedMs)} elapsed, eta ${fmtMs(etaMs)}  ${label}`;
    if (this.stream.isTTY) {
      this.stream.write(`\r${line.padEnd(this.lastLen)}`);
      this.lastLen = line.length;
    } else this.stream.write(`${line}\n`);
  }

  log(msg: string): void {
    if (this.stream.isTTY) this.stream.write(`\r${' '.repeat(this.lastLen)}\r`);
    this.stream.write(`${msg}\n`);
  }

  finish(): void {
    if (this.stream.isTTY) this.stream.write('\n');
  }
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
