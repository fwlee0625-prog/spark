import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_SETTINGS, type Project } from '@spark/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LogBufferManager } from '../src/core/logBuffer.js';
import { ProcessManager } from '../src/core/processManager.js';
import { processIdentity, normalizeProcessIdentity } from '../src/core/processRecords.js';

let dir: string;
let project: Project;
const managers: ProcessManager[] = [];
const settings = { ...DEFAULT_SETTINGS, shellMode: 'direct' as const };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function manager() {
  const logs = new LogBufferManager(100);
  const pm = new ProcessManager(logs, () => {}, path.join(dir, 'runtime'));
  managers.push(pm);
  return { pm, logs };
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-recovery-'));
  project = {
    id: 'project',
    name: 'recovery',
    type: 'generic',
    cwd: dir,
    groupIds: [],
    autoRestart: false,
    createdAt: 0,
    terminals: [
      {
        id: 'main',
        name: 'main',
        cwd: '',
        env: {},
        port: null,
        command: 'while true; do echo still-running; echo still-error >&2; sleep 0.1; done',
      },
    ],
  };
});
afterEach(async () => {
  for (const pm of managers.splice(0)) {
    await pm.stopAll([project]);
    pm.detach();
  }
  await fs.rm(dir, { recursive: true, force: true });
});
it('管理进程真正退出后项目仍运行；重建管理器恢复状态、持续日志及停止能力', async () => {
  await promisify(execFile)(process.execPath, [
    '--import',
    'tsx',
    fileURLToPath(new URL('./fixtures/detachedManager.ts', import.meta.url)),
    JSON.stringify(project),
    path.join(dir, 'runtime'),
  ]);
  const { pm, logs } = manager();
  pm.restore([project], settings);
  expect(pm.getState(project.id).status).toBe('running');
  const pid = pm.getState(project.id).pid!;
  expect(() => process.kill(pid, 0)).not.toThrow();
  expect(() => pm.start(project, settings)).toThrow('已在运行中');
  logs.clear('project:main');
  await delay(500);
  expect(logs.replay('project:main').some((line) => line.line === 'still-running')).toBe(true);
  expect(logs.replay('project:main').some((line) => line.stream === 'stderr' && line.line === 'still-error')).toBe(
    true,
  );
  await pm.stop(project);
  expect(pm.getState(project.id).status).toBe('stopped');
  expect(pm.getState(project.id).pid).toBeNull();
  expect(() => process.kill(pid, 0)).toThrow();
});
it('离线退出的终端清除旧记录，多终端状态恢复为部分运行', async () => {
  project.terminals.push({ ...project.terminals[0], id: 'short', command: 'sleep 0.7' });
  const first = manager().pm;
  first.start(project, settings);
  first.detach();
  await delay(1000);
  const second = manager().pm;
  second.restore([project], settings);
  expect(second.getState(project.id).status).toBe('partial');
  expect(second.terminalStates(project).map((t) => t.status)).toEqual(['running', 'stopped']);
  const files = await fs.readdir(path.join(dir, 'runtime'));
  expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(1);
  await second.stop(project);
});
it('身份不匹配时不接管同 PID 的进程', async () => {
  const first = manager().pm;
  first.start(project, settings);
  const pid = first.getState(project.id).pid!;
  first.detach();
  const file = path.join(dir, 'runtime', `${Buffer.from('project:main').toString('hex')}.json`);
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...record, identity: 'different start time' }));
  const second = manager().pm;
  second.restore([project], settings);
  expect(second.getState(project.id).status).toBe('stopped');
  await second.stop(project);
  expect(() => process.kill(pid, 0)).not.toThrow();
});
it('接管的进程随后退出时同步状态并清除记录', async () => {
  const first = manager().pm;
  first.start(project, settings);
  first.detach();
  const second = manager().pm;
  second.restore([project], settings);
  const pid = second.getState(project.id).pid;
  expect(pid).toBeGreaterThan(1);
  if (pid === null || pid <= 1) throw new Error('未恢复进程');
  process.kill(-pid, 'SIGTERM');
  await delay(2300);
  expect(second.getState(project.id).status).toBe('stopped');
  expect((await fs.readdir(path.join(dir, 'runtime'))).filter((name) => name.endsWith('.json'))).toHaveLength(0);
});

it('开启退出时停止项目后，真实管理进程退出会清理项目和记录', async () => {
  await promisify(execFile)(process.execPath, [
    '--import',
    'tsx',
    fileURLToPath(new URL('./fixtures/detachedManager.ts', import.meta.url)),
    JSON.stringify(project),
    path.join(dir, 'runtime'),
    'stop',
  ]);
  expect((await fs.readdir(path.join(dir, 'runtime'))).filter((name) => name.endsWith('.json'))).toHaveLength(0);
  const { pm } = manager();
  pm.restore([project], settings);
  expect(pm.getState(project.id).status).toBe('stopped');
});

it('接管旧中文locale身份后迁移为与资源采样一致的C身份', async () => {
  const first = manager().pm;
  first.start(project, settings);
  const pid = first.getState(project.id).pid!;
  first.detach();
  const file = path.join(dir, 'runtime', `${Buffer.from('project:main').toString('hex')}.json`);
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  const oldLocale = process.env.LC_ALL;
  try {
    process.env.LC_ALL = 'zh_CN.UTF-8';
    const legacyIdentity = processIdentity(pid, true);
    expect(legacyIdentity).not.toBeNull();
    await fs.writeFile(file, JSON.stringify({ ...record, identity: legacyIdentity }));
    process.env.LC_ALL = 'C';
    const second = manager().pm;
    second.restore([project], settings);
    expect(second.getState(project.id).status).toBe('running');
    const canonicalIdentity = processIdentity(pid);
    expect(second.runningGroups()[0]!.identity).toBe(canonicalIdentity);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).identity).toBe(canonicalIdentity);
    if (process.platform === 'darwin') expect(legacyIdentity).not.toBe(canonicalIdentity);
    await second.stop(project);
  } finally {
    if (oldLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = oldLocale;
  }
});

it('中文旧身份不依赖当前 locale，保留 PID 与精确启动时间校验', () => {
  expect(normalizeProcessIdentity('95102 六 10/17 13:41:52 2026')).toBe('95102 Sat Oct 17 13:41:52 2026');
  expect(normalizeProcessIdentity('95102 Sat Oct 17 13:41:52 2026')).toBe('95102 Sat Oct 17 13:41:52 2026');
  expect(normalizeProcessIdentity('different start time')).toBe('different start time');
});
