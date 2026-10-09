import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/core/configStore.js';

let dir: string;
const dirs: string[] = [];

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spark-config-'));
  dirs.push(dir);
});

afterAll(async () => {
  await Promise.all(dirs.map((d) => fsp.rm(d, { force: true, recursive: true })));
});

function makeStore(): ConfigStore {
  return new ConfigStore({ projectsFile: path.join(dir, 'projects.json'), settingsFile: path.join(dir, 'settings.json') });
}

const baseProject = {
  name: 'demo',
  type: 'vue',
  cwd: '/tmp/demo',
  terminals: [{ id: 'main', name: '终端 1', cwd: '', command: 'pnpm dev', port: 5173 as number | null, env: {} }],
  groupIds: [],
  autoRestart: false,
};

describe('ConfigStore', () => {
  it('addProject 原子写入并持久化到磁盘', async () => {
    const store = makeStore();
    await store.init();
    const p = await store.addProject(baseProject);
    expect(p.id).toMatch(/^p_/);

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'));
    expect(raw.projects).toHaveLength(1);
    expect(raw.projects[0].name).toBe('demo');
    // 无临时文件残留
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('重启(init)后可恢复数据', async () => {
    const store = makeStore();
    await store.init();
    const p = await store.addProject(baseProject);
    await store.addGroup('电商前后端', [p.id]);

    const store2 = makeStore();
    await store2.init();
    expect(store2.listProjects()[0].id).toBe(p.id);
    expect(store2.listGroups()[0].name).toBe('电商前后端');
  });

  it('损坏的配置文件被备份并按空配置继续', async () => {
    fs.writeFileSync(path.join(dir, 'projects.json'), '{ not valid json !!!');
    const store = makeStore();
    await store.init();
    expect(store.listProjects()).toHaveLength(0);
    expect(store.corruptBackups).toHaveLength(1);
    const backup = store.corruptBackups[0];
    expect(fs.existsSync(backup)).toBe(true);
    expect(fs.readFileSync(backup, 'utf8')).toContain('not valid json');
  });

  it('updateProject / deleteProject 正确落盘', async () => {
    const store = makeStore();
    await store.init();
    const p = await store.addProject(baseProject);

    await store.updateProject(p.id, { terminals: [{ ...baseProject.terminals[0], command: 'pnpm build', port: null }] });
    expect(store.getProject(p.id)?.terminals[0].command).toBe('pnpm build');

    const ok = await store.deleteProject(p.id);
    expect(ok).toBe(true);
    expect(store.getProject(p.id)).toBeNull();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'));
    expect(raw.projects).toHaveLength(0);
  });

  it('删除项目时同步清理分组引用', async () => {
    const store = makeStore();
    await store.init();
    const p = await store.addProject(baseProject);
    await store.addGroup('g1', [p.id]);

    await store.deleteProject(p.id);
    expect(store.listGroups()[0].projectIds).toHaveLength(0);
  });

  it('settings 更新与恢复', async () => {
    const store = makeStore();
    await store.init();
    expect(store.getSettings().shellMode).toBe('login');
    expect(store.getSettings().stopProjectsOnExit).toBe(false);

    await store.updateSettings({ shellMode: 'non-login', logMaxLines: 2000, stopProjectsOnExit: true });
    const store2 = makeStore();
    await store2.init();
    expect(store2.getSettings().shellMode).toBe('non-login');
    expect(store2.getSettings().logMaxLines).toBe(2000);
    expect(store2.getSettings().stopProjectsOnExit).toBe(true);
  });

  it('并发写入被串行化,不互相覆盖', async () => {
    const store = makeStore();
    await store.init();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.addProject({ ...baseProject, name: `p${i}` })),
    );
    expect(store.listProjects()).toHaveLength(10);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'));
    expect(raw.projects).toHaveLength(10);
  });

  it('多终端配置重载后保留名称、目录、命令和端口', async () => {
    const store = makeStore();
    await store.init();
    const terminals = [
      { id: 'main', number: 1, name: '前端', env: { APP_MODE: 'frontend' }, cwd: 'frontend', command: 'pnpm dev', port: 5173 },
      { id: 'api', number: 3, name: '后端', env: { APP_MODE: 'backend' }, cwd: 'backend', command: 'python app.py', port: 8000 },
    ];
    const project = await store.addProject({ ...baseProject, terminals });
    const reloaded = makeStore();
    await reloaded.init();
    expect(reloaded.getProject(project.id)?.terminals).toEqual(terminals);
  });

});
