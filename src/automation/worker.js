import { config } from '../config.js';
import { db, pool } from '../db/pool.js';
import { audit, AUTOMATION_ACTOR } from '../lib/audit.js';
import * as alerts from '../services/alerts.js';
import * as orders from '../services/orders.js';
import * as outbox from '../services/outbox.js';
import * as products from '../services/products.js';
import { getSettings } from '../services/settings.js';

const auto = config.automation;

// Free text is only allowed within 24h of the customer's last WhatsApp message;
// otherwise the message is sent as the configured approved template (if any).
async function whatsappTemplateFor(phone, template) {
  const recent = await db.one(
    `SELECT 1 FROM conversations WHERE channel = 'whatsapp' AND external_id = $1
        AND last_customer_message_at > now() - interval '23 hours'`,
    [phone],
  );
  return recent ? null : template || null;
}

export async function abandonedCarts() {
  const settings = await getSettings();
  const due = await db.many(
    `SELECT c.*, cu.name AS customer_name
       FROM carts c LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.status = 'open' AND c.reminded_at IS NULL AND c.contact_phone IS NOT NULL
        AND c.updated_at < now() - make_interval(hours => $1)
        AND c.updated_at > now() - interval '7 days'
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
        -- one reminder per number a week, however many carts carry it (anyone can type anyone's number)
        AND NOT EXISTS (SELECT 1 FROM carts c2 WHERE c2.contact_phone = c.contact_phone
                          AND c2.reminded_at > now() - interval '7 days')`,
    [auto.abandonedCartHours],
  );
  const remindedNow = new Set();
  for (const cart of due) {
    if (remindedNow.has(cart.contact_phone)) continue;
    remindedNow.add(cart.contact_phone);
    const template = await whatsappTemplateFor(cart.contact_phone, config.whatsapp.abandonedCartTemplate);
    const greeting = cart.customer_name ? `هلا ${cart.customer_name}` : 'هلا بيك';
    await outbox.enqueue({
      channel: 'whatsapp',
      recipient: cart.contact_phone,
      customerId: cart.customer_id,
      purpose: 'abandoned_cart',
      body: `${greeting}! لاحظنا طلبك من ${settings.store_name} بعده ما مكتمل. منتجاتك محفوظة إلك هنا: ${config.baseUrl}/cart/open/${cart.token}`,
      template,
      dedupeKey: `abandoned-cart-${cart.id}-${cart.updated_at.getTime()}`,
    });
    await db.query('UPDATE carts SET reminded_at = now() WHERE id = $1', [cart.id]);
    await audit({ actor: AUTOMATION_ACTOR, action: 'cart.reminder', entity: 'cart', entityId: cart.id });
  }
  return due.length;
}

export async function reviewRequests() {
  const settings = await getSettings();
  const due = await db.many(
    `SELECT o.*, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'delivered' AND o.review_requested_at IS NULL
        AND o.updated_at < now() - make_interval(days => $1)`,
    [auto.reviewRequestDays],
  );
  for (const order of due) {
    const template = await whatsappTemplateFor(order.ship_phone, config.whatsapp.reviewRequestTemplate);
    await outbox.enqueue({
      channel: 'whatsapp',
      recipient: order.ship_phone,
      customerId: order.customer_id,
      purpose: 'review_request',
      body: `شكراً لطلبك من ${settings.store_name}! يهمنا رأيك بطلب #${order.number}، شلون كانت تجربتك؟ رأيك يساعدنا نتحسن.`,
      template,
      dedupeKey: `review-${order.id}`,
    });
    await db.query('UPDATE orders SET review_requested_at = now() WHERE id = $1', [order.id]);
  }
  return due.length;
}

export async function stockAlerts() {
  const low = await products.lowStock();
  for (const p of low) {
    await alerts.raise({
      kind: 'low_stock',
      severity: p.stock === 0 ? 'critical' : 'warning',
      message: `المخزون منخفض: "${p.name}" (المتبقي ${p.stock})`,
      link: `/admin/products/${p.id}`,
      dedupeKey: `low-stock-${p.id}`,
    });
  }
  // Restocked products clear their alert.
  const open = await db.many(`SELECT a.id, p.id AS product_id FROM alerts a
      JOIN products p ON a.dedupe_key = 'low-stock-' || p.id
     WHERE a.kind = 'low_stock' AND a.resolved_at IS NULL AND p.stock > p.low_stock_at`);
  for (const a of open) await alerts.resolve(a.id);
  return low.length;
}

export async function delayedOrders() {
  const late = await orders.delayed(auto.orderDelayHours);
  for (const order of late) {
    await alerts.raise({
      kind: 'order_delayed',
      message: `الطلب #${order.number} لم يُشحن بعد مرور أكثر من ${auto.orderDelayHours} ساعة`,
      link: `/admin/orders/${order.id}`,
      dedupeKey: `order-delayed-${order.id}`,
    });
  }
  return late.length;
}

export async function runOnce() {
  const result = {};
  for (const [name, job] of Object.entries({ abandonedCarts, reviewRequests, stockAlerts, delayedOrders })) {
    try {
      result[name] = await job();
    } catch (error) {
      console.error(`automation ${name} failed`, error);
      result[name] = `error: ${error.message}`;
      await alerts.raise({
        kind: 'integration_error', severity: 'critical', message: `فشلت الأتمتة "${name}": ${error.message}`, dedupeKey: `automation-${name}`,
      }).catch(() => {});
    }
  }
  result.outbox = await outbox.deliverPending().catch((error) => `error: ${error.message}`);
  return result;
}

/** Runs the jobs unless another instance is already running them; returns null when skipped. */
export async function runLocked() {
  // Advisory lock held on one connection: with several app instances only one runs the jobs.
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(727002) AS ok');
    if (!rows[0].ok) return null;
    try {
      return await runOnce();
    } finally {
      await client.query('SELECT pg_advisory_unlock(727002)');
    }
  } finally {
    client.release();
  }
}

let timer = null;

export function start() {
  if (!auto.enabled || timer) return;
  timer = setInterval(() => runLocked().catch((e) => console.error('automation tick failed', e)), auto.intervalMinutes * 60_000);
  timer.unref();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await runOnce());
  await pool.end();
}
