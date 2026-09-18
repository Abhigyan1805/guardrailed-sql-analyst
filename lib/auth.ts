import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TenantCtx } from './db';

const TENANTS = new Set(['tenant_a', 'tenant_b']);
const ROLES = new Set(['sales_rep', 'manager', 'admin', 'finance']);
const REGIONS = new Set(['NA', 'EU', 'APAC']);

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

function clamp(value: string | null, allowed: Set<string>, field: string): string {
  const v = (value ?? '').trim();
  if (!allowed.has(v)) throw new AuthError(`invalid ${field}`);
  return v;
}

interface CtxPayload {
  tenant: string;
  user: string;
  role: string;
  region: string;
  exp: number;
}

/** Issue a signed context token (dev self-issuance; prod would mint this at login). */
export function issueCtxToken(payload: Omit<CtxPayload, 'exp'>, secret: string, ttlSec = 3600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

function verifyCtxToken(token: string, secret: string): TenantCtx {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new AuthError('malformed context token');
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new AuthError('bad context signature');
  }
  let p: CtxPayload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('malformed context payload');
  }
  if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) throw new AuthError('expired context');
  if (!p.user || typeof p.user !== 'string' || p.user.length > 64) throw new AuthError('invalid user');
  return {
    tenant_id: clamp(p.tenant, TENANTS, 'tenant'),
    user_id: p.user,
    user_role: clamp(p.role, ROLES, 'role'),
    user_region: clamp(p.region, REGIONS, 'region'),
  };
}

/**
 * Resolve the caller context. Production path verifies an HMAC-signed token
 * minted at login (AUTH_SECRET). Header-based identity only exists when
 * ALLOW_MOCK_AUTH=true, which must never be set outside local dev.
 */
export function resolveCtx(headers: Headers): TenantCtx {
  const secret = process.env.AUTH_SECRET;
  if (secret) return verifyCtxToken(headers.get('x-ctx-token') ?? '', secret);
  if (process.env.ALLOW_MOCK_AUTH === 'true') {
    if (!headers.get('x-mock-user')) throw new AuthError('missing mock user', 400);
    return {
      tenant_id: clamp(headers.get('x-mock-tenant') ?? 'tenant_a', TENANTS, 'tenant'),
      user_id: headers.get('x-mock-user') as string,
      user_role: clamp(headers.get('x-mock-role') ?? 'sales_rep', ROLES, 'role'),
      user_region: clamp(headers.get('x-mock-region') ?? 'NA', REGIONS, 'region'),
    };
  }
  throw new AuthError('no auth configured (set AUTH_SECRET or ALLOW_MOCK_AUTH=true for local dev)');
}
