import { db } from '../db/pool.js';

export async function dashboardStats() {
  const stats = await db.one(`SELECT
    COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS sales_today,
    COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS orders_today,
    COALESCE(SUM(total) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS sales_30d,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS orders_30d,
    COALESCE(AVG(total) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS aov_30d
    FROM orders WHERE status <> 'cancelled'`);
  const carts = await db.one(`SELECT
    COUNT(*) FILTER (WHERE c.created_at >= now() - interval '30 days'
                       AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)) AS carts_30d,
    COUNT(*) FILTER (WHERE c.status = 'converted' AND c.created_at >= now() - interval '30 days') AS converted_30d,
    COUNT(*) FILTER (WHERE c.status = 'open' AND c.updated_at < now() - interval '1 hour' AND c.updated_at >= now() - interval '7 days'
                       AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)) AS abandoned
    FROM carts c`);
  const misc = await db.one(`SELECT
    (SELECT COUNT(*) FROM conversations WHERE mode = 'human')::int AS handoffs,
    (SELECT COUNT(*) FROM approvals WHERE status = 'pending')::int AS pending_approvals,
    (SELECT COUNT(*) FROM customers WHERE created_at >= now() - interval '30 days')::int AS new_customers_30d`);
  const topProducts = await db.many(`SELECT i.name, SUM(i.quantity)::int AS quantity, SUM(i.quantity * i.unit_price) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
   WHERE o.status <> 'cancelled' AND o.created_at >= now() - interval '30 days'
   GROUP BY i.name ORDER BY revenue DESC LIMIT 8`);
  const sources = await db.many(`SELECT source, COUNT(*)::int AS orders, SUM(total) AS revenue FROM orders
   WHERE status <> 'cancelled' AND created_at >= now() - interval '30 days' GROUP BY source ORDER BY revenue DESC`);
  const recentOrders = await db.many('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10');
  const conversion = carts.carts_30d > 0 ? Math.round((carts.converted_30d / carts.carts_30d) * 1000) / 10 : 0;
  return {
    stats: {
      ...stats,
      aov_30d: Math.round(stats.aov_30d * 100) / 100,
      conversion_30d: conversion,
      abandoned_carts: carts.abandoned,
      ...misc,
    },
    topProducts,
    sources,
    recentOrders,
  };
}
