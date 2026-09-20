import { describe, it, expect } from 'vitest';
import { validateSql } from './sql-guard';

describe('sql-guard', () => {
  it('allows simple view SELECT and injects LIMIT', () => {
    const r = validateSql('SELECT order_id, status FROM analytics_orders WHERE region = \'NA\'');
    expect(r.ok).toBe(true);
    expect(r.rewritten).toMatch(/LIMIT 200/);
  });

  it('blocks stacked statements', () => {
    expect(validateSql('SELECT * FROM analytics_orders; DROP TABLE orders;').ok).toBe(false);
  });

  it('blocks writes', () => {
    for (const q of [
      'DELETE FROM orders',
      'UPDATE products SET stock_qty = 999',
      'INSERT INTO orders(customer_id) VALUES (1)',
      'DROP TABLE customers',
      'TRUNCATE orders',
    ]) expect(validateSql(q).ok).toBe(false);
  });

  it('rejects cartesian products across views but allows a cross join onto a CTE', () => {
    expect(validateSql('SELECT count(*) FROM analytics_order_lines a, analytics_order_lines b').ok).toBe(false);
    expect(validateSql('SELECT count(*) FROM analytics_order_lines a CROSS JOIN analytics_orders b').ok).toBe(false);
    const ct = validateSql(`WITH avg_c AS (SELECT AVG(order_id) AS avg_rev FROM analytics_orders) SELECT o.order_id FROM analytics_orders o, avg_c`);
    expect(ct.ok).toBe(true);
  });

  it('blocks base tables and PII columns', () => {
    expect(validateSql('SELECT * FROM customers').ok).toBe(false);
    expect(validateSql('SELECT email FROM analytics_customers_masked').ok).toBe(false);
    expect(validateSql('SELECT cost FROM products').ok).toBe(false);
    expect(validateSql('SELECT * FROM pg_shadow').ok).toBe(false);
  });

  it('blocks dangerous functions and comments', () => {
    expect(validateSql(`SELECT pg_sleep(5)`).ok).toBe(false);
    expect(validateSql(`SELECT * FROM analytics_orders /* x */`).ok).toBe(false);
    expect(validateSql(`SELECT * FROM analytics_orders -- hi`).ok).toBe(false);
  });

  it('caps injected LIMIT and blocks a declared LIMIT above the hard cap', () => {
    const r = validateSql('SELECT order_id FROM analytics_orders');
    expect(r.ok).toBe(true);
    expect(r.rewritten).toMatch(/LIMIT 200/);
    const big = validateSql('SELECT order_id FROM analytics_orders LIMIT 50000');
    expect(big.ok).toBe(false);
    expect(big.stage).toBe('limit');
    expect(validateSql('SELECT order_id FROM analytics_orders LIMIT 1000').ok).toBe(true);
  });

  it('blocks session mutation and set_config', () => {
    for (const q of [
      `SELECT set_config('app.tenant_id', 'tenant_b', false), count(*) FROM analytics_orders`,
      `SELECT set_config('role', 'postgres', false)`,
      `SET ROLE postgres`,
      `SET search_path TO pg_catalog`,
      `RESET ALL`,
      `SHOW search_path`,
      `SELECT current_setting('app.tenant_id', true)`,
    ]) expect(validateSql(q).ok, q).toBe(false);
  });

  it('rejects functions outside the allowlist (fail closed)', () => {
    for (const q of [
      `SELECT pg_read_file('/etc/passwd')`,
      `SELECT pg_sleep(5)`,
      `SELECT dblink('host=x', 'select 1')`,
      `SELECT query_to_xml('SELECT * FROM customers', true, false, '')`,
      `SELECT foo_bar(1) FROM analytics_orders`,
      `SELECT random() FROM analytics_orders`,
      `SELECT * FROM analytics_orders ORDER BY random()`,
      `SELECT lo_import('/etc/passwd')`,
    ]) expect(validateSql(q).ok, q).toBe(false);
  });

  it('allows the safe function allowlist', () => {
    for (const q of [
      `SELECT count(*), sum(line_revenue), avg(qty) FROM analytics_order_lines`,
      `SELECT date_trunc('month', ordered_at) AS m, to_char(ordered_at, 'YYYY-MM') AS c FROM analytics_orders GROUP BY 1, 2`,
      `SELECT lower(status), upper(status), length(status), coalesce(status, 'x'), round(1.234, 2) FROM analytics_orders`,
      `SELECT row_number() OVER (ORDER BY order_id) AS rn FROM analytics_orders`,
    ]) expect(validateSql(q).ok, q).toBe(true);
  });

  it('blocks the RLS tenant-boundary column and constant-true OR bypass', () => {
    for (const q of [
      `SELECT * FROM analytics_orders WHERE tenant_id = 'tenant_b'`,
      `SELECT tenant_id FROM analytics_orders`,
      `SELECT * FROM analytics_orders WHERE tenant_id IS NOT NULL`,
      `SELECT * FROM analytics_orders WHERE status = 'paid' OR 1 = 1`,
      `SELECT * FROM analytics_orders WHERE status = 'paid' OR true`,
    ]) expect(validateSql(q).ok, q).toBe(false);
  });

  it('rejects unparsable SQL', () => {
    expect(validateSql('SELECT FROM WHERE').ok).toBe(false);
  });

  it('blocks UNION onto forbidden tables', () => {
    expect(validateSql('SELECT order_id FROM analytics_orders UNION SELECT customer_id FROM customers').ok).toBe(false);
  });

  it('blocks writable CTEs', () => {
    expect(validateSql('WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d').ok).toBe(false);
  });

  it('blocks schema-qualified base tables', () => {
    expect(validateSql('SELECT * FROM public.orders').ok).toBe(false);
  });

  it('blocks PII via table alias', () => {
    expect(validateSql('SELECT c.email FROM analytics_customers_masked c').ok).toBe(false);
  });

  it('blocks unknown columns on allowed views', () => {
    expect(validateSql('SELECT ssn FROM analytics_customers_masked').ok).toBe(false);
  });

  it('blocks PII in JOIN conditions', () => {
    expect(validateSql('SELECT o.order_id FROM analytics_orders o JOIN analytics_customers_masked c ON c.email = o.region').ok).toBe(false);
  });

  it('caps OFFSET', () => {
    expect(validateSql('SELECT order_id FROM analytics_orders LIMIT 10 OFFSET 99999').ok).toBe(false);
    expect(validateSql('SELECT order_id FROM analytics_orders LIMIT 10 OFFSET 100').ok).toBe(true);
  });

  it('allows CTE outputs and window functions', () => {
    expect(validateSql(`WITH r AS (SELECT customer_id, SUM(x) AS revenue FROM analytics_order_lines GROUP BY customer_id) SELECT c.display_name, r.revenue FROM r JOIN analytics_customers_masked c USING (customer_id) ORDER BY r.revenue DESC LIMIT 5`).ok).toBe(false); // x is unknown
    expect(validateSql(`WITH r AS (SELECT o.customer_id, SUM(l.line_revenue) AS revenue FROM analytics_order_lines l JOIN analytics_orders o USING (order_id) GROUP BY o.customer_id) SELECT c.display_name, r.revenue FROM r JOIN analytics_customers_masked c USING (customer_id) ORDER BY r.revenue DESC LIMIT 5`).ok).toBe(true);
  });
});
