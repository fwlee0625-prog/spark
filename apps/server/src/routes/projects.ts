import { projectTerminals, terminalKey } from '@spark/shared';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Project, ProjectWithState } from '@spark/shared';
import type { PortMonitor } from '../core/portMonitor.js';
import type { ConfigStore } from '../core/configStore.js';
import type { ProcessManager } from '../core/processManager.js';
import type { LogBufferManager } from '../core/logBuffer.js';
import { getPortStatus } from '../core/portStatus.js';
import { initSse, sseHeartbeat, sseSend } from '../core/sseHub.js';
import { asyncHandler, normalizeStringArray, normalizeTerminals, runningGroupsWithCwd } from './util.js';

export interface SparkContext {
  store: ConfigStore;
  logs: LogBufferManager;
  pm: ProcessManager;
  ports: PortMonitor;
}

function withState(ctx: SparkContext, project: Project): ProjectWithState {
  return { ...project, ...ctx.pm.getState(project.id), terminalStates: ctx.pm.terminalStates(project) };
}

export function projectsRouter(ctx: SparkContext): Router {
  const router = Router();

  // 项目列表(含运行状态)
  router.get('/', asyncHandler(async (_req, res) => {
    await ctx.ports.refresh();
    res.json(ctx.store.listProjects().map((p) => withState(ctx, p)));
  }));

  // 新建项目
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      const rawCwd = String(body.cwd ?? '').trim();
      const cwd = path.resolve(rawCwd);
      if (!name || !rawCwd) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '项目名称和目录均必填' });
      }
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '项目目录不存在' });
      }
      let terminals;
      try {
        terminals = normalizeTerminals(body.terminals, cwd);
      } catch (err) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: (err as Error).message });
      }
      const project = await ctx.store.addProject({
        name,
        type: String(body.type ?? 'generic').trim() || 'generic',
        cwd,
        terminals,
        groupIds: normalizeStringArray(body.groupIds),
        autoRestart: Boolean(body.autoRestart),
      });
      res.status(201).json(withState(ctx, project));
    }),
  );

  // 修改项目
  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = ctx.store.getProject(String(req.params.id));
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (ctx.pm.isRunning(existing.id)) return res.status(409).json({ error: 'ALREADY_RUNNING', message: '请先停止项目再编辑配置' });
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.type !== undefined) patch.type = String(body.type).trim() || 'generic';
      if (body.cwd !== undefined) {
        const cwd = path.resolve(String(body.cwd).trim());
        if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: '项目目录不存在' });
        }
        patch.cwd = cwd;
      }
      if (body.groupIds !== undefined) patch.groupIds = normalizeStringArray(body.groupIds);
      if (body.autoRestart !== undefined) patch.autoRestart = Boolean(body.autoRestart);
      try {
        const cwd = String(patch.cwd ?? existing.cwd);
        patch.terminals = normalizeTerminals(body.terminals ?? existing.terminals, cwd);
        if (patch.name === '') throw new Error('名称不能为空');
      } catch (err) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: (err as Error).message });
      }
      await ctx.pm.stop(existing);
      ctx.pm.forget(existing.id);
      const project = await ctx.store.updateProject(existing.id, patch);
      if (project) res.json(withState(ctx, project));
      else res.status(404).json({ error: 'NOT_FOUND' });
    }),
  );

  // 删除项目(运行中则先停止);仅移除配置,不动项目文件
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = ctx.store.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
      await ctx.pm.stop(project);
      ctx.pm.forget(project.id);
      ctx.logs.dispose(project.id);
      await ctx.store.deleteProject(project.id);
      res.json({ ok: true });
    }),
  );

  // 启动(默认先做端口占用检测,?force=1 跳过)
  router.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      const project = ctx.store.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
      if (ctx.pm.terminalStates(project).every((t) => t.status === 'running' || t.status === 'starting')) {
        return res.status(409).json({ error: 'ALREADY_RUNNING', message: '项目已在运行中' });
      }
      for (const terminal of ctx.pm.terminalStates(project)) {
        if (terminal.port == null || terminal.status === 'running' || terminal.status === 'starting' || req.query.force === '1') continue;
        const status = await getPortStatus(terminal.port, runningGroupsWithCwd(ctx));
        if (status.occupied) {
          const projectName = status.projectId ? ctx.store.getProject(status.projectId)?.name : undefined;
          return res.status(409).json({
            error: 'PORT_IN_USE',
            message: `终端「${terminal.name}」端口 ${terminal.port} 已被占用`,
            port: { ...status, ...(projectName ? { projectName } : {}) },
          });
        }
      }
      try {
        ctx.pm.start(project, ctx.store.getSettings());
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: 'START_FAILED', message: (err as Error).message });
      }
    }),
  );

  // 停止(杀整个进程树)
  router.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      const project = ctx.store.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
      await ctx.pm.stop(project);
      res.json({ ok: true });
    }),
  );

  // 重启
  router.post(
    '/:id/restart',
    asyncHandler(async (req, res) => {
      const project = ctx.store.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
      await ctx.pm.stop(project);
      for (const terminal of projectTerminals(project)) {
        if (terminal.port == null) continue;
        const status = await getPortStatus(terminal.port, runningGroupsWithCwd(ctx));
        if (status.occupied) return res.status(409).json({ error: 'PORT_IN_USE', message: `端口 ${terminal.port} 已被占用`, port: status });
      }
      ctx.pm.start(project, ctx.store.getSettings());
      res.json({ ok: true });
    }),
  );

  // 单个终端操作，使用同样的端口保护。
  router.post('/:id/terminals/:terminalId/:action', asyncHandler(async (req, res) => {
    const project = ctx.store.getProject(String(req.params.id));
    if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
    const terminal = projectTerminals(project).find((t) => t.id === req.params.terminalId);
    if (!terminal) return res.status(404).json({ error: 'NOT_FOUND', message: '终端不存在' });
    const action = String(req.params.action);
    if (!['start', 'stop', 'restart'].includes(action)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (action === 'start' && ctx.pm.terminalStates(project).some((t) => t.id === terminal.id && ['running', 'starting'].includes(t.status))) {
      return res.status(409).json({ error: 'ALREADY_RUNNING', message: '终端已在运行中' });
    }
    if (action === 'restart') await ctx.pm.stop(project, terminal.id);
    if (action !== 'stop' && terminal.port != null && req.query.force !== '1') {
      const status = await getPortStatus(terminal.port, runningGroupsWithCwd(ctx));
      if (status.occupied) return res.status(409).json({ error: 'PORT_IN_USE', message: `端口 ${terminal.port} 已被占用`, port: status });
    }
    if (action === 'stop') await ctx.pm.stop(project, terminal.id);
    else ctx.pm.start(project, ctx.store.getSettings(), terminal.id);
    res.json({ ok: true });
  }));

  // SSE 实时日志(先回放缓冲,再接实时流)
  router.get('/:id/logs', (req, res) => {
    const id = String(req.params.id);
    const project = ctx.store.getProject(id);
    if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' });
    const terminalId = String(req.query.terminalId ?? projectTerminals(project)[0]!.id);
    if (!projectTerminals(project).some((t) => t.id === terminalId)) return res.status(404).json({ error: 'NOT_FOUND', message: '终端不存在' });
    const key = terminalKey(id, terminalId);
    initSse(res);
    for (const line of ctx.logs.replay(key)) sseSend(res, line);
    const unsubscribe = ctx.logs.subscribe(key, (line) => sseSend(res, line));
    const heartbeat = sseHeartbeat(res);
    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  // 清空日志
  router.post('/:id/logs/clear', (req, res) => {
    const project = ctx.store.getProject(String(req.params.id));
    if (!project) return res.status(404).json({ error: 'NOT_FOUND' });
    const terminalId = String(req.query.terminalId ?? projectTerminals(project)[0]!.id);
    if (!projectTerminals(project).some((t) => t.id === terminalId)) return res.status(404).json({ error: 'NOT_FOUND' });
    ctx.logs.clear(terminalKey(project.id, terminalId));
    res.json({ ok: true });
  });

  return router;
}
