import { Router } from 'express';
import { getPortStatus } from '../core/portStatus.js';
import type { SparkContext } from './projects.js';
import { asyncHandler, normalizeStringArray, runningGroupsWithCwd } from './util.js';

const GROUP_START_INTERVAL_MS = 300;

export function groupsRouter(ctx: SparkContext): Router {
  const router = Router();

  // 分组列表
  router.get('/', (_req, res) => {
    res.json(ctx.store.listGroups());
  });

  // 新建分组
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'BAD_REQUEST', message: '分组名称必填' });
      const group = await ctx.store.addGroup(name, normalizeStringArray(body.projectIds));
      res.status(201).json(group);
    }),
  );

  // 修改分组
  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: 'BAD_REQUEST', message: '分组名称不能为空' });
        patch.name = name;
      }
      if (body.projectIds !== undefined) patch.projectIds = normalizeStringArray(body.projectIds);
      const group = await ctx.store.updateGroup(String(req.params.id), patch);
      if (group) res.json(group);
      else res.status(404).json({ error: 'NOT_FOUND', message: '分组不存在' });
    }),
  );

  // 删除分组(仅移除分组,不影响项目本身)
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const ok = await ctx.store.deleteGroup(String(req.params.id));
      if (ok) res.json({ ok: true });
      else res.status(404).json({ error: 'NOT_FOUND', message: '分组不存在' });
    }),
  );

  // 整组启动:顺序启动,遇到端口被外部占用/已运行的项目跳过并上报
  router.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      const group = ctx.store.getGroup(String(req.params.id));
      if (!group) return res.status(404).json({ error: 'NOT_FOUND', message: '分组不存在' });
      const started: { id: string; name: string }[] = [];
      const blocked: { id: string; name: string; reason: string }[] = [];
      const failed: { id: string; name: string; reason: string }[] = [];
      for (const pid of group.projectIds) {
        const project = ctx.store.getProject(pid);
        if (!project) continue;
        if (ctx.pm.terminalStates(project).every((t) => ['running', 'starting'].includes(t.status))) {
          started.push({ id: project.id, name: project.name });
          continue;
        }
        let conflict = false;
        for (const terminal of ctx.pm.terminalStates(project)) {
          if (terminal.port == null || ['running', 'starting'].includes(terminal.status)) continue;
          const status = await getPortStatus(terminal.port, runningGroupsWithCwd(ctx));
          if (status.occupied) {
            blocked.push({
              id: project.id,
              name: project.name,
              reason: `终端「${terminal.name}」端口 ${terminal.port} 已被占用`,
            });
            conflict = true;
            break;
          }
        }
        if (conflict) continue;
        try {
          ctx.pm.start(project, ctx.store.getSettings());
          started.push({ id: project.id, name: project.name });
        } catch (err) {
          failed.push({ id: project.id, name: project.name, reason: (err as Error).message });
        }
        await new Promise((r) => setTimeout(r, GROUP_START_INTERVAL_MS));
      }
      res.json({ started, blocked, failed });
    }),
  );

  // 整组停止
  router.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      const group = ctx.store.getGroup(String(req.params.id));
      if (!group) return res.status(404).json({ error: 'NOT_FOUND', message: '分组不存在' });
      const projects = group.projectIds
        .map((id) => ctx.store.getProject(id))
        .filter((p): p is NonNullable<typeof p> => p != null);
      await Promise.allSettled(projects.map((p) => ctx.pm.stop(p)));
      res.json({ ok: true });
    }),
  );

  return router;
}
