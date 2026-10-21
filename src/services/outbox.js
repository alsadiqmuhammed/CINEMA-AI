import { db } from '../db/pool.js';
import { audit, AUTOMATION_ACTOR } from '../lib/audit.js';
import { channelFor } from '../channels/index.js';
import { raise } from './alerts.js';

export async function enqueue({ channel, recipient, customerId, purpose, body, template, dedupeKey }, client = db) {
  return client.one(
    `INSERT INTO outbox (channel, recipient, customer_id, purpose, body, template, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
    [channel, recipient, customerId ?? null, purpose, body, template ?? null, dedupeKey ?? null],
  );
}

const MAX_ATTEMPTS = 3;

/** Sends queued messages. A channel that is not configured marks them skipped rather than failing. */
export async function deliverPending(limit = 50) {
  const queued = await db.many(
    `SELECT * FROM outbox WHERE status = 'queued' ORDER BY created_at LIMIT $1`,
    [limit],
  );
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const message of queued) {
    const channel = channelFor(message.channel);
    if (!channel?.configured()) {
      await db.query(`UPDATE outbox SET status = 'skipped', error = $2 WHERE id = $1`, [message.id, 'القناة غير مربوطة']);
      result.skipped += 1;
      continue;
    }
    try {
      await channel.send({ to: message.recipient, text: message.body, template: message.template });
      await db.query(`UPDATE outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [message.id]);
      await audit({ actor: AUTOMATION_ACTOR, action: 'outbox.sent', entity: 'outbox', entityId: message.id, reason: message.purpose });
      result.sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
      await db.query('UPDATE outbox SET status = $2, attempts = $3, error = $4 WHERE id = $1', [message.id, status, attempts, error.message]);
      if (status === 'failed') {
        await raise({
          kind: 'integration_error',
          message: `تعذر إرسال رسالة (${message.purpose}) عبر ${message.channel}: ${error.message}`,
          link: '/admin/outbox',
          dedupeKey: `outbox-failed-${message.channel}`,
        });
      }
      result.failed += 1;
    }
  }
  return result;
}

export async function recent(limit = 200) {
  return db.many('SELECT * FROM outbox ORDER BY created_at DESC LIMIT $1', [limit]);
}
