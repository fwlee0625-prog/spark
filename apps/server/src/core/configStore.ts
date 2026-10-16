import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Group, Project, Settings } from '@spark/shared';
import { DEFAULT_SETTINGS } from '@spark/shared';

interface ProjectsFile {
  projects: Project[];
  groups: Group[];
}

export interface ConfigStoreOptions {
  projectsFile: string;
  settingsFile: string;
}

function isProject(v: unknown): v is Project {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.cwd === 'string' &&
    Array.isArray(p.terminals) &&
    p.terminals.length > 0 &&
    p.terminals.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof t.id === 'string' &&
        typeof t.command === 'string' &&
        typeof t.name === 'string' &&
        typeof t.cwd === 'string' &&
        t.env &&
        typeof t.env === 'object',
    )
  );
}

function isGroup(v: unknown): v is Group {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.projectIds);
}

/**
 * 配置存储:projects.json(项目 + 分组)与 settings.json。
 * - 写入 = 先写临时文件再 rename,避免写一半崩溃损坏文件
 * - 所有写入经 Promise 队列串行化,避免并发覆盖
 * - 启动时校验;文件损坏则备份为 *.corrupt-<ts> 后按空配置继续
 */
export class ConfigStore {
  private projects: Project[] = [];
  private groups: Group[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private queue: Promise<unknown> = Promise.resolve();
  readonly corruptBackups: string[] = [];

  constructor(private opts: ConfigStoreOptions) {}

  async init(): Promise<void> {
    await fsp.mkdir(path.dirname(this.opts.projectsFile), { recursive: true });
    await this.loadProjects();
    await this.loadSettings();
  }

  private async loadProjects(): Promise<void> {
    const raw = await this.readJson(this.opts.projectsFile);
    if (raw && typeof raw === 'object') {
      const data = raw as Partial<ProjectsFile>;
      if (Array.isArray(data.projects)) this.projects = data.projects.filter(isProject);
      if (Array.isArray(data.groups)) this.groups = data.groups.filter(isGroup);
    }
  }

  private async loadSettings(): Promise<void> {
    const raw = await this.readJson(this.opts.settingsFile);
    if (raw && typeof raw === 'object') {
      this.settings = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
    }
  }

  /** 读取 JSON;不存在返回 null;解析失败则把原文件改名备份并返回 null */
  private async readJson(file: string): Promise<unknown> {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      const backup = `${file}.corrupt-${Date.now()}`;
      await fsp.rename(file, backup);
      this.corruptBackups.push(backup);
      return null;
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private static async atomicWrite(file: string, data: unknown): Promise<void> {
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  }

  listProjects(): Project[] {
    return structuredClone(this.projects);
  }

  getProject(id: string): Project | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  async addProject(input: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    return this.enqueue(async () => {
      const project: Project = {
        ...structuredClone(input),
        id: `p_${randomUUID().slice(0, 8)}`,
        createdAt: Date.now(),
      };
      await this.persistProjectsWith([...this.projects, project], this.groups);
      this.projects.push(project);
      return structuredClone(project);
    });
  }

  async updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null> {
    return this.enqueue(async () => {
      const index = this.projects.findIndex((p) => p.id === id);
      if (index < 0) return null;
      const next = { ...this.projects[index], ...structuredClone(patch), id };
      const projects = [...this.projects];
      projects[index] = next;
      await this.persistProjectsWith(projects, this.groups);
      this.projects = projects;
      return structuredClone(next);
    });
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const before = this.projects.length;
      const projects = this.projects.filter((p) => p.id !== id);
      if (projects.length === before) return false;
      const groups = this.groups.map((g) => ({ ...g, projectIds: g.projectIds.filter((pid) => pid !== id) }));
      await this.persistProjectsWith(projects, groups);
      this.projects = projects;
      this.groups = groups;
      return true;
    });
  }

  private persistProjectsWith(projects: Project[], groups: Group[]): Promise<void> {
    return ConfigStore.atomicWrite(this.opts.projectsFile, { projects, groups });
  }

  listGroups(): Group[] {
    return structuredClone(this.groups);
  }

  getGroup(id: string): Group | null {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  async addGroup(name: string, projectIds: string[]): Promise<Group> {
    return this.enqueue(async () => {
      const group: Group = { id: `g_${randomUUID().slice(0, 8)}`, name, projectIds: [...projectIds] };
      await this.persistProjectsWith(this.projects, [...this.groups, group]);
      this.groups.push(group);
      return structuredClone(group);
    });
  }

  async updateGroup(id: string, patch: Partial<Omit<Group, 'id'>>): Promise<Group | null> {
    return this.enqueue(async () => {
      const index = this.groups.findIndex((g) => g.id === id);
      if (index < 0) return null;
      const next = { ...this.groups[index], ...structuredClone(patch), id };
      const groups = [...this.groups];
      groups[index] = next;
      await this.persistProjectsWith(this.projects, groups);
      this.groups = groups;
      return structuredClone(next);
    });
  }

  async deleteGroup(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const before = this.groups.length;
      const groups = this.groups.filter((g) => g.id !== id);
      if (groups.length === before) return false;
      await this.persistProjectsWith(this.projects, groups);
      this.groups = groups;
      return true;
    });
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.enqueue(async () => {
      this.settings = { ...this.settings, ...structuredClone(patch) };
      await ConfigStore.atomicWrite(this.opts.settingsFile, this.settings);
      return { ...this.settings };
    });
  }
}
