import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, SparkClient } from '@spark/mcp';
import { Router } from 'express';

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * MCP 端点(Streamable HTTP,无状态):所有 AI 客户端共用这一个入口。
 * 工具通过回环地址调用本服务自己的 /api,复用同一套校验与业务逻辑。
 */
export function mcpRouter(selfUrl: string): Router {
  const router = Router();
  const client = new SparkClient(selfUrl);

  // 该端点可执行命令且不带 CSRF token:浏览器请求一律带 Origin,直接拒绝;MCP 客户端不是浏览器,不受影响
  router.use((req, res, next) => {
    if (req.headers.origin) return res.status(403).json(rpcError(-32000, '拒绝浏览器来源的请求'));
    next();
  });

  router.post('/', async (req, res) => {
    const server = createMcpServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[spark] MCP 请求处理失败:', err);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, '内部错误'));
    }
  });

  // 无状态模式不支持 GET(SSE 流)与 DELETE(会话终止)
  router.all('/', (_req, res) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, '仅支持 POST'));
  });

  return router;
}
