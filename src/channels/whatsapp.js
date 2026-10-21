import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// WhatsApp Business Cloud API (official Meta API).
const wa = config.whatsapp;

export const whatsapp = {
  name: 'whatsapp',

  configured() {
    return Boolean(wa.token && wa.phoneNumberId);
  },

  /**
   * Sends free text, or an approved template when one is given. Meta only
   * allows free text inside 24 hours of the customer's last message.
   */
  async send({ to, text, template }) {
    const body = template
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: 'ar' } } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: true } };
    const response = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WhatsApp API ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response.json();
  },

  /** Checks X-Hub-Signature-256 against the raw request body. */
  verifySignature(rawBody, signatureHeader) {
    if (!wa.appSecret) return !config.isProduction;
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', wa.appSecret).update(rawBody).digest();
    const given = Buffer.from(signatureHeader.slice(7), 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  },

  /** Extracts incoming text messages from a webhook payload. */
  parseIncoming(payload) {
    const out = [];
    for (const entry of payload?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const names = Object.fromEntries((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? '']));
        for (const message of value.messages ?? []) {
          const text = message.type === 'text' ? message.text?.body
            : message.type === 'button' ? message.button?.text
              : message.type === 'interactive' ? (message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title)
                : null;
          out.push({ from: message.from, name: names[message.from] ?? '', id: message.id, text, type: message.type });
        }
      }
    }
    return out;
  },
};
