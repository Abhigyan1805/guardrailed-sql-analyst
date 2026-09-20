SELECT CASE
         WHEN o.ordered_at >= date_trunc('quarter', :eval_now) THEN 'current'
         ELSE 'prior_year'
       END AS period,
       SUM(oi.qty * oi.unit_price * (1 - oi.discount)) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status IN ('paid','shipped') AND o.tenant_id = :tenant
  AND (
    (o.ordered_at >= date_trunc('quarter', :eval_now)
      AND o.ordered_at < date_trunc('quarter', :eval_now) + interval '3 months')
    OR
    (o.ordered_at >= date_trunc('quarter', :eval_now) - interval '1 year'
      AND o.ordered_at < date_trunc('quarter', :eval_now) - interval '9 months')
  )
GROUP BY 1
ORDER BY period ASC
