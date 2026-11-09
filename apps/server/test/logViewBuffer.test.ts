import { describe, expect, it } from 'vitest';
import { LogViewBuffer } from '../../web/src/utils/logViewBuffer.js';

const line = (text: string) => ({ line: text, ts: 1, stream: 'stdout' as const });

describe('terminal log view buffer', () => {
  it('bounds a full replay and retains stable rendered entries across live batches', () => {
    const buffer = new LogViewBuffer();
    for (let i = 0; i < 6000; i++) buffer.append(line(`line-${i}`));
    const replay = buffer.flush([]);
    expect(replay).toHaveLength(5000);
    expect(replay[0].line).toBe('line-1000');
    expect(buffer.flush(replay)).toBe(replay);
    buffer.append(line('live'));
    const live = buffer.flush(replay);
    expect(live).toHaveLength(5000);
    expect(live[0]).toBe(replay[1]);
    expect(live.at(-1)?.id).toBe(6000);
  });

  it('escapes HTML and preserves ANSI state between batches', () => {
    const buffer = new LogViewBuffer();
    buffer.append(line('\x1b[31mred <script>'));
    const first = buffer.flush([]);
    expect(first[0].html).toContain('&lt;script&gt;');
    expect(first[0].html).toContain('color:');
    buffer.append(line('still red\x1b[0m'));
    expect(buffer.flush(first)[1].html).toContain('color:');
  });

  it('discards pending history and ANSI state when clearing or changing terminals', () => {
    const buffer = new LogViewBuffer();
    buffer.append(line('\x1b[31mold terminal'));
    buffer.clear();
    buffer.append(line('new terminal'));
    const result = buffer.flush([]);
    expect(result).toHaveLength(1);
    expect(result[0].html).toBe('new terminal');
  });
});
