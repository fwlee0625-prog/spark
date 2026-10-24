/** 项目运行状态 */
export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'partial' | 'failed';

/** 启动命令的 Shell 方式 */
export type ShellMode = 'login' | 'non-login' | 'direct';

/** 一个终端对应一个独立进程和日志流，cwd 可相对项目目录。 */
export interface TerminalConfig {
  id: string;
  /** 固定展示编号，删除其他终端时保持不变。 */
  number?: number;
  /** 仅应用于此终端的环境变量。 */
  env: Record<string, string>;
  name: string;
  cwd: string;
  command: string;
  port: number | null;
}

export function projectTerminals(project: Project): TerminalConfig[] {
  return project.terminals;
}

export function terminalKey(projectId: string, terminalId: string): string {
  return `${projectId}:${terminalId}`;
}

/** 项目持久化配置(data/projects.json) */
export interface Project {
  id: string;
  name: string;
  type: string;
  cwd: string;
  terminals: TerminalConfig[];
  groupIds: string[];
  autoRestart: boolean;
  createdAt: number;
}

/** 项目分组 */
export interface Group {
  id: string;
  name: string;
  projectIds: string[];
}

/** 面向界面的运行时状态；进程身份另行持久化 */
export interface RuntimeState {
  status: ProjectStatus;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
}

export type TerminalWithState = TerminalConfig & RuntimeState & { listeningPorts: number[] };
/** 有实际监听端口时展示检测结果，否则展示配置端口。 */
export function displayedPorts(terminals: TerminalWithState[]): number[] {
  return [
    ...new Set(
      terminals.flatMap((t) => (t.listeningPorts.length ? t.listeningPorts : t.port === null ? [] : [t.port])),
    ),
  ].sort((a, b) => a - b);
}

export type ProjectWithState = Project & RuntimeState & { terminalStates: TerminalWithState[] };

export interface Settings {
  shellMode: ShellMode;
  /** 退出 Spark 时停止所有项目，默认保留运行 */
  stopProjectsOnExit: boolean;
  /** 每个项目日志保留的最大行数 */
  logMaxLines: number;
  /** 崩溃自动重启次数上限 */
  autoRestartMax: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shellMode: 'login',
  stopProjectsOnExit: false,
  logMaxLines: 5000,
  autoRestartMax: 3,
};

/** 单条日志(保留原始 ANSI 序列,由前端渲染) */
export interface LogLine {
  line: string;
  ts: number;
  stream: 'stdout' | 'stderr';
}

/** /api/events 推送的状态变更 */
export interface StatusEvent extends RuntimeState {
  type: 'status';
  id: string;
  terminalStates?: TerminalWithState[];
}

/** /api/detect 识别结果(仅用于预填) */
export interface DetectResult {
  type: string;
  packageManager?: 'pnpm' | 'yarn' | 'npm';
  scripts?: string[];
  preferredScript?: string | null;
  suggestedCommand?: string | null;
  venv?: string | null;
  tags?: string[];
  notes?: string[];
}

export interface PortProcess {
  pid: number;
  command: string;
}

/** 端口占用检测结果 */
export interface PortStatus {
  port: number;
  occupied: boolean;
  /** 占用来源:已管理的项目 / 外部进程 */
  source: 'project' | 'external' | null;
  projectId?: string;
  projectName?: string;
  terminalId?: string;
  terminalName?: string;
  pid?: number;
  processName?: string;
  /** 该端口上的全部监听进程 */
  processes?: PortProcess[];
}

/** 统一错误响应体 */
export interface ApiError {
  error: string;
  message?: string;
  /** PORT_IN_USE 时附带端口详情 */
  port?: PortStatus;
}

/** 目录列表中的单个子目录 */
export interface FsDirEntry {
  name: string;
  path: string;
}

/** GET /api/fs/list 返回(文件夹选择器用,只列目录不列文件) */
export interface FsListing {
  /** 解析后的绝对路径 */
  path: string;
  /** 上级目录,处于文件系统根时为 null */
  parent: string | null;
  dirs: FsDirEntry[];
  /** 服务端主目录,供界面快捷跳转 */
  home: string;
}

/** 项目类型选项(新建/编辑表单与列表筛选共用) */
export const PROJECT_TYPE_OPTIONS = [
  { value: 'vue', label: '前端(Vue)' },
  { value: 'react', label: '前端(React)' },
  { value: 'node', label: '后端(Node)' },
  { value: 'python', label: '后端(Python)' },
  { value: 'miniprogram', label: '小程序' },
  { value: 'tools', label: '工具' },
  { value: 'generic', label: '其他' },
] as const;

export const SHELL_MODE_LABELS: Record<ShellMode, string> = {
  login: '登录 shell(zsh -ilc,环境与终端一致)',
  'non-login': '非登录 shell(zsh -lc,跳过 .zshrc)',
  direct: '直接 spawn(/bin/sh -c,最快但 PATH 可能不全)',
};

/** CPU 使用率按整机全部逻辑核心容量计算；空值表示尚未采集或不可用。 */
export interface ResourceUsage {
  status: 'ready' | 'collecting' | 'stopped' | 'unavailable';
  sampledAt: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  processCount: number | null;
  runId: string | null;
}
export interface ProcessResource {
  pid: number;
  name: string;
  memoryBytes: number;
  cpuPercent: number | null;
}
export interface TerminalResource extends ResourceUsage {
  terminalId: string;
  processes: ProcessResource[];
}
export interface ProjectResource extends ResourceUsage {
  projectId: string;
  terminals: TerminalResource[];
}
export interface ResourceSnapshot {
  type: 'resources';
  sampledAt: number;
  intervalMs: number;
  total: ResourceUsage;
  projects: ProjectResource[];
}
export interface ResourceHistoryPoint extends ResourceUsage {
  timestamp: number;
}
export interface ResourceHistory {
  projectId: string;
  points: ResourceHistoryPoint[];
}
