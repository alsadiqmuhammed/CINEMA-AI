import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { draftAdCampaign, draftProductContent } from '../ai/content.js';
import { aiEnabled } from '../ai/client.js';
import { channelFor, channelStatus } from '../channels/index.js';
import { audit, userActor } from '../lib/audit.js';
import {
  can, createSession, destroySession, hashPassword, loadSession, SESSION_COOKIE, verifyPassword,
} from '../lib/auth.js';
import { RateLimiter } from '../lib/rate-limit.js';
import * as alerts from '../services/alerts.js';
import * as approvals from '../services/approvals.js';
import * as conversations from '../services/conversations.js';
import * as customers from '../services/customers.js';
import * as orders from '../services/orders.js';
import * as outbox from '../services/outbox.js';
import * as products from '../services/products.js';
import * as uploads from '../services/uploads.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { dashboardStats } from '../services/stats.js';
import * as views from '../views/admin.js';

export const admin = Router();

const loginLimiter = new RateLimiter({ limit: 10, windowMs: 15 * 60_000 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype in uploads.IMAGE_TYPES),
});

const list = (value) => String(value ?? '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
const ids = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(Number).filter(Number.isInteger);

async function page(req, res, title, body, status = 200) {
  const settings = await getSettings();
  const counts = req.user ? await sidebarCounts() : {};
  const flash = req.query.ok ? { message: req.query.ok, type: 'ok' } : req.query.err ? { message: req.query.err, type: 'error' } : null;
  res.status(status).type('html').send(views.layout({ user: req.user, title, body, path: (req.baseUrl + req.path).replace(/\/$/, ''), counts, flash, settings }));
}

async function sidebarCounts() {
  const row = await db.one(`SELECT
    (SELECT COUNT(*) FROM approvals WHERE status = 'pending')::int AS approvals,
    (SELECT COUNT(*) FROM conversations WHERE mode = 'human')::int AS handoffs,
    (SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL)::int AS alerts`);
  return row;
}

const back = (res, path, message, isError = false) => res.redirect(`${path}?${isError ? 'err' : 'ok'}=${encodeURIComponent(message)}`);

// --- authentication ---

admin.get('/login', async (req, res) => {
  await page(req, res, 'تسجيل الدخول', views.login({ next: req.query.next }));
});

admin.post('/login', async (req, res) => {
  const key = `${req.ip}:${String(req.body.email ?? '').toLowerCase()}`;
  if (!loginLimiter.take(key)) {
    return page(req, res, 'تسجيل الدخول', views.login({ error: 'محاولات كثيرة. حاول بعد 15 دقيقة.' }), 429);
  }
  const user = await db.one('SELECT * FROM users WHERE email = $1 AND active', [String(req.body.email ?? '').trim().toLowerCase()]);
  if (!user || !(await verifyPassword(String(req.body.password ?? ''), user.password_hash))) {
    return page(req, res, 'تسجيل الدخول', views.login({ error: 'البريد أو كلمة المرور غير صحيحة', next: req.body.next }), 401);
  }
  const session = await createSession(user.id);
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true, sameSite: 'strict', secure: config.isProduction, maxAge: session.maxAgeMs, path: '/admin',
  });
  await audit({ actor: userActor(user), action: 'user.login', entity: 'user', entityId: user.id });
  const next = String(req.body.next ?? '');
  res.redirect(next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin');
});

// Everything below requires a signed-in user; POSTs require the session's CSRF token.
admin.use(async (req, res, next) => {
  req.user = await loadSession(req.cookies[SESSION_COOKIE]);
  if (!req.user) return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
});

function checkCsrf(req, res, next) {
  if (req.method === 'POST' && req.body?._csrf !== req.user.csrf_token) {
    return res.status(403).send('رمز الحماية غير صالح. حدّث الصفحة وحاول مرة أخرى.');
  }
  next();
}

// Multipart forms are parsed before the CSRF check so the token in the body is readable.
admin.post('/products/:id/images', upload.array('images', 10), checkCsrf, async (req, res) => {
  requirePermission(req, 'products.write');
  for (const file of req.files ?? []) {
    await products.addImage(Number(req.params.id), await uploads.saveImage(file.buffer, file.mimetype));
  }
  back(res, `/admin/products/${req.params.id}`, `تم رفع ${req.files?.length ?? 0} صورة`);
});

admin.use(checkCsrf);

class Forbidden extends Error {}
function requirePermission(req, permission) {
  if (!can(req.user, permission)) throw new Forbidden('ليست لديك صلاحية لهذا الإجراء');
}

admin.post('/logout', async (req, res) => {
  await destroySession(req.user.session_id);
  res.clearCookie(SESSION_COOKIE, { path: '/admin' });
  res.redirect('/admin/login');
});

// --- dashboard ---

admin.get('/', async (req, res) => {
  const settings = await getSettings();
  const data = await dashboardStats();
  await page(req, res, 'لوحة الأداء', views.dashboard({
    settings, ...data, alerts: await alerts.listOpen(8), channels: channelStatus(), aiEnabled: aiEnabled(),
  }));
});

// --- orders ---

admin.get('/orders', async (req, res) => {
  const filters = { status: req.query.status, payment: req.query.payment, q: req.query.q };
  await page(req, res, 'الطلبات', views.orders({ settings: await getSettings(), list: await orders.list(filters), filters }));
});

admin.get('/orders/:id', async (req, res) => {
  const order = await orders.get(Number(req.params.id));
  if (!order) return page(req, res, 'غير موجود', views.message({ text: 'الطلب غير موجود', back: '/admin/orders' }), 404);
  await page(req, res, `طلب #${order.number}`, views.order({
    settings: await getSettings(), user: req.user, order, nextStatuses: orders.nextStatuses(order.status),
  }));
});

admin.post('/orders/:id/status', async (req, res) => {
  requirePermission(req, 'orders.write');
  const path = `/admin/orders/${req.params.id}`;
  try {
    await orders.updateStatus(Number(req.params.id), req.body.status, { actor: userActor(req.user), trackingNumber: req.body.tracking_number });
    back(res, path, 'تم تحديث الحالة');
  } catch (error) {
    if (!(error instanceof orders.OrderError)) throw error;
    back(res, path, error.message, true);
  }
});

admin.post('/orders/:id/payment', async (req, res) => {
  requirePermission(req, 'payments.write');
  const path = `/admin/orders/${req.params.id}`;
  try {
    await orders.setPaymentStatus(Number(req.params.id), req.body.payment_status, { actor: userActor(req.user), note: req.body.note });
    back(res, path, 'تم تحديث حالة الدفع');
  } catch (error) {
    if (!(error instanceof orders.OrderError)) throw error;
    back(res, path, error.message, true);
  }
});

admin.post('/orders/:id/refund', async (req, res) => {
  requirePermission(req, 'payments.write');
  try {
    const approval = await orders.requestRefund(Number(req.params.id), { actor: userActor(req.user), reason: req.body.reason });
    back(res, `/admin/approvals/${approval.id}`, 'تم إنشاء طلب الاسترجاع، ينتظر الموافقة');
  } catch (error) {
    if (!(error instanceof orders.OrderError)) throw error;
    back(res, `/admin/orders/${req.params.id}`, error.message, true);
  }
});

// --- products ---

admin.get('/products', async (req, res) => {
  const filters = { q: req.query.q, status: req.query.status };
  await page(req, res, 'المنتجات', views.products({ settings: await getSettings(), list: await products.listAll(filters), filters }));
});

admin.get('/products/new', async (req, res) => {
  await page(req, res, 'منتج جديد', views.productForm({ user: req.user, categories: await products.categories() }));
});

async function productFields(body) {
  let categoryId = body.category_id ? Number(body.category_id) : null;
  if (String(body.new_category ?? '').trim()) categoryId = (await products.createCategory(body.new_category.trim())).id;
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return {
    name: String(body.name ?? '').trim(),
    sku: String(body.sku ?? '').trim() || null,
    description: String(body.description ?? '').trim(),
    seo_title: String(body.seo_title ?? '').trim(),
    seo_description: String(body.seo_description ?? '').trim(),
    category_id: categoryId,
    price: num(body.price) ?? 0,
    compare_at_price: num(body.compare_at_price),
    stock: Math.max(0, Math.trunc(num(body.stock) ?? 0)),
    low_stock_at: Math.max(0, Math.trunc(num(body.low_stock_at) ?? 5)),
    status: ['draft', 'active', 'archived'].includes(body.status) ? body.status : 'draft',
    tags: list(body.tags),
    faq: String(body.faq ?? '').split('\n').map((line) => line.split('|')).filter((parts) => parts.length >= 2 && parts[0].trim())
      .map(([q, ...a]) => ({ q: q.trim(), a: a.join('|').trim() })),
  };
}

admin.post('/products', async (req, res) => {
  requirePermission(req, 'products.write');
  const fields = await productFields(req.body);
  if (!fields.name) return back(res, '/admin/products/new', 'اسم المنتج مطلوب', true);
  try {
    const product = await products.saveProduct({ ...fields, actor: userActor(req.user) });
    back(res, `/admin/products/${product.id}`, 'تمت إضافة المنتج. أضف الصور الآن.');
  } catch (error) {
    if (error.code === '23505') return back(res, '/admin/products/new', 'رمز SKU مستخدم لمنتج آخر', true);
    throw error;
  }
});

admin.get('/products/:id', async (req, res) => {
  const product = await products.getById(Number(req.params.id));
  if (!product) return page(req, res, 'غير موجود', views.message({ text: 'المنتج غير موجود', back: '/admin/products' }), 404);
  await page(req, res, product.name, views.productForm({
    user: req.user,
    product,
    categories: await products.categories(),
    allProducts: await products.listAll({ status: 'active' }),
    relations: await products.relationIds(product.id),
    aiEnabled: aiEnabled(),
  }));
});

admin.post('/products/:id', async (req, res) => {
  requirePermission(req, 'products.write');
  const id = Number(req.params.id);
  const fields = await productFields(req.body);
  if (!fields.name) return back(res, `/admin/products/${id}`, 'اسم المنتج مطلوب', true);
  try {
    await products.saveProduct({ id, ...fields, actor: userActor(req.user) });
  } catch (error) {
    if (error.code === '23505') return back(res, `/admin/products/${id}`, 'رمز SKU مستخدم لمنتج آخر', true);
    throw error;
  }
  await products.setRelations(id, 'complement', ids(req.body.complements));
  await products.setRelations(id, 'alternative', ids(req.body.alternatives));
  if (fields.stock > fields.low_stock_at) await alerts.resolveByKey(`low-stock-${id}`);
  back(res, `/admin/products/${id}`, 'تم الحفظ');
});

admin.post('/products/:id/images/:imageId/delete', async (req, res) => {
  requirePermission(req, 'products.write');
  const removed = await products.removeImage(Number(req.params.id), Number(req.params.imageId));
  await uploads.removeByUrl(removed?.url);
  back(res, `/admin/products/${req.params.id}`, 'تم حذف الصورة');
});

admin.post('/products/:id/draft', async (req, res) => {
  requirePermission(req, 'products.write');
  const product = await products.getById(Number(req.params.id));
  if (!product) return back(res, '/admin/products', 'المنتج غير موجود', true);
  try {
    const approval = await draftProductContent(product, { notes: String(req.body.notes ?? '').slice(0, 1000) });
    back(res, `/admin/approvals/${approval.id}`, 'المسودة جاهزة للمراجعة');
  } catch (error) {
    console.error('draft failed', error);
    back(res, `/admin/products/${product.id}`, `تعذر إنشاء المسودة: ${error.message}`, true);
  }
});

// --- customers / CRM ---

admin.get('/customers', async (req, res) => {
  const filters = { q: req.query.q, segment: req.query.segment ?? 'all', source: req.query.source, interest: req.query.interest };
  await page(req, res, 'العملاء', views.customers({
    settings: await getSettings(),
    list: await customers.list({ ...filters, vipThreshold: config.automation.vipThreshold }),
    filters,
    sources: await customers.sources(),
  }));
});

admin.get('/customers/:id', async (req, res) => {
  const customer = await customers.get(Number(req.params.id));
  if (!customer) return page(req, res, 'غير موجود', views.message({ text: 'العميل غير موجود', back: '/admin/customers' }), 404);
  await page(req, res, customer.name || 'عميل', views.customer({ settings: await getSettings(), user: req.user, customer }));
});

admin.post('/customers/:id', async (req, res) => {
  requirePermission(req, 'customers.write');
  const id = Number(req.params.id);
  await customers.update(id, {
    name: String(req.body.name ?? '').trim(),
    notes: String(req.body.notes ?? ''),
    tags: list(req.body.tags),
    interests: list(req.body.interests),
    marketing_opt_in: req.body.marketing_opt_in === '1',
  });
  await audit({ actor: userActor(req.user), action: 'customer.update', entity: 'customer', entityId: id });
  back(res, `/admin/customers/${id}`, 'تم الحفظ');
});

// --- conversations ---

admin.get('/conversations', async (req, res) => {
  const filters = { mode: req.query.mode, label: req.query.label };
  await page(req, res, 'المحادثات', views.conversations({ list: await conversations.inbox(filters), filters }));
});

admin.get('/conversations/:id', async (req, res) => {
  const conversation = await conversations.get(Number(req.params.id));
  if (!conversation) return page(req, res, 'غير موجود', views.message({ text: 'المحادثة غير موجودة', back: '/admin/conversations' }), 404);
  await page(req, res, `محادثة #${conversation.id}`, views.conversation({ user: req.user, conversation }));
});

admin.post('/conversations/:id/reply', async (req, res) => {
  requirePermission(req, 'conversations.write');
  const id = Number(req.params.id);
  const conversation = await conversations.get(id);
  const content = String(req.body.content ?? '').trim();
  if (!conversation || !content) return back(res, `/admin/conversations/${id}`, 'الرسالة فارغة', true);
  // A staff reply means a person owns the conversation now.
  if (conversation.mode === 'bot') await conversations.setMode(id, 'human', userActor(req.user));
  if (conversation.channel !== 'web') {
    const channel = channelFor(conversation.channel);
    if (!channel?.configured()) return back(res, `/admin/conversations/${id}`, 'القناة غير مربوطة، تعذر الإرسال', true);
    try {
      await channel.send({ to: conversation.external_id, text: content });
    } catch (error) {
      return back(res, `/admin/conversations/${id}`, `تعذر الإرسال: ${error.message}`, true);
    }
  }
  await conversations.addMessage(id, 'staff', content, { authorId: req.user.id });
  await audit({ actor: userActor(req.user), action: 'conversation.reply', entity: 'conversation', entityId: id });
  back(res, `/admin/conversations/${id}`, 'تم الإرسال');
});

admin.post('/conversations/:id/mode', async (req, res) => {
  requirePermission(req, 'conversations.write');
  if (!['bot', 'human', 'closed'].includes(req.body.mode)) return back(res, `/admin/conversations/${req.params.id}`, 'وضع غير صحيح', true);
  await conversations.setMode(Number(req.params.id), req.body.mode, userActor(req.user));
  back(res, `/admin/conversations/${req.params.id}`, 'تم التحديث');
});

admin.post('/conversations/:id/label', async (req, res) => {
  requirePermission(req, 'conversations.write');
  await conversations.setLabel(Number(req.params.id), req.body.label, userActor(req.user));
  back(res, `/admin/conversations/${req.params.id}`, 'تم التصنيف');
});

// --- approvals ---

admin.get('/approvals', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  await page(req, res, 'الموافقات', views.approvals({ list: await approvals.list(status), status }));
});

admin.get('/approvals/:id', async (req, res) => {
  const approval = await approvals.get(Number(req.params.id));
  if (!approval) return page(req, res, 'غير موجود', views.message({ text: 'الطلب غير موجود', back: '/admin/approvals' }), 404);
  await page(req, res, approval.title, views.approval({ user: req.user, approval, settings: await getSettings() }));
});

admin.post('/approvals/:id', async (req, res) => {
  requirePermission(req, 'approvals.decide');
  const id = Number(req.params.id);
  try {
    await approvals.decide(id, { approve: req.body.decision === 'approve', user: req.user, note: req.body.note });
    if (req.body.decision === 'approve') await outbox.deliverPending().catch(() => {});
    back(res, `/admin/approvals/${id}`, req.body.decision === 'approve' ? 'تمت الموافقة' : 'تم الرفض');
  } catch (error) {
    if (!(error instanceof approvals.ApprovalError)) throw error;
    back(res, `/admin/approvals/${id}`, error.message, true);
  }
});

// --- marketing ---

admin.get('/marketing', async (req, res) => {
  const segmentCounts = {};
  for (const segment of ['all', 'vip', 'repeat', 'inactive', 'no_order', 'opted_in']) {
    segmentCounts[segment] = (await customers.list({ segment, vipThreshold: config.automation.vipThreshold }))
      .filter((c) => c.marketing_opt_in && c.phone).length;
  }
  await page(req, res, 'التسويق', views.marketing({
    user: req.user,
    settings: await getSettings(),
    products: await products.listAll({ status: 'active' }),
    campaigns: await db.many(`SELECT * FROM approvals WHERE kind = 'ad_campaign' ORDER BY created_at DESC LIMIT 50`),
    segmentCounts,
  }));
});

admin.post('/marketing/campaign', async (req, res) => {
  requirePermission(req, 'products.write');
  const chosen = [];
  for (const id of ids(req.body.product_ids).slice(0, 10)) {
    const product = await products.getById(id);
    if (product) chosen.push(product);
  }
  const budget = Number(req.body.budget);
  if (!chosen.length || !(budget > 0) || !String(req.body.goal ?? '').trim()) {
    return back(res, '/admin/marketing', 'اختر المنتجات واكتب الهدف والميزانية', true);
  }
  try {
    const approval = await draftAdCampaign({ goal: req.body.goal.trim().slice(0, 300), budget, products: chosen, user: req.user });
    back(res, `/admin/approvals/${approval.id}`, 'الحملة المقترحة جاهزة للمراجعة');
  } catch (error) {
    console.error('campaign draft failed', error);
    back(res, '/admin/marketing', `تعذر اقتراح الحملة: ${error.message}`, true);
  }
});

admin.post('/marketing/broadcast', async (req, res) => {
  requirePermission(req, 'customers.write');
  const body = String(req.body.body ?? '').trim();
  if (!body) return back(res, '/admin/marketing', 'نص الرسالة مطلوب', true);
  const segment = req.body.segment in customers.SEGMENTS ? req.body.segment : 'opted_in';
  const recipients = (await customers.list({ segment, vipThreshold: config.automation.vipThreshold }))
    .filter((c) => c.marketing_opt_in && c.phone);
  if (!recipients.length) return back(res, '/admin/marketing', 'لا يوجد عملاء موافقون على التسويق في هذه الشريحة', true);
  const approval = await approvals.create({
    kind: 'broadcast',
    title: `رسالة جماعية لشريحة "${customers.SEGMENTS[segment]}" (${recipients.length} عميل)`,
    payload: { segment, body: body.slice(0, 1000), template: String(req.body.template ?? '').trim() || null, customer_ids: recipients.map((c) => c.id) },
    requestedBy: `user:${req.user.id}`,
  });
  back(res, `/admin/approvals/${approval.id}`, 'أُرسلت الرسالة للموافقة');
});

// --- alerts, outbox, audit ---

admin.get('/alerts', async (req, res) => {
  await page(req, res, 'التنبيهات', views.alerts({ user: req.user, list: await alerts.listOpen() }));
});

admin.post('/alerts/:id/resolve', async (req, res) => {
  await alerts.resolve(Number(req.params.id));
  await audit({ actor: userActor(req.user), action: 'alert.resolve', entity: 'alert', entityId: req.params.id });
  back(res, '/admin/alerts', 'تم');
});

admin.get('/outbox', async (req, res) => {
  await page(req, res, 'الرسائل الصادرة', views.outbox({ list: await outbox.recent() }));
});

admin.get('/audit', async (req, res) => {
  requirePermission(req, 'audit.read');
  const filters = { actor: req.query.actor, action: req.query.action };
  const where = [];
  const params = [];
  if (filters.actor) {
    params.push(filters.actor);
    where.push(`actor_type = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    where.push(`action LIKE $${params.length} || '%'`);
  }
  const entries = await db.many(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 300`, params);
  await page(req, res, 'سجل التدقيق', views.audit({ list: entries, filters }));
});

// --- settings & users ---

admin.get('/settings', async (req, res) => {
  requirePermission(req, 'settings.write');
  await page(req, res, 'الإعدادات', views.settingsPage({ user: req.user, settings: await getSettings() }));
});

admin.post('/settings', async (req, res) => {
  requirePermission(req, 'settings.write');
  const b = req.body;
  const text = (v) => String(v ?? '').trim();
  await saveSettings({
    store_name: text(b.store_name) || 'سوگ',
    store_tagline: text(b.store_tagline),
    currency: ['IQD', 'USD', 'SAR', 'KWD', 'AED', 'QAR', 'BHD', 'OMR'].includes(b.currency) ? b.currency : 'IQD',
    shipping_fee: Math.max(0, Number(b.shipping_fee) || 0),
    free_shipping_over: Math.max(0, Number(b.free_shipping_over) || 0),
    support_phone: text(b.support_phone),
    support_email: text(b.support_email),
    bank_details: text(b.bank_details),
    brand_voice: text(b.brand_voice),
    policies: { shipping: text(b.policy_shipping), returns: text(b.policy_returns), payment: text(b.policy_payment), privacy: text(b.policy_privacy) },
  });
  await audit({ actor: userActor(req.user), action: 'settings.update' });
  back(res, '/admin/settings', 'تم حفظ الإعدادات');
});

admin.get('/users', async (req, res) => {
  requirePermission(req, 'users.write');
  await page(req, res, 'المستخدمون', views.users({ user: req.user, list: await db.many('SELECT id, name, email, role, active FROM users ORDER BY id') }));
});

admin.post('/users', async (req, res) => {
  requirePermission(req, 'users.write');
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  if (password.length < 10) return back(res, '/admin/users', 'كلمة المرور قصيرة', true);
  if (!['owner', 'manager', 'staff'].includes(req.body.role)) return back(res, '/admin/users', 'دور غير صحيح', true);
  try {
    const created = await db.one(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [String(req.body.name ?? '').trim(), email, await hashPassword(password), req.body.role],
    );
    await audit({ actor: userActor(req.user), action: 'user.create', entity: 'user', entityId: created.id, data: { role: req.body.role } });
    back(res, '/admin/users', 'تمت إضافة المستخدم');
  } catch (error) {
    if (error.code === '23505') return back(res, '/admin/users', 'البريد مستخدم مسبقاً', true);
    throw error;
  }
});

admin.post('/users/:id/toggle', async (req, res) => {
  requirePermission(req, 'users.write');
  const id = Number(req.params.id);
  if (id === req.user.id) return back(res, '/admin/users', 'لا يمكنك إيقاف حسابك', true);
  const updated = await db.one('UPDATE users SET active = NOT active WHERE id = $1 RETURNING active', [id]);
  if (updated && !updated.active) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit({ actor: userActor(req.user), action: updated?.active ? 'user.activate' : 'user.deactivate', entity: 'user', entityId: id });
  back(res, '/admin/users', 'تم التحديث');
});

admin.use(async (error, req, res, next) => {
  if (error instanceof Forbidden) {
    return page(req, res, 'غير مصرح', views.message({ text: error.message, back: '/admin' }), 403);
  }
  next(error);
});
