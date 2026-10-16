import type { LogLine } from '@spark/shared';

const MAX_LINE_LENGTH = 8000;

/**
 * 每个项目的环形日志缓冲:
 * - data 事件可能在行中间截断,按 \n 拼接后再入缓冲
 * - 超过 maxLines 时丢弃最旧的行
 * - 新日志写入缓冲的同时广播给订阅者(SSE)
 */
export class LogBufferManager {
  private buffers = new Map<string, LogLine[]>();
  /** 行拼接的残留(按流区分,stdout/stderr 各自独立) */
  private partials = new Map<string, { stdout: string; stderr: string }>();
  private subscribers = new Map<string, Set<(line: LogLine) => void>>();
  private maxLines: number;

  constructor(maxLines = 5000) {
    this.maxLines = maxLines;
  }

  setMaxLines(n: number): void {
    this.maxLines = n;
    for (const [id, buf] of this.buffers) {
      if (buf.length > n) this.buffers.set(id, buf.slice(buf.length - n));
    }
  }

  private bufferFor(id: string): LogLine[] {
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    return buf;
  }

  /** 收到一块原始输出:按 \n 切分成完整行后入缓冲 */
  appendChunk(id: string, chunk: string, stream: LogLine['stream']): void {
    const partial = this.partials.get(id) ?? { stdout: '', stderr: '' };
    let rest = (partial[stream] ?? '') + chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = rest.indexOf('\n')) >= 0) {
      lines.push(rest.slice(0, idx));
      rest = rest.slice(idx + 1);
    }
    this.partials.set(id, { ...partial, [stream]: rest });
    for (const line of lines) this.pushLine(id, line, stream);
  }

  pushLine(id: string, raw: string, stream: LogLine['stream']): void {
    const line =
      raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + ' …[单行超长已截断]' : raw.replace(/\r$/, '');
    const entry: LogLine = { line, ts: Date.now(), stream };
    const buf = this.bufferFor(id);
    buf.push(entry);
    if (buf.length > this.maxLines) buf.splice(0, buf.length - this.maxLines);
    for (const fn of this.subscribers.get(id) ?? []) {
      try {
        fn(entry);
      } catch {
        /* 单个订阅者异常不影响其他订阅者 */
      }
    }
  }

  replay(id: string): LogLine[] {
    return [...(this.buffers.get(id) ?? [])];
  }

  clear(id: string): void {
    this.buffers.set(id, []);
    this.partials.delete(id);
  }

  subscribe(id: string, fn: (line: LogLine) => void): () => void {
    let set = this.subscribers.get(id);
    if (!set) {
      set = new Set();
      this.subscribers.set(id, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  /** 项目被删除时释放相关资源 */
  dispose(id: string): void {
    this.buffers.delete(id);
    this.partials.delete(id);
    this.subscribers.delete(id);
  }
}
