SELECT t.order_id, t.status, t.ordered_at, t.region
FROM (
  SELECT o.order_id, o.status, o.ordered_at, o.region,
         ROW_NUMBER() OVER (ORDER BY o.ordered_at DESC, o.order_id DESC) AS rn
  FROM orders o
  WHERE o.tenant_id = :tenant
) t
WHERE t.rn <= 10
ORDER BY t.rn ASC
