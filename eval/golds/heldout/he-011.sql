SELECT COUNT(DISTINCT oi.product_id) AS products
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('quarter', :eval_now) - interval '3 months'
  AND o.ordered_at < date_trunc('quarter', :eval_now)
