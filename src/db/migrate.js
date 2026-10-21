import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.js';

const dir = new URL('./migrations/', import.meta.url);
const LOCK_ID = 727001;
const LOCK_WAIT_MS = 15_000;

async function pendingFiles(client) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ready`);
  if (!rows[0].ready) return files;
  const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  return files.filter((f) => !applied.has(f));
}

// Polls instead of blocking: a serverless instance frozen mid-request can keep the lock for a long time,
// and a blocking wait would hang every cold start behind it.
async function acquireLock(client) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])).rows[0].ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export async function migrate() {
  const client = await pool.connect();
  let locked = false;
  let failed = false;
  try {
    // Nothing to apply (the usual case on every start) means no lock at all.
    if (!(await pendingFiles(client)).length) return;
    locked = await acquireLock(client);
    if (!locked) throw new Error('another instance is applying migrations; try again shortly');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const file of await pendingFiles(client)) {
      const sql = await readFile(new URL(file, dir), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migration applied: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${error.message}`);
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    // After a failure the connection may be mid-query or still hold the lock; close it rather than pool it.
    client.release(failed);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
