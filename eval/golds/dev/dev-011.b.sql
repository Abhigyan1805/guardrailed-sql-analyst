WITH lines AS (
  SELECT c.name AS category_name, oi.qty * oi.unit_price * (1 - oi.discount) AS rev
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  WHERE o.status IN ('paid','shipped')
    AND o.ordered_at >= TIMESTAMPTZ '2025-01-01T00:00:00Z'
    AND o.ordered_at < TIMESTAMPTZ '2026-01-01T00:00:00Z'
    AND o.tenant_id = :tenant
), agg AS (
  SELECT category_name, SUM(rev) AS revenue,
         ROW_NUMBER() OVER (ORDER BY SUM(rev) DESC, category_name ASC) AS rn
  FROM lines
  GROUP BY category_name
)
SELECT category_name, revenue
FROM agg
WHERE rn <= 5
ORDER BY revenue DESC, category_name ASC
