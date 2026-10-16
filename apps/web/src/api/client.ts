import type {
  ApiError as ApiErrorShape,
  DetectResult,
  FsListing,
  Group,
  PortStatus,
  ProjectWithState,
  Settings,
} from '@spark/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: ApiErrorShape,
  ) {
    super(data?.message ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

let tokenPromise: Promise<string> | null = null;

function getToken(): Promise<string> {
  if (tokenPromise) return tokenPromise;
  const pending = fetch('/api/csrf-token', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`获取请求令牌失败(HTTP ${res.status})`);
      const data = (await res.json()) as { token?: unknown };
      if (typeof data.token !== 'string' || !data.token) throw new Error('请求令牌响应无效');
      return data.token;
    })
    .catch((err: unknown) => {
      if (tokenPromise === pending) tokenPromise = null;
      throw err;
    });
  tokenPromise = pending;
  return pending;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // 仅在服务明确拒绝旧令牌、尚未执行操作时刷新并重试一次。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const pending = method !== 'GET' ? getToken() : null;
    if (pending) headers['X-Spark-Token'] = await pending;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return (await res.json()) as T;
    const data = (await res.json().catch(() => null)) as ApiErrorShape | null;
    if (pending && res.status === 403 && data?.error === 'FORBIDDEN_TOKEN' && attempt === 0) {
      // 并发请求可能已经刷新了令牌，不清空它们的新缓存。
      if (tokenPromise === pending) tokenPromise = null;
      continue;
    }
    throw new ApiError(res.status, data ?? { error: 'UNKNOWN', message: `请求失败(HTTP ${res.status})` });
  }
  throw new Error('请求重试失败');
}

export interface GroupStartResult {
  started: { id: string; name: string }[];
  blocked: { id: string; name: string; reason: string }[];
  failed: { id: string; name: string; reason: string }[];
}

export type SettingsWithDir = Settings & { dataDir: string };
export interface AppLogEntry {
  id: number;
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export const api = {
  listProjects: () => request<ProjectWithState[]>('GET', '/api/projects'),
  createProject: (p: Record<string, unknown>) => request<ProjectWithState>('POST', '/api/projects', p),
  updateProject: (id: string, p: Record<string, unknown>) => request<ProjectWithState>('PUT', `/api/projects/${id}`, p),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
  startProject: (id: string, force = false) =>
    request<{ ok: true }>('POST', `/api/projects/${id}/start${force ? '?force=1' : ''}`),
  stopProject: (id: string) => request<{ ok: true }>('POST', `/api/projects/${id}/stop`),
  restartProject: (id: string) => request<{ ok: true }>('POST', `/api/projects/${id}/restart`),
  terminalAction: (id: string, terminalId: string, action: 'start' | 'stop' | 'restart', force = false) =>
    request<{ ok: true }>('POST', `/api/projects/${id}/terminals/${terminalId}/${action}${force ? '?force=1' : ''}`),
  clearLogs: (id: string, terminalId?: string) =>
    request<{ ok: true }>(
      'POST',
      `/api/projects/${id}/logs/clear${terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : ''}`,
    ),

  listGroups: () => request<Group[]>('GET', '/api/groups'),
  createGroup: (name: string, projectIds: string[]) => request<Group>('POST', '/api/groups', { name, projectIds }),
  updateGroup: (id: string, patch: { name?: string; projectIds?: string[] }) =>
    request<Group>('PUT', `/api/groups/${id}`, patch),
  deleteGroup: (id: string) => request<{ ok: true }>('DELETE', `/api/groups/${id}`),
  startGroup: (id: string) => request<GroupStartResult>('POST', `/api/groups/${id}/start`),
  stopGroup: (id: string) => request<{ ok: true }>('POST', `/api/groups/${id}/stop`),

  detect: (dir: string) => request<DetectResult>('POST', '/api/detect', { dir }),
  /** 列出某目录下的子目录(文件夹选择器用);dir 为空或 ~ 时返回主目录 */
  listDir: (dir: string, showHidden = false) =>
    request<FsListing>('GET', `/api/fs/list?path=${encodeURIComponent(dir)}&hidden=${showHidden ? 1 : 0}`),
  scanPorts: () => request<PortStatus[]>('GET', '/api/ports'),
  portStatus: (port: number) => request<PortStatus>('GET', `/api/ports/${port}`),

  getSettings: () => request<SettingsWithDir>('GET', '/api/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),
  getAppLogs: (limit = 1000) => request<AppLogEntry[]>('GET', `/api/app-logs?limit=${limit}`),
  clearAppLogs: () => request<{ ok: true }>('DELETE', '/api/app-logs'),
};
