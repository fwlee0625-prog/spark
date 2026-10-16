import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project, Settings, StatusEvent } from '@spark/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LogBufferManager } from '../src/core/logBuffer.js';
import { ProcessManager } from '../src/core/processManager.js';

let dir: string;
beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spark-pm-'));
});
afterAll(async () => {
  await fsp.rm(dir, { force: true, recursive: true });
});

const settings: Settings = { shellMode: 'direct', stopProjectsOnExit: false, logMaxLines: 1000, autoRestartMax: 3 };

function makeProject(command: string): Project {
  return {
    id: `p_${Math.random().toString(36).slice(2, 8)}`,
    name: 'pm-test',
    type: 'generic',
    cwd: dir,
    terminals: [{ id: 'main', name: '终端 1', cwd: '', command, port: null, env: {} }],
    groupIds: [],
    autoRestart: false,
    createdAt: 0,
  };
}

function waitForStatus(pm: ProcessManager, id: string, status: string, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (pm.getState(id).status === status) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`等待状态 ${status} 超时,当前: ${pm.getState(id).status}`));
    }, timeoutMs);
  });
}

/** 统计某进程组内存活进程数(pgrep -g) */
function groupMemberCount(pgid: number): number {
  try {
    const out = execFileSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

describe('ProcessManager', () => {
  it('启动 → 运行;停止后整个进程组(含子进程)被清理', async () => {
    const logs = new LogBufferManager(100);
    const pm = new ProcessManager(logs, () => {});

    // 后台子进程 + 前台长驻进程,同属一个进程组
    const project = makeProject('sleep 60 & sleep 60');
    pm.start(project, settings);
    await waitForStatus(pm, project.id, 'running');
    const pgid = pm.getState(project.id).pid!;
    expect(groupMemberCount(pgid)).toBeGreaterThanOrEqual(2);

    await pm.stop(project);
    expect(pm.getState(project.id).status).toBe('stopped');
    expect(groupMemberCount(pgid)).toBe(0);
  });

  it('启动后立即非零退出 → failed 且记录退出码', async () => {
    const logs = new LogBufferManager(100);
    const events: StatusEvent[] = [];
    const pm = new ProcessManager(logs, (e) => events.push(e));

    const project = makeProject('exit 3');
    pm.start(project, settings);
    await waitForStatus(pm, project.id, 'failed');
    expect(pm.getState(project.id).exitCode).toBe(3);
    expect(events.some((e) => e.status === 'failed')).toBe(true);
  });

  it('启动阶段 stdout/stderr 按行进入日志缓冲', async () => {
    const logs = new LogBufferManager(100);
    const pm = new ProcessManager(logs, () => {});

    const project = makeProject('echo hello-spark; echo err-spark 1>&2; sleep 60');
    pm.start(project, settings);
    await waitForStatus(pm, project.id, 'running');

    const deadline = Date.now() + 3000;
    let text = '';
    while (Date.now() < deadline) {
      text = logs
        .replay(`${project.id}:main`)
        .map((l) => l.line)
        .join('\n');
      if (text.includes('hello-spark') && text.includes('err-spark')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(text).toContain('hello-spark');
    expect(text).toContain('err-spark');
    await pm.stop(project);
  });

  it('重复启动运行中的项目抛错', async () => {
    const logs = new LogBufferManager(100);
    const pm = new ProcessManager(logs, () => {});
    const project = makeProject('sleep 60');
    pm.start(project, settings);
    await waitForStatus(pm, project.id, 'running');
    expect(() => pm.start(project, settings)).toThrow('已在运行中');
    await pm.stop(project);
  });

  it('多个终端独立启停、隔离日志，项目聚合为部分运行并可补齐启动', async () => {
    const logs = new LogBufferManager(100);
    const events: StatusEvent[] = [];
    const pm = new ProcessManager(logs, (e) => events.push(e));
    const project = makeProject('echo frontend; sleep 60');
    project.terminals = [
      { id: 'main', name: '前端', cwd: '', command: project.terminals[0].command, port: null, env: {} },
      { id: 'backend', name: '后端', cwd: '', command: 'echo backend; sleep 60', port: null, env: {} },
    ];
    try {
      pm.start(project, settings);
      await waitForStatus(pm, project.id, 'running');
      const states = pm.terminalStates(project);
      expect(states[0].pid).not.toBe(states[1].pid);
      expect(
        logs
          .replay(`${project.id}:main`)
          .map((l) => l.line)
          .join('\n'),
      ).not.toContain('backend');
      expect(
        logs
          .replay(`${project.id}:backend`)
          .map((l) => l.line)
          .join('\n'),
      ).toContain('backend');
      expect(pm.runningGroups().every((g) => g.id === project.id && g.cwd === dir)).toBe(true);
      await pm.stop(project, 'backend');
      expect(pm.getState(project.id).status).toBe('partial');
      expect(pm.isRunning(project.id)).toBe(true);
      expect(pm.terminalStates(project)[0].pid).toBe(states[0].pid);
      pm.start(project, settings);
      await waitForStatus(pm, project.id, 'running');
      expect(pm.terminalStates(project)[0].pid).toBe(states[0].pid);
      expect(events.at(-1)?.terminalStates).toHaveLength(2);
    } finally {
      await pm.stop(project);
    }
    expect(pm.getState(project.id).status).toBe('stopped');
    pm.forget(project.id);
    expect(logs.replay(`${project.id}:backend`)).toHaveLength(0);
  });

  it('一个终端启动失败时保留另一个终端，支持只重启失败终端', async () => {
    const pm = new ProcessManager(new LogBufferManager(100), () => {});
    const project = makeProject('sleep 60');
    project.terminals = [
      { id: 'main', name: '前端', cwd: '', command: project.terminals[0].command, port: null, env: {} },
      { id: 'backend', name: '后端', cwd: '', command: 'exit 7', port: null, env: {} },
    ];
    try {
      pm.start(project, settings);
      await new Promise((r) => setTimeout(r, 200));
      expect(pm.getState(project.id).status).toBe('partial');
      expect(pm.terminalStates(project)[1].status).toBe('failed');
      expect(pm.terminalStates(project)[1].exitCode).toBe(7);
      const pid = pm.terminalStates(project)[0].pid;
      project.terminals[1].command = 'sleep 60';
      await pm.restart(project, settings, 'backend');
      await waitForStatus(pm, project.id, 'running');
      expect(pm.terminalStates(project)[0].pid).toBe(pid);
    } finally {
      await pm.stop(project);
    }
  });

  it('各终端环境变量独立生效，空配置不包含其他终端的变量', async () => {
    const logs = new LogBufferManager(100);
    const pm = new ProcessManager(logs, () => {});
    const command = 'echo "env:$SPARK_TERMINAL_ENV_TEST"; sleep 60';
    const project = makeProject(command);
    project.terminals = [
      { id: 'main', name: '前端', cwd: '', command, port: null, env: { SPARK_TERMINAL_ENV_TEST: 'frontend' } },
      { id: 'api', name: '后端', cwd: '', command, port: null, env: { SPARK_TERMINAL_ENV_TEST: 'backend' } },
      { id: 'empty', name: '空变量', cwd: '', command, port: null, env: {} },
    ];
    try {
      pm.start(project, settings);
      await waitForStatus(pm, project.id, 'running');
      const output = (key: string) =>
        logs
          .replay(key)
          .filter((line) => line.line.startsWith('env:'))
          .map((line) => line.line);
      expect(output(`${project.id}:main`)).toEqual(['env:frontend']);
      expect(output(`${project.id}:api`)).toEqual(['env:backend']);
      expect(output(`${project.id}:empty`)).toEqual(['env:']);
    } finally {
      await pm.stop(project);
    }
  });
});
