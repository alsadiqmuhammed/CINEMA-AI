import { Router } from 'express';
import { config } from '../config.js';
import { reply } from '../ai/assistant.js';
import { token } from '../lib/auth.js';
import { RateLimiter } from '../lib/rate-limit.js';
import * as conversations from '../services/conversations.js';

export const api = Router();

const VISITOR_COOKIE = 'store_visitor';
const MAX_MESSAGE = 1000;
const limiter = new RateLimiter({ limit: config.ai.chatRequestsPerHour, windowMs: 3_600_000 });

function visitorId(req, res) {
  let id = req.cookies[VISITOR_COOKIE];
  if (!id || !/^[\w-]{16,64}$/.test(id)) {
    id = token(18);
    res.cookie(VISITOR_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 180 * 86_400_000, path: '/' });
  }
  return id;
}

// Messages for the web chat widget. Staff replies arrive through polling.
api.get('/chat', async (req, res) => {
  const conversation = await conversations.find('web', visitorId(req, res));
  if (!conversation) return res.json({ messages: [], mode: 'bot' });
  const items = await conversations.messages(conversation.id, { afterId: Number(req.query.after) || 0 });
  res.json({ messages: items.filter((m) => m.role !== 'system'), mode: conversation.mode });
});

api.post('/chat', async (req, res) => {
  // JSON body + same-origin check stands in for a CSRF token here.
  const origin = req.get('origin');
  if (origin && origin !== config.baseUrl && new URL(origin).host !== req.get('host')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const text = String(req.body?.message ?? '').trim().slice(0, MAX_MESSAGE);
  if (!text) return res.status(400).json({ error: 'الرسالة فارغة' });
  const visitor = visitorId(req, res);
  if (!limiter.take(`${visitor}:${req.ip}`)) {
    return res.status(429).json({ error: 'رسائل كثيرة، حاول بعد قليل.' });
  }

  const conversation = await conversations.getOrCreate('web', visitor);
  const customerMessage = await conversations.addMessage(conversation.id, 'customer', text);
  const current = await conversations.find('web', visitor);
  if (current.mode === 'human') {
    return res.json({ messages: [customerMessage], mode: 'human' });
  }
  const answer = await reply(current);
  const out = [customerMessage];
  if (answer.text) out.push(await conversations.addMessage(conversation.id, 'bot', answer.text));
  const after = await conversations.find('web', visitor);
  res.json({ messages: out, mode: after.mode, actions: answer.actions });
});
