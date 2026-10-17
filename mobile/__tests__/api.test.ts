import { ApiError, createClient, normalizeBaseUrl } from '../lib/api';

const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('api client', () => {
  it('normalizes the base URL', () => {
    expect(normalizeBaseUrl(' https://x.io/// ')).toBe('https://x.io');
  });

  it('gets a token for the tenant then sends it as x-ctx-token', async () => {
    const { calls, fetchImpl } = setup(url => url.endsWith('/api/auth/token') ? json(200, { token: 'tok' }) : json(200, { decision: 'ALLOW', caveats: [], confidence: 0.9 }));
    const res = await createClient({ baseUrl: 'http://h:3000/', tenant: 'tenant_b', fetchImpl }).ask('Top 5 products by revenue');
    expect(res.decision).toBe('ALLOW');
    expect(calls[0].url).toBe('http://h:3000/api/auth/token');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ tenant: 'tenant_b' });
    expect(calls[1].url).toBe('http://h:3000/api/query');
    expect((calls[1].init.headers as Record<string, string>)['x-ctx-token']).toBe('tok');
    expect((calls[1].init.headers as Record<string, string>)['x-mock-tenant']).toBe('tenant_b');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ question: 'Top 5 products by revenue' });
  });

  it('caches the token across questions', async () => {
    const { calls, fetchImpl } = setup(url => url.endsWith('/token') ? json(200, { token: 't' }) : json(200, { decision: 'ALLOW', caveats: [], confidence: 1 }));
    const c = createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl });
    await c.ask('a'); await c.ask('b');
    expect(calls.filter(x => x.url.endsWith('/token'))).toHaveLength(1);
  });

  it('returns BLOCK bodies delivered with 4xx status as normal responses', async () => {
    const { fetchImpl } = setup(url => url.endsWith('/token') ? json(200, { token: 't' }) : json(429, { decision: 'BLOCK', blockReason: 'rate limited — retry in 5s', caveats: [], confidence: 0 }));
    const res = await createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl }).ask('q');
    expect(res.decision).toBe('BLOCK');
    expect(res.blockReason).toMatch(/rate limited/);
  });

  it('refreshes the token once on 401', async () => {
    let n = 0;
    const { calls, fetchImpl } = setup(url => {
      if (url.endsWith('/token')) return json(200, { token: `t${++n}` });
      return n < 2 ? json(401, { decision: 'BLOCK', blockReason: 'auth: expired context', caveats: [], confidence: 0 }) : json(200, { decision: 'ALLOW', caveats: [], confidence: 1 });
    });
    const res = await createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl }).ask('q');
    expect(res.decision).toBe('ALLOW');
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['token', 'query', 'token', 'query']);
  });

  it('explains disabled mock auth', async () => {
    const { fetchImpl } = setup(() => json(403, { error: 'mock issuance disabled' }));
    await expect(createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl }).ask('q')).rejects.toThrow(/mock auth disabled/);
  });

  it('wraps network failures and unparseable replies in ApiError', async () => {
    const down = (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    await expect(createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl: down }).ask('q')).rejects.toBeInstanceOf(ApiError);
    const { fetchImpl } = setup(url => url.endsWith('/token') ? json(200, { token: 't' }) : json(500, { oops: true }));
    await expect(createClient({ baseUrl: 'http://h', tenant: 'tenant_a', fetchImpl }).ask('q')).rejects.toThrow(/Unexpected response/);
  });
});
