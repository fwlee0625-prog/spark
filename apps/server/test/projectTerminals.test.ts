import fsp from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { ApiError, PortStatus, ProjectWithState } from '@spark/shared';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../src/core/configStore.js';
import { LogBufferManager } from '../src/core/logBuffer.js';
import { PortMonitor } from '../src/core/portMonitor.js';
import { getPortStatus } from '../src/core/portStatus.js';
import { ProcessManager } from '../src/core/processManager.js';
import { groupsRouter } from '../src/routes/groups.js';
import { portsRouter } from '../src/routes/ports.js';
import { projectsRouter } from '../src/routes/projects.js';
import { settingsRouter } from '../src/routes/settings.js';

vi.mock('../src/core/portStatus.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/portStatus.js')>()),
  getPortStatus: vi.fn(),
}));
let dir: string;
let server: Server;
let url: string;
let ctx: { store: ConfigStore; logs: LogBufferManager; pm: ProcessManager; ports: PortMonitor };
beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spark-terminal-api-'));
  await fsp.mkdir(path.join(dir, 'frontend'));
  await fsp.mkdir(path.join(dir, 'backend'));
  const store = new ConfigStore({
    projectsFile: path.join(dir, 'projects.json'),
    settingsFile: path.join(dir, 'settings.json'),
  });
  await store.init();
  const logs = new LogBufferManager(100);
  const pm = new ProcessManager(logs, () => {});
  ctx = { store, logs, pm, ports: new PortMonitor(store, pm) };
  const app = express();
  app.use(express.json());
  app.use('/projects', projectsRouter(ctx));
  app.use('/groups', groupsRouter(ctx));
  app.use('/ports', portsRouter(ctx));
  app.use('/settings', settingsRouter(ctx));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.mocked(getPortStatus).mockImplementation(async (port) => ({
    port,
    occupied: port === 8000,
    source: port === 8000 ? 'external' : null,
  }));
});
afterEach(async () => {
  await ctx.pm.stopAll(ctx.store.listProjects());
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function request<T = ProjectWithState & ApiError & { blocked: { reason: string }[] }>(
  route: string,
  method = 'GET',
  body?: unknown,
) {
  const res = await fetch(url + route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
function input() {
  return {
    name: '全栈项目',
    cwd: dir,
    terminals: [
      {
        id: 'main',
        number: 1,
        name: '前端',
        env: { APP_MODE: 'frontend' },
        cwd: 'frontend',
        command: 'pnpm dev',
        port: 5173,
      },
      {
        id: 'api',
        number: 3,
        name: '后端',
        env: { APP_MODE: 'backend' },
        cwd: 'backend',
        command: 'python app.py',
        port: 8000,
      },
    ],
  };
}
describe('项目多终端 API', () => {
  it('退出设置默认保留项目，布尔值可以保存，拒绝字符串', async () => {
    expect((await request<{ stopProjectsOnExit: boolean }>('/settings')).body.stopProjectsOnExit).toBe(false);
    expect(
      (await request<{ stopProjectsOnExit: boolean }>('/settings', 'PUT', { stopProjectsOnExit: true })).body
        .stopProjectsOnExit,
    ).toBe(true);
    expect((await request('/settings', 'PUT', { stopProjectsOnExit: 'false' })).status).toBe(400);
    expect(ctx.store.getSettings().stopProjectsOnExit).toBe(true);
    expect(
      (await request<{ stopProjectsOnExit: boolean }>('/settings', 'PUT', { stopProjectsOnExit: false })).body
        .stopProjectsOnExit,
    ).toBe(false);
  });
  it('从新建、展示到修改，保存多个终端并返回各自状态', async () => {
    const created = await request('/projects', 'POST', input());
    expect(created.status).toBe(201);
    expect(created.body.terminalStates.map((t: { status: string }) => t.status)).toEqual(['stopped', 'stopped']);
    expect(created.body.terminals[0].command).toBe('pnpm dev');
    const listed = await request<ProjectWithState[]>('/projects');
    expect(listed.body[0].terminals).toEqual(input().terminals);
    const edited = await request(`/projects/${created.body.id}`, 'PUT', { terminals: [input().terminals[0]] });
    expect(edited.status).toBe(200);
    expect(edited.body.terminalStates).toHaveLength(1);
  });
  it('检查第二个终端的端口冲突，项目和分组启动都不会遗漏', async () => {
    const { body: project } = await request('/projects', 'POST', input());
    const start = vi.spyOn(ctx.pm, 'start');
    const result = await request(`/projects/${project.id}/start`, 'POST');
    expect(result.status).toBe(409);
    expect(result.body.port!.port).toBe(8000);
    expect(start).not.toHaveBeenCalled();
    const group = await ctx.store.addGroup('全栈', [project.id]);
    const grouped = await request(`/groups/${group.id}/start`, 'POST');
    expect(grouped.body.blocked[0].reason).toContain('8000');
    expect(start).not.toHaveBeenCalled();
    const ports = await request<PortStatus[]>('/ports');
    expect(ports.body.map((p: { port: number }) => p.port)).toEqual([5173, 8000]);
  });
  it('独立清空日志只影响所选终端；未知终端不被接受', async () => {
    const { body: project } = await request('/projects', 'POST', input());
    ctx.logs.pushLine(`${project.id}:main`, 'front-log', 'stdout');
    ctx.logs.pushLine(`${project.id}:api`, 'back-log', 'stdout');
    expect((await request(`/projects/${project.id}/logs/clear?terminalId=api`, 'POST')).status).toBe(200);
    expect(ctx.logs.replay(`${project.id}:main`)).toHaveLength(1);
    expect(ctx.logs.replay(`${project.id}:api`)).toHaveLength(0);
    expect((await request(`/projects/${project.id}/logs/clear?terminalId=unknown`, 'POST')).status).toBe(404);
    expect((await request(`/projects/${project.id}/terminals/unknown/start`, 'POST')).status).toBe(404);
    const conflict = await request(`/projects/${project.id}/terminals/api/start`, 'POST');
    expect(conflict.status).toBe(409);
  });
  it('拒绝空项目目录、重复端口和不存在的终端目录，终端配置必填', async () => {
    expect((await request('/projects', 'POST', { ...input(), cwd: '' })).status).toBe(400);
    const invalid = input();
    invalid.terminals[1].port = 5173;
    expect((await request('/projects', 'POST', invalid)).status).toBe(400);
    invalid.terminals[1].port = 8000;
    invalid.terminals[1].cwd = 'missing';
    expect((await request('/projects', 'POST', invalid)).status).toBe(400);
    const missing = await request('/projects', 'POST', { name: '缺少终端', cwd: dir });
    expect(missing.status).toBe(400);
  });
});
