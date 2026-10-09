import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { LogBufferManager } from './logBuffer.js';

export interface ProcessRecord {
  id: string;
  pid: number;
  identity: string;
  startedAt: number;
  cwd: string;
}

/** 启动时间与进程组一起校验，避免 PID 被其他进程复用后误接管。 */
export function processIdentity(pid: number): string | null {
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'pgid=,lstart=,stat='], { encoding: 'utf8', timeout: 2000 }).trim();
    const [pgid, ...parts] = output.split(/\s+/);
    const state = parts.pop();
    if (Number(pgid) !== pid || !state || state.startsWith('Z')) return null;
    return `${pgid} ${parts.join(' ')}`;
  } catch { return null; }
}

/** 输出直接写入文件，Spark 退出不会关闭项目的 stdout/stderr 管道。 */
export class ProcessRecords {
  constructor(private directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  private file(id: string, suffix: string): string {
    return path.join(this.directory, `${Buffer.from(id).toString('hex')}.${suffix}`);
  }
  read(id: string): ProcessRecord | null {
    try {
      const record = JSON.parse(fs.readFileSync(this.file(id, 'json'), 'utf8')) as ProcessRecord;
      return record.id === id && Number.isInteger(record.pid) && record.pid > 1 &&
        typeof record.identity === 'string' && typeof record.cwd === 'string' &&
        Number.isFinite(record.startedAt) ? record : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  write(record: ProcessRecord): void {
    const file = this.file(record.id, 'json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  remove(id: string): void { fs.rmSync(this.file(id, 'json'), { force: true }); }
  openOutput(id: string): number[] {
    const stdout = fs.openSync(this.file(id, 'stdout'), 'w', 0o600);
    try { return [stdout, fs.openSync(this.file(id, 'stderr'), 'w', 0o600)]; }
    catch (error) { fs.closeSync(stdout); throw error; }
  }
  follow(id: string, logs: LogBufferManager): () => void {
    const streams = (['stdout', 'stderr'] as const).map((stream) => ({ stream, offset: 0, decoder: new StringDecoder('utf8') }));
    const read = () => {
      for (const state of streams) {
        let fd: number | undefined;
        try {
          fd = fs.openSync(this.file(id, state.stream), 'r');
          const size = fs.fstatSync(fd).size;
          // 每次最多读 256 KiB，防止离线期间的大量日志阻塞事件循环。
          if (size - state.offset > 262144 || size < state.offset) {
            state.offset = Math.max(0, size - 262144);
            state.decoder = new StringDecoder('utf8');
          }
          const buffer = Buffer.alloc(size - state.offset);
          const count = fs.readSync(fd, buffer, 0, buffer.length, state.offset);
          state.offset += count;
          if (count) logs.appendChunk(id, state.decoder.write(buffer.subarray(0, count)), state.stream);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[spark] 读取项目日志失败:', error);
        } finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    };
    read();
    const timer = setInterval(read, 250);
    timer.unref();
    return () => { clearInterval(timer); read(); };
  }
}
