import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { db, pool, resetDatabase } from './helpers.js';
import * as conversations from '../src/services/conversations.js';
import * as customers from '../src/services/customers.js';

let victim;

before(async () => {
  await resetDatabase();
  victim = await customers.findOrCreate({ phone: '07711112222', email: 'sara@example.com', name: 'سارة' });
});
after(() => pool.end());

const chat = async (channel, externalId) => conversations.getOrCreate(channel, externalId);
const reload = (id) => db.one('SELECT * FROM conversations WHERE id = $1', [id]);

test('a website chat typing an existing customer\'s number is not attached to their record', async () => {
  const cv = await chat('web', 'visitor-a');
  const result = await conversations.captureContact(cv, { name: 'مهاجم', phone: '07711112222', interests: ['عطور'] });
  assert.equal(result.customer, null);
  const after = await reload(cv.id);
  assert.equal(after.customer_id, null);
  assert.equal(after.contact_unverified, true);
  assert.equal(after.contact_phone, '9647711112222');
  const record = await db.one('SELECT name, interests FROM customers WHERE id = $1', [victim.id]);
  assert.equal(record.name, 'سارة');
  assert.deepEqual(record.interests, []);
});

test('an existing customer\'s email cannot claim their record either', async () => {
  const cv = await chat('web', 'visitor-b');
  const result = await conversations.captureContact(cv, { phone: '07733334444', email: 'sara@example.com' });
  assert.equal(result.customer, null);
  assert.equal((await reload(cv.id)).customer_id, null);
  assert.equal(await db.one(`SELECT 1 FROM customers WHERE phone = '9647733334444'`), null);
});

test('a number the store has never seen still becomes a lead, marked unverified', async () => {
  const cv = await chat('web', 'visitor-c');
  const result = await conversations.captureContact(cv, { name: 'علي', phone: '07755556666', interests: ['ساعات'] });
  assert.ok(result.customer);
  assert.equal(result.verified, false);
  const after = await reload(cv.id);
  assert.equal(after.customer_id, result.customer.id);
  assert.equal(after.contact_unverified, true);
});

test('on WhatsApp the sender\'s own number links to their record', async () => {
  const cv = await chat('whatsapp', '9647711112222');
  const result = await conversations.captureContact(cv, { name: 'سارة' });
  assert.equal(result.verified, true);
  assert.equal(result.customer.id, victim.id);
  assert.equal((await reload(cv.id)).contact_unverified, false);
});

test('on WhatsApp, typing someone else\'s number does not link to them', async () => {
  const cv = await chat('whatsapp', '9647799990000');
  const result = await conversations.captureContact(cv, { phone: '07711112222' });
  assert.equal(result.customer, null);
  const after = await reload(cv.id);
  assert.notEqual(after.customer_id, victim.id);
  assert.equal(after.contact_unverified, true);
});
