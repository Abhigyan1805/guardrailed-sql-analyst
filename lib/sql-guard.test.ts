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
});
