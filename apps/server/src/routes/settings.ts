import type { ShellMode } from '@spark/shared';
import { Router } from 'express';
import { DATA_DIR } from '../config.js';
import type { SparkContext } from './projects.js';
import { asyncHandler } from './util.js';

const SHELL_MODES: ShellMode[] = ['login', 'non-login', 'direct'];

export function settingsRouter(ctx: SparkContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ ...ctx.store.getSettings(), dataDir: DATA_DIR });
  });

  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      if (body.stopProjectsOnExit !== undefined) {
        if (typeof body.stopProjectsOnExit !== 'boolean') {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'stopProjectsOnExit 必须是布尔值' });
        }
        patch.stopProjectsOnExit = body.stopProjectsOnExit;
      }
      if (body.shellMode !== undefined) {
        if (!SHELL_MODES.includes(body.shellMode as ShellMode)) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'shellMode 无效' });
        }
        patch.shellMode = body.shellMode;
      }
      if (body.logMaxLines !== undefined) {
        const n = Number(body.logMaxLines);
        if (!Number.isInteger(n) || n < 100 || n > 100000) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'logMaxLines 必须是 100-100000 的整数' });
        }
        patch.logMaxLines = n;
      }
      if (body.autoRestartMax !== undefined) {
        const n = Number(body.autoRestartMax);
        if (!Number.isInteger(n) || n < 0 || n > 10) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'autoRestartMax 必须是 0-10 的整数' });
        }
        patch.autoRestartMax = n;
      }

      const settings = await ctx.store.updateSettings(patch);
      ctx.logs.setMaxLines(settings.logMaxLines);
      res.json(settings);
    }),
  );

  return router;
}
