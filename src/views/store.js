import { config } from '../config.js';
import { html, raw, toString } from '../lib/html.js';
import { formatDate, formatMoney, ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from '../lib/format.js';

export function layout({ settings, title, description, body, cartCount = 0, canonical, jsonLd }) {
  const pageTitle = title ? `${title} | ${settings.store_name}` : settings.store_name;
  return '<!doctype html>' + toString(html`
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${description ?? settings.store_tagline}">
  ${canonical ? html`<link rel="canonical" href="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${description ?? settings.store_tagline}">
  <link rel="stylesheet" href="/static/css/store.css">
  ${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
</head>
<body>
  <header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/">${settings.store_name}</a>
      <form class="search" action="/search" method="get" role="search">
        <input type="search" name="q" placeholder="ابحث عن منتج…" aria-label="بحث">
      </form>
      <nav class="header-links">
        <a href="/track">تتبع طلبك</a>
        <a href="/cart" class="cart-link">السلة <span class="badge" id="cart-count">${cartCount}</span></a>
      </nav>
    </div>
  </header>
  <main class="wrap">${body}</main>
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div><strong>${settings.store_name}</strong><p>${settings.store_tagline}</p></div>
      <div><a href="/policies">السياسات</a><br><a href="/track">تتبع طلبك</a></div>
      <div>${settings.support_phone ? html`<span dir="ltr">${settings.support_phone}</span>` : ''}${settings.support_email ? html`<br>${settings.support_email}` : ''}</div>
    </div>
  </footer>
  <div id="chat-root"></div>
  <script src="/static/js/chat.js" defer></script>
</body>
</html>`);
}

function productCard(p, currency) {
  return html`
    <a class="card product-card" href="/p/${encodeURIComponent(p.slug)}">
      <div class="thumb">${p.image_url ? html`<img src="${p.image_url}" alt="${p.name}" loading="lazy">` : html`<span class="noimg">${p.name.slice(0, 1)}</span>`}</div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <div class="price">
          ${formatMoney(p.price, currency)}
          ${p.compare_at_price > p.price ? html`<s>${formatMoney(p.compare_at_price, currency)}</s>` : ''}
        </div>
        ${p.stock > 0 ? '' : html`<span class="tag muted">نفدت الكمية</span>`}
      </div>
    </a>`;
}

export function grid(items, currency) {
  if (!items.length) return html`<p class="empty">لا توجد منتجات حالياً.</p>`;
  return html`<div class="grid">${items.map((p) => productCard(p, currency))}</div>`;
}

export function home({ settings, categories, items }) {
  return html`
    <section class="hero">
      <h1>${settings.store_name}</h1>
      <p>${settings.store_tagline}</p>
    </section>
    ${categories.length ? html`<nav class="chips">${categories.map((c) => html`<a class="chip" href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}</nav>` : ''}
    ${grid(items, settings.currency)}`;
}

export function listing({ settings, heading, items, query }) {
  return html`
    <h1 class="page-title">${heading}</h1>
    ${query !== undefined && !items.length ? html`<p class="empty">ما لقينا نتائج لـ "${query}". جرّب كلمة ثانية أو اسأل المساعد بالأسفل.</p>` : grid(items, settings.currency)}`;
}

export function product({ settings, product: p, related, csrf }) {
  const images = p.images.length ? p.images : [];
  return html`
    <nav class="crumbs"><a href="/">الرئيسية</a>${p.category_slug ? html` / <a href="/c/${encodeURIComponent(p.category_slug)}">${p.category_name}</a>` : ''}</nav>
    <article class="product">
      <div class="gallery">
        ${images.length ? images.map((img, i) => html`<img src="${img.url}" alt="${img.alt || p.name}" ${i ? raw('loading="lazy"') : ''}>`) : html`<div class="noimg big">${p.name.slice(0, 1)}</div>`}
      </div>
      <div class="info">
        <h1>${p.name}</h1>
        <div class="price big">
          ${formatMoney(p.price, settings.currency)}
          ${p.compare_at_price > p.price ? html`<s>${formatMoney(p.compare_at_price, settings.currency)}</s>` : ''}
        </div>
        ${p.stock > 0
          ? html`<form method="post" action="/cart/add" class="buy">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="product_id" value="${p.id}">
              <label>الكمية <input type="number" name="quantity" value="1" min="1" max="${Math.min(p.stock, 20)}"></label>
              <button class="btn primary" type="submit">أضف للسلة</button>
            </form>
            ${p.stock <= p.low_stock_at ? html`<p class="hint">باقي ${p.stock} فقط</p>` : ''}`
          : html`<p class="tag muted">نفدت الكمية حالياً</p>`}
        <div class="description">${p.description.split(/\n+/).filter(Boolean).map((line) => html`<p>${line}</p>`)}</div>
        ${p.faq?.length ? html`<section class="faq"><h2>أسئلة شائعة</h2>${p.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</section>` : ''}
      </div>
    </article>
    ${related.length ? html`<section><h2 class="section-title">قد يعجبك أيضاً</h2>${grid(related, settings.currency)}</section>` : ''}`;
}

export function productJsonLd(p, settings) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.seo_description || p.description.slice(0, 300),
    sku: p.sku ?? undefined,
    image: p.images.map((i) => (i.url.startsWith('http') ? i.url : `${config.baseUrl}${i.url}`)),
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: settings.currency,
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${config.baseUrl}/p/${encodeURIComponent(p.slug)}`,
    },
  };
}

export function cart({ settings, view, csrf, error }) {
  const { items, subtotal, shipping, total } = view;
  if (!items.length) {
    return html`<h1 class="page-title">السلة</h1><p class="empty">سلتك فاضية. <a href="/">تصفح المنتجات</a></p>`;
  }
  return html`
    <h1 class="page-title">السلة</h1>
    ${error ? html`<p class="alert error">${error}</p>` : ''}
    <div class="cart-layout">
      <div class="cart-items">
        ${items.map((item) => html`
          <div class="cart-line">
            <a href="/p/${encodeURIComponent(item.slug)}" class="cart-thumb">${item.image_url ? html`<img src="${item.image_url}" alt="">` : ''}</a>
            <div class="grow">
              <a href="/p/${encodeURIComponent(item.slug)}">${item.name}</a>
              <div class="muted">${formatMoney(item.price, settings.currency)}</div>
              ${item.status !== 'active' || item.stock < item.quantity ? html`<div class="alert error small">الكمية المتوفرة ${item.stock}</div>` : ''}
            </div>
            <form method="post" action="/cart/update" class="qty">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="product_id" value="${item.product_id}">
              <input type="number" name="quantity" value="${item.quantity}" min="0" max="20" aria-label="الكمية">
              <button class="btn small" type="submit">تحديث</button>
            </form>
          </div>`)}
      </div>
      <aside class="card summary">
        <div class="row"><span>المجموع</span><span>${formatMoney(subtotal, settings.currency)}</span></div>
        <div class="row"><span>التوصيل</span><span>${shipping ? formatMoney(shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(total, settings.currency)}</span></div>
        ${Number(settings.free_shipping_over) > 0 && shipping ? html`<p class="hint">التوصيل مجاني للطلبات فوق ${formatMoney(settings.free_shipping_over, settings.currency)}</p>` : ''}
        <a class="btn primary block" href="/checkout">إتمام الطلب</a>
      </aside>
    </div>`;
}

export function checkout({ settings, view, csrf, error, values = {} }) {
  return html`
    <h1 class="page-title">إتمام الطلب</h1>
    ${error ? html`<p class="alert error">${error}</p>` : ''}
    <div class="cart-layout">
      <form method="post" action="/checkout" class="card form">
        <input type="hidden" name="_csrf" value="${csrf}">
        <label>الاسم <input name="name" required autocomplete="name" value="${values.name ?? ''}"></label>
        <label>رقم الجوال <input name="phone" required inputmode="tel" autocomplete="tel" dir="ltr" value="${values.phone ?? ''}"></label>
        <label>البريد الإلكتروني (اختياري) <input name="email" type="email" autocomplete="email" dir="ltr" value="${values.email ?? ''}"></label>
        <label>المدينة <input name="city" required autocomplete="address-level2" value="${values.city ?? ''}"></label>
        <label>العنوان بالتفصيل <textarea name="address" required rows="2" autocomplete="street-address">${values.address ?? ''}</textarea></label>
        <label>ملاحظات (اختياري) <textarea name="notes" rows="2">${values.notes ?? ''}</textarea></label>
        <fieldset>
          <legend>طريقة الدفع</legend>
          <label class="radio"><input type="radio" name="payment_method" value="cod" ${values.payment_method !== 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.cod}</label>
          ${settings.bank_details ? html`<label class="radio"><input type="radio" name="payment_method" value="bank_transfer" ${values.payment_method === 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.bank_transfer}</label>` : ''}
        </fieldset>
        <label class="radio"><input type="checkbox" name="marketing_opt_in" value="1" ${values.marketing_opt_in ? raw('checked') : ''}> أوافق على استلام العروض عبر واتساب</label>
        <button class="btn primary block" type="submit">تأكيد الطلب (${formatMoney(view.total, settings.currency)})</button>
        <p class="hint">بتأكيد الطلب أنت توافق على <a href="/policies">سياسات المتجر</a>.</p>
      </form>
      <aside class="card summary">
        ${view.items.map((i) => html`<div class="row"><span>${i.name} × ${i.quantity}</span><span>${formatMoney(i.price * i.quantity, settings.currency)}</span></div>`)}
        <div class="row"><span>التوصيل</span><span>${view.shipping ? formatMoney(view.shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(view.total, settings.currency)}</span></div>
      </aside>
    </div>`;
}

export function orderPlaced({ settings, order }) {
  return html`
    <section class="card center">
      <h1>شكراً لك! تم استلام طلبك</h1>
      <p>رقم الطلب: <strong dir="ltr">${order.number}</strong></p>
      <p>الإجمالي: ${formatMoney(order.total, order.currency)} — ${PAYMENT_METHODS[order.payment_method]}</p>
      ${order.payment_method === 'bank_transfer' && settings.bank_details ? html`<div class="alert">بيانات التحويل:<br>${settings.bank_details}<br>نؤكد طلبك بعد التحقق من التحويل.</div>` : ''}
      <p>تقدر تتابع حالة طلبك من <a href="/track?number=${order.number}">صفحة التتبع</a> برقم الطلب وجوالك.</p>
    </section>`;
}

export function track({ order, values = {}, notFound }) {
  return html`
    <h1 class="page-title">تتبع طلبك</h1>
    <form method="get" action="/track" class="card form inline-form">
      <label>رقم الطلب <input name="number" required dir="ltr" value="${values.number ?? ''}"></label>
      <label>رقم الجوال <input name="phone" required dir="ltr" inputmode="tel" value="${values.phone ?? ''}"></label>
      <button class="btn primary" type="submit">تتبع</button>
    </form>
    ${notFound ? html`<p class="alert error">ما لقينا طلب بهذي البيانات.</p>` : ''}
    ${order ? html`
      <section class="card">
        <h2>طلب #${order.number}</h2>
        <ol class="steps">
          ${['new', 'confirmed', 'processing', 'shipped', 'delivered'].map((s) => html`<li class="${stepClass(order.status, s)}">${ORDER_STATUS[s]}</li>`)}
        </ol>
        ${order.status === 'cancelled' ? html`<p class="alert error">تم إلغاء هذا الطلب.</p>` : ''}
        <p>الدفع: ${PAYMENT_STATUS[order.payment_status]}${order.tracking_number ? html` — رقم الشحنة: <span dir="ltr">${order.tracking_number}</span>` : ''}</p>
        <ul>${order.items.map((i) => html`<li>${i.name} × ${i.quantity}</li>`)}</ul>
        <p class="muted">تاريخ الطلب: ${formatDate(order.created_at)}</p>
      </section>` : ''}`;
}

const ORDER_FLOW = ['new', 'confirmed', 'processing', 'shipped', 'delivered'];
function stepClass(current, step) {
  if (current === 'cancelled') return '';
  return ORDER_FLOW.indexOf(step) <= ORDER_FLOW.indexOf(current) ? 'done' : '';
}

export function policies({ settings }) {
  const p = settings.policies;
  return html`
    <h1 class="page-title">سياسات المتجر</h1>
    <section class="card prose">
      <h2>الشحن والتوصيل</h2><p>${p.shipping}</p>
      <h2>الاسترجاع والاستبدال</h2><p>${p.returns}</p>
      <h2>الدفع</h2><p>${p.payment}</p>
      <h2>الخصوصية</h2><p>${p.privacy}</p>
    </section>`;
}

export function notFound() {
  return html`<section class="card center"><h1>الصفحة غير موجودة</h1><p><a href="/">العودة للرئيسية</a></p></section>`;
}
