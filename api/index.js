// Vercel entry point: every request is rewritten here (see vercel.json) and handled by the Express app.
import { seed } from '../src/db/seed.js';
import { assertProductionConfig, createApp } from '../src/server.js';

const app = createApp();
let ready = null;

export default async function handler(req, res) {
  // First request on a cold instance: check config, apply migrations, create the owner account (idempotent).
  ready ??= Promise.resolve().then(assertProductionConfig).then(() => seed()).catch((error) => {
    ready = null;
    throw error;
  });
  try {
    await ready;
  } catch (error) {
    console.error('startup failed', error);
    res.statusCode = 503;
    return res.end('Service unavailable');
  }
  return app(req, res);
}
