import pg from 'pg';
import { config } from '../config.js';

// NUMERIC comes back as a string by default; prices are small enough for a JS number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number.parseFloat(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

function sslOption() {
  if (config.databaseSsl === 'no-verify') return { rejectUnauthorized: false };
  if (config.databaseSsl === 'require') return true;
  return undefined;
}

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: sslOption(), max: 10 });

export function query(text, params) {
  return pool.query(text, params);
}

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Runs fn inside a transaction; fn receives a client with the same query helpers.
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: (text, params) => client.query(text, params),
      one: async (text, params) => (await client.query(text, params)).rows[0] ?? null,
      many: async (text, params) => (await client.query(text, params)).rows,
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const db = { query, one, many };
