import { db } from '../db/pool.js';

export const ALERT_LABELS = {
  low_stock: 'نقص مخزون',
  order_delayed: 'تأخر طلب',
  complaint: 'شكوى',
  payment_failed: 'فشل دفع',
  vip_customer: 'عميل مهم',
  integration_error: 'خطأ تكامل',
  needs_human: 'تحتاج تدخل',
};

/** Raises an alert once per dedupeKey while it is open. */
export async function raise({ kind, severity = 'warning', message, link, dedupeKey }, client = db) {
  if (dedupeKey) {
    const open = await client.one('SELECT id FROM alerts WHERE dedupe_key = $1 AND resolved_at IS NULL', [dedupeKey]);
    if (open) return null;
    // A resolved alert with the same key is re-opened as a new occurrence.
    await client.query('UPDATE alerts SET dedupe_key = NULL WHERE dedupe_key = $1', [dedupeKey]);
  }
  return client.one(
    `INSERT INTO alerts (kind, severity, message, link, dedupe_key) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [kind, severity, message, link ?? null, dedupeKey ?? null],
  );
}

export async function resolve(id) {
  await db.query('UPDATE alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL', [id]);
}

export async function resolveByKey(dedupeKey) {
  await db.query('UPDATE alerts SET resolved_at = now() WHERE dedupe_key = $1 AND resolved_at IS NULL', [dedupeKey]);
}

export async function listOpen(limit = 100) {
  return db.many(
    `SELECT * FROM alerts WHERE resolved_at IS NULL
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT $1`,
    [limit],
  );
}
