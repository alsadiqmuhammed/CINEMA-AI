import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { db, pool, resetDatabase } from './helpers.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

before(resetDatabase);
after(() => pool.end());

test('start-up does not wait on the migration lock when nothing is pending', async () => {
  // Another instance (say, one frozen mid-request) is holding the lock.
  const holder = await pool.connect();
  await holder.query('SELECT pg_advisory_lock(727001)');
  try {
    const started = Date.now();
    await migrate();
    assert.ok(Date.now() - started < 2000, 'migrate should return without waiting for the lock');
  } finally {
    await holder.query('SELECT pg_advisory_unlock(727001)');
    holder.release();
  }
});

test('a production start switches off demo accounts and their sessions, but never the admin', async () => {
  const staff = await db.one(`SELECT id FROM users WHERE email = 'staff@store.local'`);
  await db.query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ('demo-session', $1, 'x', now() + interval '1 day')`, [staff.id]);
  const previous = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'owner@store.local';
  try {
    await seed({ demo: false, catalog: false });
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previous;
  }
  const users = await db.many(`SELECT email, active FROM users WHERE email LIKE '%@store.local' ORDER BY email`);
  assert.deepEqual(users.find((u) => u.email === 'staff@store.local').active, false);
  assert.deepEqual(users.find((u) => u.email === 'owner@store.local').active, true);
  assert.equal(await db.one(`SELECT 1 FROM sessions WHERE id = 'demo-session'`), null);
});
