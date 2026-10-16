import { describe, expect, it } from 'vitest';
import type { LogLine } from '@spark/shared';
import { formatLogs, stripAnsi } from '../src/logs.js';

const line = (text: string, stream: LogLine['stream'] = 'stdout', ts = 1730000000000): LogLine => ({ line: text, ts, stream });

describe('formatLogs', () => {
  const lines = [line('\u001b[32mready\u001b[0m'), line('GET / 200'), line('Error: boom', 'stderr'), line('build failed'), line('done')];

  it('去除 ANSI 并只返回最后 N 行', () => {
    const out = formatLogs(lines, { tail: 2 });
    expect(out.returned).toBe(2);
    expect(out.matched).toBe(5);
    expect(out.text).toContain('done');
    expect(out.text).not.toContain('GET');
  });

  it('stripAnsi 清除颜色序列', () => {
    expect(stripAnsi('\u001b[32mok\u001b[0m')).toBe('ok');
  });

  it('errorsOnly 返回 stderr 和含报错关键词的行', () => {
    const out = formatLogs(lines, { tail: 50, errorsOnly: true });
    expect(out.matched).toBe(2);
    expect(out.text).toContain('boom');
    expect(out.text).toContain('build failed');
  });

  it('grep 支持正则,非法正则降级为文本匹配', () => {
    expect(formatLogs(lines, { tail: 50, grep: 'GET|done' }).matched).toBe(2);
    expect(formatLogs([line('a(b')], { tail: 50, grep: '(' }).matched).toBe(1);
  });

  it('超出字符上限时丢弃最早的行并标记截断', () => {
    const many = Array.from({ length: 100 }, (_, i) => line(`line-${i}`));
    const out = formatLogs(many, { tail: 100, maxChars: 200 });
    expect(out.truncated).toBe(true);
    expect(out.text).toContain('line-99');
    expect(out.text).not.toContain('line-0 ');
  });
});
