import path from 'node:path';

/** 服务只监听本机回环地址,不对局域网开放 */
export const HOST = '127.0.0.1';

export const PORT = Number(process.env.SPARK_PORT ?? 7788);

/** 数据目录(项目配置、设置);可用 SPARK_DATA_DIR 覆盖 */
export const DATA_DIR = process.env.SPARK_DATA_DIR
  ? path.resolve(process.env.SPARK_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/** 前端构建产物目录(生产模式下由本服务静态托管) */
export const WEB_DIST = process.env.SPARK_WEB_DIST
  ? path.resolve(process.env.SPARK_WEB_DIST)
  : path.resolve(process.cwd(), '../web/dist');
