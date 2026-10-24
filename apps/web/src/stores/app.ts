import type {
  Group,
  ProjectWithState,
  ResourceHistoryPoint,
  ResourceSnapshot,
  Settings,
  StatusEvent,
} from '@spark/shared';
import { reactive } from 'vue';
import { api, type SettingsWithDir } from '../api/client.js';

interface AppState {
  resources: ResourceSnapshot | null;
  resourceHistory: Record<string, ResourceHistoryPoint[]>;
  loaded: boolean;
  connected: boolean;
  projects: ProjectWithState[];
  groups: Group[];
  settings: SettingsWithDir | null;
}

export const store = reactive<AppState>({
  resources: null,
  resourceHistory: {},
  loaded: false,
  connected: false,
  projects: [],
  groups: [],
  settings: null,
});

export async function refreshProjects(): Promise<void> {
  store.projects = await api.listProjects();
  for (const id of Object.keys(store.resourceHistory)) {
    if (!store.projects.some((p) => p.id === id)) delete store.resourceHistory[id];
  }
}

export async function refreshGroups(): Promise<void> {
  store.groups = await api.listGroups();
}

export async function refreshSettings(): Promise<void> {
  store.settings = await api.getSettings();
}

export async function initStore(): Promise<void> {
  await Promise.all([refreshProjects(), refreshGroups(), refreshSettings()]);
  await refreshResources();
  store.loaded = true;
  connectEvents();
}

/** 订阅状态变更推送,实时刷新状态点 */
function connectEvents(): void {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    store.connected = true;
    void refreshProjects();
    void refreshResources();
  };
  es.onerror = () => (store.connected = false);
  es.onmessage = (e) => {
    let evt: StatusEvent | ResourceSnapshot;
    try {
      evt = JSON.parse(e.data) as StatusEvent | ResourceSnapshot;
    } catch {
      return;
    }
    if ('type' in evt && evt.type === 'resources') {
      applyResources(evt);
      return;
    }
    if (!('id' in evt)) return;
    const p = store.projects.find((x) => x.id === evt.id);
    if (!p) return;
    p.status = evt.status;
    p.pid = evt.pid;
    p.startedAt = evt.startedAt;
    p.exitCode = evt.exitCode;
    if (evt.terminalStates) p.terminalStates = evt.terminalStates;
  };
}

export function getProject(id: string): ProjectWithState | undefined {
  return store.projects.find((p) => p.id === id);
}

export async function reloadSettingsQuietly(): Promise<void> {
  try {
    await refreshSettings();
  } catch {
    /* 忽略 */
  }
}

export type { Settings };

export function applyResources(snapshot: ResourceSnapshot): void {
  if (store.resources && snapshot.sampledAt < store.resources.sampledAt) return;
  store.resources = snapshot;
  for (const id of Object.keys(store.resourceHistory)) {
    if (!snapshot.projects.some((p) => p.projectId === id)) delete store.resourceHistory[id];
  }
  for (const project of snapshot.projects) {
    const points = (store.resourceHistory[project.projectId] ?? []).filter(
      (p) => p.timestamp > snapshot.sampledAt - 900000,
    );
    if (project.sampledAt == null || points.some((p) => p.timestamp === project.sampledAt)) {
      store.resourceHistory[project.projectId] = points;
      continue;
    }
    const point: ResourceHistoryPoint = {
      timestamp: project.sampledAt,
      sampledAt: project.sampledAt,
      status: project.status,
      memoryBytes: project.memoryBytes,
      cpuPercent: project.cpuPercent,
      processCount: project.processCount,
      runId: project.runId,
    };
    store.resourceHistory[project.projectId] = [...points, point]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-1000);
  }
}
export async function refreshResources(): Promise<void> {
  try {
    applyResources(await api.getResources());
  } catch {
    /* 资源采集独立于项目管理 */
  }
}
export function getResource(id: string) {
  return store.resources?.projects.find((p) => p.projectId === id);
}
