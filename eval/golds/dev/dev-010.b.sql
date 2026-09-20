SELECT COUNT(*) AS orders_2025
FROM orders o
WHERE o.tenant_id = :tenant AND date_part('year', o.ordered_at) = 2025
