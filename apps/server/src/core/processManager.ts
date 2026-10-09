import { projectTerminals, terminalKey } from '@spark/shared';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Project, ProjectStatus, RuntimeState, TerminalWithState, Settings, StatusEvent } from '@spark/shared';
import type { LogBufferManager } from './logBuffer.js';
import { isPortFree, listPortProcesses, pidCwd } from './portChecker.js';
import { ProcessRecords, processIdentity } from './processRecords.js';
import type { RunningGroup } from './portStatus.js';

type ProcessSpec = Omit<Project, 'terminals'> & { command: string; port: number | null; env: Record<string, string> };

interface Entry {
  status: ProjectStatus;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  child: ChildProcess | null;
  manualStop: boolean;
  restartCount: number;
  restartTimer: NodeJS.Timeout | undefined;
  aliveTimer: NodeJS.Timeout | undefined;
  identity?: string;
  stopLogs?: () => void;
}

/** starting 状态持续超过该时长且未退出,视为运行中 */
const START_TO_RUNNING_MS = 2000;
/** SIGTERM 后等待优雅退出的超时,超时改用 SIGKILL */
const TERM_TIMEOUT_MS = 5000;

/**
 * 进程管理器:
 * - 以 detached 方式 spawn,子进程成为新进程组组长(pgid == pid),便于整组 kill
 * - 停止流程:SIGTERM 进程组 → 5s 未退出则 SIGKILL → 若配置端口仍被占用,校验 cwd 后按端口兜底
 * - 启动后 2s 内非零退出视为 failed;开启 autoRestart 时按指数退避自动重启
 */
class TerminalProcessManager {
  private entries = new Map<string, Entry>();
  private recoveryTimers = new Map<string, NodeJS.Timeout>();
  private detached = false;

  constructor(
    private logs: LogBufferManager,
    private onStatus: (evt: StatusEvent) => void,
    private records?: ProcessRecords,
  ) {}

  restore(project: ProcessSpec, settings: Settings): void {
    const record = this.records?.read(project.id);
    if (!record) return;
    if (record.cwd !== fs.realpathSync(project.cwd) || processIdentity(record.pid) !== record.identity) {
      this.records!.remove(project.id);
      return;
    }
    const e = this.entry(project.id);
    e.pid = record.pid;
    e.identity = record.identity;
    e.startedAt = record.startedAt;
    e.stopLogs = this.records!.follow(project.id, this.logs);
    this.setStatus(e, project.id, 'running');
    const timer = setInterval(() => {
      if (e.pid && processIdentity(e.pid) !== e.identity) {
        clearInterval(timer);
        this.recoveryTimers.delete(project.id);
        this.handleExit(project, settings, null, null);
      }
    }, 2000);
    timer.unref();
    this.recoveryTimers.set(project.id, timer);
  }

  detach(): void {
    this.detached = true;
    for (const timer of this.recoveryTimers.values()) clearInterval(timer);
    this.recoveryTimers.clear();
    for (const e of this.entries.values()) {
      clearTimeout(e.restartTimer);
      clearTimeout(e.aliveTimer);
      e.stopLogs?.();
      e.stopLogs = undefined;
      e.child?.unref();
    }
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = {
        status: 'stopped',
        pid: null,
        startedAt: null,
        exitCode: null,
        child: null,
        manualStop: false,
        restartCount: 0,
        restartTimer: undefined,
        aliveTimer: undefined,
      };
      this.entries.set(id, e);
    }
    return e;
  }

  getState(id: string): { status: ProjectStatus; pid: number | null; startedAt: number | null; exitCode: number | null } {
    const e = this.entries.get(id);
    if (!e) return { status: 'stopped', pid: null, startedAt: null, exitCode: null };
    return { status: e.status, pid: e.pid, startedAt: e.startedAt, exitCode: e.exitCode };
  }

  isRunning(id: string): boolean {
    const { status } = this.getState(id);
    return status === 'running' || status === 'starting';
  }

  runningGroups(): RunningGroup[] {
    const result: RunningGroup[] = [];
    for (const [id, e] of this.entries) {
      if (e.pid != null && (e.status === 'running' || e.status === 'starting')) {
        result.push({ id, pgid: e.pid });
      }
    }
    return result;
  }

  /** 项目被删除时清理运行时条目 */
  forget(id: string): void {
    const e = this.entries.get(id);
    if (e) {
      clearTimeout(e.restartTimer);
      clearTimeout(e.aliveTimer);
      e.stopLogs?.();
    }
    clearInterval(this.recoveryTimers.get(id));
    this.recoveryTimers.delete(id);
    this.records?.remove(id);
    this.entries.delete(id);
  }

  private setStatus(e: Entry, id: string, status: ProjectStatus): void {
    if (e.status === status) return;
    e.status = status;
    this.onStatus({ type: 'status', id, status, pid: e.pid, startedAt: e.startedAt, exitCode: e.exitCode });
  }

  start(project: ProcessSpec, settings: Settings, opts: { keepRestartCount?: boolean } = {}): void {
    const e = this.entry(project.id);
    if (e.status === 'running' || e.status === 'starting') {
      throw new Error('项目已在运行中');
    }
    clearTimeout(e.restartTimer);
    e.restartTimer = undefined;
    clearTimeout(e.aliveTimer);
    if (!opts.keepRestartCount) e.restartCount = 0;
    e.manualStop = false;
    e.exitCode = null;
    e.startedAt = Date.now();
    e.status = 'starting';

    const spec =
      settings.shellMode === 'direct'
        ? { file: '/bin/sh', args: ['-c', project.command] }
        : settings.shellMode === 'non-login'
          ? { file: 'zsh', args: ['-lc', project.command] }
          : { file: 'zsh', args: ['-ilc', project.command] };

    let child: ChildProcess;
    let output: number[] = [];
    try {
      output = this.records?.openOutput(project.id) ?? [];
      child = spawn(spec.file, spec.args, {
        cwd: project.cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1', ...project.env },
        detached: true, // 独立进程组,便于整组 kill
        stdio: output.length ? ['ignore', output[0], output[1]] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      e.startedAt = null;
      e.exitCode = -1;
      this.logs.pushLine(project.id, `[spark] 启动失败: ${(err as Error).message}`, 'stderr');
      this.setStatus(e, project.id, 'failed');
      return;
    } finally {
      for (const fd of output) fs.closeSync(fd);
    }

    e.child = child;
    e.pid = child.pid ?? null;
    this.logs.pushLine(project.id, `[spark] 启动: ${project.command}`, 'stdout');
    this.onStatus({ type: 'status', id: project.id, status: 'starting', pid: e.pid, startedAt: e.startedAt, exitCode: null });

    child.stdout?.on('data', (d: Buffer) => this.logs.appendChunk(project.id, d.toString('utf8'), 'stdout'));
    child.stderr?.on('data', (d: Buffer) => this.logs.appendChunk(project.id, d.toString('utf8'), 'stderr'));

    // spawn 本身失败(如 cwd 不存在)
    child.on('error', (err: Error) => {
      if (this.detached) return;
      e.stopLogs?.();
      e.stopLogs = undefined;
      this.records?.remove(project.id);
      clearTimeout(e.aliveTimer);
      e.child = null;
      e.pid = null;
      e.startedAt = null;
      e.exitCode = -1;
      this.logs.pushLine(project.id, `[spark] 启动失败: ${err.message}`, 'stderr');
      this.setStatus(e, project.id, 'failed');
    });

    child.on('exit', (code, signal) => this.handleExit(project, settings, code, signal));

    if (this.records && e.pid) {
      e.identity = processIdentity(e.pid) ?? undefined;
      try {
        if (e.identity) this.records.write({ id: project.id, pid: e.pid, identity: e.identity,
          cwd: fs.realpathSync(project.cwd), startedAt: e.startedAt! });
        e.stopLogs = this.records.follow(project.id, this.logs);
      } catch (error) {
        // 无法保存记录时回滚本次启动，避免留下无法恢复管理的项目。
        e.manualStop = true;
        try { process.kill(-e.pid, 'SIGKILL'); } catch { /* 已退出 */ }
        throw error;
      }
    }

    e.aliveTimer = setTimeout(() => {
      if (e.status === 'starting') this.setStatus(e, project.id, 'running');
    }, START_TO_RUNNING_MS);
  }

  private handleExit(project: ProcessSpec, settings: Settings, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.detached) return;
    const e = this.entry(project.id);
    e.stopLogs?.();
    e.stopLogs = undefined;
    this.records?.remove(project.id);
    clearTimeout(e.aliveTimer);
    e.child = null;
    e.pid = null;
    e.exitCode = code;
    const wasStarting = e.status === 'starting';

    if (e.manualStop) {
      e.startedAt = null;
      this.setStatus(e, project.id, 'stopped');
      return;
    }

    // 启动阶段(2s 内)非零退出 → failed
    if (wasStarting && (code ?? 1) !== 0) {
      e.startedAt = null;
      this.logs.pushLine(project.id, `[spark] 启动失败,退出码: ${code ?? signal}`, 'stderr');
      this.setStatus(e, project.id, 'failed');
      return;
    }

    // 崩溃自动重启(指数退避,次数上限)
    if (project.autoRestart && e.restartCount < settings.autoRestartMax) {
      e.restartCount += 1;
      const delay = Math.min(30000, 2000 * 2 ** (e.restartCount - 1));
      this.logs.pushLine(
        project.id,
        `[spark] 进程意外退出(code=${code ?? signal}),${delay / 1000}s 后自动重启(${e.restartCount}/${settings.autoRestartMax})`,
        'stderr',
      );
      e.startedAt = null;
      this.setStatus(e, project.id, 'stopped');
      e.restartTimer = setTimeout(() => {
        if (!e.manualStop) this.start(project, settings, { keepRestartCount: true });
      }, delay);
      return;
    }

    e.startedAt = null;
    this.setStatus(e, project.id, 'stopped');
  }

  async stop(project: ProcessSpec): Promise<void> {
    const e = this.entry(project.id);
    clearTimeout(e.restartTimer);
    e.restartTimer = undefined;

    if (e.pid == null) {
      e.manualStop = true;
      e.startedAt = null;
      this.setStatus(e, project.id, 'stopped');
      return;
    }

    e.manualStop = true;
    clearInterval(this.recoveryTimers.get(project.id));
    this.recoveryTimers.delete(project.id);
    if (e.identity && processIdentity(e.pid) !== e.identity) {
      clearInterval(this.recoveryTimers.get(project.id));
      e.stopLogs?.();
      e.stopLogs = undefined;
      e.pid = null;
      e.child = null;
      e.startedAt = null;
      clearTimeout(e.aliveTimer);
      this.records?.remove(project.id);
      this.setStatus(e, project.id, 'stopped');
      return;
    }
    const pgid = e.pid;
    this.logs.pushLine(project.id, `[spark] 停止: SIGTERM 进程组 ${pgid}`, 'stdout');
    try {
      process.kill(-pgid, 'SIGTERM');
    } catch {
      /* 进程组已不存在 */
    }
    let exited = await this.waitExit(e, TERM_TIMEOUT_MS);
    if (!exited) {
      this.logs.pushLine(project.id, `[spark] 优雅退出超时,SIGKILL 进程组 ${pgid}`, 'stderr');
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        /* 进程组已不存在 */
      }
      exited = await this.waitExit(e, 2000);
    }
    if (!exited && e.child) {
      try {
        e.child.kill('SIGKILL');
      } catch {
        /* 已退出 */
      }
    }

    // 兜底:针对自行 fork 脱离进程组的项目,若端口仍被占用则按端口清理;
    // 仅在确认监听进程的工作目录属于本项目时才杀,避免误伤外部进程
    if (project.port != null && !(await isPortFree(project.port))) {
      await this.killByPort(project.port, project);
    }

    clearInterval(this.recoveryTimers.get(project.id));
    this.recoveryTimers.delete(project.id);
    clearTimeout(e.aliveTimer);
    e.stopLogs?.();
    e.stopLogs = undefined;
    e.pid = null;
    e.child = null;
    e.startedAt = null;
    this.records?.remove(project.id);
    this.setStatus(e, project.id, 'stopped');
  }

  private async killByPort(port: number, project: ProcessSpec): Promise<void> {
    // lsof 返回真实路径(如 /private/tmp),与项目配置路径比较前先归一化
    let projectDir = project.cwd;
    try {
      projectDir = fs.realpathSync(project.cwd);
    } catch {
      /* 目录已不存在,退回原始路径 */
    }
    const procs = await listPortProcesses(port);
    for (const proc of procs) {
      const cwd = await pidCwd(proc.pid);
      if (cwd && (cwd === projectDir || cwd.startsWith(projectDir + path.sep))) {
        this.logs.pushLine(project.id, `[spark] 兜底清理: 杀掉占用端口 ${port} 的进程 ${proc.pid} (${proc.command})`, 'stdout');
        try {
          process.kill(proc.pid, 'SIGKILL');
        } catch {
          /* 已退出 */
        }
      } else {
        this.logs.pushLine(project.id, `[spark] 端口 ${port} 仍被外部进程 ${proc.pid} (${proc.command}) 占用,已跳过清理`, 'stderr');
      }
    }
  }

  async restart(project: ProcessSpec, settings: Settings): Promise<void> {
    await this.stop(project);
    this.start(project, settings);
  }

  async stopAll(projects: ProcessSpec[]): Promise<void> {
    const running = projects.filter((p) => this.isRunning(p.id));
    await Promise.allSettled(running.map((p) => this.stop(p)));
  }

  private waitExit(e: Entry, ms: number): Promise<boolean> {
    if (e.child && (e.child.exitCode !== null || e.child.signalCode !== null)) return Promise.resolve(true);
    if (!e.child) return new Promise((resolve) => {
      const deadline = Date.now() + ms;
      const timer = setInterval(() => {
        let alive = false;
        try { if (e.pid) { process.kill(-e.pid, 0); alive = true; } } catch { /* 已退出 */ }
        if (!alive || Date.now() >= deadline) { clearInterval(timer); resolve(!alive); }
      }, 100);
    });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      e.child!.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}


/** 项目级协调器；每个终端沿用独立进程组的生命周期管理。 */
export class ProcessManager {
  private runner: TerminalProcessManager;
  private projects = new Map<string, Project>();
  private discoveredPorts = new Map<string, { pid: number; ports: number[] }>();

  constructor(private logs: LogBufferManager, private onStatus: (evt: StatusEvent) => void, runtimeDirectory?: string) {
    this.runner = new TerminalProcessManager(logs, (evt) => {
      const project = [...this.projects.values()].find((p) =>
        projectTerminals(p).some((t) => terminalKey(p.id, t.id) === evt.id));
      if (project) this.onStatus({ type: 'status', id: project.id, ...this.getState(project.id) });
    }, runtimeDirectory ? new ProcessRecords(runtimeDirectory) : undefined);
  }

  restore(projects: Project[], settings: Settings): void {
    for (const project of projects) {
      this.projects.set(project.id, project);
      for (const spec of this.specs(project)) {
        try { this.runner.restore(spec, settings); }
        catch (error) { console.warn(`[spark] 恢复 ${spec.id} 失败:`, error); }
      }
    }
  }

  detach(): void { this.runner.detach(); }

  async shutdown(projects: Project[], settings: Settings): Promise<void> {
    try {
      if (settings.stopProjectsOnExit) await this.stopAll(projects);
    } finally { this.detach(); }
  }


  terminalStates(project: Project): TerminalWithState[] {
    return projectTerminals(project).map((t) => {
      const key = terminalKey(project.id, t.id);
      const state = this.runner.getState(key);
      const discovered = this.discoveredPorts.get(key);
      const listeningPorts = state.pid !== null && discovered?.pid === state.pid && ['running', 'starting'].includes(state.status) ? discovered.ports : [];
      return { ...t, ...state, listeningPorts };
    });
  }

  getState(id: string): RuntimeState & { terminalStates: TerminalWithState[] } {
    const project = this.projects.get(id);
    const terminalStates = project ? this.terminalStates(project) : [];
    const active = terminalStates.filter((t) => t.status === 'running' || t.status === 'starting');
    const failed = terminalStates.find((t) => t.status === 'failed');
    const status: ProjectStatus = active.length
      ? active.length < terminalStates.length ? 'partial' : active.some((t) => t.status === 'starting') ? 'starting' : 'running'
      : failed ? 'failed' : 'stopped';
    return { status, pid: active[0]?.pid ?? null,
      startedAt: active.length ? Math.min(...active.map((t) => t.startedAt!)) : null,
      exitCode: failed?.exitCode ?? terminalStates[0]?.exitCode ?? null, terminalStates };
  }

  isRunning(id: string): boolean {
    return ['starting', 'running', 'partial'].includes(this.getState(id).status);
  }

  private specs(project: Project, terminalId?: string): ProcessSpec[] {
    const terminals = projectTerminals(project).filter((t) => !terminalId || t.id === terminalId);
    if (!terminals.length) throw new Error('终端不存在');
    const { terminals: _terminals, ...config } = project;
    return terminals.map((t) => ({ ...config, id: terminalKey(project.id, t.id),
      cwd: path.resolve(project.cwd, t.cwd || '.'), command: t.command, port: t.port, env: t.env }));
  }

  start(project: Project, settings: Settings, terminalId?: string): void {
    this.projects.set(project.id, project);
    const specs = this.specs(project, terminalId).filter((p) => !this.runner.isRunning(p.id));
    if (!specs.length) throw new Error('项目已在运行中');
    for (const spec of specs) this.runner.start(spec, settings);
  }

  async stop(project: Project, terminalId?: string): Promise<void> {
    this.projects.set(project.id, project);
    await Promise.all(this.specs(project, terminalId).map((p) => this.runner.stop(p)));
  }

  async restart(project: Project, settings: Settings, terminalId?: string): Promise<void> {
    await this.stop(project, terminalId);
    this.start(project, settings, terminalId);
  }

  runningGroups(): RunningGroup[] {
    return this.runner.runningGroups().map((g) => {
      for (const p of this.projects.values()) {
        const spec = this.specs(p).find((s) => s.id === g.id);
        if (spec) return { ...g, id: p.id, terminalId: p.terminals.find((t) => terminalKey(p.id, t.id) === spec.id)!.id, cwd: spec.cwd };
      }
      return g;
    });
  }

  updateListeningPorts(groups: RunningGroup[], ports: { projectId?: string; terminalId?: string; port: number }[]): void {
    const changed = new Set<string>();
    for (const group of groups) {
      if (!group.terminalId) continue;
      const key = terminalKey(group.id, group.terminalId);
      if (this.runner.getState(key).pid !== group.pgid) continue;
      const next = [...new Set(ports.filter((p) => p.projectId === group.id && p.terminalId === group.terminalId).map((p) => p.port))].sort((a, b) => a - b);
      const previous = this.discoveredPorts.get(key);
      this.discoveredPorts.set(key, { pid: group.pgid, ports: next });
      if ((previous?.ports ?? []).join(',') !== next.join(',') || (previous?.pid !== group.pgid && next.length > 0)) changed.add(group.id);
    }
    for (const id of changed) this.onStatus({ type: 'status', id, ...this.getState(id) });
  }

  forget(id: string): void {
    const project = this.projects.get(id);
    if (project) for (const spec of this.specs(project)) {
      this.runner.forget(spec.id);
      this.discoveredPorts.delete(spec.id);
      this.logs.dispose(spec.id);
    }
    this.projects.delete(id);
  }

  async stopAll(projects: Project[]): Promise<void> {
    // 包含处于自动重启等待期的终端。
    await Promise.all(projects.map((p) => this.stop(p)));
  }
}
