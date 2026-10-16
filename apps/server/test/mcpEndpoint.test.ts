import fs from 'node:fs';
import type { Server } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let server: Server;
let base: string;
let tmp: string;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-mcp-'));
  const port = await freePort();
  // config.ts 在导入时读取环境变量,需先于导入设置
  vi.stubEnv('SPARK_PORT', String(port));
  vi.stubEnv('SPARK_DATA_DIR', path.join(tmp, 'data'));
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  const { app } = await createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('/mcp 端点', () => {
  it('MCP 客户端可列出工具并通过工具创建、删除项目', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base)));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['create_project', 'get_terminals', 'get_logs', 'control_project']));

    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      return { error: r.isError === true, text: r.content[0]!.text };
    };
    const created = await call('create_project', {
      name: 'demo',
      cwd: tmp,
      terminals: [
        { name: 'web', command: 'echo hi' },
        { name: 'api', command: 'echo api' },
      ],
    });
    expect(created.error).toBe(false);
    expect(JSON.parse(created.text).created.terminalCount).toBe(2);

    const terminals = await call('get_terminals', { project: 'demo' });
    expect(JSON.parse(terminals.text).terminalCount).toBe(2);

    expect((await call('delete_project', { project: 'demo' })).error).toBe(false);
    expect((await call('get_project', { project: 'demo' })).error).toBe(true);
    await client.close();
  });

  it('拒绝带 Origin 的浏览器请求', async () => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('无状态模式下 GET 返回 405', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(405);
  });
});
