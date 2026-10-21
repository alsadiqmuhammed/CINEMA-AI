import { randomInt } from 'node:crypto';
import { db, transaction } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { normalizePhone, ORDER_STATUS, round3 } from '../lib/format.js';
import * as carts from './carts.js';
import * as customers from './customers.js';
import * as alerts from './alerts.js';
import * as approvals from './approvals.js';
import { getSettings } from './settings.js';
import { config } from '../config.js';

export class OrderError extends Error {}

// Allowed status moves. Payment state is tracked separately.
const TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function nextStatuses(status) {
  return TRANSITIONS[status] ?? [];
}

function orderNumber() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 7; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * Turns an open cart into an order. Stock is checked and decremented under row
 * locks so two customers cannot buy the last unit.
 */
export async function placeOrder(cartToken, form, { actor = { type: 'customer' } } = {}) {
  const phone = normalizePhone(form.phone);
  if (!phone) throw new OrderError('رقم الجوال غير صحيح');
  for (const field of ['name', 'city', 'address']) {
    if (!String(form[field] ?? '').trim()) throw new OrderError('يرجى تعبئة الاسم والمدينة والعنوان');
  }
  if (!['cod', 'bank_transfer'].includes(form.payment_method)) throw new OrderError('طريقة الدفع غير متاحة');
  const settings = await getSettings();

  const order = await transaction(async (tx) => {
    const cart = await tx.one(`SELECT * FROM carts WHERE token = $1 AND status = 'open' FOR UPDATE`, [cartToken]);
    if (!cart) throw new OrderError('السلة غير موجودة أو تم إتمامها');
    const items = await tx.many(
      `SELECT ci.product_id, ci.quantity, p.name, p.price, p.stock, p.status, p.low_stock_at
         FROM cart_items ci JOIN products p ON p.id = ci.product_id
        WHERE ci.cart_id = $1 ORDER BY p.id FOR UPDATE OF p`,
      [cart.id],
    );
    if (!items.length) throw new OrderError('السلة فارغة');
    for (const item of items) {
      if (item.status !== 'active') throw new OrderError(`المنتج "${item.name}" لم يعد متاحاً`);
      if (item.stock < item.quantity) throw new OrderError(`الكمية المتوفرة من "${item.name}" هي ${item.stock} فقط`);
    }
    const { subtotal, shipping, total } = carts.totals(items, settings);

    const customer = await customers.findOrCreate(
      { phone, email: form.email, name: form.name, source: cart.source },
      tx,
    );
    if (form.marketing_opt_in) {
      await tx.query('UPDATE customers SET marketing_opt_in = TRUE WHERE id = $1', [customer.id]);
    }
    let created = null;
    for (let attempt = 0; !created && attempt < 5; attempt += 1) {
      created = await tx.one(
        `INSERT INTO orders (number, customer_id, payment_method, subtotal, shipping_fee, total, currency,
                             ship_name, ship_phone, ship_city, ship_address, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (number) DO NOTHING RETURNING *`,
        [orderNumber(), customer.id, form.payment_method, subtotal, shipping, total, settings.currency,
          form.name.trim(), phone, form.city.trim(), form.address.trim(), String(form.notes ?? '').trim(), cart.source],
      );
    }
    for (const item of items) {
      await tx.query(
        'INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES ($1, $2, $3, $4, $5)',
        [created.id, item.product_id, item.name, item.price, item.quantity],
      );
      await tx.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [item.product_id, item.quantity]);
      const remaining = item.stock - item.quantity;
      if (remaining <= item.low_stock_at) {
        await alerts.raise({
          kind: 'low_stock',
          severity: remaining === 0 ? 'critical' : 'warning',
          message: `المخزون منخفض: "${item.name}" (المتبقي ${remaining})`,
          link: `/admin/products/${item.product_id}`,
          dedupeKey: `low-stock-${item.product_id}`,
        }, tx);
      }
    }
    await tx.query(`UPDATE carts SET status = 'converted', customer_id = $2, updated_at = now() WHERE id = $1`, [cart.id, customer.id]);
    await customers.addEvent(customer.id, 'order.placed', `طلب جديد #${created.number} بقيمة ${total}`, { order_id: created.id }, tx);
    await audit({ actor, action: 'order.place', entity: 'order', entityId: created.id, data: { total, items: items.length } }, tx);

    const value = await customers.lifetimeValue(customer.id, tx);
    if (value >= config.automation.vipThreshold) {
      await alerts.raise({
        kind: 'vip_customer',
        severity: 'info',
        message: `طلب جديد من عميل مهم: ${customer.name || phone} (إجمالي مشترياته ${round3(value)})`,
        link: `/admin/orders/${created.id}`,
        dedupeKey: `vip-order-${created.id}`,
      }, tx);
    }
    return created;
  });
  return order;
}

export async function track(number, phone) {
  const p = normalizePhone(phone);
  if (!number || !p) return null;
  const order = await db.one('SELECT * FROM orders WHERE number = $1 AND ship_phone = $2', [String(number).trim().toUpperCase(), p]);
  if (!order) return null;
  order.items = await db.many('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
  return order;
}

export async function getByNumber(number) {
  return db.one('SELECT * FROM orders WHERE number = $1', [String(number ?? '').toUpperCase()]);
}

export async function get(id) {
  const order = await db.one(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
    [id],
  );
  if (!order) return null;
  order.items = await db.many('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  order.history = await db.many(
    `SELECT * FROM audit_log WHERE entity = 'order' AND entity_id = $1 ORDER BY created_at DESC`,
    [String(id)],
  );
  return order;
}

export async function list({ status, payment, q } = {}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (payment) {
    params.push(payment);
    where.push(`o.payment_status = $${params.length}`);
  }
  if (q) {
    params.push(q);
    where.push(`(o.number ILIKE '%' || $${params.length} || '%' OR o.ship_phone LIKE '%' || $${params.length} || '%' OR o.ship_name ILIKE '%' || $${params.length} || '%')`);
  }
  return db.many(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.created_at DESC LIMIT 300`,
    params,
  );
}

export async function updateStatus(id, nextStatus, { actor, trackingNumber } = {}) {
  return transaction(async (tx) => {
    const order = await tx.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!order) throw new OrderError('الطلب غير موجود');
    if (!nextStatuses(order.status).includes(nextStatus)) {
      throw new OrderError(`لا يمكن نقل الطلب من "${ORDER_STATUS[order.status]}" إلى "${ORDER_STATUS[nextStatus] ?? nextStatus}"`);
    }
    if (nextStatus === 'cancelled') {
      const items = await tx.many('SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL', [id]);
      for (const item of items) {
        await tx.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [item.product_id, item.quantity]);
      }
    }
    const updated = await tx.one(
      `UPDATE orders SET status = $2, tracking_number = COALESCE($3, tracking_number), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, nextStatus, trackingNumber?.trim() || null],
    );
    await customers.addEvent(order.customer_id, 'order.status', `الطلب #${order.number}: ${ORDER_STATUS[nextStatus]}`, { order_id: id }, tx);
    await audit({ actor, action: 'order.status', entity: 'order', entityId: id, data: { from: order.status, to: nextStatus } }, tx);
    return updated;
  });
}

/** Payment changes are always a person's decision (payments.write permission). */
export async function setPaymentStatus(id, paymentStatus, { actor, note } = {}) {
  if (!['paid', 'failed'].includes(paymentStatus)) throw new OrderError('حالة دفع غير صحيحة');
  return transaction(async (tx) => {
    const order = await tx.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!order) throw new OrderError('الطلب غير موجود');
    if (!['unpaid', 'failed'].includes(order.payment_status)) throw new OrderError('لا يمكن تعديل حالة الدفع لهذا الطلب');
    const updated = await tx.one(
      'UPDATE orders SET payment_status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, paymentStatus],
    );
    if (paymentStatus === 'failed') {
      await alerts.raise({
        kind: 'payment_failed',
        message: `فشل الدفع للطلب #${order.number}`,
        link: `/admin/orders/${id}`,
        dedupeKey: `payment-failed-${id}`,
      }, tx);
    }
    await audit({ actor, action: `payment.${paymentStatus}`, entity: 'order', entityId: id, reason: note }, tx);
    return updated;
  });
}

/** A refund is requested here and only executed when a manager approves it. */
export async function requestRefund(id, { actor, reason }) {
  const order = await db.one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) throw new OrderError('الطلب غير موجود');
  if (order.payment_status !== 'paid') throw new OrderError('الاسترجاع متاح فقط للطلبات المدفوعة');
  await db.query(`UPDATE orders SET payment_status = 'refund_pending', updated_at = now() WHERE id = $1`, [id]);
  await audit({ actor, action: 'refund.request', entity: 'order', entityId: id, reason });
  return approvals.create({
    kind: 'refund',
    title: `استرجاع مبلغ الطلب #${order.number} (${order.total} ${order.currency})`,
    payload: { order_id: id, amount: order.total, reason: reason ?? '' },
    requestedBy: actor.type === 'user' ? `user:${actor.id}` : actor.type,
  });
}

export async function delayed(hours) {
  return db.many(
    `SELECT * FROM orders WHERE status IN ('new', 'confirmed', 'processing')
        AND created_at < now() - make_interval(hours => $1)`,
    [hours],
  );
}
