import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { aiEnabled } from './ai/client.js';
import { channelStatus } from './channels/index.js';
import * as worker from './automation/worker.js';
import { admin } from './routes/admin.js';
import { api } from './routes/api.js';
import { store } from './routes/store.js';
import { webhooks } from './routes/webhooks.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.get('/healthz', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, ai: aiEnabled() ? 'claude' : 'template', channels: channelStatus() });
  });

  // Webhooks read the raw body for signature checks, so they mount before the body parsers.
  app.use('/webhooks', webhooks);

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use('/static', express.static(new URL('../public/', import.meta.url).pathname, { maxAge: config.isProduction ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', index: false }));

  app.use('/api', api);
  app.use('/admin', admin);
  app.use('/', store);

  app.use((req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><p dir="rtl">الصفحة غير موجودة. <a href="/">الرئيسية</a></p>'));
  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api')) return res.status(500).json({ error: 'حدث خطأ غير متوقع' });
    res.status(500).type('html').send('<!doctype html><meta charset="utf-8"><p dir="rtl">حدث خطأ غير متوقع. حاول مرة ثانية.</p>');
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (config.isProduction && (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)) {
    console.error('APP_SECRET (32+ characters) is required in production.');
    process.exit(1);
  }
  await migrate();
  createApp().listen(config.port, () => {
    console.log(`store running on ${config.baseUrl} (port ${config.port})`);
    console.log(`ai=${aiEnabled() ? `claude (${config.ai.model})` : 'template'} whatsapp=${channelStatus().whatsapp ? 'on' : 'off'} automation=${config.automation.enabled ? 'on' : 'off'}`);
  });
  worker.start();
}
