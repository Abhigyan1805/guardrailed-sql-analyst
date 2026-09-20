SELECT 'current' AS period, SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('quarter', :eval_now)
  AND o.ordered_at < date_trunc('quarter', :eval_now) + interval '3 months'
UNION ALL
SELECT 'prior_year', SUM(oi.qty * oi.unit_price * (1 - oi.discount))
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('quarter', :eval_now) - interval '1 year'
  AND o.ordered_at < date_trunc('quarter', :eval_now) - interval '9 months'
ORDER BY period ASC
