import type { Group, ProjectWithState, TerminalWithState } from '@spark/shared';
import type { SparkClient } from './client.js';

/** 按 id / 名称解析项目;名称不区分大小写,多个同名时报错提示用 id */
export async function resolveProject(client: SparkClient, ref: string): Promise<ProjectWithState> {
  const projects = await client.get<ProjectWithState[]>('/api/projects');
  const byId = projects.find((p) => p.id === ref);
  if (byId) return byId;
  const matches = projects.filter((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new Error(`存在多个名为「${ref}」的项目,请改用 id:${matches.map((p) => p.id).join(', ')}`);
  throw new Error(`未找到项目「${ref}」。可用项目:${projects.map((p) => `${p.name}(${p.id})`).join(', ') || '无'}`);
}

/** 按 id / 编号 / 名称解析终端;不传时取第一个终端 */
export function resolveTerminal<T extends { id: string; number?: number; name: string }>(
  terminals: T[],
  ref?: string | number,
): T {
  if (ref === undefined || ref === '') return terminals[0]!;
  const text = String(ref);
  const found =
    terminals.find((t) => t.id === text) ??
    terminals.find((t) => t.number !== undefined && String(t.number) === text) ??
    terminals.find((t) => t.name.toLowerCase() === text.toLowerCase());
  if (!found)
    throw new Error(
      `未找到终端「${text}」。可用终端:${terminals.map((t) => `#${t.number ?? '-'} ${t.name}(${t.id})`).join(', ')}`,
    );
  return found;
}

/** 按 id / 名称解析分组 */
export async function resolveGroup(client: SparkClient, ref: string): Promise<Group> {
  const groups = await client.get<Group[]>('/api/groups');
  const found = groups.find((g) => g.id === ref) ?? groups.find((g) => g.name.toLowerCase() === ref.toLowerCase());
  if (!found)
    throw new Error(`未找到分组「${ref}」。可用分组:${groups.map((g) => `${g.name}(${g.id})`).join(', ') || '无'}`);
  return found;
}

const iso = (ts: number | null) => (ts ? new Date(ts).toISOString() : null);

export function summarizeTerminal(t: TerminalWithState, detail = false) {
  return {
    id: t.id,
    number: t.number ?? null,
    name: t.name,
    status: t.status,
    pid: t.pid,
    startedAt: iso(t.startedAt),
    exitCode: t.exitCode,
    command: t.command,
    cwd: t.cwd || '.',
    configuredPort: t.port,
    listeningPorts: t.listeningPorts,
    ...(detail ? { env: t.env } : {}),
  };
}

export function summarizeProject(p: ProjectWithState, detail = false) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    cwd: p.cwd,
    status: p.status,
    autoRestart: p.autoRestart,
    groupIds: p.groupIds,
    terminalCount: p.terminalStates.length,
    terminals: p.terminalStates.map((t) => summarizeTerminal(t, detail)),
  };
}
