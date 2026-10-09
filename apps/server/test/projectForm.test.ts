import { describe, expect, it } from 'vitest';
import { normalizePortInput } from '../../web/src/utils/projectForm.js';

describe('终端端口表单值', () => {
  it('接受数字输入框返回的数字以及从配置读回的字符串', () => {
    expect(normalizePortInput(5177)).toBe(5177);
    expect(normalizePortInput('5177')).toBe(5177);
    expect(normalizePortInput(3001)).toBe(3001);
    expect(normalizePortInput(' 3001 ')).toBe(3001);
  });
  it('清空端口后保存为 null', () => {
    expect(normalizePortInput('')).toBeNull();
    expect(normalizePortInput(' ')).toBeNull();
  });
  it('拒绝非整数、无效数字和越界端口', () => {
    for (const value of [0, -1, 65536, 12.5, Number.NaN, 'invalid']) {
      expect(() => normalizePortInput(value)).toThrow('端口必须是 1-65535 的整数');
    }
  });
});
