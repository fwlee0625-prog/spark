# Spark · 本地项目启动管理工具

统一的本地项目管理面板:项目的**创建、启动、停止、重启、实时日志、端口监控与分组一键启停**。
Node.js 常驻服务(Express + SSE)+ Vue 3 Web 页面,monorepo 管理(pnpm workspaces)。

对应 `PRD.md`(v1 范围 M1–M3)与 `TECH.md`;界面按 `原型图.png` 实现。

## 快速开始

要求:Node.js 20+、pnpm。

```bash
pnpm install

# 开发模式:页面 http://127.0.0.1:5173(Vite 热更新,API 代理到开发实例 7789)
pnpm dev

# 日常使用:自动构建前端并由服务托管(单进程,生产端口 7788)
pnpm start
# 打开 http://127.0.0.1:7788
# 跳过构建:`pnpm start:only`
```

| 模式 | 页面地址 | API 端口 |
| --- | --- | --- |
| 开发(`pnpm dev`) | http://127.0.0.1:5173 | 7789 |
| 生产(`pnpm start`) | http://127.0.0.1:7788 | 7788 |

两个实例端口不同,可以同时运行(比如开发时保持生产实例在线);注意它们共用同一个数据目录,
同时操作同一批项目时以后保存的为准。API 端口都可用 `SPARK_PORT` 覆盖。

重复 `pnpm start` 会得到友好提示(端口被占用时,大概率是 Spark 已在运行);未构建前端时启动会有明确提醒。

环境变量(可选):`SPARK_PORT`(默认 7788)、`SPARK_DATA_DIR`(默认 `apps/server/data`)、`SPARK_WEB_DIST`。

## 让 AI 直接管理项目(MCP)

Spark 服务内嵌了 MCP 端点(Streamable HTTP):`http://127.0.0.1:7788/mcp`,Cursor / Claude 等 AI 客户端
可以直接创建项目、启停、查看终端信息和日志,不用手动操作页面。
所有客户端共用 Spark 服务这一个入口,**不会为每个会话额外启动进程**。

使用前提:Spark 服务已运行(`pnpm start`)。仓库已带 `.cursor/mcp.json`,Cursor 打开本项目后在
「Settings → MCP」启用 `spark` 即可。其他支持 HTTP 的客户端配置:

```json
{
  "mcpServers": {
    "spark": { "url": "http://127.0.0.1:7788/mcp" }
  }
}
```

连开发实例时把端口改为 `7789`。仅支持 stdio 的客户端可借助 `npx mcp-remote http://127.0.0.1:7788/mcp` 桥接。

安全:端点只监听 `127.0.0.1`,同样校验 Host;带 `Origin` 的浏览器请求一律拒绝(防止网页跨站调用);
无状态模式,仅接受 POST。工具通过回环地址调用本服务自己的 `/api`,复用原有校验与业务逻辑。

| 工具 | 说明 |
| --- | --- |
| `detect_project` | 识别目录类型并给出建议命令(只读) |
| `list_projects` / `get_project` | 项目列表 / 单个项目完整配置 |
| `get_terminals` | 项目有几个终端、各终端状态,附日志概况(总行数、最近输出、疑似报错数) |
| `create_project` / `update_project` / `delete_project` | 增删改项目;`create_project` 省略终端时按识别结果生成,`start=true` 可创建后立即启动 |
| `control_project` | 启动 / 停止 / 重启整个项目或单个终端,端口冲突时返回占用来源 |
| `get_logs` / `clear_logs` | 读取(`tail`、`grep`、`errorsOnly`、`stream`)/ 清空终端日志 |
| `get_app_logs` | Spark 自身运行日志 |
| `check_port` | 单端口占用检测;不传端口则列出全部监听端口 |
| `list_groups` / `create_group` / `control_group` / `delete_group` | 分组管理与整组启停 |
| `get_settings` | 读取全局设置 |

项目和终端参数都可以传 id 或名称(终端还可传编号)。注意:终端命令会在本机执行,请在客户端保留对变更类工具的确认。

## Monorepo 结构

```
apps/server   Express 服务:进程管理、日志 SSE、识别器、端口检测、配置存储
apps/mcp      MCP 工具定义(库):由 server 挂载到 /mcp 端点,把 Spark API 封装为 AI 可调用的工具
apps/web      Vue 3 + Vite + Tailwind v4:首页 / 项目列表 / 端口管理 / 设置
packages/shared   前后端共享类型与常量(自动被两端以 TS 源码消费)
```

## 功能

- **项目管理**:新建(浏览选择目录或手填 → 自动识别 → 预填命令)、编辑、删除(仅移除配置)、启动/停止/重启。
- **智能识别**:锁文件 → pnpm/yarn/npm;`package.json` scripts 点选;Python 虚拟环境与入口文件;结果仅用于预填。
- **实时日志**:SSE 推送,先回放缓冲再接实时流;环形缓冲默认 5000 行;ANSI 颜色渲染;自动滚动(上滚暂停)、清空。
- **进程树清理**:detached 进程组 + SIGTERM→SIGKILL,按端口 cwd 校验兜底,不留 vite/webpack 子进程。
- **端口管理**:启动前冲突检测(占用来源定位到项目或外部进程 PID)、批量扫描页、`?force=1` 强制启动。
- **分组**:整组启动(端口冲突自动跳过并上报)/ 整组停止。
- **崩溃自动重启**:项目级开关,指数退避,次数上限见设置页。
- **安全**:仅监听 127.0.0.1;Host/Origin 校验 + CSRF token;服务退出(SIGINT/SIGTERM)时停止全部子项目。
- **设置**:Shell 启动方式(`zsh -ilc` / `zsh -lc` / 直接 spawn)、日志行数、重启上限，以及「退出 Spark 时停止所有项目」（默认关闭）。

## 数据与备份

`$SPARK_DATA_DIR/projects.json`(项目 + 分组)、`settings.json`(设置);写入为「临时文件 + rename」,
损坏时自动备份为 `*.corrupt-<ts>`。可直接拷贝目录迁移。

## 测试

```bash
pnpm test        # vitest:logBuffer / configStore / detectors / portChecker / processManager(真实进程)
pnpm typecheck   # 全仓 TS 检查
```

## 验收清单(PRD §7 / TECH §9,已逐条验证)

1. pnpm + Vue 项目选目录自动预填 `pnpm dev`,启动后页面实时显示日志 ✓
2. 带 `.venv` 的 Python 项目预填虚拟环境命令,`PYTHONUNBUFFERED=1` 下日志秒级可见 ✓
3. 停止后 `ps` 无任何相关进程、端口释放(含 pnpm → sh → node 多层树)✓
4. 端口被占用时给出明确提示(项目名或外部进程 PID)✓
5. 关闭浏览器页面项目继续运行;重新打开后状态与日志恢复(SSE 回放)✓
6. `Ctrl+C` 停止服务后所有子项目被一并清理 ✓

## 已知边界

- 服务重启后不接管仍在运行的项目(v1 行为,会提示端口被占用)。
- 组内启动顺序与间隔、开机自启、Tauri 托盘壳(M4)未实现,见 PRD P2。
- Windows 未适配(依赖 zsh/lsof/pgrep)。


### 一个项目配置多个终端

新建或编辑项目时，点击「添加终端」，分别配置前端、后端等服务的名称、启动命令、工作目录和端口。工作目录留空使用项目目录，也支持相对路径（如 `frontend`、`backend`）及绝对路径。环境变量在每个终端卡片内独立配置，自动重启设置由所有终端共用。

项目的启动、停止和重启按钮操作全部终端；处于「部分运行」时再次启动只启动未运行的终端。首页日志和项目日志抽屉提供终端标签页，每个终端可独立启停、重启和清空日志。项目列表展示各终端状态，端口管理扫描所有终端的配置端口，并每 3 秒自动发现运行进程及其子进程实际监听的 TCP 端口。无需填写端口，项目卡片、终端日志面板和端口管理也会展示检测结果；检测结果仅保留在运行时。

编辑运行配置前需先停止项目。

### 退出与恢复

默认关闭或重启 Spark 时，已启动的项目继续在后台运行。下次启动 Spark 会读取 `data/runtime/` 的终端进程记录，核对 PID、进程组和启动时间，恢复仍在运行的终端；已经退出的终端显示为停止。恢复后支持继续查看日志、停止和重启，无需重新启动项目。多终端项目会按实际情况显示「部分运行」。

设置中开启「退出 Spark 时停止所有项目」可恢复随 Spark 一同停止的行为，保存后在下次退出时生效。关闭浏览器页面始终不会停止项目。Spark 不运行期间不提供崩溃自动重启，也不会在下次启动时自动拉起已停止的项目。

项目输出保存在 `data/runtime/`，页面仍按设置限制日志行数；重启 Spark 时回放每条输出流最近最多 256 KiB，随后继续实时读取。日志文件在该终端重新启动时覆盖，持续运行及 Spark 离线期间会累积磁盘日志。运行记录仅适用于本机，不应作为配置迁移。升级前已启动的进程仍使用旧的日志管道，需要使用新版重新启动一次项目后才能跨 Spark 重启恢复。
