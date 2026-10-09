/** 运行时长:2小时12分钟 / 43分钟 / 12秒 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}小时${m}分钟`;
  if (m > 0) return `${m}分钟`;
  return `${s}秒`;
}

/** HH:mm:ss */
export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** MM-DD HH:mm */
export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 路径最后一段作为目录名 */
export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export interface TypeMeta {
  label: string;
  badgeClass: string;
  dotClass: string;
  letter: string;
}

/** 项目类型 → 展示标签与配色 */
export function typeMeta(type: string): TypeMeta {
  switch (type) {
    case 'vue':
    case 'react':
      return { label: '前端', badgeClass: 'bg-emerald-50 text-emerald-600', dotClass: 'bg-emerald-500', letter: 'V' };
    case 'python':
    case 'node':
      return { label: '后端', badgeClass: 'bg-blue-50 text-blue-600', dotClass: 'bg-blue-500', letter: 'S' };
    case 'miniprogram':
      return { label: '小程序', badgeClass: 'bg-orange-50 text-orange-600', dotClass: 'bg-orange-500', letter: 'M' };
    case 'tools':
      return { label: '工具', badgeClass: 'bg-purple-50 text-purple-600', dotClass: 'bg-purple-500', letter: 'T' };
    default:
      return { label: '其他', badgeClass: 'bg-slate-100 text-slate-500', dotClass: 'bg-slate-400', letter: '?' };
  }
}
