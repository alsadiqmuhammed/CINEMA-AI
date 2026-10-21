import { config } from '../config.js';
import { db } from '../db/pool.js';

/**
 * Fixed-window limiter kept in Postgres, so every instance shares one count (an in-memory map is
 * per instance and resets on every cold start). take() is async and fails open: if the database
 * can't be reached the request is about to fail anyway, and the limit must not become the outage.
 */
export class RateLimiter {
  constructor({ name, limit, windowMs }) {
    this.name = name;
    this.limit = limit;
    this.windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  }

  async take(key) {
    if (!config.rateLimits) return true;
    try {
      const row = await db.one(
        `INSERT INTO rate_limits (key, window_start, hits)
         VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
         ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
         RETURNING hits`,
        [`${this.name}:${key}`, this.windowSeconds],
      );
      if (Math.random() < 0.01) prune();
      return row.hits <= this.limit;
    } catch (error) {
      console.error('rate limit check failed', error.message);
      return true;
    }
  }
}

function prune() {
  db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`).catch(() => {});
}
