const env = process.env;

function int(name, fallback) {
  const value = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProduction: env.NODE_ENV === 'production',
  port: int('PORT', 3000),
  secret: env.APP_SECRET ?? 'dev-only-secret-change-me',
  // Render sets RENDER_EXTERNAL_URL to the service's public address; Vercel sets the production host without a scheme.
  baseUrl: (env.APP_BASE_URL || env.RENDER_EXTERNAL_URL
    || (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL ?? 'postgres://store:store@localhost:5432/store',
  databaseSsl: env.DATABASE_SSL ?? '',
  // Local numbers starting with 0 are stored in international form (needed by WhatsApp): 07XX… → 9647XX…
  defaultCountryCode: (env.DEFAULT_COUNTRY_CODE ?? '964').replace(/\D/g, ''),

  ai: {
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    model: env.AI_MODEL ?? 'claude-opus-5-5',
    chatRequestsPerHour: int('AI_CHAT_REQUESTS_PER_HOUR', 60),
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
    appSecret: env.WHATSAPP_APP_SECRET ?? '',
    apiVersion: env.WHATSAPP_API_VERSION ?? 'v21.0',
    // Messages outside the 24h customer-service window must use an approved template.
    abandonedCartTemplate: env.WHATSAPP_TEMPLATE_ABANDONED_CART ?? '',
    reviewRequestTemplate: env.WHATSAPP_TEMPLATE_REVIEW_REQUEST ?? '',
  },

  automation: {
    enabled: env.AUTOMATION_ENABLED !== 'false',
    // Vercel Cron sends this as a Bearer token; the cron route stays off while it is unset.
    cronSecret: env.CRON_SECRET ?? '',
    intervalMinutes: int('AUTOMATION_INTERVAL_MINUTES', 5),
    abandonedCartHours: int('ABANDONED_CART_HOURS', 3),
    orderDelayHours: int('ORDER_DELAY_HOURS', 48),
    reviewRequestDays: int('REVIEW_REQUEST_DAYS', 3),
    vipThreshold: int('VIP_LIFETIME_VALUE', 500000),
  },
};
