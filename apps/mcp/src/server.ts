import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SparkClient } from './client.js';
import { registerTools } from './tools.js';

/** 创建一个注册好全部工具的 MCP Server 实例(无状态,可按请求创建) */
export function createMcpServer(client: SparkClient): McpServer {
  const server = new McpServer(
    { name: 'spark', version: '0.1.0' },
    {
      instructions:
        'Spark 是本机项目启动管理工具。一个项目包含若干终端(各自独立进程和日志)。常见流程:detect_project → create_project → control_project(start) → get_terminals / get_logs 排查。',
    },
  );
  registerTools(server, client);
  return server;
}
