import { db, transaction } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import * as outbox from './outbox.js';

export const APPROVAL_KINDS = {
  product_content: 'محتوى منتج',
  ad_campaign: 'حملة إعلانية',
  broadcast: 'رسالة جماعية',
  refund: 'استرجاع مبلغ',
};

export class ApprovalError extends Error {}

export async function create({ kind, title, payload, requestedBy }, client = db) {
  const approval = await client.one(
    `INSERT INTO approvals (kind, title, payload, requested_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [kind, title, JSON.stringify(payload), requestedBy],
  );
  await audit({
    actor: requestedBy.startsWith('user:') ? { type: 'user', id: requestedBy.slice(5) } : { type: requestedBy === 'ai' ? 'ai' : 'automation' },
    action: 'approval.request',
    entity: 'approval',
    entityId: approval.id,
    data: { kind },
  }, client);
  return approval;
}

export async function list(status = 'pending') {
  return db.many('SELECT * FROM approvals WHERE status = $1 ORDER BY created_at DESC LIMIT 200', [status]);
}

export async function get(id) {
  return db.one('SELECT * FROM approvals WHERE id = $1', [id]);
}

export async function pendingCount() {
  return (await db.one(`SELECT COUNT(*)::int AS n FROM approvals WHERE status = 'pending'`)).n;
}

// What approving each kind actually does. Rejection only records the decision
// (plus undoing a pending refund flag).
const APPLY = {
  async product_content(tx, payload) {
    const fields = payload.fields ?? {};
    await tx.query(
      `UPDATE products SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         seo_title = COALESCE($4, seo_title),
         seo_description = COALESCE($5, seo_description),
         faq = COALESCE($6::jsonb, faq),
         updated_at = now()
       WHERE id = $1`,
      [payload.product_id, fields.name ?? null, fields.description ?? null, fields.seo_title ?? null,
        fields.seo_description ?? null, fields.faq ? JSON.stringify(fields.faq) : null],
    );
  },
  async refund(tx, payload) {
    const order = await tx.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [payload.order_id]);
    if (!order || order.payment_status !== 'refund_pending') throw new ApprovalError('الطلب ليس بانتظار استرجاع');
    await tx.query(`UPDATE orders SET payment_status = 'refunded', updated_at = now() WHERE id = $1`, [order.id]);
  },
  async broadcast(tx, payload, approval) {
    // Recipients are resolved at approval time and limited to customers who opted in.
    const recipients = await tx.many(
      `SELECT id, phone FROM customers WHERE marketing_opt_in AND phone IS NOT NULL AND id = ANY($1::bigint[])`,
      [payload.customer_ids ?? []],
    );
    for (const customer of recipients) {
      await outbox.enqueue({
        channel: 'whatsapp',
        recipient: customer.phone,
        customerId: customer.id,
        purpose: 'broadcast',
        body: payload.body,
        template: payload.template ?? null,
        dedupeKey: `broadcast-${approval.id}-${customer.id}`,
      }, tx);
    }
  },
  // Launching paid ads stays manual in phase 1: approval marks the plan as accepted.
  async ad_campaign() {},
};

const UNDO_ON_REJECT = {
  async refund(tx, payload) {
    await tx.query(`UPDATE orders SET payment_status = 'paid', updated_at = now()
                     WHERE id = $1 AND payment_status = 'refund_pending'`, [payload.order_id]);
  },
};

export async function decide(id, { approve, user, note }) {
  return transaction(async (tx) => {
    const approval = await tx.one('SELECT * FROM approvals WHERE id = $1 FOR UPDATE', [id]);
    if (!approval) throw new ApprovalError('الطلب غير موجود');
    if (approval.status !== 'pending') throw new ApprovalError('تم اتخاذ قرار في هذا الطلب مسبقاً');
    if (approve) await APPLY[approval.kind](tx, approval.payload, approval);
    else await UNDO_ON_REJECT[approval.kind]?.(tx, approval.payload, approval);
    const updated = await tx.one(
      `UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
        WHERE id = $1 RETURNING *`,
      [id, approve ? 'approved' : 'rejected', user.id, note ?? null],
    );
    await audit({
      actor: { type: 'user', id: user.id },
      action: approve ? 'approval.approve' : 'approval.reject',
      entity: 'approval',
      entityId: id,
      reason: note,
      data: { kind: approval.kind },
    }, tx);
    return updated;
  });
}
