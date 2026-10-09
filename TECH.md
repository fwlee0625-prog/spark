# 本地项目启动管理工具 · 技术文档

版本:v0.1  
对应 PRD:`PRD.md`

---

## 1. 技术选型

| 层     | 选择                                           | 说明                                  |
| ----- | -------------------------------------------- | ----------------------------------- |
| 后端    | Node.js 20+(Express)                         | `child_process` 做进程管理最顺手            |
| 实时通信  | SSE(日志推送)                                    | 日志是单向推送,SSE 比 WebSocket 更简单;需要双向时再换 |
| 前端    | Vue 3 + Vite(或原生 HTML)                       | 与日常技术栈一致                            |
| 存储    | 本地 JSON 文件                                   | 配置量小,无需数据库                          |
| 进程树管理 | 进程组(`detached: true` + `process.kill(-pid)`) | 保证停止时不残留子进程                         |
| 端口检测  | `net` 模块 + `lsof`(兜底)                        | 检测占用与定位来源                           |

---

## 2. 整体架构

```
┌──────────────┐   HTTP / SSE    ┌───────────────────────────┐
│  Web 页面     │ ◀─────────────▶ │  Node 服务 (127.0.0.1)     │
│  (Vue)       │                 │                           │
└──────────────┘                 │  ├─ API 路由               │
                                 │  ├─ ProcessManager         │
                                 │  ├─ LogBuffer              │
                                 │  ├─ Detector (识别器)       │
                                 │  └─ ConfigStore            │
                                 └──────────┬────────────────┘
                                            │ spawn (进程组)
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                     pnpm dev          python app.py      node server.js
                     (vite 子进程)      (uvicorn 等)
```

**关键点**:Node 服务常驻,项目进程是它的子进程;页面只是控制台,关闭页面不影响项目运行。

---

## 3. 目录结构建议

```
project-launcher/
├─ server/
│  ├─ index.js            # 入口,启动 HTTP 服务
│  ├─ routes/             # API 路由
│  ├─ core/
│  │  ├─ processManager.js
│  │  ├─ logBuffer.js
│  │  ├─ portChecker.js
│  │  └─ configStore.js
│  └─ detectors/
│     ├─ node.js          # 包管理器 + scripts 识别
│     └─ python.js        # 虚拟环境 + 入口识别
├─ web/                   # 前端
├─ data/
│  └─ projects.json       # 项目配置
└─ package.json
```

---

## 4. 数据模型

`data/projects.json`:

```json
{
  "projects": [
    {
      "id": "p_1",
      "name": "admin-web",
      "type": "vue",
      "cwd": "/Users/me/code/admin-web",
      "command": "pnpm dev",
      "port": 5173,
      "env": { "FORCE_COLOR": "1" },
      "groupIds": ["g_1"]
    }
  ],
  "groups": [
    { "id": "g_1", "name": "电商前后端", "projectIds": ["p_1", "p_2"] }
  ]
}
```

**运行时状态**（界面状态在内存，进程身份写入 `data/runtime/` 用于启动时核验恢复）:

```js
{
  id: "p_1",
  status: "running",        // stopped | starting | running | failed
  pid: 12345,
  startedAt: 1730000000000,
  exitCode: null
}
```

---

## 5. 核心模块设计

### 5.1 ProcessManager

**启动**

```js
const { spawn } = require('child_process');

function start(project) {
  const child = spawn('zsh', ['-ilc', project.command], {
    cwd: project.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', ...project.env },
    detached: true,                 // 独立进程组,便于整组 kill
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => logBuffer.push(project.id, d));
  child.stderr.on('data', (d) => logBuffer.push(project.id, d));
  child.on('exit', (code) => markStopped(project.id, code));

  return child.pid;
}
```

**说明**

- 使用登录 shell `zsh -ilc`,保证 PATH、nvm、pyenv、conda 与终端一致。
- `detached: true` 让子进程成为新进程组组长,此时 `pid` 即 `pgid`。
- 如果 `.zshrc` 过重导致启动慢,提供配置项改用 `zsh -lc` 或直接 `spawn`。

**停止(杀进程组)**

```js
async function stop(project) {
  const { pid } = state[project.id];
  try { process.kill(-pid, 'SIGTERM'); } catch {}
  const exited = await waitExit(pid, 5000);
  if (!exited) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
  // 兜底:按端口再清理一次(针对自行脱离进程组的项目)
  if (project.port) await killByPort(project.port);
}
```

**要点**

- 先 `SIGTERM` 优雅退出,超时(如 5 秒)再 `SIGKILL`。
- `-pid` 表示杀整个进程组,覆盖 `pnpm → sh → vite` 这类多层结构。
- 兜底按端口清理:用 `lsof -ti :PORT` 找到 PID 再杀,仅在确认该端口属于本项目时执行。

**服务自身退出时的清理**

- 监听 `SIGINT`、`SIGTERM`，默认保留独立进程组运行；设置 `stopProjectsOnExit` 为 true 时停止所有项目。输出使用文件而不是父进程管道；启动时核验记录中的 PID、进程组、启动时间后恢复管理，每 2 秒检查恢复进程是否退出。

### 5.2 LogBuffer

- 每个项目一个环形缓冲区(默认 5000 行)。
- 新日志到来时:写入缓冲区,同时广播给订阅该项目的 SSE 连接。
- 页面新打开时先回放缓冲区,再接实时流,这样刷新页面也能看到历史日志。
- 注意处理分片:`data` 事件可能在一行中间截断,需要按 `\n` 拼接后再入缓冲。

### 5.3 Detector(智能识别)

**Node 识别器**

```js
function detectNode(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const pm = has('pnpm-lock.yaml') ? 'pnpm'
           : has('yarn.lock') ? 'yarn'
           : 'npm';

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const scripts = Object.keys(pkg.scripts || {});
  const preferred = ['dev', 'serve', 'start'].find((s) => scripts.includes(s));

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const tag = deps.vue ? 'vue' : deps.react ? 'react' : 'node';

  return {
    type: tag,
    packageManager: pm,
    scripts,
    suggestedCommand: preferred
      ? (pm === 'npm' ? `npm run ${preferred}` : `${pm} ${preferred}`)
      : null,
  };
}
```

**Python 识别器**

```js
function detectPython(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const venv = ['.venv', 'venv'].find((v) => has(v));
  const py = venv ? `${venv}/bin/python` : 'python3';

  let suggestedCommand = null;
  if (has('manage.py')) suggestedCommand = `${py} manage.py runserver`;
  else if (has('main.py')) suggestedCommand = `${py} main.py`;
  else if (has('app.py')) suggestedCommand = `${py} app.py`;

  return { type: 'python', venv, suggestedCommand };
}
```

**说明**

- 识别结果只用于**预填**,用户可以随时修改,不强制。
- 类型判定为"建议性",例如 FastAPI 项目需要读取依赖再决定是否推荐 `uvicorn`,可在后续迭代中增强。

### 5.4 端口检测

```js
const net = require('net');

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}
```

被占用时,调用 `lsof -nP -iTCP:PORT -sTCP:LISTEN` 解析出 PID 与进程名;如果 PID 属于某个已管理项目的进程组,则提示"被项目 X 占用",否则提示为外部进程。

### 5.5 ConfigStore

- 启动时读取 `projects.json`,不存在则创建空结构。
- 写入时使用"先写临时文件再 rename"的方式,避免写到一半崩溃导致文件损坏。
- 所有写入串行化(简单的 Promise 队列),避免并发覆盖。

---

## 6. API 设计

| 方法     | 路径                          | 说明                       |
| ------ | --------------------------- | ------------------------ |
| GET    | `/api/projects`             | 项目列表(含运行状态)              |
| POST   | `/api/projects`             | 新建项目                     |
| PUT    | `/api/projects/:id`         | 修改项目                     |
| DELETE | `/api/projects/:id`         | 删除项目(先停止)                |
| POST   | `/api/projects/:id/start`   | 启动                       |
| POST   | `/api/projects/:id/stop`    | 停止                       |
| POST   | `/api/projects/:id/restart` | 重启                       |
| GET    | `/api/projects/:id/logs`    | SSE 实时日志(先回放缓冲)          |
| POST   | `/api/detect`               | 入参 `{ dir }`,返回识别结果与建议命令 |
| GET    | `/api/ports/:port`          | 端口占用检测                   |
| GET    | `/api/groups`               | 分组列表                     |
| POST   | `/api/groups/:id/start`     | 整组启动                     |
| POST   | `/api/groups/:id/stop`      | 整组停止                     |
| GET    | `/api/events`               | SSE 状态变更推送(状态点实时刷新)      |

**SSE 日志示例**

```
GET /api/projects/p_1/logs
Content-Type: text/event-stream

data: {"line":"  VITE v5.0.0  ready in 320 ms\n","ts":1730000000000}
```

---

## 7. 安全设计

- 服务只绑定 `127.0.0.1`,不监听 `0.0.0.0`。
- 由于该服务可以执行任意命令,必须防止被网页跨站调用(CSRF / DNS rebinding):
  - 校验请求的 `Host` 头必须为 `127.0.0.1:端口` 或 `localhost:端口`
  - 校验 `Origin`,仅允许自身页面来源
  - 修改类接口使用 `POST/PUT/DELETE`,并带一个启动时生成的随机 token(页面加载时由服务注入)
- 命令来自用户本人配置,不拼接外部输入;`/api/detect` 的 `dir` 需做路径规范化,仅读取文件、不执行。

---

## 8. 异常与边界处理

| 场景             | 处理                                  |
| -------------- | ----------------------------------- |
| 启动命令立即退出       | 状态置为 failed,日志保留,页面提示退出码            |
| 端口被占用          | 启动前拦截并提示来源                          |
| 项目自行 fork 守护进程 | 停止时按端口兜底清理                          |
| 服务重启后项目仍在运行    | v1 不接管(会提示端口被占用);v2 可持久化 pid 并校验后接管 |
| 日志过大           | 环形缓冲限制行数,单行超长截断                     |
| 配置文件损坏         | 启动时校验,失败则备份原文件并提示                   |

---

## 9. 测试要点

1. **进程树清理**:启动 `pnpm dev`,停止后用 `ps -ef | grep` 确认无残留,端口已释放。
2. **日志实时性**:Python 项目启动后,`print` 输出在 1 秒内出现在页面。
3. **环境一致性**:在 nvm 切换过 Node 版本的机器上,项目使用的 Node 版本与终端一致。
4. **端口冲突**:手动占用端口后启动项目,出现正确提示。
5. **服务退出**:`Ctrl+C` 停止 Node 服务后,所有子项目被一并清理。
6. **刷新页面**:刷新后状态、历史日志可恢复。

---

## 10. 后续演进:套 Tauri 壳

当需要托盘、开机自启、独立窗口时:

- 将 Node 服务作为 **sidecar** 由 Tauri 拉起和管理生命周期。
- 前端页面原样复用,仅将访问地址指向本地服务端口。
- Tauri 退出时负责通知 Node 服务执行清理,避免孤儿进程。

这样现有的所有业务代码都不需要重写。

---

## 11. 开发计划(对应 PRD 里程碑)

| 阶段 | 任务                                                        |
| -- | --------------------------------------------------------- |
| M1 | ConfigStore、ProcessManager(启动/停止)、LogBuffer + SSE、基础页面    |
| M2 | 进程组清理与端口兜底、PortChecker、Node/Python Detector、`/api/detect` |
| M3 | 分组启动、ANSI 渲染(`ansi_up`)、崩溃自动重启、安全校验(Host/Origin/token)    |
| M4 | (可选)Tauri 壳                                               |
