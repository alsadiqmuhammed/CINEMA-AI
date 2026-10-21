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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Retry-After', '5');
    return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>لحظة وحدة</title><div dir="rtl" style="font-family:system-ui,sans-serif;max-width:28rem;margin:20vh auto;padding:0 16px;text-align:center"><h1>لحظة وحدة</h1><p>المتجر ديصحى هسة. حدّث الصفحة بعد ثواني.</p><p><a href="">حدّث الصفحة</a></p></div>');
  }
  // Vercel's Node helpers attach their own req.body/query/cookies and res.redirect/status/send/json, which
  // shadow Express's (res.redirect defaults to 307, so a form POST is replayed at the redirect target).
  for (const key of ['body', 'query', 'cookies']) delete req[key];
  for (const key of ['redirect', 'status', 'send', 'json']) delete res[key];
  return app(req, res);
}
