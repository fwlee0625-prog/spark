import net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { isPortFree, listPortProcesses, pidCwd, pidPgid } from '../src/core/portChecker.js';

let server: net.Server;
let port: number;

function listen(): Promise<void> {
  return new Promise((resolve) => {
    server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as net.AddressInfo).port;
      resolve();
    });
  });
}

afterAll(() => server?.close());

describe('portChecker', () => {
  it('空闲端口检测为 free', async () => {
    // 先向系统借一个空闲端口再释放
    const freePort = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address() as net.AddressInfo;
        s.close(() => resolve(addr.port));
      });
    });
    expect(await isPortFree(freePort)).toBe(true);
  });

  it('被监听的端口检测为 occupied,并可通过 lsof 定位到进程', async () => {
    await listen();
    expect(await isPortFree(port)).toBe(false);

    const procs = await listPortProcesses(port);
    expect(procs.length).toBeGreaterThan(0);
    expect(procs.some((p) => p.pid === process.pid)).toBe(true);
  });

  it('pidPgid 返回当前进程的进程组', async () => {
    const pgid = await pidPgid(process.pid);
    expect(pgid).toBeTypeOf('number');
    expect(pgid).toBeGreaterThan(0);
  });

  it('pidCwd 返回当前进程工作目录', async () => {
    const cwd = await pidCwd(process.pid);
    expect(cwd).toBe(process.cwd());
  });

  it('不存在的进程返回 null', async () => {
    expect(await pidPgid(999999999)).toBeNull();
  });
});
