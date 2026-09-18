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

  it('caps huge LIMIT', () => {
    const r = validateSql('SELECT order_id FROM analytics_orders LIMIT 50000');
    expect(r.ok).toBe(true);
    expect(r.rewritten).toMatch(/LIMIT 1000/);
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
