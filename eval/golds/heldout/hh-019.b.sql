SELECT o.status, AVG(oi.cnt) AS avg_items_per_order
FROM orders o
JOIN (SELECT order_id, COUNT(*) AS cnt FROM order_items GROUP BY order_id) oi
  ON oi.order_id = o.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
GROUP BY o.status
ORDER BY o.status ASC
