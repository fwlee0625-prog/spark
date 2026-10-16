import { execFile } from 'node:child_process';
import net from 'node:net';
import type { PortProcess } from '@spark/shared';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** 通过 net 模块试听检测端口是否空闲 */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** 用 lsof 找出监听指定端口的进程(IPv4/IPv6 去重) */
export async function listPortProcesses(port: number): Promise<PortProcess[]> {
  try {
    const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
    const result = new Map<number, string>();
    for (const line of out.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 2) continue;
      const pid = Number(cols[1]);
      if (Number.isInteger(pid) && pid > 0) result.set(pid, cols[0]);
    }
    return [...result].map(([pid, command]) => ({ pid, command }));
  } catch {
    return [];
  }
}

/** 查询进程所属进程组 id */
export async function pidPgid(pid: number): Promise<number | null> {
  try {
    const out = await run('ps', ['-o', 'pgid=', '-p', String(pid)]);
    const n = Number(out.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 查询进程工作目录(lsof -Fn 输出形如 "n/path") */
export async function pidCwd(pid: number): Promise<string | null> {
  try {
    const out = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

export interface ListeningProcess extends PortProcess {
  port: number;
}
export interface ProcessRelation {
  pid: number;
  ppid: number;
  pgid: number;
}

/** lsof 字段输出能处理 IPv4、IPv6、通配监听及包含空格的命令名。 */
export function parseListeners(output: string): ListeningProcess[] {
  let pid = 0;
  let command = '';
  const result = new Map<string, ListeningProcess>();
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
      command = '';
    } else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n')) {
      const port = Number(line.match(/:(\d+)$/)?.[1]);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(port) && port > 0 && port <= 65535) {
        result.set(`${pid}:${port}`, { pid, command, port });
      }
    }
  }
  return [...result.values()];
}

export async function listListeningProcesses(): Promise<ListeningProcess[]> {
  return parseListeners(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
}

/** 一次获取进程关系，识别 pnpm 等另起进程组的子进程。 */
export async function listProcessRelations(): Promise<ProcessRelation[]> {
  const output = await run('ps', ['-axo', 'pid=,ppid=,pgid=']);
  return output.split('\n').flatMap((line) => {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    return pid && ppid !== undefined && pgid ? [{ pid, ppid, pgid }] : [];
  });
}
