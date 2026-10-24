import type { ResourceSnapshot, StatusEvent } from '@spark/shared';
import type { Response } from 'express';

const HEARTBEAT_MS = 15000;

export function initSse(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
}

export function sseSend(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseHeartbeat(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* 连接已断开,close 事件会清理 */
    }
  }, HEARTBEAT_MS);
}

/** 全局状态变更广播(/api/events),用于状态点实时刷新 */
export class StatusHub {
  private clients = new Set<Response>();

  add(res: Response): void {
    initSse(res);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(evt: StatusEvent | ResourceSnapshot): void {
    for (const res of this.clients) {
      try {
        sseSend(res, evt);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}
