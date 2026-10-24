import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { HOST, PORT, WEB_DIST } from './config.js';

const { app, ctx } = await createApp();
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    ctx.appLogs.add(
      level,
      args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Error) return arg.stack ?? arg.message;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' '),
    );
  };
}
ctx.ports.start();
ctx.resources.start();

for (const backup of ctx.store.corruptBackups) {
  console.warn(`[spark] 配置文件损坏,已备份到 ${backup},并以空配置继续`);
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[spark] 服务已启动: http://${HOST}:${PORT}`);
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    console.warn(`[spark] 未找到前端构建产物(${WEB_DIST}),页面不可用,请在仓库根目录先运行 pnpm build`);
  }
  console.log(
    ctx.store.getSettings().stopProjectsOnExit
      ? '[spark] 退出时将停止所有项目'
      : '[spark] 退出时保留项目运行，下次启动自动恢复管理',
  );
});

// 端口被占用等启动失败:给出可操作的提示,而不是抛出堆栈
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[spark] 端口 ${PORT} 已被占用,无法启动。`);
    console.error('[spark] 大概率 Spark 已在运行,直接访问 http://127.0.0.1:7788 即可;');
    console.error(`[spark] 如需重启:lsof -ti tcp:${PORT} 查到进程后 kill -TERM <pid>(不要用 kill -9)。`);
    process.exit(1);
  }
  throw err;
});

let shuttingDown = false;

/** 按设置停止项目或保留后台运行。 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ctx.ports.stop();
  ctx.resources.stop();
  console.log(`[spark] 收到 ${signal},正在退出…`);
  try {
    await ctx.pm.shutdown(ctx.store.listProjects(), ctx.store.getSettings());
  } catch (err) {
    console.error('[spark] 清理项目进程时出错:', err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
