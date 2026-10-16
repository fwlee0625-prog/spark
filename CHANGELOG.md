# Changelog

本文件记录面向用户的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-10-16

### 新增

- 本机项目管理：创建、编辑、删除配置，启动 / 停止 / 重启
- 一个项目可配置多个终端（各自命令、目录、端口、环境变量）
- 目录智能识别（Node 包管理器与 scripts、Python 虚拟环境）
- 实时日志（SSE、ANSI 颜色、环形缓冲）
- 端口占用检测、批量扫描、启动前冲突提示
- 分组整组启停
- 崩溃自动重启（项目级开关、指数退避）
- Spark 退出后可恢复仍在运行的项目进程
- 内嵌 MCP 端点，供 Cursor / Claude 等客户端直接管理项目

### 说明

- `pnpm dev` 数据在 `apps/server/data`；`pnpm start` 使用 `~/.spark`，首次从项目 `data` 复制
- 许可证：MIT
- 平台：macOS 优先，Linux 待验证，Windows 未适配
