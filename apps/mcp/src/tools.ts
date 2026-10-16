import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DetectResult, Group, LogLine, PortStatus, ProjectWithState, Settings } from '@spark/shared';
import { z } from 'zod';
import { SparkApiError } from './client.js';
import type { SparkClient } from './client.js';
import { formatLogs, stripAnsi } from './logs.js';
import { resolveGroup, resolveProject, resolveTerminal, summarizeProject, summarizeTerminal } from './resolve.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});

function fail(err: unknown): ToolResult {
  let text = err instanceof Error ? err.message : String(err);
  if (err instanceof SparkApiError && err.data && typeof err.data === 'object' && 'port' in err.data) {
    text += `\n端口详情:${JSON.stringify((err.data as { port: unknown }).port)}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

/** 统一错误处理,工具内部抛出的异常转为 isError 结果 */
function safe<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = encodeURIComponent;

const projectRef = z.string().min(1).describe('项目 id 或名称');

const terminalInput = z.object({
  name: z.string().min(1).describe('终端名称,如 web / api'),
  command: z.string().min(1).describe('启动命令,如 pnpm dev'),
  cwd: z.string().optional().describe('相对项目目录的子目录,默认项目根目录'),
  port: z.number().int().min(1).max(65535).nullable().optional().describe('该终端监听的端口,用于启动前冲突检测'),
  env: z.record(z.string(), z.string()).optional().describe('仅作用于该终端的环境变量'),
  id: z.string().optional().describe('更新项目时传入已有终端 id,可保留日志与状态映射'),
  number: z.number().int().min(1).optional().describe('更新项目时传入已有终端编号'),
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export function registerTools(server: McpServer, client: SparkClient): void {
  // ───────── 项目识别与查询 ─────────

  server.registerTool(
    'detect_project',
    {
      description: '识别目录的项目类型(Node/Python 等)并给出建议启动命令。只读取文件,不执行任何命令。创建项目前可先调用。',
      inputSchema: { dir: z.string().min(1).describe('项目目录绝对路径') },
      annotations: READ,
    },
    safe(({ dir }) => client.post<DetectResult>('/api/detect', { dir })),
  );

  server.registerTool(
    'list_projects',
    {
      description: '列出所有项目及其终端概要(状态、pid、端口)。用于了解当前有哪些项目、每个项目有几个终端。',
      inputSchema: {},
      annotations: READ,
    },
    safe(async () => {
      const projects = await client.get<ProjectWithState[]>('/api/projects');
      return { total: projects.length, projects: projects.map((p) => summarizeProject(p)) };
    }),
  );

  server.registerTool(
    'get_project',
    {
      description: '获取单个项目的完整配置与运行状态(含各终端的命令、目录、环境变量)。',
      inputSchema: { project: projectRef },
      annotations: READ,
    },
    safe(async ({ project }) => summarizeProject(await resolveProject(client, project), true)),
  );

  server.registerTool(
    'get_terminals',
    {
      description:
        '查看项目有几个终端及每个终端的运行信息,并附带日志概况(日志总行数、最近一次输出、疑似报错行数),便于快速定位哪个终端出问题。',
      inputSchema: { project: projectRef },
      annotations: READ,
    },
    safe(async ({ project }) => {
      const p = await resolveProject(client, project);
      const terminals = await Promise.all(
        p.terminalStates.map(async (t) => {
          const snap = await client.get<{ total: number; lines: LogLine[] }>(`/api/projects/${q(p.id)}/logs/snapshot?terminalId=${q(t.id)}`);
          const errors = formatLogs(snap.lines, { tail: 1, errorsOnly: true, stripAnsi: true });
          const last = snap.lines.at(-1);
          return {
            ...summarizeTerminal(t),
            logs: {
              totalLines: snap.total,
              suspectedErrorLines: errors.matched,
              lastLine: last ? { at: new Date(last.ts).toISOString(), stream: last.stream, text: stripAnsi(last.line) } : null,
            },
          };
        }),
      );
      return { project: { id: p.id, name: p.name, status: p.status }, terminalCount: terminals.length, terminals };
    }),
  );

  // ───────── 项目增删改 ─────────

  server.registerTool(
    'create_project',
    {
      description:
        '创建项目(仅写入配置,不会修改项目文件)。terminals 省略时自动识别目录并生成单个终端;识别不出命令则报错。一个项目可有多个终端(如前端+后端)。start=true 时创建后立即启动。注意:终端命令会在本机执行。',
      inputSchema: {
        name: z.string().min(1).describe('项目名称'),
        cwd: z.string().min(1).describe('项目目录绝对路径'),
        type: z.string().optional().describe('项目类型标签,如 vue / node / python,默认 generic'),
        terminals: z.array(terminalInput).min(1).max(20).optional().describe('终端列表,省略则按自动识别结果生成'),
        groupIds: z.array(z.string()).optional().describe('加入的分组 id'),
        autoRestart: z.boolean().optional().describe('崩溃后自动重启'),
        start: z.boolean().optional().describe('创建后立即启动,默认 false'),
      },
      annotations: WRITE,
    },
    safe(async (args) => {
      let terminals = args.terminals;
      let type = args.type;
      let detected: DetectResult | undefined;
      if (!terminals) {
        detected = await client.post<DetectResult>('/api/detect', { dir: args.cwd });
        if (!detected.suggestedCommand) {
          throw new Error('无法自动识别启动命令,请显式传入 terminals。识别结果:' + JSON.stringify(detected));
        }
        terminals = [{ name: 'main', command: detected.suggestedCommand }];
        type ??= detected.type;
      }
      const created = await client.post<ProjectWithState>('/api/projects', {
        name: args.name,
        cwd: args.cwd,
        ...(type ? { type } : {}),
        terminals,
        ...(args.groupIds ? { groupIds: args.groupIds } : {}),
        ...(args.autoRestart === undefined ? {} : { autoRestart: args.autoRestart }),
      });
      const result: Record<string, unknown> = { created: summarizeProject(created), ...(detected ? { detected } : {}) };
      if (args.start) {
        try {
          await client.post(`/api/projects/${q(created.id)}/start`);
          await sleep(2500);
          result.created = summarizeProject(await resolveProject(client, created.id));
          result.started = true;
        } catch (err) {
          result.started = false;
          result.startError = fail(err).content[0]!.text;
        }
      }
      return result;
    }),
  );

  server.registerTool(
    'update_project',
    {
      description:
        '修改项目配置。项目运行中不能编辑,需先 control_project stop。传入 terminals 会整体替换终端列表(保留已有终端请带上其 id 和 number)。',
      inputSchema: {
        project: projectRef,
        name: z.string().min(1).optional(),
        type: z.string().optional(),
        cwd: z.string().optional().describe('新的项目目录绝对路径'),
        terminals: z.array(terminalInput).min(1).max(20).optional(),
        groupIds: z.array(z.string()).optional(),
        autoRestart: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    safe(async ({ project, ...patch }) => {
      const p = await resolveProject(client, project);
      const updated = await client.put<ProjectWithState>(`/api/projects/${q(p.id)}`, patch);
      return summarizeProject(updated, true);
    }),
  );

  server.registerTool(
    'delete_project',
    {
      description: '删除项目:会先停止其所有进程,再移除配置。不会删除项目目录里的任何文件。',
      inputSchema: { project: projectRef },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ project }) => {
      const p = await resolveProject(client, project);
      await client.delete(`/api/projects/${q(p.id)}`);
      return { deleted: { id: p.id, name: p.name } };
    }),
  );

  // ───────── 启停控制 ─────────

  server.registerTool(
    'control_project',
    {
      description:
        '启动/停止/重启项目或其中某个终端。启动前会检测端口冲突,被占用时返回占用来源(force=true 可跳过检测)。start/restart 后会等待片刻并返回最新状态,若终端立即退出会体现为 failed,可再用 get_logs 查看原因。',
      inputSchema: {
        project: projectRef,
        action: z.enum(['start', 'stop', 'restart']),
        terminal: z.string().optional().describe('终端 id / 编号 / 名称;省略则操作整个项目的所有终端'),
        force: z.boolean().optional().describe('跳过端口占用检测'),
        waitMs: z.number().int().min(0).max(10000).optional().describe('启动/重启后等待多久再取状态,默认 2500'),
      },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ project, action, terminal, force, waitMs }) => {
      const p = await resolveProject(client, project);
      const suffix = force ? '?force=1' : '';
      if (terminal !== undefined) {
        const t = resolveTerminal(p.terminalStates, terminal);
        await client.post(`/api/projects/${q(p.id)}/terminals/${q(t.id)}/${action}${suffix}`);
      } else {
        await client.post(`/api/projects/${q(p.id)}/${action}${suffix}`);
      }
      if (action !== 'stop') await sleep(waitMs ?? 2500);
      return summarizeProject(await resolveProject(client, p.id));
    }),
  );

  // ───────── 日志 ─────────

  server.registerTool(
    'get_logs',
    {
      description:
        '读取项目某个终端的日志(来自内存缓冲区,默认保留 5000 行)。默认返回最后 200 行并去除 ANSI 颜色;每行格式为「时间 O/E 内容」,O=stdout,E=stderr。排查问题时优先用 errorsOnly 或 grep 缩小范围。',
      inputSchema: {
        project: projectRef,
        terminal: z.string().optional().describe('终端 id / 编号 / 名称,默认第一个终端'),
        tail: z.number().int().min(1).max(2000).optional().describe('返回最后 N 行(过滤后),默认 200'),
        grep: z.string().optional().describe('按正则过滤(忽略大小写)'),
        stream: z.enum(['stdout', 'stderr']).optional(),
        errorsOnly: z.boolean().optional().describe('只返回 stderr 与含 error/exception/fail 等关键词的行'),
        stripAnsi: z.boolean().optional().describe('去除颜色转义,默认 true'),
      },
      annotations: READ,
    },
    safe(async ({ project, terminal, tail, grep, stream, errorsOnly, stripAnsi }) => {
      const p = await resolveProject(client, project);
      const t = resolveTerminal(p.terminalStates, terminal);
      const snap = await client.get<{ total: number; lines: LogLine[] }>(`/api/projects/${q(p.id)}/logs/snapshot?terminalId=${q(t.id)}`);
      const out = formatLogs(snap.lines, {
        tail: tail ?? 200,
        ...(grep ? { grep } : {}),
        ...(stream ? { stream } : {}),
        ...(errorsOnly ? { errorsOnly } : {}),
        ...(stripAnsi === undefined ? {} : { stripAnsi }),
      });
      return {
        project: p.name,
        terminal: { id: t.id, name: t.name, status: t.status },
        bufferedLines: snap.total,
        matchedLines: out.matched,
        returnedLines: out.returned,
        truncated: out.truncated,
        logs: out.text || '(无匹配日志)',
      };
    }),
  );

  server.registerTool(
    'clear_logs',
    {
      description: '清空某个终端的日志缓冲区,便于复现问题前先清屏。',
      inputSchema: { project: projectRef, terminal: z.string().optional().describe('终端 id / 编号 / 名称,默认第一个终端') },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ project, terminal }) => {
      const p = await resolveProject(client, project);
      const t = resolveTerminal(p.terminalStates, terminal);
      await client.post(`/api/projects/${q(p.id)}/logs/clear?terminalId=${q(t.id)}`);
      return { cleared: { project: p.name, terminal: t.name } };
    }),
  );

  server.registerTool(
    'get_app_logs',
    {
      description: '读取 Spark 管理服务自身的运行日志(非项目终端输出),最新的在前。用于排查 Spark 本身的问题。',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe('返回条数,默认 100'),
        level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional(),
      },
      annotations: READ,
    },
    safe(({ limit, level }) => client.get(`/api/app-logs?limit=${limit ?? 100}${level ? `&level=${level}` : ''}`)),
  );

  // ───────── 端口 ─────────

  server.registerTool(
    'check_port',
    {
      description: '检测端口占用及来源(某个已管理项目的终端,或外部进程 pid)。不传 port 则列出所有已配置/已发现的监听端口。',
      inputSchema: { port: z.number().int().min(1).max(65535).optional() },
      annotations: READ,
    },
    safe(({ port }) => client.get<PortStatus | PortStatus[]>(port === undefined ? '/api/ports' : `/api/ports/${port}`)),
  );

  // ───────── 分组 ─────────

  server.registerTool(
    'list_groups',
    { description: '列出所有分组及其包含的项目 id。', inputSchema: {}, annotations: READ },
    safe(() => client.get<Group[]>('/api/groups')),
  );

  server.registerTool(
    'create_group',
    {
      description: '创建分组,可一次性指定包含的项目(id 或名称)。',
      inputSchema: { name: z.string().min(1), projects: z.array(z.string()).optional().describe('项目 id 或名称列表') },
      annotations: WRITE,
    },
    safe(async ({ name, projects }) => {
      const ids = projects ? (await Promise.all(projects.map((ref) => resolveProject(client, ref)))).map((p) => p.id) : [];
      return client.post<Group>('/api/groups', { name, projectIds: ids });
    }),
  );

  server.registerTool(
    'control_group',
    {
      description: '整组启动或停止。启动时端口被占用的项目会被跳过并在 blocked 中上报。',
      inputSchema: { group: z.string().min(1).describe('分组 id 或名称'), action: z.enum(['start', 'stop']) },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ group, action }) => {
      const g = await resolveGroup(client, group);
      return client.post(`/api/groups/${q(g.id)}/${action}`);
    }),
  );

  server.registerTool(
    'delete_group',
    {
      description: '删除分组,仅移除分组本身,不影响其中的项目。',
      inputSchema: { group: z.string().min(1).describe('分组 id 或名称') },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ group }) => {
      const g = await resolveGroup(client, group);
      await client.delete(`/api/groups/${q(g.id)}`);
      return { deleted: { id: g.id, name: g.name } };
    }),
  );

  // ───────── 设置 ─────────

  server.registerTool(
    'get_settings',
    { description: '读取 Spark 全局设置(Shell 启动方式、日志行数、自动重启上限、数据目录等)。', inputSchema: {}, annotations: READ },
    safe(() => client.get<Settings & { dataDir: string }>('/api/settings')),
  );
}
