import type { LogLine } from '@spark/shared';
import { AnsiUp } from 'ansi_up';

export interface RenderedLogLine extends LogLine {
  id: number;
  html: string;
}

/** Convert each incoming line once, and bound both pending and displayed history. */
export class LogViewBuffer {
  private ansi = new AnsiUp();
  private pending: RenderedLogLine[] = [];
  private sequence = 0;

  constructor(private readonly maxLines = 5000) {}

  append(line: LogLine): void {
    this.pending.push({ ...line, id: this.sequence++, html: this.ansi.ansi_to_html(line.line) });
    if (this.pending.length > this.maxLines) this.pending.splice(0, this.pending.length - this.maxLines);
  }

  flush(previous: RenderedLogLine[]): RenderedLogLine[] {
    if (!this.pending.length) return previous;
    const result = previous.concat(this.pending).slice(-this.maxLines);
    this.pending = [];
    return result;
  }

  clear(): void {
    this.pending = [];
    this.ansi = new AnsiUp();
  }
}
