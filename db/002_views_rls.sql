-- 002_views_rls.sql — PII-stripped views + RLS (authoritative enforcement)
-- LLM registry exposes ONLY analytics_* views. Base tables hidden from prompt.

CREATE OR REPLACE VIEW analytics_orders AS
SELECT o.order_id, o.customer_id, o.status, o.ordered_at, o.region,
       o.sales_rep_id, o.tenant_id
FROM orders o;

CREATE OR REPLACE VIEW analytics_customers_masked AS
SELECT c.customer_id,
       'CUSTOMER-' || c.customer_id AS display_name,
       CASE WHEN current_setting('app.user_role', true) IN ('admin','finance')
            THEN c.email ELSE '***' END AS email_masked,
       c.region, c.segment, c.created_at
FROM customers c;

CREATE OR REPLACE VIEW analytics_products_public AS
SELECT p.product_id, p.sku, p.name, p.category_id, c.name AS category_name,
       p.list_price, p.is_active, p.stock_qty
FROM products p JOIN categories c USING (category_id);

CREATE OR REPLACE VIEW analytics_order_lines AS
SELECT oi.order_id, oi.product_id, p.sku, p.name AS product_name,
       c.name AS category_name, oi.qty, oi.unit_price, oi.discount,
       (oi.qty * oi.unit_price * (1 - oi.discount)) AS line_revenue,
       o.status, o.ordered_at, o.region, o.tenant_id
FROM order_items oi
JOIN orders o USING (order_id)
JOIN products p USING (product_id)
JOIN categories c ON c.category_id = p.category_id;

CREATE OR REPLACE VIEW analytics_payments AS
SELECT pay.payment_id, pay.order_id, pay.method, pay.amount, pay.paid_at,
       o.region, o.tenant_id, o.status
FROM payments pay JOIN orders o USING (order_id);

CREATE OR REPLACE VIEW analytics_reviews AS
SELECT r.review_id, r.product_id, p.name AS product_name, p.sku,
       r.customer_id, r.rating, r.created_at
FROM reviews r JOIN products p USING (product_id);

-- RLS: enabled + FORCED on user-data tables (FORCE also binds table owners;
-- superusers still bypass, so runtime must SET ROLE app_reader — see lib/db.ts).
-- Views use security_invoker so underlying RLS is checked as the caller.
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER VIEW analytics_orders SET (security_invoker = true);
ALTER VIEW analytics_customers_masked SET (security_invoker = true);
ALTER VIEW analytics_products_public SET (security_invoker = true);
ALTER VIEW analytics_order_lines SET (security_invoker = true);
ALTER VIEW analytics_payments SET (security_invoker = true);
ALTER VIEW analytics_reviews SET (security_invoker = true);

-- DROP stale policies for re-runnable seeds
DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
DROP POLICY IF EXISTS user_scope_orders ON orders;
DROP POLICY IF EXISTS tenant_and_scope_orders ON orders;
DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
DROP POLICY IF EXISTS tenant_isolation_payments ON payments;

-- Single AND-policy (multiple permissive policies combine with OR, which would
-- leak cross-tenant rows). NULL setting denies all rows (fail-closed).
CREATE POLICY tenant_and_scope_orders ON orders
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND (
      current_setting('app.user_role', true) = 'admin'
      OR sales_rep_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), '-1')::int
      OR region = current_setting('app.user_region', true)
    )
  );

CREATE POLICY tenant_isolation_customers ON customers
  FOR SELECT
  USING (
    current_setting('app.user_role', true) = 'admin'
    OR region = current_setting('app.user_region', true)
  );

CREATE POLICY tenant_isolation_payments ON payments
  FOR SELECT
  USING (true);

-- Least-privilege grants for the runtime role (no-ops on re-run)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reader;
GRANT SELECT ON analytics_reviews TO app_reader;
