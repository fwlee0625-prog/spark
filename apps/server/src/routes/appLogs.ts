import { Router } from 'express';
import type { AppLogLevel, AppLogStore } from '../core/appLogStore.js';
import type { SparkContext } from './projects.js';
import { asyncHandler } from './util.js';

const LEVELS: AppLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export function appLogsRouter(ctx: SparkContext & { appLogs: AppLogStore }): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const limit = req.query.limit == null ? 500 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'limit 必须是 1-5000 的整数' });
    }
    const level = req.query.level == null ? undefined : String(req.query.level);
    if (level && !LEVELS.includes(level as AppLogLevel)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '日志级别无效' });
    }
    res.json(ctx.appLogs.list(limit, level as AppLogLevel | undefined));
  });
  router.delete(
    '/',
    asyncHandler(async (_req, res) => {
      ctx.appLogs.clear();
      res.json({ ok: true });
    }),
  );
  return router;
}
