import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

// A stand-in for the Messages API: records requests and replies from a script.
const requests = [];
let script = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    const next = script.shift();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      stop_reason: next.stop_reason, stop_sequence: null, content: next.content,
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
});
await new Promise((resolve) => mock.listen(0, resolve));
process.env.TEST_AI_MOCK = '1';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;

const { db, pool, productBySku, resetDatabase } = await import('./helpers.js');
const { reply } = await import('../src/ai/assistant.js');
const { draftProductContent } = await import('../src/ai/content.js');
const conversations = await import('../src/services/conversations.js');
const products = await import('../src/services/products.js');

before(resetDatabase);
after(async () => {
  mock.close();
  await pool.end();
});

test('assistant runs catalog tools, then answers with a checkout link', async () => {
  const wallet = await productBySku('DEMO-5');
  script = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'search_products', input: { query: 'محفظة' } }] },
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tu_2', name: 'create_checkout_link', input: { items: [{ product_id: wallet.id, quantity: 1 }] } },
      { type: 'tool_use', id: 'tu_3', name: 'classify_conversation', input: { label: 'lead' } },
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'تفضل رابط الطلب' }] },
  ];
  const conversation = await conversations.getOrCreate('web', 'visitor-ai-1');
  await conversations.addMessage(conversation.id, 'customer', 'أبي محفظة');
  const answer = await reply(conversation);

  assert.equal(answer.text, 'تفضل رابط الطلب');
  assert.deepEqual(answer.actions.map((a) => a.type), ['checkout_link', 'label']);
  assert.equal(requests.length, 3);

  const first = requests[0];
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.match(first.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepEqual(first.body.thinking, { type: 'adaptive' });
  assert.ok(first.body.tools.every((t) => t.strict === true));
  assert.equal(first.body.tool_choice, undefined);

  // Tool results are returned together, in one user turn, after the assistant turn.
  const third = requests[2].body.messages;
  const results = third.at(-1).content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['tu_2', 'tu_3']);
  const searchResult = JSON.parse(requests[1].body.messages.at(-1).content[0].content);
  assert.ok(searchResult.some((p) => p.product_id === wallet.id));

  const cart = await db.one('SELECT * FROM carts ORDER BY id DESC LIMIT 1');
  assert.equal((await db.one('SELECT quantity FROM cart_items WHERE cart_id = $1', [cart.id])).quantity, 1);
  assert.equal((await db.one('SELECT label FROM conversations WHERE id = $1', [conversation.id])).label, 'lead');
});

test('invalid tool input is returned as an error instead of running the tool', async () => {
  requests.length = 0;
  script = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_x', name: 'create_checkout_link', input: { items: [] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'وش المنتج اللي تبيه؟' }] },
  ];
  const conversation = await conversations.getOrCreate('web', 'visitor-ai-2');
  await conversations.addMessage(conversation.id, 'customer', 'أبي أطلب');
  const before = (await db.one('SELECT COUNT(*)::int AS n FROM carts')).n;
  const answer = await reply(conversation);
  assert.equal(answer.text, 'وش المنتج اللي تبيه؟');
  assert.equal(requests[1].body.messages.at(-1).content[0].is_error, true);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM carts')).n, before);
});

test('a refusal hands the conversation to a person', async () => {
  script = [{ stop_reason: 'refusal', content: [] }];
  const conversation = await conversations.getOrCreate('web', 'visitor-ai-3');
  await conversations.addMessage(conversation.id, 'customer', 'سؤال');
  const answer = await reply(conversation);
  assert.equal(answer.actions[0].type, 'handoff');
  assert.equal((await db.one('SELECT mode FROM conversations WHERE id = $1', [conversation.id])).mode, 'human');
});

test('product drafts use structured output and land in the approval queue', async () => {
  requests.length = 0;
  const fields = { name: 'عطر مسك الليل 100 مل', description: 'وصف جديد', seo_title: 'عطر مسك', seo_description: 'وصف قصير', faq: [{ q: 'س', a: 'ج' }] };
  script = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(fields) }] }];
  const product = await products.getById((await productBySku('DEMO-1')).id);
  const approval = await draftProductContent(product);
  assert.equal(requests[0].body.output_config.format.type, 'json_schema');
  assert.equal(approval.status, 'pending');
  assert.equal(approval.payload.source, 'claude');
  assert.deepEqual(approval.payload.fields, fields);
  assert.equal((await productBySku('DEMO-1')).name, 'عطر مسك الليل');
});
