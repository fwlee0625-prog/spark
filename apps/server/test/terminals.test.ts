import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { terminalKey } from '@spark/shared';
import { normalizeTerminals } from '../src/routes/util.js';

const base = { id: 'main', name: '前端', cwd: '', command: 'pnpm dev', port: 5173, env: {} };
describe('终端配置', () => {
  it('各终端使用独立日志键', () => {
    expect(terminalKey('p_demo', 'main')).toBe('p_demo:main');
    expect(terminalKey('p_demo', 'api')).toBe('p_demo:api');
  });
  it('校验全部终端的目录、命令、端口及重复配置', () => {
    expect(normalizeTerminals([base], os.tmpdir())).toEqual([base]);
    expect(normalizeTerminals([{ ...base, number: 3 }], os.tmpdir())[0].number).toBe(3);
    expect(() => normalizeTerminals([{ ...base, number: 0 }], os.tmpdir())).toThrow('编号');
    expect(() => normalizeTerminals([{ ...base, number: 3 }, { ...base, id: 'api', port: null, number: 3 }], os.tmpdir())).toThrow('编号');
    expect(normalizeTerminals([{ ...base, cwd: '.' }], os.tmpdir())[0].cwd).toBe('.');
    expect(() => normalizeTerminals([], os.tmpdir())).toThrow();
    expect(() => normalizeTerminals([{ ...base, command: ' ' }], os.tmpdir())).toThrow('启动命令');
    expect(() => normalizeTerminals([{ ...base, cwd: '/missing-spark-terminal' }], os.tmpdir())).toThrow('目录不存在');
    expect(() => normalizeTerminals([{ ...base, port: 65536 }], os.tmpdir())).toThrow('端口');
    expect(() => normalizeTerminals([base, base], os.tmpdir())).toThrow('ID');
    expect(() => normalizeTerminals([base, { ...base, id: 'api' }], os.tmpdir())).toThrow('重复端口');
  });
});
