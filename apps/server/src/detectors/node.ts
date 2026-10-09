import fs from 'node:fs';
import path from 'node:path';
import type { DetectResult } from '@spark/shared';

const PREFERRED_SCRIPTS = ['dev', 'serve', 'start'];

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Node / 前端项目识别:锁文件 → 包管理器,package.json → scripts 与类型标签 */
export function detectNode(dir: string): DetectResult | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
  } catch {
    return { type: 'node', suggestedCommand: null, notes: ['package.json 解析失败,请手动填写启动命令'] };
  }

  const has = (f: string) => fs.existsSync(path.join(dir, f));
  const packageManager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  const scripts = Object.keys(pkg.scripts ?? {});
  const preferredScript = PREFERRED_SCRIPTS.find((s) => scripts.includes(s)) ?? null;

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const tags: string[] = [];
  if (deps.vue) tags.push('Vue');
  if (deps.react) tags.push('React');
  if (deps.vite) tags.push('Vite');
  if (deps.nuxt) tags.push('Nuxt');
  if (deps.next) tags.push('Next.js');
  if (deps.express) tags.push('Express');
  if (deps.typescript || has('tsconfig.json')) tags.push('TS');
  const type = deps.vue ? 'vue' : deps.react ? 'react' : 'node';

  const suggestedCommand = preferredScript
    ? packageManager === 'npm'
      ? `npm run ${preferredScript}`
      : `${packageManager} ${preferredScript}`
    : null;

  const notes: string[] = [];
  if (scripts.length === 0) notes.push('package.json 中没有 scripts,请手动填写启动命令');
  else if (!preferredScript) notes.push('未找到 dev/serve/start,可从脚本列表中选择');

  return { type, packageManager, scripts, preferredScript, suggestedCommand, tags, notes };
}
