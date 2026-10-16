/** Spark 服务 API 错误,保留状态码与响应体便于上层给出提示 */
export class SparkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown,
  ) {
    super(message);
    this.name = 'SparkApiError';
  }
}

type FetchLike = typeof fetch;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Spark HTTP API 客户端:
 * - 修改类请求自动携带 CSRF token
 * - 服务重启导致 token 失效时,刷新 token 并重试一次
 */
export class SparkClient {
  private token: string | null = null;

  constructor(
    readonly baseUrl: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async send(method: string, path: string, body?: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['X-Spark-Token'] = token;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new Error(
        `无法连接 Spark 服务(${this.baseUrl}):${(err as Error).message}。请确认服务已启动,或通过 SPARK_URL 指定地址`,
      );
    }
  }

  private async fetchToken(): Promise<string> {
    const res = await this.send('GET', '/api/csrf-token');
    if (!res.ok) throw new SparkApiError('获取请求令牌失败', res.status, null);
    const { token } = (await res.json()) as { token: string };
    this.token = token;
    return token;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const needToken = MUTATING.has(method);
    let res = await this.send(method, path, body, needToken ? (this.token ?? (await this.fetchToken())) : undefined);
    let data = await parseBody(res);
    if (needToken && res.status === 403 && (data as { error?: string } | null)?.error === 'FORBIDDEN_TOKEN') {
      res = await this.send(method, path, body, await this.fetchToken());
      data = await parseBody(res);
    }
    if (!res.ok) {
      const info = data as { message?: string; error?: string } | null;
      throw new SparkApiError(info?.message ?? info?.error ?? `请求失败(${res.status})`, res.status, data);
    }
    return data as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
