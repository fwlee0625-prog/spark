# Spark

[English](README.md)

本机项目管理面板：项目的**创建、启动、停止、重启、实时日志、端口监控与分组一键启停**。Node.js 常驻服务（Express + SSE）+ Vue 3 页面，pnpm workspace 管理。Cursor / Claude 等 MCP 客户端可以走同一套接口。

平台：**macOS** 优先；Linux 待验证；Windows 未适配（依赖 `zsh` / `lsof` / `pgrep`）。

## 功能

- **项目管理**：浏览选目录或手填路径 → 自动识别 → 预填命令；启动 / 停止 / 重启
- **多终端**：一个项目可配前端、后端等多个终端，命令、工作目录、端口、环境变量各自独立
- **智能识别**：锁文件 → pnpm / yarn / npm；`package.json` scripts；Python 虚拟环境与入口（结果只用于预填）
- **实时日志**：SSE，先回放缓冲再接实时流；ANSI 颜色；按终端分栏
- **进程树清理**：detached 进程组 + SIGTERM → SIGKILL，按端口和 cwd 校验兜底，不留 vite/webpack 子进程
- **端口管理**：启动前冲突检测（占用来源定位到项目或外部 PID）、批量扫描、`?force=1` 强制启动
- **分组**：整组启动（端口冲突自动跳过并上报）/ 整组停止
- **崩溃自动重启**：项目级开关，指数退避，次数上限在设置页
- **退出可恢复**：默认关闭 Spark 后项目继续跑，下次启动恢复管理。见 [docs/process-recovery.md](docs/process-recovery.md)
- **只监听本机**：`127.0.0.1`，Host/Origin 校验 + CSRF token

## 快速开始

需要 Node.js 20+、pnpm。

```bash
pnpm install

# 开发：页面 http://127.0.0.1:5173（Vite 热更新，API 代理到 7789）
pnpm dev

# 日常使用：构建前端并由服务托管（单进程，端口 7788）
pnpm start
# 打开 http://127.0.0.1:7788
# 跳过构建：pnpm start:only
```

| 模式 | 页面 | API |
| --- | --- | --- |
| 开发（`pnpm dev`） | http://127.0.0.1:5173 | 7789 |
| 生产（`pnpm start`） | http://127.0.0.1:7788 | 7788 |

两个实例可以同时跑。`pnpm dev` 的数据留在 `apps/server/data`。`pnpm start` 使用 `~/.spark`，新目录还没有配置时，会从项目 `data` 复制一份；之后两边互不影响。API 端口可用 `SPARK_PORT` 覆盖。

重复 `pnpm start` 若端口被占用，会提示大概率 Spark 已在运行。未构建前端时启动也会给出明确提醒。

更多说明：[docs/configuration.md](docs/configuration.md)。

## 让 AI 直接管理项目（MCP）

服务内嵌 MCP 端点（Streamable HTTP）：`http://127.0.0.1:7788/mcp`。所有客户端共用这一个入口，**不会为每个会话再起进程**。

前提：Spark 已运行（`pnpm start`）。仓库带 `.cursor/mcp.json`，Cursor 打开本项目后在 Settings → MCP 启用 `spark` 即可。其他支持 HTTP 的客户端：

```json
{
  "mcpServers": {
    "spark": { "url": "http://127.0.0.1:7788/mcp" }
  }
}
```

连开发实例时把端口改成 `7789`。仅支持 stdio 的客户端可借助 `npx mcp-remote http://127.0.0.1:7788/mcp` 桥接。

工具列表、各客户端说明与安全约束见 [docs/mcp.md](docs/mcp.md)。

## 仓库结构

```
apps/server      Express：进程、日志 SSE、识别器、端口、配置、挂载 /mcp
apps/mcp         MCP 工具定义（库，由 server 挂载）
apps/web         Vue 3 + Vite + Tailwind v4
packages/shared  前后端共享类型与常量
docs/            说明文档
```

## 数据

`pnpm dev` 写在 `apps/server/data`。`pnpm start` 写在 `~/.spark`（可用 `SPARK_DATA_DIR` 覆盖）。两边都含 `projects.json`、`settings.json`、应用日志和 `runtime/` 运行记录。拷贝对应目录即可备份。第一次 `pnpm start` 且 `~/.spark` 还没有配置时，会从项目 `data` 复制过去。

详见 [docs/configuration.md](docs/configuration.md)。多终端配置方式见页面上的「添加终端」；退出与恢复见 [docs/process-recovery.md](docs/process-recovery.md)。

## 测试

```bash
pnpm test        # 各子包 vitest
pnpm typecheck
pnpm lint        # Biome
```

## 路线图

- 组内启动顺序与间隔
- 开机自启 / 托盘（可选 Tauri 壳）
- 验证 Linux；Windows 暂不计划
- 健康检查：端口可连通即视为就绪

## 许可证

[MIT](LICENSE) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [更新日志](CHANGELOG.md)
