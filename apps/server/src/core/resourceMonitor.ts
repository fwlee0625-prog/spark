import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  ProjectResource,
  ResourceHistory,
  ResourceHistoryPoint,
  ResourceSnapshot,
  ResourceUsage,
  TerminalResource,
} from '@spark/shared';
import type { ConfigStore } from './configStore.js';
import { findProcessOwner } from './portStatus.js';
import type { ProcessManager } from './processManager.js';

export interface ProcessSample {
  pid: number;
  ppid: number;
  pgid: number;
  identity: string;
  cpuMs: number;
  memoryBytes: number;
  name: string;
}
export const RESOURCE_INTERVAL_MS = 3000;
const HISTORY_MS = 15 * 60 * 1000;
const MAX_POINTS = Math.ceil(HISTORY_MS / RESOURCE_INTERVAL_MS) + 1;

export function parseCpuTime(value: string): number {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('Invalid ps CPU time');
  return (
    (Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3]) * 60 + Number(match[4])) * 1000
  );
}

/** BSD and procps both support these explicit columns. lstart guards against PID reuse. */
export function parseProcessSamples(output: string): ProcessSample[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
      if (!match) throw new Error('Invalid ps resource output');
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        memoryBytes: Number(match[4]) * 1024,
        cpuMs: parseCpuTime(match[5]!),
        identity: match[6]!.trim().split(/\s+/).join(' '),
        name: path.basename(match[7]!.trim()),
      };
    });
}

export function sampleProcesses(): Promise<ProcessSample[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,pgid=,rss=,time=,lstart=,comm='],
      { encoding: 'utf8', timeout: 2000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(parseProcessSamples(stdout));
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

function empty(status: ResourceUsage['status'], runId: string | null = null): ResourceUsage {
  return { status, sampledAt: null, memoryBytes: null, cpuPercent: null, processCount: null, runId };
}
function sum(usages: ResourceUsage[], runId: string | null, at: number): ResourceUsage {
  const active = usages.filter((u) => u.status !== 'stopped');
  if (!active.length) return empty('stopped');
  if (active.some((u) => u.status === 'unavailable')) return { ...empty('unavailable', runId), sampledAt: at };
  const knownMemory = active.every((u) => u.memoryBytes !== null);
  const knownCpu = active.every((u) => u.cpuPercent !== null);
  return {
    status: knownCpu ? 'ready' : 'collecting',
    sampledAt: at,
    runId,
    memoryBytes: knownMemory ? active.reduce((n, u) => n + u.memoryBytes!, 0) : null,
    processCount: knownMemory ? active.reduce((n, u) => n + u.processCount!, 0) : null,
    cpuPercent: knownCpu
      ? Math.min(
          100,
          active.reduce((n, u) => n + u.cpuPercent!, 0),
        )
      : null,
  };
}

export class ResourceMonitor {
  private timer?: NodeJS.Timeout;
  private pending: Promise<ResourceSnapshot> | null = null;
  private previous = new Map<number, { identity: string; cpuMs: number; at: number; owner: string }>();
  private histories = new Map<string, ResourceHistoryPoint[]>();
  private snapshot: ResourceSnapshot = {
    type: 'resources',
    sampledAt: 0,
    intervalMs: RESOURCE_INTERVAL_MS,
    total: empty('stopped'),
    projects: [],
  };
  private generation = 0;
  constructor(
    private store: Pick<ConfigStore, 'listProjects'>,
    private pm: Pick<ProcessManager, 'terminalStates' | 'runningGroups'>,
    private broadcast: (snapshot: ResourceSnapshot) => void,
    private collect = sampleProcesses,
    private now = Date.now,
    private monotonic = () => performance.now(),
    private cpuCount = os.cpus().length || 1,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, RESOURCE_INTERVAL_MS);
    this.timer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
    this.previous.clear();
  }

  /** Apply lifecycle changes immediately, including while a ps invocation is in flight. */
  stateChanged(): void {
    this.generation++;
    this.reconcile();
    this.broadcast(this.snapshot);
  }
  private layout(): ProjectResource[] {
    return this.store.listProjects().map((project) => {
      const terminals: TerminalResource[] = this.pm.terminalStates(project).map((terminal) => {
        const active = terminal.status === 'running' || terminal.status === 'starting';
        const runId = active ? `${terminal.id}:${terminal.pid ?? 'pending'}:${terminal.startedAt ?? 'pending'}` : null;
        return { ...empty(active ? 'collecting' : 'stopped', runId), terminalId: terminal.id, processes: [] };
      });
      const runId = terminals.some((t) => t.runId) ? terminals.map((t) => t.runId ?? '-').join('|') : null;
      const usage = sum(terminals, runId, this.now());
      return { ...usage, projectId: project.id, terminals };
    });
  }
  private reconcile(): void {
    const at = this.now();
    let changed = false;
    const projects = this.layout().map((project) => {
      const old = this.snapshot.projects.find((p) => p.projectId === project.projectId);
      if (old && old.runId === project.runId) return old;
      changed = true;
      if (old?.runId || project.runId) this.record(project, at);
      return project;
    });
    const ids = new Set(projects.map((p) => p.projectId));
    for (const id of this.histories.keys()) if (!ids.has(id)) this.histories.delete(id);
    if (changed || projects.length !== this.snapshot.projects.length) {
      const sampledAt = this.snapshot.sampledAt || at;
      this.snapshot = {
        type: 'resources',
        sampledAt,
        intervalMs: RESOURCE_INTERVAL_MS,
        projects,
        total: sum(
          projects,
          projects.some((p) => p.runId) ? projects.map((p) => p.runId ?? '-').join('|') : null,
          sampledAt,
        ),
      };
    }
  }
  read(): ResourceSnapshot {
    this.reconcile();
    return this.snapshot;
  }
  history(projectId: string): ResourceHistory {
    this.reconcile();
    this.prune(projectId, this.now());
    return { projectId, points: [...(this.histories.get(projectId) ?? [])] };
  }
  refresh(): Promise<ResourceSnapshot> {
    if (this.pending) return this.pending;
    this.reconcile();
    const pending = this.scan().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }
  private prune(id: string, at: number): void {
    const points = this.histories.get(id);
    if (points) this.histories.set(id, points.filter((p) => at - p.timestamp <= HISTORY_MS).slice(-MAX_POINTS));
  }
  private record(project: ProjectResource, at: number): void {
    const { projectId, terminals: _terminals, ...usage } = project;
    const points = this.histories.get(projectId) ?? [];
    points.push({ ...usage, timestamp: at });
    this.histories.set(projectId, points);
    this.prune(projectId, at);
  }
  private async scan(): Promise<ResourceSnapshot> {
    const generation = this.generation;
    const layout = this.layout();
    const groups = this.pm.runningGroups();
    let samples: ProcessSample[] = [];
    let failed = false;
    try {
      if (groups.length) samples = await this.collect();
    } catch {
      failed = true;
    }
    const at = this.now();
    const tick = this.monotonic();
    if (generation !== this.generation) {
      this.reconcile();
      return this.snapshot;
    }
    // Also catch direct state/config changes not delivered through the status callback.
    if (
      JSON.stringify(layout.map((p) => [p.projectId, p.runId])) !==
      JSON.stringify(this.layout().map((p) => [p.projectId, p.runId]))
    ) {
      this.reconcile();
      return this.snapshot;
    }
    const next = new Map<number, { identity: string; cpuMs: number; at: number; owner: string }>();
    const assigned = new Map<string, TerminalResource['processes']>();
    const validGroups = groups.filter((group) => {
      if (!group.identity) return true;
      const root = samples.find((p) => p.pid === group.pgid);
      return root && `${root.pgid} ${root.identity}` === group.identity;
    });
    for (const process of new Map(samples.map((p) => [p.pid, p])).values()) {
      const owner = findProcessOwner(process.pid, validGroups, samples);
      if (!owner?.terminalId) continue;
      const terminal = layout
        .find((p) => p.projectId === owner.id)
        ?.terminals.find((t) => t.terminalId === owner.terminalId);
      if (!terminal?.runId) continue;
      const key = `${owner.id}:${owner.terminalId}:${terminal.runId}`;
      const previous = this.previous.get(process.pid);
      const cpuPercent =
        previous &&
        previous.identity === process.identity &&
        previous.owner === key &&
        tick > previous.at &&
        process.cpuMs >= previous.cpuMs
          ? Math.min(100, ((process.cpuMs - previous.cpuMs) / (tick - previous.at) / this.cpuCount) * 100)
          : null;
      next.set(process.pid, { identity: process.identity, cpuMs: process.cpuMs, at: tick, owner: key });
      const list = assigned.get(key) ?? [];
      list.push({ pid: process.pid, name: process.name, memoryBytes: process.memoryBytes, cpuPercent });
      assigned.set(key, list);
    }
    this.previous = next;
    const projects = layout.map((project) => {
      const terminals = project.terminals.map((terminal) => {
        if (!terminal.runId) return terminal;
        const processes = assigned.get(`${project.projectId}:${terminal.terminalId}:${terminal.runId}`) ?? [];
        if (failed || !processes.length) return { ...terminal, ...empty('unavailable', terminal.runId), sampledAt: at };
        return {
          ...terminal,
          processes,
          sampledAt: at,
          status: processes.every((p) => p.cpuPercent !== null) ? ('ready' as const) : ('collecting' as const),
          memoryBytes: processes.reduce((n, p) => n + p.memoryBytes, 0),
          processCount: processes.length,
          cpuPercent: processes.every((p) => p.cpuPercent !== null)
            ? Math.min(
                100,
                processes.reduce((n, p) => n + p.cpuPercent!, 0),
              )
            : null,
        };
      });
      const result = { ...project, ...sum(terminals, project.runId, at), terminals };
      if (result.runId) this.record(result, at);
      return result;
    });
    this.snapshot = {
      type: 'resources',
      sampledAt: at,
      intervalMs: RESOURCE_INTERVAL_MS,
      projects,
      total: sum(projects, projects.some((p) => p.runId) ? projects.map((p) => p.runId ?? '-').join('|') : null, at),
    };
    this.broadcast(this.snapshot);
    return this.snapshot;
  }
}
