// Compact schema slice injected into the LLM prompt (static for v1 —
// no vector DB; the whole registry is ~800 tokens).
export const SCHEMA_SLICE = `
TABLES (use ONLY these views; never base tables):
- analytics_orders(order_id, customer_id, status, ordered_at, region, sales_rep_id, tenant_id)
- analytics_customers_masked(customer_id, display_name, region, segment, created_at) — no PII columns exist here
- analytics_products_public(product_id, sku, name, category_id, category_name, list_price, is_active, stock_qty)
- analytics_order_lines(order_id, product_id, sku, product_name, category_name, qty, unit_price, discount, line_revenue, status, ordered_at, region, tenant_id)
- analytics_payments(payment_id, order_id, method, amount, paid_at, region, tenant_id, status)
- analytics_reviews(review_id, product_id, product_name, sku, customer_id, rating, created_at)

JOIN GRAIN RULES (avoid fanout):
- Revenue of an order line = qty*unit_price*(1-discount), precomputed as line_revenue.
- Order revenue = SUM(line_revenue) grouped by order FIRST in a CTE, then join.
- status filter for revenue questions: status IN ('paid','shipped') unless asked otherwise.
- Dates: ordered_at (timestamptz, UTC). Use DATE_TRUNC('month', ordered_at).
- Top-N queries MUST add deterministic tie-breaker (e.g., ORDER BY revenue DESC, product_id ASC).
- Time-series MUST generate full month spine (generate_series) + LEFT JOIN so zero months appear.

FORBIDDEN: base tables (customers/products/orders/order_items/payments/reviews),
columns (email, full_name, cost, card_*), pg_*, information_schema, DDL/DML.
`.trim();

export interface LinkedSchema {
  tables: string[];
  hint: string;
}

/** Keyword schema-linking: pick relevant views for the question. */
export function linkSchema(question: string): LinkedSchema {
  const q = question.toLowerCase();
  const tables = new Set<string>(['analytics_orders']);
  if (/customer|segment|region|churn|cohort/.test(q)) tables.add('analytics_customers_masked');
  if (/product|sku|categor|stock|inventory|price/.test(q)) tables.add('analytics_products_public');
  if (/revenue|line|item|margin|discount|category revenue|top product/.test(q)) tables.add('analytics_order_lines');
  if (/payment|method|paypal|card|wire|paid/.test(q)) tables.add('analytics_payments');
  if (/month|trend|growth|over time|mom/.test(q)) tables.add('analytics_order_lines');
  return {
    tables: [...tables],
    hint: `Relevant views for this question: ${[...tables].join(', ')}.`,
  };
}
