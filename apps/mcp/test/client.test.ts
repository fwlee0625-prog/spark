import { describe, expect, it, vi } from 'vitest';
import { SparkApiError, SparkClient } from '../src/client.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('SparkClient', () => {
  it('GET 请求不带令牌', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json([]));
    await new SparkClient('http://x', f).get('/api/projects');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('修改类请求先取令牌并携带', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 't1' })).mockResolvedValueOnce(json({ ok: true }));
    await new SparkClient('http://x', f).post('/api/projects/p/start');
    expect(f.mock.calls[1]![1]).toMatchObject({ method: 'POST', headers: { 'X-Spark-Token': 't1' } });
  });

  it('令牌失效时刷新并重试一次', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(json({ error: 'FORBIDDEN_TOKEN' }, 403))
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(json({ ok: true }));
    await expect(new SparkClient('http://x', f).post('/api/x')).resolves.toEqual({ ok: true });
    expect(f.mock.calls[3]![1]).toMatchObject({ headers: { 'X-Spark-Token': 'new' } });
  });

  it('其他错误不重试并抛出带状态码的错误', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 't' })).mockResolvedValueOnce(json({ error: 'PORT_IN_USE', message: '端口被占用' }, 409));
    await expect(new SparkClient('http://x', f).post('/api/x')).rejects.toMatchObject({ status: 409, message: '端口被占用' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('服务不可达时给出可操作的提示', async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await new SparkClient('http://x', f).get('/api/projects').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SparkApiError);
    expect((err as Error).message).toContain('SPARK_URL');
  });
});
