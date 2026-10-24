import type { ProjectWithState, ResourceUsage } from '@spark/shared';
import { getResource, store } from '../stores/app.js';
export function memory(bytes: number): string {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function metric(
  resource: ResourceUsage | undefined | null,
  field: 'memoryBytes' | 'cpuPercent' | 'processCount',
): string {
  if (!resource) return '采集中';
  if (resource.status === 'stopped') return '—';
  if (resource.status === 'unavailable') return '不可用';
  if (resource[field] == null) return resource.status === 'collecting' ? '采集中' : '不可用';
  return field === 'memoryBytes'
    ? memory(resource[field]!)
    : field === 'cpuPercent'
      ? `${resource[field]!.toFixed(1)}%`
      : `${resource[field]}`;
}
export const sortOptions = [
  { value: 'default', label: '默认排序' },
  { value: 'status', label: '启动状态（运行优先）' },
  { value: 'memoryBytes', label: '内存从高到低' },
  { value: 'cpuPercent', label: 'CPU 从高到低' },
];
export function sortProjects(projects: ProjectWithState[], key: string): ProjectWithState[] {
  if (key === 'default') return projects;
  if (key === 'status') {
    const isActive = (project: ProjectWithState) =>
      ['running', 'starting', 'partial'].includes(project.status);
    return [...projects].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
  }
  return [...projects].sort((a, b) => {
    const value = (id: string) => {
      const r = getResource(id);
      return r && r.status !== 'stopped' && r.status !== 'unavailable'
        ? ((key === 'memoryBytes' ? r.memoryBytes : r.cpuPercent) ?? -1)
        : -1;
    };
    return value(b.id) - value(a.id);
  });
}
export function freshness(resource: ResourceUsage | null | undefined, now: number): string {
  if (!resource?.sampledAt) return resource?.status === 'stopped' ? '已停止' : '等待采样';
  const seconds = Math.max(0, Math.floor((now - resource.sampledAt) / 1000));
  return seconds > Math.max(15, ((store.resources?.intervalMs ?? 5000) * 3) / 1000)
    ? `数据已过期 · ${seconds} 秒前`
    : `${seconds} 秒前更新`;
}
