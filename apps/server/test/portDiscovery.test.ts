import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Project, StatusEvent } from '@spark/shared';
import { displayedPorts } from '@spark/shared';
import { parseListeners } from '../src/core/portChecker.js';
import { findProcessOwner } from '../src/core/portStatus.js';
import { ConfigStore } from '../src/core/configStore.js';
import { LogBufferManager } from '../src/core/logBuffer.js';
import { ProcessManager } from '../src/core/processManager.js';
import { PortMonitor } from '../src/core/portMonitor.js';

async function waitUntil(check: () => boolean, timeout = 6000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('等待测试监听进程超时');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('运行时端口发现', () => {
  it('解析 IPv4/IPv6/通配地址，去重同一进程的重复监听记录', () => {
    expect(parseListeners('p101\ncnode server\nf1\nn127.0.0.1:5173\nf2\nn[::1]:5173\nf3\nn*:8000\np102\ncpython\nn[::]:9000\nninvalid\n'))
      .toEqual([{ pid: 101, command: 'node server', port: 5173 }, { pid: 101, command: 'node server', port: 8000 }, { pid: 102, command: 'python', port: 9000 }]);
  });

  it('通过进程祖先匹配另起进程组的子进程，不认领无关监听者', () => {
    const group = { id: 'project', terminalId: 'api', pgid: 100 };
    const relations = [
      { pid: 100, ppid: 1, pgid: 100 }, { pid: 101, ppid: 100, pgid: 101 },
      { pid: 102, ppid: 101, pgid: 102 }, { pid: 200, ppid: 1, pgid: 200 },
    ];
    expect(findProcessOwner(102, [group], relations)).toBe(group);
    expect(findProcessOwner(200, [group], relations)).toBeUndefined();
    expect(findProcessOwner(300, [group], [...relations, { pid: 300, ppid: 1, pgid: 100 }])).toBe(group);
  });

  it('未配置端口时发现实际子进程的多个监听端口，推送到卡片并纳入端口管理，关闭后移除', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spark-discover-'));
    const store = new ConfigStore({ projectsFile: path.join(dir, 'projects.json'), settingsFile: path.join(dir, 'settings.json') });
    await store.init();
    const logs = new LogBufferManager(100);
    const events: StatusEvent[] = [];
    const pm = new ProcessManager(logs, (evt) => events.push(evt));
    const monitor = new PortMonitor(store, pm);
    // shell 是组长，node 监听服务是其子进程；两个端口均由系统随机分配。
    const script = `const net = require("net"); const first = net.createServer(); const second = net.createServer();
      process.on("SIGUSR2", () => first.close(() => console.log("closed:first")));
      first.listen(0, "127.0.0.1", () => second.listen(0, "127.0.0.1", () => {
        console.log("ports:" + first.address().port + "," + second.address().port);
      }));`;
    const executable = "'" + process.execPath.replace(/'/g, "'\\''") + "'";
    const command = `${executable} -e '${script}' & wait`;
    let project: Project | undefined;
    try {
      project = await store.addProject({ name: '自动发现', type: 'node', cwd: dir, groupIds: [], autoRestart: false,
        terminals: [{ id: 'main', name: '服务', cwd: '', command, port: null, env: {} }] });
      pm.start(project, { shellMode: 'direct', stopProjectsOnExit: false, logMaxLines: 100, autoRestartMax: 0 });
      await waitUntil(() => logs.replay(`${project!.id}:main`).some((line) => line.line.startsWith('ports:')));
      const text = logs.replay(`${project.id}:main`).find((line) => line.line.startsWith('ports:'))!.line;
      const expected = text.slice(6).split(',').map(Number).sort((a, b) => a - b);
      const statuses = await monitor.refresh();
      expect(statuses.map((s) => s.port)).toEqual(expected);
      expect(statuses.every((s) => s.projectId === project!.id && s.terminalId === 'main' && s.terminalName === '服务')).toBe(true);
      expect(statuses.every((s) => s.pid !== pm.getState(project!.id).pid)).toBe(true);
      expect(pm.terminalStates(project)[0].listeningPorts).toEqual(expected);
      expect(displayedPorts(pm.terminalStates(project))).toEqual(expected);
      expect(events.at(-1)?.terminalStates?.[0].listeningPorts).toEqual(expected);
      expect(store.getProject(project.id)?.terminals[0].port).toBeNull();
      expect(store.getProject(project.id)?.terminals[0]).not.toHaveProperty('listeningPorts');
      const count = events.length;
      await monitor.refresh();
      expect(events.length).toBe(count);
      // 进程仍存活但关闭一个监听端口，下一次扫描只保留另一个。
      process.kill(statuses[0].pid!, 'SIGUSR2');
      await waitUntil(() => logs.replay(`${project!.id}:main`).some((line) => line.line === 'closed:first'));
      const remaining = Number(text.slice(6).split(',')[1]);
      expect((await monitor.refresh()).map((s) => s.port)).toEqual([remaining]);
      expect(pm.terminalStates(project)[0].listeningPorts).toEqual([remaining]);
      await pm.stop(project);
      expect(pm.terminalStates(project)[0].listeningPorts).toEqual([]);
      expect(await monitor.refresh()).toEqual([]);
    } finally {
      monitor.stop();
      if (project) await pm.stop(project);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
