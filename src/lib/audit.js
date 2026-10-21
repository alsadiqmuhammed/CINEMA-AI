import { db } from '../db/pool.js';

/**
 * Records an action. actor: { type: 'user'|'ai'|'automation'|'customer'|'system', id? }.
 * Accepts an optional transaction client so the entry commits with the change it describes.
 */
export async function audit({ actor, action, entity, entityId, reason, data }, client = db) {
  await client.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, reason, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor.type,
      actor.id == null ? null : String(actor.id),
      action,
      entity ?? null,
      entityId == null ? null : String(entityId),
      reason ?? null,
      JSON.stringify(data ?? {}),
    ],
  );
}

export const userActor = (user) => ({ type: 'user', id: user.id });
export const AI_ACTOR = { type: 'ai', id: 'assistant' };
export const AUTOMATION_ACTOR = { type: 'automation', id: 'worker' };
