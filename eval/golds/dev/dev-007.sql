SELECT o.order_id, o.status, o.ordered_at, o.region
FROM orders o
WHERE o.tenant_id = :tenant
ORDER BY o.ordered_at DESC, o.order_id DESC
LIMIT 10
