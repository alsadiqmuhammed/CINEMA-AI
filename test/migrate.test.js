import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { pool, resetDatabase } from './helpers.js';
import { migrate } from '../src/db/migrate.js';

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
