SELECT SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND o.ordered_at >= date_trunc('month', :eval_now) - interval '1 month'
  AND o.ordered_at < date_trunc('month', :eval_now)
