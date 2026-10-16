import type { PortStatus } from '@spark/shared';
import { Router } from 'express';
import { getPortStatus } from '../core/portStatus.js';
import type { SparkContext } from './projects.js';
import { asyncHandler, runningGroupsWithCwd } from './util.js';

function parsePort(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

export function portsRouter(ctx: SparkContext): Router {
  const router = Router();

  const decorate = (s: PortStatus): PortStatus => {
    if (s.projectId) {
      const name = ctx.store.getProject(s.projectId)?.name;
      return name ? { ...s, projectName: name } : s;
    }
    return s;
  };

  // 扫描配置端口及运行中终端自动发现的监听端口
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await ctx.ports.refresh());
    }),
  );

  // 单端口检测
  router.get(
    '/:port',
    asyncHandler(async (req, res) => {
      const port = parsePort(String(req.params.port));
      if (port == null) return res.status(400).json({ error: 'BAD_REQUEST', message: '端口必须是 1-65535 的整数' });
      res.json(decorate(await getPortStatus(port, runningGroupsWithCwd(ctx))));
    }),
  );

  return router;
}
