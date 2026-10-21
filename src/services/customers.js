import { db } from '../db/pool.js';
import { normalizeEmail, normalizePhone } from '../lib/format.js';

/**
 * Finds a customer by phone, then email, or creates one. Fills in missing
 * name/email on an existing record but never overwrites what is there.
 */
export async function findOrCreate({ phone, email, name, source = 'web' }, client = db) {
  const p = normalizePhone(phone);
  const e = normalizeEmail(email);
  let customer = null;
  if (p) customer = await client.one('SELECT * FROM customers WHERE phone = $1', [p]);
  if (!customer && e) customer = await client.one('SELECT * FROM customers WHERE email = $1', [e]);

  if (customer) {
    return client.one(
      `UPDATE customers SET
         name = CASE WHEN name = '' THEN COALESCE($2, '') ELSE name END,
         phone = COALESCE(phone, $3),
         email = COALESCE(email, $4),
         last_seen_at = now()
       WHERE id = $1 RETURNING *`,
      [customer.id, name?.trim() || null, p, e && !(await emailTaken(client, e, customer.id)) ? e : null],
    );
  }
  if (!p && !e) return null;
  return client.one(
    `INSERT INTO customers (name, phone, email, source, last_seen_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING *`,
    [name?.trim() ?? '', p, e, source],
  );
}

async function emailTaken(client, email, exceptId) {
  return Boolean(await client.one('SELECT 1 FROM customers WHERE email = $1 AND id <> $2', [email, exceptId]));
}

export async function addEvent(customerId, kind, summary, data = {}, client = db) {
  if (!customerId) return;
  await client.query(
    'INSERT INTO customer_events (customer_id, kind, summary, data) VALUES ($1, $2, $3, $4)',
    [customerId, kind, summary, JSON.stringify(data)],
  );
}

const STATS = `
  SELECT c.*,
         COUNT(o.id) FILTER (WHERE o.status <> 'cancelled') AS order_count,
         COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS lifetime_value,
         MAX(o.created_at) AS last_order_at
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id`;

export const SEGMENTS = {
  all: 'كل العملاء',
  vip: 'عملاء مهمون',
  repeat: 'عملاء متكررون',
  inactive: 'غير نشطين (90 يوم)',
  no_order: 'بدون طلبات',
  opted_in: 'موافقون على التسويق',
};

export async function list({ segment = 'all', q, source, interest, vipThreshold = 500 } = {}) {
  const where = [];
  const having = [];
  const params = [];
  if (q) {
    params.push(q);
    where.push(`(c.name ILIKE '%' || $${params.length} || '%' OR c.phone LIKE '%' || $${params.length} || '%' OR c.email ILIKE '%' || $${params.length} || '%')`);
  }
  if (source) {
    params.push(source);
    where.push(`c.source = $${params.length}`);
  }
  if (interest) {
    params.push(interest);
    where.push(`$${params.length} = ANY(c.interests)`);
  }
  if (segment === 'opted_in') where.push('c.marketing_opt_in');
  if (segment === 'vip') {
    params.push(vipThreshold);
    having.push(`COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) >= $${params.length}`);
  }
  if (segment === 'repeat') having.push(`COUNT(o.id) FILTER (WHERE o.status <> 'cancelled') >= 2`);
  if (segment === 'no_order') having.push('COUNT(o.id) = 0');
  if (segment === 'inactive') having.push(`COUNT(o.id) > 0 AND MAX(o.created_at) < now() - interval '90 days'`);

  return db.many(
    `${STATS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY c.id ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
      ORDER BY COALESCE(MAX(o.created_at), c.created_at) DESC LIMIT 500`,
    params,
  );
}

export async function get(id) {
  const customer = await db.one(`${STATS} WHERE c.id = $1 GROUP BY c.id`, [id]);
  if (!customer) return null;
  customer.events = await db.many('SELECT * FROM customer_events WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100', [id]);
  customer.orders = await db.many('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [id]);
  customer.conversations = await db.many('SELECT * FROM conversations WHERE customer_id = $1 ORDER BY last_message_at DESC', [id]);
  return customer;
}

export async function update(id, { name, notes, tags, interests, marketing_opt_in }) {
  return db.one(
    `UPDATE customers SET name = $2, notes = $3, tags = $4, interests = $5, marketing_opt_in = $6
      WHERE id = $1 RETURNING *`,
    [id, name ?? '', notes ?? '', tags ?? [], interests ?? [], Boolean(marketing_opt_in)],
  );
}

export async function lifetimeValue(customerId, client = db) {
  const row = await client.one(
    `SELECT COALESCE(SUM(total), 0) AS value FROM orders WHERE customer_id = $1 AND status <> 'cancelled'`,
    [customerId],
  );
  return row.value;
}

export async function sources() {
  return (await db.many('SELECT DISTINCT source FROM customers ORDER BY source')).map((r) => r.source);
}

export async function addInterests(customerId, interests) {
  const clean = interests.map((i) => i.trim()).filter(Boolean);
  if (!clean.length) return;
  await db.query(
    `UPDATE customers SET interests = ARRAY(SELECT DISTINCT unnest(interests || $2::text[])) WHERE id = $1`,
    [customerId, clean],
  );
}
