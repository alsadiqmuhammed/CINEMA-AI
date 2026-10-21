import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  checkoutForm, db, pool, productBySku, resetDatabase, startServer, visitorWithCart,
} from './helpers.js';
import { config } from '../src/config.js';
import { RateLimiter } from '../src/lib/rate-limit.js';
import { abandonedCarts } from '../src/automation/worker.js';

let server;

before(async () => {
  await resetDatabase();
  server = await startServer();
});

after(async () => {
  await server.close();
  await pool.end();
});

async function order(phone, extra = {}) {
  const product = await productBySku('DEMO-6');
  const { visitor, csrf } = await visitorWithCart(server.base, product.id, 1);
  return visitor.post('/checkout', checkoutForm(csrf, { phone, ...extra }));
}

describe('abuse protections', () => {
  test('two limiter instances with the same name share one count, as separate servers would', async () => {
    config.rateLimits = true;
    try {
      const a = new RateLimiter({ name: 'shared-test', limit: 3, windowMs: 60_000 });
      const b = new RateLimiter({ name: 'shared-test', limit: 3, windowMs: 60_000 });
      const results = [await a.take('x'), await b.take('x'), await a.take('x'), await b.take('x')];
      assert.deepEqual(results, [true, true, true, false]);
    } finally {
      config.rateLimits = false;
    }
  });

  test('one number cannot pile up unconfirmed cash-on-delivery orders', async () => {
    assert.equal((await order('07712340001')).status, 302);
    assert.equal((await order('07712340001')).status, 302);
    const third = await order('07712340001');
    assert.equal(third.status, 422);
    assert.match(third.body, /تنتظر التأكيد/);
    // once staff confirm one, the number can order again
    await db.query(`UPDATE orders SET status = 'confirmed' WHERE ship_phone = '9647712340001' AND id = (SELECT min(id) FROM orders WHERE ship_phone = '9647712340001')`);
    assert.equal((await order('07712340001')).status, 302);
  });

  test('marketing consent from the public form applies to a new number only', async () => {
    await order('07712340002', { marketing_opt_in: '1' });
    const fresh = await db.one(`SELECT marketing_opt_in FROM customers WHERE phone = '9647712340002'`);
    assert.equal(fresh.marketing_opt_in, true);

    await order('07712340003');
    await order('07712340003', { marketing_opt_in: '1' });
    const existing = await db.one(`SELECT id, marketing_opt_in FROM customers WHERE phone = '9647712340003'`);
    assert.equal(existing.marketing_opt_in, false);
    const request = await db.one(`SELECT 1 FROM customer_events WHERE customer_id = $1 AND kind = 'marketing.opt_in_requested'`, [existing.id]);
    assert.ok(request, 'the request is kept on the record for staff to confirm');
  });

  test('a number typed into several carts gets one reminder, not one per cart', async () => {
    const product = await productBySku('DEMO-6');
    for (let i = 0; i < 3; i += 1) {
      const { visitor, csrf } = await visitorWithCart(server.base, product.id, 1);
      await visitor.post('/cart/contact', { _csrf: csrf, phone: '07712340004' });
    }
    await db.query(`UPDATE carts SET updated_at = now() - interval '5 hours' WHERE contact_phone = '9647712340004'`);
    await abandonedCarts();
    await abandonedCarts();
    const sent = await db.many(`SELECT 1 FROM outbox WHERE purpose = 'abandoned_cart' AND recipient = '9647712340004'`);
    assert.equal(sent.length, 1);
  });

  test('checkout is limited per address when limits are on', async () => {
    config.rateLimits = true;
    try {
      const statuses = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await order(`0771234010${i}`)).status);
      assert.deepEqual(statuses.slice(0, 6), [302, 302, 302, 302, 302, 302]);
      assert.equal(statuses[6], 429);
    } finally {
      config.rateLimits = false;
    }
  });
});
