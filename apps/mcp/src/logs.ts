import type { LogLine } from '@spark/shared';

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** 常见错误特征,用于只看报错 */
const ERROR_RE = /\b(error|exception|fatal|fail(?:ed|ure)?|traceback|panic|EADDRINUSE|ECONNREFUSED|ENOENT)\b|ERR!/i;

export interface LogFilter {
  /** 正则(忽略大小写),非法正则时按普通文本匹配 */
  grep?: string;
  stream?: 'stdout' | 'stderr';
  errorsOnly?: boolean;
  stripAnsi?: boolean;
  tail: number;
  /** 输出总字符上限,超出时丢弃最早的行 */
  maxChars?: number;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function buildMatcher(grep: string): (text: string) => boolean {
  try {
    const re = new RegExp(grep, 'i');
    return (text) => re.test(text);
  } catch {
    const needle = grep.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 过滤日志并格式化为文本,返回命中总数与是否被截断 */
export function formatLogs(
  lines: LogLine[],
  filter: LogFilter,
): { text: string; matched: number; returned: number; truncated: boolean } {
  const matcher = filter.grep ? buildMatcher(filter.grep) : null;
  const matched = lines
    .map((l) => ({ ...l, line: filter.stripAnsi === false ? l.line : stripAnsi(l.line) }))
    .filter((l) => (filter.stream ? l.stream === filter.stream : true))
    .filter((l) => (filter.errorsOnly ? l.stream === 'stderr' || ERROR_RE.test(l.line) : true))
    .filter((l) => (matcher ? matcher(l.line) : true));

  let picked = matched.slice(-filter.tail);
  const rows = picked.map((l) => `${formatTime(l.ts)} ${l.stream === 'stderr' ? 'E' : 'O'} ${l.line}`);
  const maxChars = filter.maxChars ?? 30000;
  let total = 0;
  let start = rows.length;
  while (start > 0 && total + rows[start - 1]!.length + 1 <= maxChars) {
    start -= 1;
    total += rows[start]!.length + 1;
  }
  picked = picked.slice(start);
  return {
    text: rows.slice(start).join('\n'),
    matched: matched.length,
    returned: picked.length,
    truncated: picked.length < matched.length,
  };
}
