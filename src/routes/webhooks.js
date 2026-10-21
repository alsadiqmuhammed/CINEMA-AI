import express, { Router } from 'express';
import { config } from '../config.js';
import { reply } from '../ai/assistant.js';
import { whatsapp } from '../channels/whatsapp.js';
import * as alerts from '../services/alerts.js';
import * as conversations from '../services/conversations.js';
import * as customers from '../services/customers.js';

export const webhooks = Router();

// Meta's subscription handshake.
webhooks.get('/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken
      && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

webhooks.post('/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  if (!whatsapp.verifySignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  // Acknowledge immediately; Meta retries slow webhooks.
  res.sendStatus(200);
  handleWhatsApp(payload).catch(async (error) => {
    console.error('whatsapp webhook failed', error);
    await alerts.raise({
      kind: 'integration_error', severity: 'critical', message: `خطأ في معالجة رسائل واتساب: ${error.message}`, dedupeKey: 'whatsapp-webhook',
    }).catch(() => {});
  });
});

export async function handleWhatsApp(payload) {
  for (const incoming of whatsapp.parseIncoming(payload)) {
    const customer = await customers.findOrCreate({ phone: incoming.from, name: incoming.name, source: 'whatsapp' });
    const conversation = await conversations.getOrCreate('whatsapp', incoming.from, { customerId: customer?.id });
    const text = incoming.text ?? `[رسالة من نوع ${incoming.type}]`;
    const stored = await conversations.addMessage(conversation.id, 'customer', text, { externalId: `wa:${incoming.id}` });
    if (!stored) continue;
    const current = await conversations.find('whatsapp', incoming.from);
    if (current.mode !== 'bot') continue;
    if (!incoming.text) {
      await conversations.handoff(conversation.id, 'العميل أرسل وسائط أو رسالة غير نصية', { type: 'system' });
      continue;
    }
    const answer = await reply(current);
    if (!answer.text) continue;
    await conversations.addMessage(conversation.id, 'bot', answer.text);
    if (whatsapp.configured()) await whatsapp.send({ to: incoming.from, text: answer.text });
  }
}
