SELECT s.status,
       (SELECT COUNT(*) FROM orders o WHERE o.status = s.status AND o.tenant_id = :tenant) AS orders
FROM (SELECT unnest(ARRAY['pending','paid','shipped','cancelled','refunded']) AS status) s
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.status = s.status AND o.tenant_id = :tenant)
ORDER BY orders DESC, s.status ASC
