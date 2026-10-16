import type { Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { detect } from '../detectors/index.js';
import { asyncHandler } from './util.js';

/** POST /api/detect { dir } → 识别结果与建议命令(dir 仅读取,不执行) */
export function detectRouter(): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const raw = String((req.body as Record<string, unknown> | undefined)?.dir ?? '').trim();
      if (!raw) return res.status(400).json({ error: 'BAD_REQUEST', message: 'dir 必填' });
      const dir = path.resolve(raw);
      let stat: Stats;
      try {
        stat = await fsp.stat(dir);
      } catch {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '目录不存在' });
      }
      if (!stat.isDirectory()) return res.status(400).json({ error: 'BAD_REQUEST', message: '路径不是目录' });
      res.json(detect(dir));
    }),
  );

  return router;
}
