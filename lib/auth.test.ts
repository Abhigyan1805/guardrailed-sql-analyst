import { describe, it, expect } from 'vitest';
import { resolveCtx, issueCtxToken, AuthError } from './auth';

const SECRET = 'test-secret';

function headers(pairs: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(pairs)) h.set(k, v);
  return h;
}

describe('auth', () => {
  it('rejects when nothing is configured', () => {
    delete process.env.AUTH_SECRET;
    delete process.env.ALLOW_MOCK_AUTH;
    expect(() => resolveCtx(headers({}))).toThrow(AuthError);
  });

  it('mock path clamps tenant/role/region', () => {
    process.env.ALLOW_MOCK_AUTH = 'true';
    expect(() => resolveCtx(headers({ 'x-mock-user': '1', 'x-mock-tenant': 'tenant_z' }))).toThrow(/tenant/);
    expect(() => resolveCtx(headers({ 'x-mock-user': '1', 'x-mock-role': 'superadmin' }))).toThrow(/role/);
    const ctx = resolveCtx(headers({ 'x-mock-user': '7', 'x-mock-tenant': 'tenant_b', 'x-mock-role': 'sales_rep', 'x-mock-region': 'EU' }));
    expect(ctx).toEqual({ tenant_id: 'tenant_b', user_id: '7', user_role: 'sales_rep', user_region: 'EU' });
    delete process.env.ALLOW_MOCK_AUTH;
  });

  it('accepts a valid signed token and rejects forgeries', () => {
    process.env.AUTH_SECRET = SECRET;
    const good = issueCtxToken({ tenant: 'tenant_a', user: '9', role: 'manager', region: 'NA' }, SECRET);
    expect(resolveCtx(headers({ 'x-ctx-token': good })).user_id).toBe('9');
    expect(() => resolveCtx(headers({ 'x-ctx-token': good.slice(0, -2) + 'ff' }))).toThrow(/signature/);
    const expired = issueCtxToken({ tenant: 'tenant_a', user: '9', role: 'manager', region: 'NA' }, SECRET, -10);
    expect(() => resolveCtx(headers({ 'x-ctx-token': expired }))).toThrow(/expired/);
    const otherTenant = issueCtxToken({ tenant: 'tenant_a', user: '9', role: 'admin', region: 'EU' }, 'wrong-secret');
    expect(() => resolveCtx(headers({ 'x-ctx-token': otherTenant }))).toThrow();
    delete process.env.AUTH_SECRET;
  });
});
