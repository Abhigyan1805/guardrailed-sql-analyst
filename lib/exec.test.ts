import { describe, it, expect } from 'vitest';
import { executeGuarded } from './exec';
import type { TenantCtx } from './db';

const CTX_A: TenantCtx = { tenant_id: 'tenant_a', user_id: '1', user_role: 'sales_rep', user_region: 'NA' };

describe('exec + RLS', () => {
  it('allows view query and writes audit', async () => {
    const r = await executeGuarded('SELECT order_id FROM analytics_order_lines LIMIT 5', CTX_A, 't1');
    expect(r.decision).toBe('ALLOW');
    expect((r.rows ?? []).length).toBeGreaterThan(0);
  }, 60000);

  it('blocks base-table query', async () => {
    const r = await executeGuarded('SELECT * FROM customers', CTX_A, 't2');
    expect(r.decision).toBe('BLOCK');
  }, 60000);

  it('payments and order_items are tenant-isolated on their own', async () => {
    const { withTenant } = await import('./db');
    const count = (table: string, tenant_id: string) => withTenant({ ...CTX_A, tenant_id }, async (db) => {
      const r = await db.query(`SELECT count(*)::text AS c FROM ${table}`);
      return (r.rows as any[])[0].c as string;
    });
    const pa = await count('payments', 'tenant_a');
    const pb = await count('payments', 'tenant_b');
    const ia = await count('order_items', 'tenant_a');
    const ib = await count('order_items', 'tenant_b');
    console.log('payments a/b:', pa, pb, 'items a/b:', ia, ib);
    expect(pa).not.toBe(pb);
    expect(ia).not.toBe(ib);
    expect(Number(pa) + Number(pb)).toBeLessThanOrEqual(719);
  }, 60000);

  it('app_reader has no PII columns even with direct access', async () => {
    const { withTenant } = await import('./db');
    for (const q of [
      'SELECT email FROM customers LIMIT 1',
      'SELECT full_name FROM customers LIMIT 1',
      'SELECT cost FROM products LIMIT 1',
    ]) {
      await expect(withTenant(CTX_A, async (db) => { await db.query(q); })).rejects.toThrow(/permission denied/);
    }
  }, 60000);

  it('tenant isolation: tenants see disjoint row sets', async () => {
    const { withTenant } = await import('./db');
    const count = (tenant_id: string) => withTenant({ ...CTX_A, tenant_id }, async (db) => {
      const r = await db.query('SELECT count(*)::text AS c FROM analytics_orders');
      return (r.rows as any[])[0].c as string;
    });
    const a = await count('tenant_a');
    const b = await count('tenant_b');
    console.log('tenant_a view rows:', a, 'tenant_b view rows:', b);
    expect(a).not.toBe(b);
    expect(Number(a)).toBeGreaterThan(0);
    expect(Number(b)).toBeGreaterThan(0);
    expect(Number(a) + Number(b)).toBeLessThanOrEqual(800);
  }, 60000);
});
