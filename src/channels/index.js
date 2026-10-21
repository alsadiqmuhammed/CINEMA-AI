import { whatsapp } from './whatsapp.js';

// Messenger and Instagram adapters plug in here with the same interface (phase 2).
const CHANNELS = { whatsapp };

export function channelFor(name) {
  return CHANNELS[name] ?? null;
}

export function channelStatus() {
  return {
    web: true,
    whatsapp: whatsapp.configured(),
    messenger: false,
    instagram: false,
  };
}
