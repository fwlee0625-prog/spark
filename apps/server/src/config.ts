import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 服务只监听本机回环地址,不对局域网开放 */
export const HOST = '127.0.0.1';

export const PORT = Number(process.env.SPARK_PORT ?? 7788);

/** 默认数据目录:用户主目录下的 .spark,可用 SPARK_DATA_DIR 覆盖 */
export const DEFAULT_DATA_DIR = path.join(os.homedir(), '.spark');

export function resolveDataDir(): string {
  return process.env.SPARK_DATA_DIR ? path.resolve(process.env.SPARK_DATA_DIR) : DEFAULT_DATA_DIR;
}

export const DATA_DIR = resolveDataDir();
export const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/** 前端构建产物目录(生产模式下由本服务静态托管) */
export const WEB_DIST = process.env.SPARK_WEB_DIST
  ? path.resolve(process.env.SPARK_WEB_DIST)
  : path.resolve(process.cwd(), '../web/dist');

/**
 * 将仓库内 data 目录复制到 ~/.spark。
 * 开发脚本已设置 SPARK_DATA_DIR，不会触发；仅 pnpm start 这类未覆盖数据目录的启动会迁移。
 * 目标已有 projects.json 时不覆盖。
 */
export function migrateLegacyDataDir(opts?: { legacyDir?: string; targetDir?: string }): void {
  if (process.env.SPARK_DATA_DIR) return;
  const legacy = opts?.legacyDir ?? path.resolve(process.cwd(), 'data');
  const target = opts?.targetDir ?? DEFAULT_DATA_DIR;
  if (!fs.existsSync(path.join(legacy, 'projects.json'))) return;
  if (fs.existsSync(path.join(target, 'projects.json'))) {
    // 配置已迁移也要补齐运行记录；不覆盖目标记录，不凭端口接管进程。
    const sourceRuntime = path.join(legacy, 'runtime');
    const targetRuntime = path.join(target, 'runtime');
    if (!fs.existsSync(sourceRuntime)) return;
    fs.mkdirSync(targetRuntime, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(sourceRuntime)) {
      if (!name.endsWith('.json')) continue;
      const destination = path.join(targetRuntime, name);
      if (fs.existsSync(destination)) continue;
      const base = name.slice(0, -5);
      for (const suffix of ['stdout', 'stderr']) {
        const source = path.join(sourceRuntime, `${base}.${suffix}`);
        const output = path.join(targetRuntime, `${base}.${suffix}`);
        // 原进程仍持有旧日志文件的描述符，链接保证后续输出继续可读。
        if (fs.existsSync(source) && !fs.existsSync(output)) fs.symlinkSync(source, output);
      }
      fs.copyFileSync(path.join(sourceRuntime, name), destination, fs.constants.COPYFILE_EXCL);
    }
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(legacy, target, {
    recursive: true,
    filter: (source) => source !== path.join(legacy, 'runtime'),
  });
  migrateLegacyDataDir({ legacyDir: legacy, targetDir: target });
  console.warn(`[spark] 已将数据从 ${legacy} 迁移到 ${target}`);
}
