import { describe, expect, it } from 'vitest';
import { LogBufferManager } from '../src/core/logBuffer.js';

describe('LogBufferManager', () => {
  it('跨 data 分片按 \\n 拼接成完整行', () => {
    const buf = new LogBufferManager(100);
    buf.appendChunk('p1', 'hel', 'stdout');
    buf.appendChunk('p1', 'lo\nwor', 'stdout');
    buf.appendChunk('p1', 'ld\n', 'stdout');
    expect(buf.replay('p1').map((l) => l.line)).toEqual(['hello', 'world']);
  });

  it('stdout 与 stderr 的残留拼接互不干扰', () => {
    const buf = new LogBufferManager(100);
    buf.appendChunk('p1', 'out-1\n', 'stdout');
    buf.appendChunk('p1', 'err', 'stderr'); // stderr 残留
    buf.appendChunk('p1', 'out-ha', 'stdout'); // stdout 残留
    buf.appendChunk('p1', 'lf\n', 'stdout');
    buf.appendChunk('p1', 'or\n', 'stderr');
    const lines = buf.replay('p1');
    expect(lines[0]).toMatchObject({ line: 'out-1', stream: 'stdout' });
    expect(lines[1]).toMatchObject({ line: 'out-half', stream: 'stdout' });
    expect(lines[2]).toMatchObject({ line: 'error', stream: 'stderr' });
  });

  it('超过环形上限时丢弃最旧的行', () => {
    const buf = new LogBufferManager(5);
    for (let i = 1; i <= 8; i++) buf.pushLine('p1', `line-${i}`, 'stdout');
    const lines = buf.replay('p1');
    expect(lines).toHaveLength(5);
    expect(lines[0].line).toBe('line-4');
    expect(lines[4].line).toBe('line-8');
  });

  it('单行超长被截断', () => {
    const buf = new LogBufferManager(100);
    buf.pushLine('p1', 'x'.repeat(9000), 'stdout');
    const line = buf.replay('p1')[0];
    expect(line.line.length).toBeLessThan(9000);
    expect(line.line.endsWith('…[单行超长已截断]')).toBe(true);
  });

  it('新日志实时广播给订阅者', () => {
    const buf = new LogBufferManager(100);
    const received: string[] = [];
    const unsub = buf.subscribe('p1', (l) => received.push(l.line));
    buf.pushLine('p1', 'hello', 'stdout');
    buf.appendChunk('p1', 'wor', 'stdout');
    expect(received).toEqual(['hello']);
    unsub();
    buf.pushLine('p1', 'gone', 'stdout');
    expect(received).toEqual(['hello']);
  });

  it('clear 清空缓冲与行拼接残留', () => {
    const buf = new LogBufferManager(100);
    buf.appendChunk('p1', 'partial', 'stdout');
    buf.clear('p1');
    buf.appendChunk('p1', 'fresh\n', 'stdout');
    expect(buf.replay('p1').map((l) => l.line)).toEqual(['fresh']);
  });

  it('不同项目缓冲相互隔离', () => {
    const buf = new LogBufferManager(100);
    buf.pushLine('a', 'a1', 'stdout');
    buf.pushLine('b', 'b1', 'stdout');
    expect(buf.replay('a').map((l) => l.line)).toEqual(['a1']);
    expect(buf.replay('b').map((l) => l.line)).toEqual(['b1']);
  });
});
