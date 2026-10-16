import fs from 'node:fs';
import path from 'node:path';
import type { DetectResult } from '@spark/shared';

function readText(dir: string, file: string): string {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf8');
  } catch {
    return '';
  }
}

/** Python 项目识别:虚拟环境 + 入口文件 → 预填启动命令 */
export function detectPython(dir: string): DetectResult | null {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  const isPython =
    has('manage.py') || has('app.py') || has('main.py') || has('requirements.txt') || has('pyproject.toml');
  if (!isPython) return null;

  const venv = (['.venv', 'venv'] as const).find((v) => has(v)) ?? null;
  const py = venv ? `${venv}/bin/python` : 'python3';

  // 依赖声明中包含 fastapi/uvicorn 时推荐 uvicorn 启动
  const depText = readText(dir, 'requirements.txt') + readText(dir, 'pyproject.toml');
  const usesFastApi = /fastapi|uvicorn/i.test(depText);

  let suggestedCommand: string | null = null;
  if (has('manage.py')) suggestedCommand = `${py} manage.py runserver`;
  else if (usesFastApi && has('main.py')) suggestedCommand = `${py} -m uvicorn main:app --reload`;
  else if (has('main.py')) suggestedCommand = `${py} main.py`;
  else if (has('app.py')) suggestedCommand = `${py} app.py`;

  const notes: string[] = [];
  if (!venv) notes.push('未检测到虚拟环境(.venv / venv),将使用系统 python3');
  notes.push('启动时自动附加 PYTHONUNBUFFERED=1,保证日志实时输出');
  if (!suggestedCommand) notes.push('未找到入口文件(manage.py / main.py / app.py),请手动填写启动命令');

  return { type: 'python', venv, suggestedCommand, notes, tags: venv ? ['venv'] : [] };
}
