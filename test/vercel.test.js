import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { pool, resetDatabase } from './helpers.js';

const { default: handler } = await import('../api/index.js');
let server;
let base;

before(async () => {
  await resetDatabase();
  // Mimics Vercel's Node helpers: own properties that would shadow Express (res.redirect defaults to 307).
  server = http.createServer((req, res) => {
    Object.defineProperty(req, 'body', { configurable: true, enumerable: true, get: () => ({}), set() {} });
    res.redirect = (statusOrUrl, url) => {
      res.statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
      res.setHeader('location', url ?? statusOrUrl);
      res.end();
    };
    return handler(req, res);
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('the Vercel entry point uses Express redirects (302) so a form POST is not replayed', async () => {
  const res = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=owner@store.local&password=Demo-Owner-2026&next=',
  });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/admin');
});
