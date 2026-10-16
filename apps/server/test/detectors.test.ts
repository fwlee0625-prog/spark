import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detect } from '../src/detectors/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-detect-'));
afterAll(() => fs.rmSync(root, { force: true, recursive: true }));

function makeDir(name: string, files: Record<string, string | null>): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    if (content === null) {
      fs.mkdirSync(path.join(dir, file), { recursive: true });
    } else {
      fs.writeFileSync(path.join(dir, file), content);
    }
  }
  return dir;
}

describe('detectors', () => {
  it('pnpm + Vue 项目:识别包管理器并预填 pnpm dev', () => {
    const dir = makeDir('pnpm-vue', {
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({
        name: 'admin-web',
        scripts: { dev: 'vite', build: 'vite build', serve: 'vite preview' },
        dependencies: { vue: '^3.4.0' },
        devDependencies: { vite: '^5.0.0' },
      }),
    });
    const result = detect(dir);
    expect(result.type).toBe('vue');
    expect(result.packageManager).toBe('pnpm');
    expect(result.suggestedCommand).toBe('pnpm dev');
    expect(result.scripts).toEqual(['dev', 'build', 'serve']);
    expect(result.tags).toContain('Vue');
    expect(result.tags).toContain('Vite');
  });

  it('yarn.lock → yarn', () => {
    const dir = makeDir('yarn-node', {
      'yarn.lock': '',
      'package.json': JSON.stringify({ scripts: { start: 'node server.js' }, dependencies: { express: '^4.0.0' } }),
    });
    const result = detect(dir);
    expect(result.packageManager).toBe('yarn');
    expect(result.suggestedCommand).toBe('yarn start');
    expect(result.type).toBe('node');
  });

  it('package-lock.json → npm run', () => {
    const dir = makeDir('npm-node', {
      'package-lock.json': '',
      'package.json': JSON.stringify({ scripts: { dev: 'webpack serve' } }),
    });
    const result = detect(dir);
    expect(result.packageManager).toBe('npm');
    expect(result.suggestedCommand).toBe('npm run dev');
  });

  it('scripts 里没有 dev/serve/start 时不强行推荐', () => {
    const dir = makeDir('no-scripts', {
      'package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
    });
    const result = detect(dir);
    expect(result.suggestedCommand).toBeNull();
    expect(result.notes?.length).toBeGreaterThan(0);
  });

  it('Django 项目:使用 .venv 的 manage.py runserver', () => {
    const dir = makeDir('django-app', {
      '.venv': null,
      'manage.py': '# django',
      'requirements.txt': 'django==5.0\n',
    });
    const result = detect(dir);
    expect(result.type).toBe('python');
    expect(result.venv).toBe('.venv');
    expect(result.suggestedCommand).toBe('.venv/bin/python manage.py runserver');
  });

  it('FastAPI 项目:推荐 uvicorn 启动', () => {
    const dir = makeDir('fastapi-app', {
      venv: null,
      'main.py': 'from fastapi import FastAPI',
      'requirements.txt': 'fastapi==0.110\nuvicorn==0.29\n',
    });
    const result = detect(dir);
    expect(result.venv).toBe('venv');
    expect(result.suggestedCommand).toBe('venv/bin/python -m uvicorn main:app --reload');
  });

  it('无虚拟环境的 app.py 回退到 python3', async () => {
    const dir = makeDir('plain-py', { 'app.py': 'print(1)' });
    const result = detect(dir);
    expect(result.suggestedCommand).toBe('python3 app.py');
    expect(result.notes?.some((n) => n.includes('虚拟环境'))).toBe(true);
  });

  it('空目录返回通用兜底', async () => {
    const dir = await fsp.mkdtemp(path.join(root, 'empty-'));
    const result = detect(dir);
    expect(result.type).toBe('generic');
    expect(result.suggestedCommand).toBeNull();
  });
});
