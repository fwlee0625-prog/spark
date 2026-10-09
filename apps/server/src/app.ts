import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { DATA_DIR, PORT, PROJECTS_FILE, SETTINGS_FILE, WEB_DIST } from './config.js';
import { ConfigStore } from './core/configStore.js';
import { LogBufferManager } from './core/logBuffer.js';
import { StatusHub } from './core/sseHub.js';
import { PortMonitor } from './core/portMonitor.js';
import { ProcessManager } from './core/processManager.js';
import { projectsRouter } from './routes/projects.js';
import { groupsRouter } from './routes/groups.js';
import { detectRouter } from './routes/detect.js';
import { fsRouter } from './routes/fs.js';
import { portsRouter } from './routes/ports.js';
import { settingsRouter } from './routes/settings.js';

export interface SparkContext {
  store: ConfigStore;
  logs: LogBufferManager;
  pm: ProcessManager;
  hub: StatusHub;
  ports: PortMonitor;
}

export async function createApp(): Promise<{ app: express.Express; ctx: SparkContext; csrfToken: string }> {
  const store = new ConfigStore({ projectsFile: PROJECTS_FILE, settingsFile: SETTINGS_FILE });
  await store.init();
  const logs = new LogBufferManager(store.getSettings().logMaxLines);
  const hub = new StatusHub();
  const pm = new ProcessManager(logs, (evt) => hub.broadcast(evt), path.join(DATA_DIR, 'runtime'));
  pm.restore(store.listProjects(), store.getSettings());
  const ports = new PortMonitor(store, pm);
  const ctx: SparkContext = { store, logs, pm, hub, ports };

  // 随机 CSRF token:页面启动时获取,修改类请求必须携带
  const csrfToken = randomBytes(24).toString('hex');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // 安全:Host / Origin 校验,防跨站调用与 DNS rebinding(服务可执行任意命令)
  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, '127.0.0.1', 'localhost']);
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) {
      return res.status(403).json({ error: 'FORBIDDEN_HOST', message: '服务仅允许通过 127.0.0.1 / localhost 访问' });
    }
    const origin = req.headers.origin;
    // 允许任意 localhost 来源端口,兼容 Vite 代理;外部站点来源一律拒绝
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: '拒绝跨站请求' });
    }
    next();
  });

  app.get('/api/csrf-token', (_req, res) => res.set('Cache-Control', 'no-store').json({ token: csrfToken }));

  // 修改类接口必须携带 token
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (req.headers['x-spark-token'] !== csrfToken) {
      return res.status(403).json({ error: 'FORBIDDEN_TOKEN', message: '缺少或错误的请求令牌' });
    }
    next();
  });

  app.use('/api/projects', projectsRouter(ctx));
  app.use('/api/groups', groupsRouter(ctx));
  app.use('/api/detect', detectRouter());
  app.use('/api/fs', fsRouter());
  app.use('/api/ports', portsRouter(ctx));
  app.use('/api/settings', settingsRouter(ctx));
  app.get('/api/events', (_req, res) => hub.add(res));
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

  // 生产模式:静态托管前端构建产物 + SPA 回退
  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    // JSON 解析失败按 400 返回
    if (typeof err === 'object' && err !== null && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '请求体不是合法 JSON' });
    }
    console.error('[spark] 未处理错误:', err);
    res.status(500).json({ error: 'INTERNAL', message: String((err as Error)?.message ?? err) });
  });

  return { app, ctx, csrfToken };
}
