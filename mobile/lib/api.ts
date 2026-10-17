import type { QueryResponse, Tenant } from './types';

type FetchLike = typeof fetch;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  tenant: Tenant;
  fetchImpl?: FetchLike;
  now?: () => number;
}

const TOKEN_TTL_MS = 55 * 60 * 1000; // server issues 1h tokens; refresh a bit early

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Typed client for the analyst API. Auth mirrors the web app: POST /api/auth/token
 * (mock issuance, only enabled with ALLOW_MOCK_AUTH=true) returns a signed context
 * token that is sent as `x-ctx-token` on /api/query (plus the mock identity headers).
 */
export function createClient(opts: ClientOptions) {
  const base = normalizeBaseUrl(opts.baseUrl);
  const doFetch: FetchLike = opts.fetchImpl ?? ((...a) => fetch(...a));
  const now = opts.now ?? Date.now;
  let cached: { token: string; at: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init);
    } catch (e) {
      throw new ApiError(`Cannot reach ${base} (${e instanceof Error ? e.message : 'network error'})`);
    }
  }

  async function getToken(force = false): Promise<string> {
    if (!force && cached && now() - cached.at < TOKEN_TTL_MS) return cached.token;
    const res = await send(`${base}/api/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: opts.tenant }),
    });
    if (!res.ok) {
      throw new ApiError(
        res.status === 403 ? 'Server has mock auth disabled (set ALLOW_MOCK_AUTH=true)' : `Token request failed (${res.status})`,
        res.status,
      );
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) throw new ApiError('Token response missing token', res.status);
    cached = { token, at: now() };
    return token;
  }

  async function post(question: string, token: string): Promise<Response> {
    return send(`${base}/api/query`, {
      method: 'POST',
      // The signed token is used when the server has AUTH_SECRET; the x-mock-* identity
      // (same user/role/region the token endpoint mints) covers ALLOW_MOCK_AUTH-only dev servers.
      headers: {
        'content-type': 'application/json',
        'x-ctx-token': token,
        'x-mock-user': '1',
        'x-mock-tenant': opts.tenant,
        'x-mock-role': 'sales_rep',
        'x-mock-region': 'NA',
      },
      body: JSON.stringify({ question }),
    });
  }

  /**
   * Ask a question. Guard rejections arrive as HTTP 4xx *with* a BLOCK body
   * (empty question, rate limit, auth), so any JSON body with a decision is returned
   * as a normal response; only unparseable replies throw.
   */
  async function ask(question: string): Promise<QueryResponse> {
    let res = await post(question, await getToken());
    if (res.status === 401) res = await post(question, await getToken(true));
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError(`Unexpected response from server (${res.status})`, res.status);
    }
    const r = body as Partial<QueryResponse>;
    if (!r || typeof r.decision !== 'string') throw new ApiError(`Unexpected response from server (${res.status})`, res.status);
    return { caveats: [], confidence: 0, ...r } as QueryResponse;
  }

  return { ask, getToken };
}

export type AnalystClient = ReturnType<typeof createClient>;
