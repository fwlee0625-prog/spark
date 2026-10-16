# 贡献指南

感谢你愿意给 Spark 提建议或补代码。提交 Issue / PR 前请先读这一份。

## 环境

- Node.js 20+（仓库带 `.nvmrc`）
- pnpm 9+（根目录 `package.json` 的 `packageManager` 已锁定版本，推荐用 [Corepack](https://nodejs.org/api/corepack.html)）

```bash
corepack enable
pnpm install
```

## 常用命令

```bash
pnpm dev          # 开发：页面 http://127.0.0.1:5173，API 7789
pnpm start        # 构建前端并由服务托管，http://127.0.0.1:7788
pnpm test         # 全部子包测试
pnpm typecheck    # 全仓 TypeScript 检查
pnpm lint         # Biome 检查（暂不覆盖 .vue / .css）
pnpm format       # Biome 自动修复
```

开发实例（7789）和生产实例（7788）可以同时跑。`pnpm dev` 的数据在 `apps/server/data`；`pnpm start` 使用 `~/.spark`，首次会从项目 `data` 复制一份。两边之后互不影响。

测试里如果会启动服务，必须先设置 `SPARK_DATA_DIR` 指向临时目录，避免写到真实的 `~/.spark`。

## 仓库结构

```
apps/server     Express 服务：进程、日志、端口、配置、挂载 MCP
apps/mcp        MCP 工具定义（库），由 server 挂到 /mcp
apps/web        Vue 3 管理页面
packages/shared 前后端共享类型与常量
docs/           说明文档
```

改 API 或共享类型时，请同步检查 `packages/shared` 和 MCP 工具描述。

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，主体用简体中文：

```
feat: 添加分组启动间隔
fix: 修复停止后残留 vite 子进程
docs: 补充 MCP 客户端配置
```

常见前缀：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。

## Pull Request

1. 从最新 `main` 拉分支。
2. 改动尽量小、只做一件事。
3. 提交前跑通 `pnpm test` 和 `pnpm typecheck`。
4. 涉及用户可见行为时，在 PR 里写清怎么验证（操作系统、Shell 方式、复现步骤）。
5. 不要提交 `data/`、`~/.spark`、`.env`、日志或本机项目路径。

## 平台说明

当前首要支持 macOS；Linux 欢迎一起验证。Windows 依赖 `zsh` / `lsof` / `pgrep`，v1 未适配。

## 安全相关改动

Spark 会在本机执行用户配置的命令，并暴露 MCP 端点。涉及监听地址、Host/Origin 校验、CSRF、MCP 鉴权的改动，请在 PR 中单独说明，并阅读 [SECURITY.md](SECURITY.md)。
