import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  checkoutForm, Client, db, pool, productBySku, resetDatabase, startServer, visitorWithCart,
} from './helpers.js';

let server;

before(async () => {
  await resetDatabase();
  server = await startServer();
});

after(async () => {
  await server.close();
  await pool.end();
});

describe('storefront and checkout', () => {
  test('pages render in Arabic RTL with product structured data', async () => {
    const client = new Client(server.base);
    const home = await client.get('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /<html lang="ar" dir="rtl">/);
    const product = await productBySku('DEMO-1');
    const page = await client.get(`/p/${encodeURIComponent(product.slug)}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /"@type":"Product"/);
    assert.match(page.body, /قد يعجبك أيضاً/);
    const search = await client.get(`/search?q=${encodeURIComponent('محفظة')}`);
    assert.match(search.body, /محفظة رجالية نحيفة/);
  });

  test('POST without the CSRF token is rejected', async () => {
    const client = new Client(server.base);
    await client.get('/');
    const res = await client.post('/cart/add', { product_id: '1', quantity: '1' });
    assert.equal(res.status, 403);
  });

  test('checkout creates order, customer and CRM event, and decrements stock', async () => {
    const product = await productBySku('DEMO-1'); // 149, below the 300 free-shipping threshold when ×2
    const { visitor, csrf } = await visitorWithCart(server.base, product.id, 2);
    const res = await visitor.post('/checkout', checkoutForm(csrf, { marketing_opt_in: '1' }));
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/order\/[A-Z0-9]{7}\?t=/);

    const order = await db.one('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
    assert.equal(order.subtotal, 298);
    assert.equal(order.shipping_fee, 25);
    assert.equal(order.total, 323);
    assert.equal(order.ship_phone, '0501234567');
    assert.equal((await productBySku('DEMO-1')).stock, product.stock - 2);

    const customer = await db.one('SELECT * FROM customers WHERE id = $1', [order.customer_id]);
    assert.equal(customer.name, 'سارة أحمد');
    assert.equal(customer.marketing_opt_in, true);
    const event = await db.one(`SELECT * FROM customer_events WHERE customer_id = $1 AND kind = 'order.placed'`, [customer.id]);
    assert.ok(event);

    const confirmation = await visitor.get(res.location);
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.body, new RegExp(order.number));
    // Order number alone is not enough to view the confirmation page.
    assert.equal((await visitor.get(`/order/${order.number}`)).status, 404);

    const track = await visitor.get(`/track?number=${order.number}&phone=${encodeURIComponent('050 123 4567')}`);
    assert.match(track.body, /طلب #/);
    const wrongPhone = await visitor.get(`/track?number=${order.number}&phone=0559999999`);
    assert.match(wrongPhone.body, /ما لقينا طلب/);
  });

  test('the last units cannot be sold twice when two customers check out at once', async () => {
    const product = await productBySku('DEMO-4'); // stock 3
    const a = await visitorWithCart(server.base, product.id, 3);
    const b = await visitorWithCart(server.base, product.id, 3);
    const [ra, rb] = await Promise.all([
      a.visitor.post('/checkout', checkoutForm(a.csrf, { phone: '0511111111' })),
      b.visitor.post('/checkout', checkoutForm(b.csrf, { phone: '0522222222' })),
    ]);
    const statuses = [ra.status, rb.status].sort();
    assert.deepEqual(statuses, [302, 422]);
    const failed = ra.status === 422 ? ra : rb;
    assert.match(failed.body, /الكمية المتوفرة/);
    assert.equal((await productBySku('DEMO-4')).stock, 0);
    const alert = await db.one(`SELECT * FROM alerts WHERE dedupe_key = $1 AND resolved_at IS NULL`, [`low-stock-${product.id}`]);
    assert.equal(alert.severity, 'critical');
  });

  test('invalid phone shows a form error and keeps the cart', async () => {
    const product = await productBySku('DEMO-3');
    const { visitor, csrf } = await visitorWithCart(server.base, product.id, 1);
    const res = await visitor.post('/checkout', checkoutForm(csrf, { phone: '12' }));
    assert.equal(res.status, 422);
    assert.match(res.body, /رقم الجوال غير صحيح/);
    assert.match((await visitor.get('/cart')).body, /شمعة معطرة بالعنبر/);
  });
});
