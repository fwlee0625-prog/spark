import type { Group, ProjectWithState, Settings, StatusEvent } from '@spark/shared';
import { reactive } from 'vue';
import { api, type SettingsWithDir } from '../api/client.js';

interface AppState {
  loaded: boolean;
  connected: boolean;
  projects: ProjectWithState[];
  groups: Group[];
  settings: SettingsWithDir | null;
}

export const store = reactive<AppState>({
  loaded: false,
  connected: false,
  projects: [],
  groups: [],
  settings: null,
});

export async function refreshProjects(): Promise<void> {
  store.projects = await api.listProjects();
}

export async function refreshGroups(): Promise<void> {
  store.groups = await api.listGroups();
}

export async function refreshSettings(): Promise<void> {
  store.settings = await api.getSettings();
}

export async function initStore(): Promise<void> {
  await Promise.all([refreshProjects(), refreshGroups(), refreshSettings()]);
  store.loaded = true;
  connectEvents();
}

/** 订阅状态变更推送,实时刷新状态点 */
function connectEvents(): void {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    store.connected = true;
    void refreshProjects();
  };
  es.onerror = () => (store.connected = false);
  es.onmessage = (e) => {
    const evt = JSON.parse(e.data) as StatusEvent;
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
