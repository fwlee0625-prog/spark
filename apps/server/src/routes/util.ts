import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TerminalConfig } from '@spark/shared';
import type { RequestHandler } from 'express';
import type { RunningGroup } from '../core/portStatus.js';
import type { SparkContext } from './projects.js';

/** 包装异步 handler,拒绝的 Promise 转交 express 错误处理 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 运行中项目列表,附带 cwd 供端口归属判定 */
export function runningGroupsWithCwd(ctx: SparkContext): RunningGroup[] {
  return ctx.pm.runningGroups().map((g) => ({ ...g, cwd: g.cwd ?? ctx.store.getProject(g.id)?.cwd }));
}

/** 端口入参规范化:空/无效返回 null,非法范围抛错由调用方处理 */
export function normalizePort(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new RangeError('端口必须是 1-65535 的整数');
  }
  return n;
}

export function normalizeEnv(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim()) result[k.trim()] = String(v ?? '');
  }
  return result;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export function normalizeTerminals(value: unknown, projectCwd: string): TerminalConfig[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('请配置 1-20 个终端');
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const ports = new Set<number>();
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('终端配置无效');
    const row = item as Record<string, unknown>;
    const id = row.id === undefined ? `t_${randomUUID().slice(0, 8)}` : String(row.id);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('终端 ID 无效或重复');
    ids.add(id);
    const number = row.number;
    if (number !== undefined) {
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || numbers.has(number))
        throw new Error('终端编号无效或重复');
      numbers.add(number);
    }
    const name = String(row.name ?? '').trim();
    const command = String(row.command ?? '').trim();
    const cwd = String(row.cwd ?? '').trim();
    if (!name || !command) throw new Error('每个终端的名称和启动命令均必填');
    const absoluteCwd = path.resolve(projectCwd, cwd || '.');
    if (!fs.existsSync(absoluteCwd) || !fs.statSync(absoluteCwd).isDirectory())
      throw new Error(`终端「${name}」目录不存在`);
    const port = normalizePort(row.port);
    if (port !== null && ports.has(port)) throw new Error('同一项目的终端不能配置重复端口');
    if (port !== null) ports.add(port);
    return {
      id,
      name,
      cwd,
      command,
      port,
      ...(number === undefined ? {} : { number: number as number }),
      env: normalizeEnv(row.env),
    };
  });
}
