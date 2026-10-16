import type { PortStatus } from '@spark/shared';
import type { ConfigStore } from './configStore.js';
import { getPortStatus, scanManagedPorts } from './portStatus.js';
import type { ProcessManager } from './processManager.js';

/** 统一端口快照供页面与状态推送使用，扫描期间的重复请求共用一次结果。 */
export class PortMonitor {
  private pending: Promise<PortStatus[]> | null = null;
  private timer?: NodeJS.Timeout;
  constructor(
    private store: ConfigStore,
    private pm: ProcessManager,
  ) {}

  start(): void {
    if (this.timer) return;
    const refresh = () => {
      void this.refresh().catch((err) => console.warn('[spark] 端口扫描失败:', (err as Error).message));
    };
    refresh();
    this.timer = setInterval(refresh, 3000);
    this.timer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  refresh(): Promise<PortStatus[]> {
    if (this.pending) return this.pending;
    const pending = this.scan().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private async scan(): Promise<PortStatus[]> {
    const groups = this.pm.runningGroups();
    const discovered = await scanManagedPorts(groups);
    const configured = [
      ...new Set(
        this.store.listProjects().flatMap((p) => p.terminals.flatMap((t) => (t.port === null ? [] : [t.port]))),
      ),
    ];
    const missing = configured.filter((port) => !discovered.some((s) => s.port === port));
    const statuses = [...discovered, ...(await Promise.all(missing.map((port) => getPortStatus(port, groups))))];
    this.pm.updateListeningPorts(groups, discovered);
    return statuses
      .sort((a, b) => a.port - b.port)
      .map((status) => {
        const project = status.projectId ? this.store.getProject(status.projectId) : null;
        const terminal = project?.terminals.find((t) => t.id === status.terminalId);
        return {
          ...status,
          ...(project ? { projectName: project.name } : {}),
          ...(terminal ? { terminalName: terminal.name } : {}),
        };
      });
  }
}
