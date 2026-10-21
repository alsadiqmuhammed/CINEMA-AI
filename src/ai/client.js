import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client = null;

export function aiEnabled() {
  return Boolean(config.ai.apiKey);
}

export function anthropic() {
  if (!aiEnabled()) return null;
  client ??= new Anthropic({ apiKey: config.ai.apiKey, timeout: 60_000, maxRetries: 2 });
  return client;
}

/**
 * One Messages API call. Server-side refusal fallback is on so a declined
 * request is retried on a fallback model inside the same call.
 */
export function createMessage(params) {
  return anthropic().beta.messages.create({
    model: config.ai.model,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...params,
  });
}

export function textOf(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
