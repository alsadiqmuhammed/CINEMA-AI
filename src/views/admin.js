import { config } from '../config.js';
import { html, raw, toString } from '../lib/html.js';
import { can, ROLE_LABELS } from '../lib/auth.js';
import {
  CHANNELS, CONVERSATION_LABELS, formatDate, formatMoney, ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS,
} from '../lib/format.js';
import { ALERT_LABELS } from '../services/alerts.js';
import { APPROVAL_KINDS } from '../services/approvals.js';
import { SEGMENTS } from '../services/customers.js';

const NAV = [
  ['/admin', 'لوحة الأداء'],
  ['/admin/orders', 'الطلبات'],
  ['/admin/products', 'المنتجات'],
  ['/admin/customers', 'العملاء'],
  ['/admin/conversations', 'المحادثات'],
  ['/admin/approvals', 'الموافقات'],
  ['/admin/marketing', 'التسويق'],
  ['/admin/alerts', 'التنبيهات'],
  ['/admin/outbox', 'الرسائل الصادرة'],
  ['/admin/audit', 'سجل التدقيق', 'audit.read'],
  ['/admin/settings', 'الإعدادات', 'settings.write'],
  ['/admin/users', 'المستخدمون', 'users.write'],
];

export function layout({ user, title, body, path = '', counts = {}, flash, settings }) {
  return '<!doctype html>' + toString(html`
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} | لوحة التحكم</title>
  <link rel="preload" href="/static/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/css/admin.css?v=${config.assetVersion}">
</head>
<body>
  ${user ? html`
  <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="القائمة">
  <aside class="sidebar">
    <div class="side-brand"><span>${settings?.store_name ?? 'المتجر'}</span><small>لوحة التحكم</small><label for="nav-toggle" class="close" aria-label="إغلاق القائمة">×</label></div>
    <nav>
      ${NAV.filter(([, , perm]) => !perm || can(user, perm)).map(([href, label]) => html`
        <a href="${href}" class="${(href === '/admin' ? path === '/admin' : path.startsWith(href)) ? 'active' : ''}">
          ${label}
          ${href === '/admin/approvals' && counts.approvals ? html`<span class="pill">${counts.approvals}</span>` : ''}
          ${href === '/admin/conversations' && counts.handoffs ? html`<span class="pill warn">${counts.handoffs}</span>` : ''}
          ${href === '/admin/alerts' && counts.alerts ? html`<span class="pill">${counts.alerts}</span>` : ''}
        </a>`)}
    </nav>
    <div class="side-user">
      <div class="who"><strong>${user.name}</strong><span>${ROLE_LABELS[user.role]}</span></div>
      <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${user.csrf_token}"><button class="link">تسجيل الخروج</button></form>
      <a href="/" target="_blank" rel="noopener">عرض المتجر</a>
    </div>
  </aside>` : ''}
  <main class="${user ? 'content' : 'content solo'}">
    ${user ? html`<label for="nav-toggle" class="menu-btn">☰ القائمة</label>` : html`<div class="login-brand">${settings?.store_name ?? 'المتجر'}</div>`}
    <h1>${title}</h1>
    ${flash ? html`<p class="flash ${flash.type ?? ''}">${flash.message}</p>` : ''}
    ${body}
  </main>
</body>
</html>`);
}

const csrfField = (user) => html`<input type="hidden" name="_csrf" value="${user.csrf_token}">`;
const money = (v, settings) => formatMoney(v, settings.currency);
const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;

export function login({ error, next }) {
  return html`
    <form method="post" action="/admin/login" class="card narrow form">
      ${error ? html`<p class="flash error">${error}</p>` : ''}
      <input type="hidden" name="next" value="${next ?? ''}">
      <label>البريد الإلكتروني <input name="email" type="email" required autofocus dir="ltr"></label>
      <label>كلمة المرور <input name="password" type="password" required dir="ltr"></label>
      <button class="btn primary block">دخول</button>
    </form>`;
}

export function dashboard({ settings, stats, alerts, recentOrders, topProducts, sources, channels, aiEnabled }) {
  const kpi = (label, value, hint) => html`<div class="kpi"><span>${label}</span><strong>${value}</strong>${hint ? html`<small>${hint}</small>` : ''}</div>`;
  return html`
    <div class="kpis">
      ${kpi('مبيعات اليوم', money(stats.sales_today, settings), `${stats.orders_today} طلب`)}
      ${kpi('مبيعات 30 يوم', money(stats.sales_30d, settings), `${stats.orders_30d} طلب`)}
      ${kpi('متوسط قيمة الطلب', money(stats.aov_30d, settings), 'آخر 30 يوم')}
      ${kpi('نسبة التحويل', `${stats.conversion_30d}%`, 'سلال تحولت لطلبات')}
      ${kpi('سلال متروكة', stats.abandoned_carts, 'آخر 7 أيام')}
      ${kpi('محادثات تنتظر موظف', stats.handoffs)}
      ${kpi('موافقات معلقة', stats.pending_approvals)}
      ${kpi('عملاء جدد', stats.new_customers_30d, 'آخر 30 يوم')}
    </div>
    <div class="cols">
      <section class="card">
        <h2>تنبيهات مفتوحة</h2>
        ${alerts.length ? html`<ul class="list">${alerts.slice(0, 8).map((a) => html`<li>${badge(ALERT_LABELS[a.kind], a.severity)} ${a.link ? html`<a href="${a.link}">${a.message}</a>` : a.message}</li>`)}</ul>` : html`<p class="muted">لا توجد تنبيهات.</p>`}
      </section>
      <section class="card">
        <h2>حالة التكاملات</h2>
        <ul class="list">
          <li>الذكاء الاصطناعي: ${aiEnabled ? badge('Claude مفعّل', 'ok') : badge('قالب أساسي (بدون مفتاح API)', 'warning')}</li>
          ${Object.entries(channels).map(([name, on]) => html`<li>${CHANNELS[name]}: ${on ? badge('مربوط', 'ok') : badge('غير مربوط', 'muted')}</li>`)}
        </ul>
      </section>
    </div>
    <div class="cols">
      <section class="card">
        <h2>الأكثر مبيعاً (30 يوم)</h2>
        ${table(['المنتج', 'الكمية', 'الإيراد'], topProducts.map((p) => [p.name, p.quantity, money(p.revenue, settings)]))}
      </section>
      <section class="card">
        <h2>المبيعات حسب المصدر (30 يوم)</h2>
        ${table(['المصدر', 'الطلبات', 'الإيراد'], sources.map((s) => [CHANNELS[s.source] ?? s.source, s.orders, money(s.revenue, settings)]))}
      </section>
    </div>
    <section class="card">
      <h2>أحدث الطلبات</h2>
      ${ordersTable(recentOrders, settings)}
    </section>`;
}

function table(headers, rows) {
  if (!rows.length) return html`<p class="muted">لا توجد بيانات.</p>`;
  return html`<div class="table-wrap"><table><thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`;
}

function ordersTable(list, settings) {
  return table(
    ['الطلب', 'العميل', 'الإجمالي', 'الحالة', 'الدفع', 'المصدر', 'التاريخ'],
    list.map((o) => [
      html`<a href="/admin/orders/${o.id}" dir="ltr">${o.number}</a>`,
      o.ship_name,
      money(o.total, settings),
      badge(ORDER_STATUS[o.status], o.status),
      badge(PAYMENT_STATUS[o.payment_status], o.payment_status),
      CHANNELS[o.source] ?? o.source,
      formatDate(o.created_at),
    ]),
  );
}

export function orders({ settings, list, filters }) {
  return html`
    <form class="filters" method="get">
      <input name="q" placeholder="رقم الطلب، الاسم أو الهاتف" value="${filters.q ?? ''}">
      <select name="status"><option value="">كل الحالات</option>${Object.entries(ORDER_STATUS).map(([k, v]) => html`<option value="${k}" ${filters.status === k ? raw('selected') : ''}>${v}</option>`)}</select>
      <select name="payment"><option value="">كل حالات الدفع</option>${Object.entries(PAYMENT_STATUS).map(([k, v]) => html`<option value="${k}" ${filters.payment === k ? raw('selected') : ''}>${v}</option>`)}</select>
      <button class="btn">تصفية</button>
    </form>
    <section class="card">${ordersTable(list, settings)}</section>`;
}

export function order({ settings, user, order: o, nextStatuses }) {
  return html`
    <div class="cols">
      <section class="card">
        <h2>تفاصيل الطلب ${badge(ORDER_STATUS[o.status], o.status)}</h2>
        <dl class="facts">
          <dt>العميل</dt><dd><a href="/admin/customers/${o.customer_id}">${o.ship_name}</a></dd>
          <dt>الهاتف</dt><dd dir="ltr">${o.ship_phone}</dd>
          <dt>العنوان</dt><dd>${o.ship_city} — ${o.ship_address}</dd>
          <dt>طريقة الدفع</dt><dd>${PAYMENT_METHODS[o.payment_method]}</dd>
          <dt>حالة الدفع</dt><dd>${badge(PAYMENT_STATUS[o.payment_status], o.payment_status)}</dd>
          <dt>المصدر</dt><dd>${CHANNELS[o.source] ?? o.source}</dd>
          <dt>رقم الشحنة</dt><dd dir="ltr">${o.tracking_number ?? '—'}</dd>
          <dt>ملاحظات</dt><dd>${o.notes || '—'}</dd>
        </dl>
        ${table(['المنتج', 'السعر', 'الكمية', 'المجموع'], o.items.map((i) => [i.name, money(i.unit_price, settings), i.quantity, money(i.unit_price * i.quantity, settings)]))}
        <p class="totals">المجموع ${money(o.subtotal, settings)} + التوصيل ${money(o.shipping_fee, settings)} = <strong>${money(o.total, settings)}</strong></p>
      </section>
      <section class="card">
        <h2>الإجراءات</h2>
        ${can(user, 'orders.write') && nextStatuses.length ? html`
          <form method="post" action="/admin/orders/${o.id}/status" class="form">
            ${csrfField(user)}
            <label>تغيير الحالة إلى
              <select name="status">${nextStatuses.map((s) => html`<option value="${s}">${ORDER_STATUS[s]}</option>`)}</select>
            </label>
            <label>رقم الشحنة (عند الشحن) <input name="tracking_number" dir="ltr" value="${o.tracking_number ?? ''}"></label>
            <button class="btn primary">حفظ</button>
          </form>` : ''}
        ${can(user, 'payments.write') ? html`
          <h3>الدفع</h3>
          <p class="muted">تأكيد استلام المبلغ قرار بشري. تأكد من وصول المبلغ قبل تأكيده.</p>
          ${['unpaid', 'failed'].includes(o.payment_status) ? html`
            <form method="post" action="/admin/orders/${o.id}/payment" class="row-form">
              ${csrfField(user)}
              <input name="note" placeholder="ملاحظة (مثلاً: رقم التحويل)">
              <button class="btn primary" name="payment_status" value="paid">تأكيد استلام المبلغ</button>
              ${o.payment_status === 'unpaid' ? html`<button class="btn danger" name="payment_status" value="failed">تسجيل فشل الدفع</button>` : ''}
            </form>` : ''}
          ${o.payment_status === 'paid' ? html`
            <form method="post" action="/admin/orders/${o.id}/refund" class="row-form">
              ${csrfField(user)}
              <input name="reason" required placeholder="سبب الاسترجاع">
              <button class="btn danger">طلب استرجاع (يحتاج موافقة)</button>
            </form>` : ''}` : ''}
        <h3>السجل</h3>
        <ul class="timeline">${o.history.map((h) => html`<li><span class="muted">${formatDate(h.created_at)}</span> ${actorLabel(h)} — ${h.action}${h.data?.to ? ` → ${ORDER_STATUS[h.data.to]}` : ''}${h.reason ? ` (${h.reason})` : ''}</li>`)}</ul>
      </section>
    </div>`;
}

function actorLabel(entry) {
  return { user: `مستخدم #${entry.actor_id}`, ai: 'المساعد الذكي', automation: 'الأتمتة', customer: 'العميل', system: 'النظام' }[entry.actor_type];
}

export function products({ settings, list, filters }) {
  return html`
    <div class="toolbar">
      <form class="filters" method="get">
        <input name="q" placeholder="اسم المنتج أو SKU" value="${filters.q ?? ''}">
        <select name="status"><option value="">الكل</option><option value="active" ${filters.status === 'active' ? raw('selected') : ''}>منشور</option><option value="draft" ${filters.status === 'draft' ? raw('selected') : ''}>مسودة</option><option value="archived" ${filters.status === 'archived' ? raw('selected') : ''}>مؤرشف</option></select>
        <button class="btn">تصفية</button>
      </form>
      <a class="btn primary" href="/admin/products/new">منتج جديد</a>
    </div>
    <section class="card">
      ${table(['', 'المنتج', 'السعر', 'المخزون', 'الحالة'], list.map((p) => [
        p.image_url ? html`<img class="mini" src="${p.image_url}" alt="">` : '',
        html`<a href="/admin/products/${p.id}">${p.name}</a>`,
        money(p.price, settings),
        p.stock <= p.low_stock_at ? badge(p.stock, p.stock === 0 ? 'critical' : 'warning') : p.stock,
        badge({ active: 'منشور', draft: 'مسودة', archived: 'مؤرشف' }[p.status], p.status),
      ]))}
    </section>`;
}

export function productForm({ user, product: p, categories, allProducts = [], relations = [], aiEnabled }) {
  const isNew = !p?.id;
  const v = p ?? { status: 'draft', stock: 0, low_stock_at: 5, faq: [], tags: [] };
  const related = (kind) => new Set(relations.filter((r) => r.kind === kind).map((r) => r.related_id));
  return html`
    <form method="post" action="${isNew ? '/admin/products' : `/admin/products/${v.id}`}" class="card form">
      ${csrfField(user)}
      <div class="form-grid">
        <label>اسم المنتج <input name="name" required value="${v.name ?? ''}"></label>
        <label>SKU <input name="sku" dir="ltr" value="${v.sku ?? ''}"></label>
        <label>السعر <input name="price" type="number" step="any" min="0" required value="${v.price ?? ''}"></label>
        <label>السعر قبل الخصم <input name="compare_at_price" type="number" step="any" min="0" value="${v.compare_at_price ?? ''}"></label>
        <label>المخزون <input name="stock" type="number" min="0" required value="${v.stock}"></label>
        <label>تنبيه عند مخزون أقل من <input name="low_stock_at" type="number" min="0" value="${v.low_stock_at}"></label>
        <label>التصنيف
          <select name="category_id"><option value="">بدون</option>${categories.map((c) => html`<option value="${c.id}" ${v.category_id === c.id ? raw('selected') : ''}>${c.name}</option>`)}</select>
        </label>
        <label>تصنيف جديد (اختياري) <input name="new_category"></label>
        <label>الحالة
          <select name="status">${[['draft', 'مسودة'], ['active', 'منشور'], ['archived', 'مؤرشف']].map(([k, l]) => html`<option value="${k}" ${v.status === k ? raw('selected') : ''}>${l}</option>`)}</select>
        </label>
        <label>وسوم (مفصولة بفاصلة) <input name="tags" value="${(v.tags ?? []).join('، ')}"></label>
      </div>
      <label>الوصف <textarea name="description" rows="6">${v.description ?? ''}</textarea></label>
      <div class="form-grid">
        <label>عنوان SEO <input name="seo_title" maxlength="70" value="${v.seo_title ?? ''}"></label>
        <label>وصف SEO <input name="seo_description" maxlength="160" value="${v.seo_description ?? ''}"></label>
      </div>
      <label>الأسئلة الشائعة (سؤال | جواب، كل سطر سؤال)
        <textarea name="faq" rows="4">${(v.faq ?? []).map((f) => `${f.q} | ${f.a}`).join('\n')}</textarea>
      </label>
      ${!isNew ? html`
        <div class="form-grid">
          <label>منتجات مكملة
            <select name="complements" multiple size="5">${allProducts.filter((o) => o.id !== v.id).map((o) => html`<option value="${o.id}" ${related('complement').has(o.id) ? raw('selected') : ''}>${o.name}</option>`)}</select>
          </label>
          <label>منتجات بديلة
            <select name="alternatives" multiple size="5">${allProducts.filter((o) => o.id !== v.id).map((o) => html`<option value="${o.id}" ${related('alternative').has(o.id) ? raw('selected') : ''}>${o.name}</option>`)}</select>
          </label>
        </div>` : ''}
      <button class="btn primary">${isNew ? 'إضافة المنتج' : 'حفظ التغييرات'}</button>
    </form>
    ${!isNew ? html`
      <section class="card">
        <h2>الصور</h2>
        <div class="images">${v.images.map((img) => html`
          <figure><img src="${img.url}" alt="${img.alt}">
            <form method="post" action="/admin/products/${v.id}/images/${img.id}/delete">${csrfField(user)}<button class="link danger">حذف</button></form>
          </figure>`)}</div>
        <form method="post" action="/admin/products/${v.id}/images" enctype="multipart/form-data" class="row-form">
          ${csrfField(user)}
          <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required>
          <button class="btn">رفع</button>
        </form>
      </section>
      <section class="card">
        <h2>مساعد المحتوى</h2>
        <p class="muted">يكتب مسودة للعنوان والوصف وSEO والأسئلة الشائعة ${aiEnabled ? 'باستخدام Claude' : 'من قالب أساسي (أضف مفتاح API لتفعيل Claude)'}. المسودة تنتظر موافقتك في صفحة الموافقات ولا تُنشر تلقائياً.</p>
        <form method="post" action="/admin/products/${v.id}/draft" class="row-form">
          ${csrfField(user)}
          <input name="notes" placeholder="ملاحظات للمساعد (اختياري): مثل المميزات أو الجمهور المستهدف">
          <button class="btn primary">اكتب مسودة</button>
        </form>
      </section>` : ''}`;
}

export function customers({ settings, list, filters, sources }) {
  return html`
    <form class="filters" method="get">
      <input name="q" placeholder="الاسم، الهاتف أو البريد" value="${filters.q ?? ''}">
      <select name="segment">${Object.entries(SEGMENTS).map(([k, v]) => html`<option value="${k}" ${filters.segment === k ? raw('selected') : ''}>${v}</option>`)}</select>
      <select name="source"><option value="">كل المصادر</option>${sources.map((s) => html`<option value="${s}" ${filters.source === s ? raw('selected') : ''}>${CHANNELS[s] ?? s}</option>`)}</select>
      <input name="interest" placeholder="اهتمام" value="${filters.interest ?? ''}">
      <button class="btn">تصفية</button>
    </form>
    <section class="card">
      <p class="muted">${list.length} عميل</p>
      ${table(['العميل', 'الهاتف', 'المصدر', 'الطلبات', 'إجمالي المشتريات', 'آخر طلب', 'تسويق'], list.map((c) => [
        html`<a href="/admin/customers/${c.id}">${c.name || 'بدون اسم'}</a>`,
        html`<span dir="ltr">${c.phone ?? ''}</span>`,
        CHANNELS[c.source] ?? c.source,
        c.order_count,
        money(c.lifetime_value, settings),
        c.last_order_at ? formatDate(c.last_order_at) : '—',
        c.marketing_opt_in ? '✓' : '',
      ]))}
    </section>`;
}

export function customer({ settings, user, customer: c }) {
  return html`
    <div class="cols">
      <section class="card">
        <h2>${c.name || 'عميل بدون اسم'}</h2>
        <dl class="facts">
          <dt>الهاتف</dt><dd dir="ltr">${c.phone ?? '—'}</dd>
          <dt>البريد</dt><dd dir="ltr">${c.email ?? '—'}</dd>
          <dt>المصدر</dt><dd>${CHANNELS[c.source] ?? c.source}</dd>
          <dt>الطلبات</dt><dd>${c.order_count}</dd>
          <dt>إجمالي المشتريات</dt><dd>${money(c.lifetime_value, settings)}</dd>
          <dt>الاهتمامات</dt><dd>${c.interests.join('، ') || '—'}</dd>
          <dt>منذ</dt><dd>${formatDate(c.created_at)}</dd>
        </dl>
        ${can(user, 'customers.write') ? html`
          <form method="post" action="/admin/customers/${c.id}" class="form">
            ${csrfField(user)}
            <label>الاسم <input name="name" value="${c.name}"></label>
            <label>وسوم <input name="tags" value="${c.tags.join('، ')}"></label>
            <label>اهتمامات <input name="interests" value="${c.interests.join('، ')}"></label>
            <label>ملاحظات <textarea name="notes" rows="3">${c.notes}</textarea></label>
            <label class="radio"><input type="checkbox" name="marketing_opt_in" value="1" ${c.marketing_opt_in ? raw('checked') : ''}> موافق على الرسائل التسويقية</label>
            <button class="btn primary">حفظ</button>
          </form>` : ''}
      </section>
      <section class="card">
        <h2>سجل المتابعة</h2>
        <ul class="timeline">${c.events.map((e) => html`<li><span class="muted">${formatDate(e.created_at)}</span> ${e.summary}</li>`)}</ul>
        <h2>المحادثات</h2>
        <ul class="list">${c.conversations.map((cv) => html`<li><a href="/admin/conversations/${cv.id}">${CHANNELS[cv.channel]} — ${CONVERSATION_LABELS[cv.label]}</a> <span class="muted">${formatDate(cv.last_message_at)}</span></li>`)}</ul>
      </section>
    </div>
    <section class="card"><h2>الطلبات</h2>${ordersTable(c.orders, settings)}</section>`;
}

export function conversations({ list, filters }) {
  return html`
    <form class="filters" method="get">
      <select name="mode"><option value="">الكل</option><option value="human" ${filters.mode === 'human' ? raw('selected') : ''}>تنتظر موظف</option><option value="bot" ${filters.mode === 'bot' ? raw('selected') : ''}>يرد المساعد</option><option value="closed" ${filters.mode === 'closed' ? raw('selected') : ''}>مغلقة</option></select>
      <select name="label"><option value="">كل التصنيفات</option>${Object.entries(CONVERSATION_LABELS).map(([k, v]) => html`<option value="${k}" ${filters.label === k ? raw('selected') : ''}>${v}</option>`)}</select>
      <button class="btn">تصفية</button>
    </form>
    <section class="card">
      ${table(['العميل', 'القناة', 'التصنيف', 'الوضع', 'آخر رسالة', 'الوقت'], list.map((cv) => [
        html`<a href="/admin/conversations/${cv.id}">${cv.customer_name || cv.customer_phone || `زائر #${cv.id}`}</a>`,
        CHANNELS[cv.channel],
        badge(CONVERSATION_LABELS[cv.label], cv.label),
        cv.mode === 'human' ? badge('تنتظر موظف', 'warning') : cv.mode === 'bot' ? badge('المساعد', 'ok') : badge('مغلقة', 'muted'),
        (cv.last_message ?? '').slice(0, 80),
        formatDate(cv.last_message_at),
      ]))}
    </section>`;
}

const ROLE_NAMES = { customer: 'العميل', bot: 'المساعد', staff: 'الموظف', system: 'النظام' };

export function conversation({ user, conversation: cv }) {
  return html`
    <div class="cols wide-first">
      <section class="card chat-log">
        ${cv.messages.map((m) => html`<div class="msg ${m.role}"><small>${ROLE_NAMES[m.role]} · ${formatDate(m.created_at)}</small><p>${m.content}</p></div>`)}
        ${can(user, 'conversations.write') && cv.mode !== 'closed' ? html`
          <form method="post" action="/admin/conversations/${cv.id}/reply" class="row-form">
            ${csrfField(user)}
            <textarea name="content" rows="2" required placeholder="اكتب ردك للعميل…"></textarea>
            <button class="btn primary">إرسال</button>
          </form>
          ${cv.channel === 'web' ? html`<p class="muted">يظهر الرد للعميل في نافذة المحادثة بالموقع.</p>` : ''}` : ''}
      </section>
      <section class="card">
        <h2>معلومات</h2>
        <dl class="facts">
          <dt>القناة</dt><dd>${CHANNELS[cv.channel]}</dd>
          <dt>العميل</dt><dd>${cv.customer_id ? html`<a href="/admin/customers/${cv.customer_id}">${cv.customer_name || cv.customer_phone}</a>` : 'غير معروف'}</dd>
          <dt>الوضع</dt><dd>${{ bot: 'يرد المساعد', human: 'ينتظر موظف', closed: 'مغلقة' }[cv.mode]}</dd>
          ${cv.handoff_reason ? html`<dt>سبب التحويل</dt><dd>${cv.handoff_reason}</dd>` : ''}
        </dl>
        ${can(user, 'conversations.write') ? html`
          <form method="post" action="/admin/conversations/${cv.id}/mode" class="row-form">
            ${csrfField(user)}
            ${cv.mode !== 'human' ? html`<button class="btn" name="mode" value="human">استلام المحادثة</button>` : ''}
            ${cv.mode !== 'bot' ? html`<button class="btn" name="mode" value="bot">إرجاعها للمساعد</button>` : ''}
            ${cv.mode !== 'closed' ? html`<button class="btn" name="mode" value="closed">إغلاق</button>` : ''}
          </form>
          <form method="post" action="/admin/conversations/${cv.id}/label" class="row-form">
            ${csrfField(user)}
            <select name="label">${Object.entries(CONVERSATION_LABELS).map(([k, v]) => html`<option value="${k}" ${cv.label === k ? raw('selected') : ''}>${v}</option>`)}</select>
            <button class="btn">تصنيف</button>
          </form>` : ''}
      </section>
    </div>`;
}

export function approvals({ list, status }) {
  return html`
    <nav class="tabs">
      ${[['pending', 'معلقة'], ['approved', 'موافق عليها'], ['rejected', 'مرفوضة']].map(([k, l]) => html`<a href="?status=${k}" class="${status === k ? 'active' : ''}">${l}</a>`)}
    </nav>
    <section class="card">
      ${table(['الطلب', 'النوع', 'من', 'التاريخ'], list.map((a) => [
        html`<a href="/admin/approvals/${a.id}">${a.title}</a>`,
        APPROVAL_KINDS[a.kind],
        a.requested_by === 'ai' ? 'المساعد الذكي' : a.requested_by.startsWith('user:') ? `مستخدم #${a.requested_by.slice(5)}` : 'الأتمتة',
        formatDate(a.created_at),
      ]))}
    </section>`;
}

export function approval({ user, approval: a, settings }) {
  return html`
    <section class="card">
      <p>${badge(APPROVAL_KINDS[a.kind])} ${badge({ pending: 'معلقة', approved: 'موافق عليها', rejected: 'مرفوضة' }[a.status], a.status)}
        ${a.payload.source ? badge(a.payload.source === 'claude' ? 'Claude' : 'قالب أساسي', 'muted') : ''}</p>
      ${approvalBody(a, settings)}
      ${a.status === 'pending' && can(user, 'approvals.decide') ? html`
        <form method="post" action="/admin/approvals/${a.id}" class="row-form">
          ${csrfField(user)}
          <input name="note" placeholder="ملاحظة (اختياري)">
          <button class="btn primary" name="decision" value="approve">موافقة</button>
          <button class="btn danger" name="decision" value="reject">رفض</button>
        </form>` : ''}
      ${a.status === 'pending' && !can(user, 'approvals.decide') ? html`<p class="muted">القرار في هذا الطلب لمدير أو مالك المتجر.</p>` : ''}
      ${a.decided_at ? html`<p class="muted">القرار: ${formatDate(a.decided_at)} بواسطة مستخدم #${a.decided_by}${a.decision_note ? ` — ${a.decision_note}` : ''}</p>` : ''}
    </section>`;
}

function approvalBody(a, settings) {
  const p = a.payload;
  if (a.kind === 'product_content') {
    const row = (label, before, after) => html`<tr><th>${label}</th><td>${before || '—'}</td><td>${after}</td></tr>`;
    return html`
      <p><a href="/admin/products/${p.product_id}">فتح المنتج</a></p>
      <div class="table-wrap"><table class="diff"><thead><tr><th></th><th>الحالي</th><th>المقترح</th></tr></thead><tbody>
        ${row('العنوان', p.before?.name, p.fields.name)}
        ${row('الوصف', html`<div class="pre">${p.before?.description}</div>`, html`<div class="pre">${p.fields.description}</div>`)}
        ${row('عنوان SEO', p.before?.seo_title, p.fields.seo_title)}
        ${row('وصف SEO', p.before?.seo_description, p.fields.seo_description)}
        ${row('الأسئلة', (p.before?.faq ?? []).map((f) => html`<p><b>${f.q}</b><br>${f.a}</p>`), p.fields.faq.map((f) => html`<p><b>${f.q}</b><br>${f.a}</p>`))}
      </tbody></table></div>
      <p class="muted">عند الموافقة يُحدَّث المنتج بالمحتوى المقترح. يمكنك تعديله بعدها من صفحة المنتج.</p>`;
  }
  if (a.kind === 'ad_campaign') {
    const plan = p.plan;
    return html`
      <dl class="facts"><dt>الهدف</dt><dd>${plan.objective}</dd><dt>الميزانية القصوى</dt><dd>${formatMoney(p.budget, p.currency)}</dd><dt>توزيع الميزانية</dt><dd>${plan.budget_plan}</dd></dl>
      <h3>الجمهور</h3><ul>${plan.audiences.map((x) => html`<li><b>${x.name}</b>: ${x.description}</li>`)}</ul>
      <h3>النصوص الإعلانية</h3>${plan.ad_copies.map((x) => html`<div class="card inset"><b>${x.headline}</b><p>${x.primary_text}</p><small>${x.call_to_action}</small></div>`)}
      <h3>أفكار التصاميم والفيديو</h3><ul>${plan.creative_ideas.map((x) => html`<li>${x}</li>`)}</ul>
      <h3>مؤشرات النجاح</h3><ul>${plan.success_metrics.map((x) => html`<li>${x}</li>`)}</ul>
      <p class="muted">الموافقة تعتمد الخطة فقط. إطلاق الإعلان وصرف الميزانية يتم يدوياً من مدير الإعلانات في Meta.</p>`;
  }
  if (a.kind === 'broadcast') {
    return html`<p>عدد المستلمين المحتملين: ${p.customer_ids.length} (فقط الموافقون على التسويق ولديهم رقم هاتف)</p>
      <div class="card inset pre">${p.body}</div>${p.template ? html`<p>قالب واتساب: <code>${p.template}</code></p>` : ''}`;
  }
  if (a.kind === 'refund') {
    return html`<p><a href="/admin/orders/${p.order_id}">فتح الطلب</a> — المبلغ: ${formatMoney(p.amount, settings.currency)}</p><p>السبب: ${p.reason}</p>
      <p class="muted">الموافقة تسجل الطلب كمسترجع. تحويل المبلغ للعميل يتم يدوياً من حساب البنك أو بوابة الدفع.</p>`;
  }
  return html`<pre>${JSON.stringify(p, null, 2)}</pre>`;
}

export function marketing({ user, settings, products: list, campaigns, segmentCounts }) {
  return html`
    <div class="cols">
      <section class="card">
        <h2>اقتراح حملة إعلانية</h2>
        <p class="muted">المساعد يقترح الجمهور والنصوص والتصاميم وتوزيع الميزانية. لا يُطلق أي إعلان ولا تُصرف أي ميزانية إلا بقرار منك.</p>
        <form method="post" action="/admin/marketing/campaign" class="form">
          ${csrfField(user)}
          <label>هدف الحملة <input name="goal" required placeholder="مثلاً: زيادة مبيعات العطور قبل العيد"></label>
          <label>الميزانية القصوى (${settings.currency}) <input name="budget" type="number" min="1" required></label>
          <label>المنتجات <select name="product_ids" multiple size="6" required>${list.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>
          <button class="btn primary">اقترح الحملة</button>
        </form>
      </section>
      <section class="card">
        <h2>رسالة جماعية عبر واتساب</h2>
        <p class="muted">تُرسل فقط للعملاء الموافقين على التسويق، وبعد موافقة مدير. خارج نافذة 24 ساعة يلزم قالب معتمد من Meta.</p>
        <form method="post" action="/admin/marketing/broadcast" class="form">
          ${csrfField(user)}
          <label>الشريحة <select name="segment">${Object.entries(SEGMENTS).map(([k, v]) => html`<option value="${k}">${v} (${segmentCounts[k] ?? 0})</option>`)}</select></label>
          <label>نص الرسالة <textarea name="body" rows="4" required></textarea></label>
          <label>اسم قالب واتساب المعتمد (اختياري) <input name="template" dir="ltr"></label>
          <button class="btn primary">إرسال للموافقة</button>
        </form>
      </section>
    </div>
    <section class="card">
      <h2>الحملات المقترحة</h2>
      ${table(['الحملة', 'الحالة', 'التاريخ'], campaigns.map((a) => [html`<a href="/admin/approvals/${a.id}">${a.title}</a>`, badge({ pending: 'معلقة', approved: 'معتمدة', rejected: 'مرفوضة' }[a.status], a.status), formatDate(a.created_at)]))}
    </section>`;
}

export function alerts({ user, list }) {
  return html`<section class="card">
    ${list.length ? html`<ul class="list">${list.map((a) => html`<li>
      ${badge(ALERT_LABELS[a.kind], a.severity)} ${a.link ? html`<a href="${a.link}">${a.message}</a>` : a.message}
      <span class="muted">${formatDate(a.created_at)}</span>
      <form method="post" action="/admin/alerts/${a.id}/resolve" class="inline">${csrfField(user)}<button class="link">تم</button></form>
    </li>`)}</ul>` : html`<p class="muted">لا توجد تنبيهات مفتوحة.</p>`}
  </section>`;
}

export function outbox({ list }) {
  const STATUS = { queued: 'بالانتظار', sent: 'أُرسلت', failed: 'فشلت', skipped: 'لم تُرسل' };
  const PURPOSE = { abandoned_cart: 'سلة متروكة', review_request: 'طلب تقييم', broadcast: 'رسالة جماعية' };
  return html`<section class="card">
    <p class="muted">"لم تُرسل" تعني أن القناة غير مربوطة بعد. اربط واتساب من متغيرات البيئة لتبدأ الإرسال.</p>
    ${table(['الغرض', 'القناة', 'المستلم', 'الرسالة', 'الحالة', 'التاريخ'], list.map((m) => [
      PURPOSE[m.purpose] ?? m.purpose, CHANNELS[m.channel] ?? m.channel, html`<span dir="ltr">${m.recipient}</span>`,
      m.body.slice(0, 90), html`${badge(STATUS[m.status], m.status)}${m.error ? html`<br><small class="muted">${m.error}</small>` : ''}`, formatDate(m.created_at),
    ]))}
  </section>`;
}

export function audit({ list, filters }) {
  const ACTORS = { user: 'مستخدم', ai: 'المساعد الذكي', automation: 'الأتمتة', customer: 'العميل', system: 'النظام' };
  return html`
    <form class="filters" method="get">
      <select name="actor"><option value="">كل المنفذين</option>${Object.entries(ACTORS).map(([k, v]) => html`<option value="${k}" ${filters.actor === k ? raw('selected') : ''}>${v}</option>`)}</select>
      <input name="action" placeholder="الإجراء (مثل order.status)" value="${filters.action ?? ''}" dir="ltr">
      <button class="btn">تصفية</button>
    </form>
    <section class="card">
      ${table(['الوقت', 'المنفذ', 'الإجراء', 'العنصر', 'السبب', 'التفاصيل'], list.map((e) => [
        formatDate(e.created_at), `${ACTORS[e.actor_type]}${e.actor_id ? ` #${e.actor_id}` : ''}`, html`<code>${e.action}</code>`,
        e.entity ? `${e.entity} #${e.entity_id}` : '', e.reason ?? '', html`<code class="small">${JSON.stringify(e.data)}</code>`,
      ]))}
    </section>`;
}

export function settingsPage({ user, settings }) {
  const p = settings.policies;
  return html`
    <form method="post" action="/admin/settings" class="card form">
      ${csrfField(user)}
      <div class="form-grid">
        <label>اسم المتجر <input name="store_name" required value="${settings.store_name}"></label>
        <label>الشعار النصي <input name="store_tagline" value="${settings.store_tagline}"></label>
        <label>العملة
          <select name="currency">${['IQD', 'USD', 'SAR', 'KWD', 'AED', 'QAR', 'BHD', 'OMR'].map((c) => html`<option ${settings.currency === c ? raw('selected') : ''}>${c}</option>`)}</select>
        </label>
        <label>رسوم التوصيل <input name="shipping_fee" type="number" step="any" min="0" value="${settings.shipping_fee}"></label>
        <label>توصيل مجاني فوق (0 لإيقافه) <input name="free_shipping_over" type="number" step="any" min="0" value="${settings.free_shipping_over}"></label>
        <label>هاتف خدمة العملاء <input name="support_phone" dir="ltr" value="${settings.support_phone}"></label>
        <label>بريد خدمة العملاء <input name="support_email" dir="ltr" value="${settings.support_email}"></label>
      </div>
      <label>بيانات التحويل البنكي (اتركها فارغة لإخفاء التحويل البنكي) <textarea name="bank_details" rows="2">${settings.bank_details}</textarea></label>
      <label>أسلوب العلامة (يستخدمه المساعد في الردود والمحتوى) <textarea name="brand_voice" rows="2">${settings.brand_voice}</textarea></label>
      <h2>السياسات (يجيب منها المساعد)</h2>
      <label>الشحن <textarea name="policy_shipping" rows="2">${p.shipping}</textarea></label>
      <label>الاسترجاع <textarea name="policy_returns" rows="2">${p.returns}</textarea></label>
      <label>الدفع <textarea name="policy_payment" rows="2">${p.payment}</textarea></label>
      <label>الخصوصية <textarea name="policy_privacy" rows="2">${p.privacy}</textarea></label>
      <button class="btn primary">حفظ</button>
    </form>`;
}

export function users({ user, list }) {
  return html`
    <section class="card">
      ${table(['الاسم', 'البريد', 'الدور', 'الحالة', ''], list.map((u) => [
        u.name, html`<span dir="ltr">${u.email}</span>`, ROLE_LABELS[u.role], u.active ? 'فعّال' : 'موقوف',
        u.id !== user.id ? html`<form method="post" action="/admin/users/${u.id}/toggle" class="inline">${csrfField(user)}<button class="link">${u.active ? 'إيقاف' : 'تفعيل'}</button></form>` : '',
      ]))}
    </section>
    <form method="post" action="/admin/users" class="card form">
      <h2>إضافة مستخدم</h2>
      ${csrfField(user)}
      <div class="form-grid">
        <label>الاسم <input name="name" required></label>
        <label>البريد <input name="email" type="email" required dir="ltr"></label>
        <label>كلمة المرور (10 أحرف على الأقل) <input name="password" type="password" minlength="10" required dir="ltr"></label>
        <label>الدور <select name="role"><option value="staff">موظف</option><option value="manager">مدير</option><option value="owner">مالك</option></select></label>
      </div>
      <p class="muted">الموظف: المنتجات والطلبات والعملاء والمحادثات. المدير: إضافة للموافقات والمدفوعات والإعدادات وسجل التدقيق. المالك: كل شيء بما فيها المستخدمون.</p>
      <button class="btn primary">إضافة</button>
    </form>`;
}

export function message({ text, back }) {
  return html`<section class="card"><p>${text}</p>${back ? html`<p><a href="${back}">رجوع</a></p>` : ''}</section>`;
}
