import { config } from '../config.js';

export function slugify(text) {
  const slug = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `item-${Date.now().toString(36)}`;
}

// Arabic-Indic and Persian digits → ASCII, then keep digits and a leading +.
export function normalizePhone(input) {
  if (!input) return null;
  const ascii = String(input)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const digits = ascii.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  let bare = digits.replace(/^\+/, '').replace(/^00/, '');
  if (config.defaultCountryCode && /^0[1-9]/.test(bare) && !digits.startsWith('+')) {
    bare = config.defaultCountryCode + bare.slice(1);
  }
  return bare.length >= 7 && bare.length <= 15 ? bare : null;
}

export function normalizeEmail(input) {
  const email = String(input ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function formatMoney(amount, currency) {
  const value = Number(amount ?? 0);
  const digits = { KWD: 3, BHD: 3, OMR: 3, IQD: 0 }[currency] ?? 2;
  return `${value.toLocaleString('ar', { minimumFractionDigits: 0, maximumFractionDigits: digits })} ${currencyLabel(currency)}`;
}

const CURRENCY_LABELS = {
  SAR: 'ر.س', KWD: 'د.ك', AED: 'د.إ', QAR: 'ر.ق', BHD: 'د.ب', OMR: 'ر.ع', IQD: 'د.ع', USD: '$',
};

export function currencyLabel(currency) {
  return CURRENCY_LABELS[currency] ?? currency;
}

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

export const ORDER_STATUS = {
  new: 'جديد',
  confirmed: 'مؤكد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

export const PAYMENT_STATUS = {
  unpaid: 'غير مدفوع',
  paid: 'مدفوع',
  failed: 'فشل الدفع',
  refund_pending: 'استرجاع بانتظار الموافقة',
  refunded: 'مسترجع',
};

export const PAYMENT_METHODS = {
  cod: 'الدفع عند الاستلام',
  bank_transfer: 'تحويل بنكي',
  online: 'دفع إلكتروني',
};

export const CONVERSATION_LABELS = {
  new: 'جديدة',
  interested: 'مهتم',
  lead: 'عميل محتمل',
  confirmed_order: 'طلب مؤكد',
  follow_up: 'متابعة',
  complaint: 'شكوى',
  needs_human: 'تحتاج موظف',
};

export const CHANNELS = {
  web: 'الموقع',
  whatsapp: 'واتساب',
  messenger: 'ماسنجر',
  instagram: 'انستقرام',
};

export const GOVERNORATES = ['بغداد', 'البصرة', 'نينوى', 'أربيل', 'النجف', 'كربلاء', 'بابل', 'ذي قار', 'ميسان', 'واسط', 'القادسية', 'المثنى', 'ديالى', 'الأنبار', 'صلاح الدين', 'كركوك', 'السليمانية', 'دهوك'];

/** An Iraqi mobile number after normalizePhone: 964 7X XXXXXXXX. */
export const isIraqiMobile = (phone) => /^9647[3-9]\d{8}$/.test(phone ?? '');
