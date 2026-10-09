import fs from 'node:fs';
import path from 'node:path';
import type { PortStatus } from '@spark/shared';
import { isPortFree, listPortProcesses, pidCwd, pidPgid, listListeningProcesses, listProcessRelations, type ProcessRelation } from './portChecker.js';

/** macOS 的 /tmp 是 /private/tmp 的符号链接,lsof 返回真实路径,比较前统一归一化 */
function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export interface RunningGroup {
  id: string;
  terminalId?: string;
  /** detached 子进程是组长,pgid 即其 pid */
  pgid: number;
  /** 项目 cwd,用于 pgid 匹配失败时(如 pnpm 会给子进程另起进程组)按工作目录归属 */
  cwd?: string;
}

/**
 * 检测单个端口占用情况:
 * - 空闲 → { occupied: false }
 * - 占用 → 解析监听进程;先按进程组归属到运行中的项目,失败再按进程 cwd 匹配
 */
export async function getPortStatus(port: number, runningGroups: RunningGroup[]): Promise<PortStatus> {
  if (await isPortFree(port)) {
    return { port, occupied: false, source: null };
  }
  const processes = await listPortProcesses(port);
  const first = processes[0];
  if (!first) {
    return { port, occupied: true, source: null, processes: [] };
  }
  const pgid = await pidPgid(first.pid);
  let owner = pgid != null ? runningGroups.find((g) => g.pgid === pgid) : undefined;
  if (!owner) {
    const cwd = await pidCwd(first.pid);
    if (cwd) {
      owner = runningGroups.find((g) => {
        if (!g.cwd) return false;
        const projectDir = realPath(g.cwd);
        return cwd === projectDir || cwd.startsWith(projectDir + path.sep);
      });
    }
  }
  return {
    port,
    occupied: true,
    source: owner ? 'project' : 'external',
    ...(owner ? { projectId: owner.id, terminalId: owner.terminalId } : {}),
    pid: first.pid,
    processName: first.command,
    processes,
  };
}


export function findProcessOwner(pid: number, groups: RunningGroup[], relations: ProcessRelation[]): RunningGroup | undefined {
  const byPid = new Map(relations.map((p) => [p.pid, p]));
  const visited = new Set<number>();
  let current = pid;
  while (current > 0 && !visited.has(current)) {
    visited.add(current);
    const exact = groups.find((g) => g.pgid === current);
    if (exact) return exact;
    current = byPid.get(current)?.ppid ?? 0;
  }
  const pgid = byPid.get(pid)?.pgid;
  return groups.find((g) => g.pgid === pgid);
}

/** 只纳入已管理终端的真实监听端口，不按工作目录误认外部进程。 */
export async function scanManagedPorts(groups: RunningGroup[]): Promise<PortStatus[]> {
  if (!groups.length) return [];
  const [listeners, relations] = await Promise.all([listListeningProcesses(), listProcessRelations()]);
  const ports = new Map<number, PortStatus>();
  for (const listener of listeners) {
    const owner = findProcessOwner(listener.pid, groups, relations);
    if (!owner) continue;
    if (!ports.has(listener.port)) {
      ports.set(listener.port, { port: listener.port, occupied: true, source: 'project',
        projectId: owner.id, terminalId: owner.terminalId, pid: listener.pid, processName: listener.command,
        processes: listeners.filter((p) => p.port === listener.port).map(({ pid, command }) => ({ pid, command })) });
    }
  }
  return [...ports.values()].sort((a, b) => a.port - b.port);
}
