import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '../db/pool.js';

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 14;
export const SESSION_COOKIE = 'store_session';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function token(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

export async function createSession(userId) {
  const id = token(32);
  const csrf = token(24);
  await db.query(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [id, userId, csrf, SESSION_DAYS],
  );
  return { id, maxAgeMs: SESSION_DAYS * 86_400_000 };
}

export async function loadSession(sessionId) {
  if (!sessionId) return null;
  return db.one(
    `SELECT s.id AS session_id, s.csrf_token, u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
    [sessionId],
  );
}

export async function destroySession(sessionId) {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

// Permissions per role. The AI and automations never hold these: they act
// through approvals and the audit log, not through a staff session.
const PERMISSIONS = {
  owner: ['*'],
  manager: [
    'products.write', 'orders.write', 'customers.write', 'conversations.write',
    'approvals.decide', 'payments.write', 'audit.read', 'settings.write',
  ],
  staff: ['products.write', 'orders.write', 'customers.write', 'conversations.write'],
};

export function can(user, permission) {
  const granted = PERMISSIONS[user?.role] ?? [];
  return granted.includes('*') || granted.includes(permission);
}

export const ROLE_LABELS = { owner: 'مالك', manager: 'مدير', staff: 'موظف' };
