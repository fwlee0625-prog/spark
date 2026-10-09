import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const rejectedToken = () => json({ error: 'FORBIDDEN_TOKEN', message: '缺少或错误的请求令牌' }, 403);

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function client() { return (await import('../../web/src/api/client.js')).api; }

describe('API 请求令牌刷新', () => {
  it('服务重启导致令牌失效时重新获取令牌并重试原请求', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(rejectedToken())
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(json({ type: 'node' }));
    const api = await client();
    expect(await api.detect('/tmp/project')).toEqual({ type: 'node' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { 'X-Spark-Token': 'old' }, body: JSON.stringify({ dir: '/tmp/project' }) });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ headers: { 'X-Spark-Token': 'new' }, body: JSON.stringify({ dir: '/tmp/project' }) });
    expect(fetchMock.mock.calls[2][1]).toEqual({ cache: 'no-store' });
  });

  it('刷新后仍被拒绝时停止重试', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(rejectedToken())
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(rejectedToken());
    const api = await client();
    await expect(api.detect('/tmp/project')).rejects.toMatchObject({ status: 403, data: { error: 'FORBIDDEN_TOKEN' } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('其他错误不重试，避免重复创建或启动', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'current' }))
      .mockResolvedValueOnce(json({ error: 'START_FAILED' }, 500));
    const api = await client();
    await expect(api.startProject('p_demo')).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('网络异常后下一次操作可以重新获取令牌', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ token: 'current' }))
      .mockResolvedValueOnce(json({ type: 'node' }));
    const api = await client();
    await expect(api.detect('/tmp/project')).rejects.toThrow('offline');
    expect(await api.detect('/tmp/project')).toEqual({ type: 'node' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('无效令牌响应不缓存，下次操作可恢复', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: null }))
      .mockResolvedValueOnce(json({ token: 'current' }))
      .mockResolvedValueOnce(json({ type: 'node' }));
    const api = await client();
    await expect(api.detect('/tmp/project')).rejects.toThrow('请求令牌响应无效');
    expect(await api.detect('/tmp/project')).toEqual({ type: 'node' });
  });

  it('并发失效请求共用一次令牌刷新', async () => {
    let tokenRequests = 0;
    fetchMock.mockImplementation(async (url, opts) => {
      if (url === '/api/csrf-token') return json({ token: ++tokenRequests === 1 ? 'old' : 'new' });
      return (opts?.headers as Record<string, string>)['X-Spark-Token'] === 'old'
        ? rejectedToken() : json({ type: 'node' });
    });
    const api = await client();
    const results = await Promise.all([api.detect('/tmp/one'), api.detect('/tmp/two')]);
    expect(results).toEqual([{ type: 'node' }, { type: 'node' }]);
    expect(tokenRequests).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
