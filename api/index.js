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
  // Vercel's Node helpers attach their own req.body/query/cookies and res.redirect/status/send/json, which
  // shadow Express's (res.redirect defaults to 307, so a form POST is replayed at the redirect target).
  for (const key of ['body', 'query', 'cookies']) delete req[key];
  for (const key of ['redirect', 'status', 'send', 'json']) delete res[key];
  return app(req, res);
}
