import fs from 'node:fs';
import path from 'node:path';

export type AppLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export interface AppLogEntry { id: number; timestamp: string; level: AppLogLevel; message: string }

const MAX_ENTRIES = 5000;

/** 持久化 Spark 自身的运行日志，与项目终端输出分开保存。 */
export class AppLogStore {
  private entries: AppLogEntry[] = [];
  private nextId = 1;

  constructor(private file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) return;
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-MAX_ENTRIES);
      this.entries = lines.flatMap((line) => {
        try {
          const entry = JSON.parse(line) as AppLogEntry;
          return typeof entry.timestamp === 'string' && typeof entry.message === 'string' ? [entry] : [];
        } catch { return []; }
      });
      this.nextId = Math.max(0, ...this.entries.map((entry) => entry.id)) + 1;
      if (this.entries.length !== lines.length) this.persist();
    } catch {
      this.entries = [];
    }
  }

  add(level: AppLogLevel, message: string): void {
    const entry: AppLogEntry = { id: this.nextId++, timestamp: new Date().toISOString(), level, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    try { fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8'); } catch { /* keep console logging available if disk is read-only */ }
    try {
      if (fs.statSync(this.file).size > 5 * 1024 * 1024) this.persist();
    } catch { /* next write will retry */ }
  }

  list(limit = 500, level?: AppLogLevel): AppLogEntry[] {
    return this.entries.filter((entry) => !level || entry.level === level).slice(-limit).reverse();
  }

  clear(): void { this.entries = []; this.persist(); }

  private persist(): void {
    try { fs.writeFileSync(this.file, this.entries.map((entry) => JSON.stringify(entry)).join('\n') + (this.entries.length ? '\n' : ''), 'utf8'); }
    catch { /* API callers can still inspect the in-memory log */ }
  }
}
