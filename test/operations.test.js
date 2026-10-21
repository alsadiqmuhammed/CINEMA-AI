import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  checkoutForm, Client, db, pool, productBySku, resetDatabase, startServer, visitorWithCart,
} from './helpers.js';
import { runOnce } from '../src/automation/worker.js';
import { config } from '../src/config.js';
import { handleWhatsApp } from '../src/routes/webhooks.js';

let server;

before(async () => {
  await resetDatabase();
  server = await startServer();
});

after(async () => {
  await server.close();
  await pool.end();
});

async function placeOrder(phone = '07701234567', sku = 'DEMO-5') {
  const product = await productBySku(sku);
  const { visitor, csrf } = await visitorWithCart(server.base, product.id, 1);
  const res = await visitor.post('/checkout', checkoutForm(csrf, { phone }));
  assert.equal(res.status, 302);
  return db.one('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
}

describe('chat assistant (template mode, no API key)', () => {
  test('answers product questions from the catalog and labels the conversation', async () => {
    const visitor = new Client(server.base);
    const res = await visitor.request('/api/chat', { method: 'POST', json: { message: 'أبي محفظة' } });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.messages.length, 2);
    assert.match(data.messages[1].content, /محفظة رجالية نحيفة/);
    const conversation = await db.one(`SELECT * FROM conversations WHERE channel = 'web' ORDER BY id DESC LIMIT 1`);
    assert.equal(conversation.label, 'interested');
  });

  test('refund requests are handed to a person and the bot stops replying', async () => {
    const visitor = new Client(server.base);
    const first = (await visitor.request('/api/chat', { method: 'POST', json: { message: 'أبي استرجاع طلبي' } })).json();
    assert.equal(first.mode, 'human');
    const conversation = await db.one(`SELECT * FROM conversations ORDER BY id DESC LIMIT 1`);
    assert.equal(conversation.mode, 'human');
    assert.ok(await db.one(`SELECT 1 FROM alerts WHERE dedupe_key = $1`, [`handoff-${conversation.id}`]));
    const second = (await visitor.request('/api/chat', { method: 'POST', json: { message: 'متى بتردون؟' } })).json();
    assert.equal(second.messages.length, 1, 'no bot reply while a person owns the conversation');
  });

  test('order status needs the order number and the matching phone', async () => {
    const order = await placeOrder('07733333333');
    const visitor = new Client(server.base);
    const ok = (await visitor.request('/api/chat', { method: 'POST', json: { message: `طلبي ${order.number} ورقمي 07733333333` } })).json();
    assert.match(ok.messages[1].content, /جديد/);
    const wrong = (await visitor.request('/api/chat', { method: 'POST', json: { message: `طلبي ${order.number} ورقمي 07744444444` } })).json();
    assert.match(wrong.messages[1].content, /لم نجد/);
  });
});

describe('admin permissions and approvals', () => {
  test('admin pages require login', async () => {
    const res = await new Client(server.base).get('/admin/orders');
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/admin\/login/);
  });

  test('wrong password is rejected', async () => {
    const client = new Client(server.base);
    const res = await client.post('/admin/login', { email: 'owner@store.local', password: 'nope' });
    assert.equal(res.status, 401);
  });

  test('admin POST without the session CSRF token is rejected', async () => {
    const staff = new Client(server.base);
    await staff.login('staff@store.local', 'Demo-Staff-2026');
    const res = await staff.post('/admin/customers/1', { name: 'x' });
    assert.equal(res.status, 403);
  });

  test('AI product drafts wait for approval; staff cannot approve, a manager can', async () => {
    const product = await productBySku('DEMO-3');
    const staff = new Client(server.base);
    await staff.login('staff@store.local', 'Demo-Staff-2026');
    const draft = await staff.adminPost(`/admin/products/${product.id}/draft`);
    assert.equal(draft.status, 302);
    const approvalId = Number(draft.location.match(/approvals\/(\d+)/)[1]);
    const approval = await db.one('SELECT * FROM approvals WHERE id = $1', [approvalId]);
    assert.equal(approval.status, 'pending');
    assert.equal(approval.payload.source, 'template');
    assert.equal((await productBySku('DEMO-3')).seo_description, '', 'nothing is published before approval');

    const denied = await staff.adminPost(`/admin/approvals/${approvalId}`, { decision: 'approve' });
    assert.equal(denied.status, 403);

    const manager = new Client(server.base);
    await manager.login('manager@store.local', 'Demo-Manager-2026');
    const approved = await manager.adminPost(`/admin/approvals/${approvalId}`, { decision: 'approve' });
    assert.equal(approved.status, 302);
    const updated = await productBySku('DEMO-3');
    assert.equal(updated.seo_description, approval.payload.fields.seo_description);
    const logged = await db.many(`SELECT actor_type, action FROM audit_log WHERE entity = 'approval' AND entity_id = $1 ORDER BY id`, [String(approvalId)]);
    assert.deepEqual(logged.map((l) => `${l.actor_type}:${l.action}`), ['ai:approval.request', 'user:approval.approve']);
  });

  test('payments and refunds: staff cannot mark paid; refund needs approval', async () => {
    const order = await placeOrder('07755555555');
    const staff = new Client(server.base);
    await staff.login('staff@store.local', 'Demo-Staff-2026');
    assert.equal((await staff.adminPost(`/admin/orders/${order.id}/payment`, { payment_status: 'paid' })).status, 403);

    const manager = new Client(server.base);
    await manager.login('manager@store.local', 'Demo-Manager-2026');
    await manager.adminPost(`/admin/orders/${order.id}/payment`, { payment_status: 'paid', note: 'تحويل 123' });
    assert.equal((await db.one('SELECT payment_status FROM orders WHERE id = $1', [order.id])).payment_status, 'paid');

    const refund = await manager.adminPost(`/admin/orders/${order.id}/refund`, { reason: 'منتج تالف' });
    const approvalId = Number(refund.location.match(/approvals\/(\d+)/)[1]);
    assert.equal((await db.one('SELECT payment_status FROM orders WHERE id = $1', [order.id])).payment_status, 'refund_pending');
    await manager.adminPost(`/admin/approvals/${approvalId}`, { decision: 'reject', note: 'غير مؤهل' });
    assert.equal((await db.one('SELECT payment_status FROM orders WHERE id = $1', [order.id])).payment_status, 'paid');
  });

  test('order status follows allowed transitions and cancelling restocks', async () => {
    const before = (await productBySku('DEMO-5')).stock;
    const order = await placeOrder('07766666666');
    const staff = new Client(server.base);
    await staff.login('staff@store.local', 'Demo-Staff-2026');
    const skip = await staff.adminPost(`/admin/orders/${order.id}/status`, { status: 'delivered' });
    assert.match(decodeURIComponent(skip.location), /لا يمكن نقل الطلب/);
    await staff.adminPost(`/admin/orders/${order.id}/status`, { status: 'cancelled' });
    assert.equal((await productBySku('DEMO-5')).stock, before);
  });

  test('uploaded images are stored in the database and served with their type', async () => {
    const owner = new Client(server.base);
    await owner.login('owner@store.local', 'Demo-Owner-2026');
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
    const form = new FormData();
    form.append('_csrf', owner.csrf);
    form.append('images', new Blob([png], { type: 'image/png' }), 'photo.png');
    form.append('images', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
    const res = await fetch(`${server.base}/admin/products/1/images`, {
      method: 'POST', body: form, redirect: 'manual', headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    assert.equal(res.status, 302);
    const images = await db.many(`SELECT url FROM product_images WHERE product_id = 1 AND url LIKE '/uploads/%'`);
    assert.equal(images.length, 1, 'the HTML file is rejected');
    assert.match(images[0].url, /\.png$/);
    const served = await fetch(server.base + images[0].url);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
  });

  test('every admin page renders for the owner', async () => {
    const owner = new Client(server.base);
    await owner.login('owner@store.local', 'Demo-Owner-2026');
    const pages = ['/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/products/1', '/admin/customers',
      '/admin/customers/1', '/admin/conversations', '/admin/conversations/1', '/admin/approvals', '/admin/approvals/1',
      '/admin/marketing', '/admin/alerts', '/admin/outbox', '/admin/audit', '/admin/settings', '/admin/users', '/admin/orders/1'];
    for (const path of pages) {
      const res = await owner.get(path);
      assert.equal(res.status, 200, `${path} → ${res.status}`);
    }
  });
});

describe('automation and WhatsApp', () => {
  test('abandoned carts with a phone get one reminder, held as skipped while WhatsApp is not connected', async () => {
    const product = await productBySku('DEMO-6');
    const { visitor, csrf } = await visitorWithCart(server.base, product.id, 1);
    await visitor.post('/cart/contact', { _csrf: csrf, phone: '07777777777' });
    await db.query(`UPDATE carts SET updated_at = now() - interval '5 hours' WHERE contact_phone = '9647777777777'`);

    await runOnce();
    await runOnce();
    const messages = await db.many(`SELECT * FROM outbox WHERE purpose = 'abandoned_cart' AND recipient = '9647777777777'`);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].status, 'skipped');
    assert.match(messages[0].body, /\/cart\/open\//);
  });

  test('the cron route runs the jobs only with the right secret and is off without one', async () => {
    const client = new Client(server.base);
    assert.equal((await client.get('/cron/automation')).status, 404);
    Object.assign(config.automation, { cronSecret: 'test-cron-secret', enabled: true });
    try {
      assert.equal((await client.request('/cron/automation', { headers: { authorization: 'Bearer wrong' } })).status, 404);
      const res = await client.request('/cron/automation', { headers: { authorization: 'Bearer test-cron-secret' } });
      assert.equal(res.status, 200);
      assert.ok('abandonedCarts' in res.json());
    } finally {
      Object.assign(config.automation, { cronSecret: '', enabled: false });
    }
  });

  test('incoming WhatsApp messages are stored once, linked to a customer, and answered', async () => {
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '9647500000001', profile: { name: 'خالد' } }],
        messages: [{ from: '9647500000001', id: 'wamid.1', type: 'text', text: { body: 'عندكم عطر؟' } }],
      } }] }],
    };
    await handleWhatsApp(payload);
    await handleWhatsApp(payload); // Meta retry
    const conversation = await db.one(`SELECT * FROM conversations WHERE channel = 'whatsapp' AND external_id = '9647500000001'`);
    const messages = await db.many('SELECT role FROM messages WHERE conversation_id = $1 ORDER BY id', [conversation.id]);
    assert.deepEqual(messages.map((m) => m.role), ['customer', 'bot']);
    const customer = await db.one('SELECT * FROM customers WHERE id = $1', [conversation.customer_id]);
    assert.equal(customer.name, 'خالد');
    assert.equal(customer.source, 'whatsapp');
  });

  test('webhook verification handshake rejects a wrong token', async () => {
    const res = await new Client(server.base).get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1');
    assert.equal(res.status, 403);
  });
});
