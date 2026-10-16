# 架构

对应产品背景见 [design/prd.md](design/prd.md)。实现以代码为准。

## 1. 技术选型

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 后端 | Node.js 20+（Express） | `child_process` 做进程管理 |
| 实时通信 | SSE | 日志和状态都是服务端推送 |
| 前端 | Vue 3 + Vite + Tailwind v4 | 管理页面 |
| 存储 | 本地 JSON | 配置量小，无需数据库 |
| 进程树 | 进程组（`detached: true` + `process.kill(-pid)`） | 停止时不残留子进程 |
| 端口检测 | `net` + `lsof` | 占用检测与来源定位 |
| AI 接入 | MCP Streamable HTTP | 挂在同一服务的 `/mcp` |

## 2. 整体架构

```
┌──────────────┐   HTTP / SSE    ┌────────────────────────────────┐
│  Web 页面     │ ◀─────────────▶ │  Node 服务 (127.0.0.1)          │
│  (Vue)       │                 │                                │
└──────────────┘                 │  ├─ API 路由                    │
                                 │  ├─ ProcessManager              │
       AI 客户端 ──POST /mcp──▶  │  ├─ LogBuffer / 磁盘日志        │
                                 │  ├─ Detector                    │
                                 │  ├─ ConfigStore                 │
                                 │  └─ MCP（apps/mcp 工具库）       │
                                 └──────────────┬─────────────────┘
                                                │ spawn（进程组）
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                     pnpm dev              python app.py         node server.js
```

Node 服务常驻。项目进程是独立进程组，默认不随 Spark 退出而停止。页面只是控制台；MCP 走同一套 `/api`。

## 3. 目录结构

```
spark/
├─ apps/
│  ├─ server/          Express：进程、日志、识别、端口、配置、挂载 /mcp
│  ├─ mcp/             MCP 工具定义（库）
│  └─ web/             Vue 3 管理页面
├─ packages/shared/    前后端共享类型与常量
├─ docs/
└─ package.json        pnpm workspace 根
```

`pnpm dev` 的数据在仓库 `apps/server/data`；`pnpm start` 使用 `~/.spark`。见 [configuration.md](configuration.md)。

## 4. 数据模型

`projects.json`：

```json
{
  "projects": [
    {
      "id": "p_1",
      "name": "admin",
      "type": "vue",
      "cwd": "/Users/me/code/admin",
      "terminals": [
        {
          "id": "t_1",
          "number": 1,
          "name": "web",
          "cwd": "",
          "command": "pnpm dev",
          "port": 5173,
          "env": { "FORCE_COLOR": "1" }
        }
      ],
      "groupIds": ["g_1"],
      "autoRestart": false,
      "createdAt": 1730000000000
    }
  ],
  "groups": [
    { "id": "g_1", "name": "电商前后端", "projectIds": ["p_1", "p_2"] }
  ]
}
```

界面状态在内存；进程身份写入 `runtime/`，启动时核验后恢复。项目状态：`stopped` | `starting` | `running` | `partial` | `failed`。

## 5. 核心模块

### ProcessManager

- 使用登录 shell `zsh -ilc`（可改为 `zsh -lc` 或直接 spawn），保证 PATH / nvm / pyenv / conda 与终端接近。
- `detached: true`，子进程成为新进程组组长（`pid` 即 `pgid`）。
- 停止：先对进程组 `SIGTERM`，约 5 秒后再 `SIGKILL`；配置端口仍被占用时，校验 cwd 再按端口兜底。
- 一个项目多个终端，各自独立进程和日志；项目级按钮操作全部终端，「部分运行」时再次启动只拉未运行的。
- 崩溃自动重启：项目级开关，指数退避，次数见设置。
- 退出：默认 `detach` 保留进程；`stopProjectsOnExit` 为 true 时先停再退出。恢复逻辑见 [process-recovery.md](process-recovery.md)。

### LogBuffer

- 每个终端一个环形缓冲（默认 5000 行）。
- 新日志写入缓冲并广播给 SSE；页面打开时先回放再接实时流。
- `data` 可能在行中间截断，需按 `\n` 拼接。
- 进程 stdout/stderr 同时落到 `runtime/` 文件，Spark 重启后最多回放每条流最近 256 KiB。

### Detector

识别结果只用于预填，不强制。

- Node：锁文件判断 pnpm / yarn / npm；读 `package.json` scripts，优先 `dev` / `serve` / `start`。
- Python：检测 `.venv` / `venv`、`requirements.txt`、`pyproject.toml`、`manage.py`、`app.py` / `main.py`；建议命令自动带 `PYTHONUNBUFFERED=1`。

### 端口检测

先用 `net` 测能否监听；被占用时用 `lsof` 解析 PID。若 PID 属于已管理项目的进程组，提示项目名和终端，否则提示外部进程。页面还会定期发现运行进程实际监听的 TCP 端口。

### ConfigStore

启动读 `projects.json` / `settings.json`，不存在则创建。写入先写临时文件再 rename，并用 Promise 队列串行化。

### MCP

`apps/mcp` 把 `/api` 封装成工具。server 以无状态 Streamable HTTP 挂在 `/mcp`。详见 [mcp.md](mcp.md)。

## 6. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/csrf-token` | 页面修改类请求令牌 |
| GET | `/api/projects` | 项目列表（含运行状态） |
| POST | `/api/projects` | 新建 |
| PUT | `/api/projects/:id` | 修改 |
| DELETE | `/api/projects/:id` | 删除（先停止，只删配置） |
| POST | `/api/projects/:id/start` | 启动（`?force=1` 跳过端口检测） |
| POST | `/api/projects/:id/stop` | 停止 |
| POST | `/api/projects/:id/restart` | 重启 |
| POST | `/api/projects/:id/terminals/:terminalId/:action` | 单终端 start/stop/restart |
| GET | `/api/projects/:id/logs` | SSE 实时日志 |
| GET | `/api/projects/:id/logs/snapshot` | 日志快照（MCP / CLI） |
| POST | `/api/projects/:id/logs/clear` | 清空日志 |
| POST | `/api/detect` | `{ dir }` → 识别结果 |
| GET | `/api/fs/list` | 列目录（文件夹选择器） |
| GET | `/api/ports` | 已配置 / 已发现端口 |
| GET | `/api/ports/:port` | 单端口占用 |
| GET/POST/PUT/DELETE | `/api/groups` | 分组 CRUD |
| POST | `/api/groups/:id/start` | 整组启动（冲突项跳过并上报） |
| POST | `/api/groups/:id/stop` | 整组停止 |
| GET/PUT | `/api/settings` | 全局设置 |
| GET | `/api/events` | SSE 状态变更 |
| GET/DELETE | `/api/app-logs` | Spark 自身日志 |
| POST | `/mcp` | MCP（无 CSRF，拒绝带 Origin 的请求） |

## 7. 安全

见 [SECURITY.md](../SECURITY.md)。要点：只绑 `127.0.0.1`；Host / Origin 校验；修改类 API 带 CSRF token；MCP 拒绝浏览器 Origin。

## 8. 测试要点

1. 启动 `pnpm dev` 后停止，进程树和端口都清掉。
2. Python 项目 `print` 在约 1 秒内出现在页面。
3. nvm 切换过 Node 的机器上，项目用的版本与终端一致。
4. 手动占用端口后启动，提示来源正确。
5. 默认退出后项目仍在；下次启动能恢复管理。`stopProjectsOnExit` 打开时，`Ctrl+C` 会停掉子项目。
6. 刷新页面后状态和历史日志可恢复。

## 9. 后续

需要托盘、开机自启、独立窗口时，可以把 Node 服务作为 Tauri sidecar，前端仍指向本地端口。业务代码不必重写。
