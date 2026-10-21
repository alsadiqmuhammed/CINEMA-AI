import { db } from '../db/pool.js';

export const DEFAULT_SETTINGS = {
  store_name: 'سوگ',
  store_tagline: 'كلشي تحتاجه، يوصلك لباب البيت',
  currency: 'IQD',
  shipping_fee: 5000,
  free_shipping_over: 100000,
  support_phone: '',
  support_email: '',
  bank_details: '',
  policies: {
    shipping: 'نوصلك خلال يوم أو يومين داخل بغداد، ومن 2 إلى 4 أيام لباقي المحافظات.',
    returns: 'إذا ما عجبك المنتج، تكدر ترجعه خلال 7 أيام من الاستلام بشرط يكون بحالته الأصلية. احجي ويانا بالمحادثة ونراجع الطلب ونرتب الرجعة وياك.',
    payment: 'تدفع نقداً للمندوب من يوصلك الطلب، وتكدر تفحصه قبل ما تدفع.',
    privacy: 'نستخدم معلوماتك حتى نوصل طلبك ونتواصل وياك بس، وما ننطيها لأي جهة للتسويق.',
  },
  brand_voice: 'ودود، واضح، ومختصر. نخاطب العميل باحترام ونتجنب المبالغة.',
};

let cache = null;

export async function getSettings() {
  if (cache) return cache;
  const rows = await db.many('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = {
    ...DEFAULT_SETTINGS,
    ...stored,
    policies: { ...DEFAULT_SETTINGS.policies, ...(stored.policies ?? {}) },
  };
  return cache;
}

export async function saveSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }
  cache = null;
}

export function clearSettingsCache() {
  cache = null;
}
