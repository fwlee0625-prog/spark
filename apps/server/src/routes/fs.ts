import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type { FsDirEntry, FsListing } from '@spark/shared';
import { asyncHandler } from './util.js';

/** GET /api/fs/list?path=…&hidden=1 → 只读目录列表(文件夹选择器用) */
export function fsRouter(): Router {
  const router = Router();

  router.get(
    '/list',
    asyncHandler(async (req, res) => {
      const raw = String(req.query.path ?? '').trim();
      const showHidden = String(req.query.hidden ?? '') === '1';
      // 支持 ~ 开头;为空时回退主目录
      const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
      const dir = path.resolve(expanded || os.homedir());

      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return res.status(400).json({ error: 'BAD_REQUEST', message: '目录不存在' });
        if (code === 'ENOTDIR') return res.status(400).json({ error: 'BAD_REQUEST', message: '路径不是目录' });
        if (code === 'EACCES' || code === 'EPERM') {
          return res.status(403).json({ error: 'FORBIDDEN', message: '没有读取该目录的权限' });
        }
        throw err;
      }

      const dirs: FsDirEntry[] = [];
      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        let isDir = entry.isDirectory();
        // 符号链接按指向的真实类型判断,失效链接直接跳过
        if (!isDir && entry.isSymbolicLink()) {
          try {
            isDir = (await fsp.stat(path.join(dir, entry.name))).isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (isDir) dirs.push({ name: entry.name, path: path.join(dir, entry.name) });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));

      const parent = path.dirname(dir);
      const listing: FsListing = {
        path: dir,
        parent: parent === dir ? null : parent,
        dirs,
        home: os.homedir(),
      };
      res.json(listing);
    }),
  );

  return router;
}
