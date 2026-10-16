import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('resolveDataDir', () => {
  it('SPARK_DATA_DIR 覆盖默认目录', async () => {
    vi.stubEnv('SPARK_DATA_DIR', '/tmp/spark-data');
    vi.resetModules();
    const { DATA_DIR } = await import('../src/config.js');
    expect(DATA_DIR).toBe(path.resolve('/tmp/spark-data'));
  });

  it('未设置环境变量时使用 ~/.spark', async () => {
    vi.stubEnv('SPARK_DATA_DIR', '');
    Reflect.deleteProperty(process.env, 'SPARK_DATA_DIR');
    vi.resetModules();
    const { DATA_DIR, DEFAULT_DATA_DIR } = await import('../src/config.js');
    expect(DEFAULT_DATA_DIR).toBe(path.join(os.homedir(), '.spark'));
    expect(DATA_DIR).toBe(DEFAULT_DATA_DIR);
  });
});

describe('migrateLegacyDataDir', () => {
  it('目标没有配置时从旧目录复制', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-migrate-'));
    const legacy = path.join(tmp, 'legacy');
    const target = path.join(tmp, 'target');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'projects.json'), '{"projects":[],"groups":[]}');
    Reflect.deleteProperty(process.env, 'SPARK_DATA_DIR');
    vi.resetModules();
    const { migrateLegacyDataDir } = await import('../src/config.js');
    migrateLegacyDataDir({ legacyDir: legacy, targetDir: target });
    expect(fs.readFileSync(path.join(target, 'projects.json'), 'utf8')).toContain('"projects"');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('目标已有配置时不覆盖', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-migrate-'));
    const legacy = path.join(tmp, 'legacy');
    const target = path.join(tmp, 'target');
    fs.mkdirSync(legacy);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(legacy, 'projects.json'), '{"projects":["old"]}');
    fs.writeFileSync(path.join(target, 'projects.json'), '{"projects":["keep"]}');
    Reflect.deleteProperty(process.env, 'SPARK_DATA_DIR');
    vi.resetModules();
    const { migrateLegacyDataDir } = await import('../src/config.js');
    migrateLegacyDataDir({ legacyDir: legacy, targetDir: target });
    expect(fs.readFileSync(path.join(target, 'projects.json'), 'utf8')).toContain('keep');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('设置了 SPARK_DATA_DIR 时不迁移', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-migrate-'));
    const legacy = path.join(tmp, 'legacy');
    const target = path.join(tmp, 'target');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'projects.json'), '{"projects":[]}');
    vi.stubEnv('SPARK_DATA_DIR', target);
    vi.resetModules();
    const { migrateLegacyDataDir } = await import('../src/config.js');
    migrateLegacyDataDir({ legacyDir: legacy, targetDir: target });
    expect(fs.existsSync(path.join(target, 'projects.json'))).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
