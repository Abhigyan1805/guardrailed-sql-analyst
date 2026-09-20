SELECT COUNT(*) AS cancelled_orders
FROM orders o
WHERE o.tenant_id = :tenant AND o.status = 'cancelled'
  AND date_part('year', o.ordered_at) = 2023
