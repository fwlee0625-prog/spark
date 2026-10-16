# MCP

Spark 服务内嵌 MCP 端点（Streamable HTTP）：

```
http://127.0.0.1:7788/mcp
```

所有客户端共用这一个入口，**不会为每个会话再起进程**。使用前请先让 Spark 跑起来（`pnpm start`）。连开发实例时把端口改成 `7789`。

## Cursor

仓库已带 [`.cursor/mcp.json`](../.cursor/mcp.json)。用 Cursor 打开本仓库后，在 Settings → MCP 启用 `spark` 即可。

其他项目若要接入，把同一段配置放到那个项目的 `.cursor/mcp.json`，或写到用户级 MCP 配置：

```json
{
  "mcpServers": {
    "spark": { "url": "http://127.0.0.1:7788/mcp" }
  }
}
```

## 其他 HTTP 客户端

Claude Desktop、Claude Code 等支持 HTTP MCP 的客户端，使用同样的 URL。

只支持 stdio 的客户端可以桥接：

```bash
npx mcp-remote http://127.0.0.1:7788/mcp
```

## 工具一览

| 工具 | 说明 |
| --- | --- |
| `detect_project` | 识别目录类型并给出建议命令（只读） |
| `list_projects` / `get_project` | 项目列表 / 单个项目完整配置 |
| `get_terminals` | 各终端状态，附日志概况 |
| `create_project` / `update_project` / `delete_project` | 增删改；`create_project` 省略终端时按识别结果生成，`start=true` 可创建后立即启动 |
| `control_project` | 启动 / 停止 / 重启整个项目或单个终端 |
| `get_logs` / `clear_logs` | 读取（`tail`、`grep`、`errorsOnly`、`stream`）/ 清空终端日志 |
| `get_app_logs` | Spark 自身运行日志 |
| `check_port` | 单端口检测；不传端口则列出全部监听端口 |
| `list_groups` / `create_group` / `control_group` / `delete_group` | 分组管理与整组启停 |
| `get_settings` | 读取全局设置 |

项目和终端参数都可以传 id 或名称（终端还可传编号）。

## 安全

- 端点只监听 `127.0.0.1`，并校验 Host
- 带 `Origin` 的浏览器请求一律拒绝，防止网页跨站调用
- 无状态模式，仅接受 POST
- 工具通过回环地址调用本服务 `/api`，复用原有校验与业务逻辑
- 终端命令会在本机执行：请在客户端对变更类工具保留确认

详见 [SECURITY.md](../SECURITY.md)。
