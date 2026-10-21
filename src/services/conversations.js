import { db } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { normalizeEmail, normalizePhone } from '../lib/format.js';
import * as alerts from './alerts.js';
import * as customers from './customers.js';

export const LABELS = ['new', 'interested', 'lead', 'confirmed_order', 'follow_up', 'complaint', 'needs_human'];

export async function getOrCreate(channel, externalId, { customerId } = {}) {
  return db.one(
    `INSERT INTO conversations (channel, external_id, customer_id) VALUES ($1, $2, $3)
     ON CONFLICT (channel, external_id) DO UPDATE SET customer_id = COALESCE(conversations.customer_id, EXCLUDED.customer_id)
     RETURNING *`,
    [channel, externalId, customerId ?? null],
  );
}

export async function find(channel, externalId) {
  return db.one('SELECT * FROM conversations WHERE channel = $1 AND external_id = $2', [channel, externalId]);
}

/** Stores a message. Returns null when externalId was already stored (duplicate delivery). */
export async function addMessage(conversationId, role, content, { authorId = null, externalId = null } = {}) {
  const message = await db.one(
    `INSERT INTO messages (conversation_id, role, content, author_id, external_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (external_id) DO NOTHING RETURNING *`,
    [conversationId, role, content, authorId, externalId],
  );
  if (!message) return null;
  await db.query(
    `UPDATE conversations SET last_message_at = now(),
            last_customer_message_at = CASE WHEN $2 = 'customer' THEN now() ELSE last_customer_message_at END,
            mode = CASE WHEN mode = 'closed' AND $2 = 'customer' THEN 'bot' ELSE mode END
      WHERE id = $1`,
    [conversationId, role],
  );
  return message;
}

export async function messages(conversationId, { afterId = 0, limit = 200 } = {}) {
  return db.many(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 AND id > $2 ORDER BY id LIMIT $3',
    [conversationId, afterId, limit],
  );
}

export async function history(conversationId, limit = 30) {
  const rows = await db.many(
    `SELECT role, content FROM messages WHERE conversation_id = $1 AND role IN ('customer', 'bot', 'staff')
      ORDER BY id DESC LIMIT $2`,
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function setLabel(conversationId, label, actor) {
  if (!LABELS.includes(label)) return;
  const conversation = await db.one('UPDATE conversations SET label = $2 WHERE id = $1 RETURNING *', [conversationId, label]);
  await audit({ actor, action: 'conversation.label', entity: 'conversation', entityId: conversationId, data: { label } });
  if (label === 'complaint') {
    await alerts.raise({
      kind: 'complaint',
      message: `شكوى جديدة في محادثة #${conversationId}`,
      link: `/admin/conversations/${conversationId}`,
      dedupeKey: `complaint-${conversationId}`,
    });
  }
  return conversation;
}

/** Hands the conversation to a person. The bot stops replying until staff hand it back. */
export async function handoff(conversationId, reason, actor) {
  const conversation = await db.one(
    `UPDATE conversations SET mode = 'human', handoff_reason = $2,
            label = CASE WHEN label IN ('complaint') THEN label ELSE 'needs_human' END
      WHERE id = $1 RETURNING *`,
    [conversationId, reason],
  );
  await addMessage(conversationId, 'system', `تم تحويل المحادثة لموظف: ${reason}`);
  await audit({ actor, action: 'conversation.handoff', entity: 'conversation', entityId: conversationId, reason });
  await alerts.raise({
    kind: 'needs_human',
    message: `محادثة تحتاج موظف (#${conversationId}): ${reason}`,
    link: `/admin/conversations/${conversationId}`,
    dedupeKey: `handoff-${conversationId}`,
  });
  return conversation;
}

export async function setMode(conversationId, mode, actor) {
  const conversation = await db.one('UPDATE conversations SET mode = $2 WHERE id = $1 RETURNING *', [conversationId, mode]);
  await audit({ actor, action: 'conversation.mode', entity: 'conversation', entityId: conversationId, data: { mode } });
  if (mode !== 'human') await alerts.resolveByKey(`handoff-${conversationId}`);
  return conversation;
}

/**
 * Saves contact details a customer gave in a chat. Only a WhatsApp sender's own number is proof of who is
 * writing; a number or email typed into a chat could be anyone's. So typed details never attach the chat
 * to an existing customer (that would show this person someone else's record, and mix their messages into
 * it). They are kept on the conversation, marked unverified, and a number the store has never seen still
 * becomes a new lead. Returns { customer, verified }; customer is null when the details stay on the chat.
 */
export async function captureContact(conversation, { name, phone, email, interests = [] }) {
  const sender = conversation.channel === 'whatsapp' ? normalizePhone(conversation.external_id) : null;
  const p = normalizePhone(phone) ?? sender;
  const e = normalizeEmail(email);
  if (!p && !e) return null;
  const verified = Boolean(sender) && p === sender;
  const cleanName = name?.trim() || null;

  // Looked up by phone only: an email match would let a typed address claim someone's record.
  let customer = p ? await db.one('SELECT * FROM customers WHERE phone = $1', [p]) : null;
  const taken = customer || (e && await db.one('SELECT id FROM customers WHERE email = $1', [e]));
  if (verified) {
    customer = await customers.findOrCreate({ phone: p, name: cleanName, source: conversation.channel });
  } else if (!taken && p) {
    customer = await customers.findOrCreate({ phone: p, name: cleanName, source: conversation.channel });
  } else {
    customer = null;
  }

  await db.query(
    `UPDATE conversations SET
       customer_id = COALESCE($2, customer_id),
       contact_name = COALESCE($3, contact_name), contact_phone = COALESCE($4, contact_phone),
       contact_email = COALESCE($5, contact_email),
       contact_interests = ARRAY(SELECT DISTINCT unnest(contact_interests || $6::text[])),
       contact_unverified = contact_unverified OR $7
     WHERE id = $1`,
    [conversation.id, customer?.id ?? null, cleanName, p, e, interests, !verified],
  );
  if (customer && interests.length) await customers.addInterests(customer.id, interests);
  return { customer, verified };
}

export async function get(id) {
  const conversation = await db.one(
    `SELECT cv.*, c.name AS customer_name, c.phone AS customer_phone
       FROM conversations cv LEFT JOIN customers c ON c.id = cv.customer_id WHERE cv.id = $1`,
    [id],
  );
  if (!conversation) return null;
  conversation.messages = await messages(id);
  return conversation;
}

export async function inbox({ mode, label } = {}) {
  const where = [];
  const params = [];
  if (mode) {
    params.push(mode);
    where.push(`cv.mode = $${params.length}`);
  }
  if (label) {
    params.push(label);
    where.push(`cv.label = $${params.length}`);
  }
  return db.many(
    `SELECT cv.*, c.name AS customer_name, c.phone AS customer_phone,
            (SELECT content FROM messages m WHERE m.conversation_id = cv.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM conversations cv LEFT JOIN customers c ON c.id = cv.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (cv.mode = 'human') DESC, cv.last_message_at DESC LIMIT 200`,
    params,
  );
}
