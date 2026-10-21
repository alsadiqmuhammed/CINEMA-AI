import { config } from '../config.js';
import { html, raw, toString } from '../lib/html.js';
import { formatDate, formatMoney, ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from '../lib/format.js';

// Small inline icons (stroke follows currentColor); inline SVG keeps them inside the CSP.
const icon = {
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  bag: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'),
  truck: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>'),
  cash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>'),
  gift: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1"/></svg>'),
};

/** Promises shown in the hero and footer, built from the store's own settings. */
function promises(settings) {
  const list = [{ icon: icon.cash, text: 'الدفع نقداً عند الاستلام' }, { icon: icon.truck, text: 'توصيل لكل المحافظات' }];
  if (Number(settings.free_shipping_over) > 0) {
    list.push({ icon: icon.gift, text: `التوصيل مجاني فوق ${formatMoney(settings.free_shipping_over, settings.currency)}` });
  }
  return list;
}

export function layout({ settings, title, description, body, cartCount = 0, canonical, jsonLd }) {
  const pageTitle = title ? `${title} | ${settings.store_name}` : settings.store_name;
  return '<!doctype html>' + toString(html`
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1d3b8b">
  <title>${pageTitle}</title>
  <meta name="description" content="${description ?? settings.store_tagline}">
  ${canonical ? html`<link rel="canonical" href="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${description ?? settings.store_tagline}">
  <link rel="preload" href="/static/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/static/fonts/reem-kufi-arabic-700-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/css/store.css?v=${config.assetVersion}">
  ${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
</head>
<body>
  <a class="skip" href="#main">انتقل للمحتوى</a>
  <header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/">${settings.store_name}</a>
      <form class="search" action="/search" method="get" role="search">
        ${icon.search}
        <input type="search" name="q" placeholder="شنو تدوّر عليه؟" aria-label="بحث في المنتجات">
      </form>
      <nav class="header-links" aria-label="روابط المتجر">
        <a href="/track">تتبع طلبك</a>
        <a href="/cart" class="cart-link" aria-label="السلة، فيها ${cartCount} منتج">${icon.bag}<span class="badge" id="cart-count">${cartCount}</span></a>
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">${body}</main>
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <a class="brand" href="/">${settings.store_name}</a>
        <p>${settings.store_tagline}</p>
      </div>
      <ul class="footer-promises">${promises(settings).map((p) => html`<li>${p.icon}${p.text}</li>`)}</ul>
      <div class="footer-links">
        <a href="/track">تتبع طلبك</a>
        <a href="/policies">الشحن والاسترجاع والخصوصية</a>
        ${settings.support_phone ? html`<a href="tel:${settings.support_phone}" dir="ltr">${settings.support_phone}</a>` : ''}
        ${settings.support_email ? html`<a href="mailto:${settings.support_email}">${settings.support_email}</a>` : ''}
      </div>
    </div>
  </footer>
  <div id="chat-root"></div>
  <script src="/static/js/chat.js?v=${config.assetVersion}" defer></script>
</body>
</html>`);
}

function productCard(p, currency) {
  const onSale = p.compare_at_price > p.price;
  return html`
    <a class="product-card" href="/p/${encodeURIComponent(p.slug)}">
      <div class="arch">
        ${p.image_url ? html`<img src="${p.image_url}" alt="${p.name}" loading="lazy">` : html`<span class="noimg" aria-hidden="true">${p.name.slice(0, 1)}</span>`}
        ${p.stock > 0 ? (onSale ? html`<span class="flag sale">تخفيض</span>` : '') : html`<span class="flag out">نفدت الكمية</span>`}
      </div>
      <h3>${p.name}</h3>
      <div class="price">
        <span>${formatMoney(p.price, currency)}</span>
        ${onSale ? html`<s>${formatMoney(p.compare_at_price, currency)}</s>` : ''}
      </div>
    </a>`;
}

export function grid(items, currency) {
  if (!items.length) return html`<p class="empty">ماكو منتجات هنا حالياً. <a href="/">ارجع للرئيسية</a></p>`;
  return html`<div class="grid">${items.map((p) => productCard(p, currency))}</div>`;
}

function categoryNav(categories, current) {
  if (!categories?.length) return '';
  return html`
    <nav class="chips" aria-label="الأقسام">
      <a class="chip ${current ? '' : 'active'}" href="/">الكل</a>
      ${categories.map((c) => html`<a class="chip ${current === c.slug ? 'active' : ''}" href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}
    </nav>`;
}

export function home({ settings, categories, items }) {
  const featured = items.find((p) => p.image_url && p.stock > 0) ?? items[0];
  return html`
    <section class="gate">
      <div class="gate-text">
        <h1><span class="gate-name">${settings.store_name}</span><span class="gate-tagline">${settings.store_tagline}</span></h1>
        <ul class="gate-promises">${promises(settings).map((p) => html`<li>${p.icon}${p.text}</li>`)}</ul>
        <a class="btn buy" href="#products">تصفح المنتجات</a>
      </div>
      ${featured ? html`
        <a class="gate-window" href="/p/${encodeURIComponent(featured.slug)}">
          <span class="arch">${featured.image_url ? html`<img src="${featured.image_url}" alt="${featured.name}">` : html`<span class="noimg">${featured.name.slice(0, 1)}</span>`}</span>
          <span class="gate-caption">${featured.name}<b>${formatMoney(featured.price, settings.currency)}</b></span>
        </a>` : ''}
    </section>
    <section id="products" class="shelf">
      <h2 class="section-title">المنتجات</h2>
      ${categoryNav(categories)}
      ${grid(items, settings.currency)}
    </section>`;
}

export function listing({ settings, heading, items, query }) {
  return html`
    <h1 class="page-title">${heading}</h1>
    ${query !== undefined && !items.length
      ? html`<p class="empty">ما لكينا شي لـ "${query}". جرّب كلمة ثانية، أو اسأل المساعد تحت وهو يدوّرلك.</p>`
      : grid(items, settings.currency)}`;
}

export function product({ settings, product: p, related, csrf }) {
  const images = p.images;
  const onSale = p.compare_at_price > p.price;
  return html`
    <nav class="crumbs" aria-label="المسار"><a href="/">الرئيسية</a>${p.category_slug ? html`<span aria-hidden="true">/</span><a href="/c/${encodeURIComponent(p.category_slug)}">${p.category_name}</a>` : ''}</nav>
    <article class="product">
      <div class="gallery">
        <div class="arch large">
          ${images.length ? html`<img src="${images[0].url}" alt="${images[0].alt || p.name}">` : html`<span class="noimg">${p.name.slice(0, 1)}</span>`}
        </div>
        ${images.length > 1 ? html`<div class="thumbs">${images.slice(1).map((img) => html`<img src="${img.url}" alt="${img.alt || p.name}" loading="lazy">`)}</div>` : ''}
      </div>
      <div class="info">
        <h1>${p.name}</h1>
        <div class="price big">
          <span>${formatMoney(p.price, settings.currency)}</span>
          ${onSale ? html`<s>${formatMoney(p.compare_at_price, settings.currency)}</s>` : ''}
        </div>
        ${p.stock > 0
          ? html`<form method="post" action="/cart/add" class="buy-form">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="product_id" value="${p.id}">
              <label class="qty-field">الكمية <input type="number" name="quantity" value="1" min="1" max="${Math.min(p.stock, 20)}" inputmode="numeric"></label>
              <button class="btn buy" type="submit">أضف للسلة</button>
            </form>
            ${p.stock <= p.low_stock_at ? html`<p class="stock-note">باقي ${p.stock} بس</p>` : ''}`
          : html`<p class="stock-note out">نفدت الكمية حالياً. اسأل المساعد ونبلغك من يرجع.</p>`}
        <ul class="assurances">
          <li>${icon.cash}<span><b>الدفع عند الاستلام.</b> افحص طلبك قبل ما تدفع.</span></li>
          <li>${icon.truck}<span><b>التوصيل.</b> ${settings.policies.shipping}</span></li>
        </ul>
        <div class="description">${p.description.split(/\n+/).filter(Boolean).map((line) => html`<p>${line}</p>`)}</div>
        ${p.faq?.length ? html`<section class="faq"><h2>أسئلة شائعة</h2>${p.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</section>` : ''}
      </div>
    </article>
    ${related.length ? html`<section class="shelf"><h2 class="section-title">قد يعجبك أيضاً</h2>${grid(related, settings.currency)}</section>` : ''}`;
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

function freeShippingNote(settings, subtotal, shipping) {
  const threshold = Number(settings.free_shipping_over);
  if (!(threshold > 0) || !shipping) return '';
  const left = threshold - subtotal;
  const progress = Math.max(0, Math.min(100, Math.round((subtotal / threshold) * 100)));
  return html`
    <div class="free-ship">
      <p>ضيف ${formatMoney(left, settings.currency)} ويصير التوصيل مجاني</p>
      <progress max="100" value="${progress}">${progress}%</progress>
    </div>`;
}

export function cart({ settings, view, csrf, error }) {
  const { items, subtotal, shipping, total } = view;
  if (!items.length) {
    return html`
      <h1 class="page-title">السلة</h1>
      <section class="empty-state">
        <p>سلتك فارغة.</p>
        <a class="btn buy" href="/">تصفح المنتجات</a>
      </section>`;
  }
  return html`
    <h1 class="page-title">السلة</h1>
    ${error ? html`<p class="alert error">${error}</p>` : ''}
    <div class="cart-layout">
      <ul class="cart-items">
        ${items.map((item) => html`
          <li class="cart-line">
            <a href="/p/${encodeURIComponent(item.slug)}" class="cart-thumb">${item.image_url ? html`<img src="${item.image_url}" alt="">` : ''}</a>
            <div class="grow">
              <a class="cart-name" href="/p/${encodeURIComponent(item.slug)}">${item.name}</a>
              <div class="muted">${formatMoney(item.price, settings.currency)}</div>
              ${item.status !== 'active' || item.stock < item.quantity ? html`<div class="alert error small">الكمية المتوفرة ${item.stock}</div>` : ''}
            </div>
            <form method="post" action="/cart/update" class="qty">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="product_id" value="${item.product_id}">
              <input type="number" name="quantity" value="${item.quantity}" min="0" max="20" inputmode="numeric" aria-label="كمية ${item.name}">
              <button class="btn ghost small" type="submit">حدّث</button>
            </form>
          </li>`)}
      </ul>
      <aside class="summary">
        <h2>ملخص الطلب</h2>
        <div class="row"><span>المجموع</span><span>${formatMoney(subtotal, settings.currency)}</span></div>
        <div class="row"><span>التوصيل</span><span>${shipping ? formatMoney(shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(total, settings.currency)}</span></div>
        ${freeShippingNote(settings, subtotal, shipping)}
        <a class="btn buy block" href="/checkout">إتمام الطلب</a>
        <p class="hint">الدفع نقداً عند الاستلام</p>
      </aside>
    </div>`;
}

export function checkout({ settings, view, csrf, error, values = {} }) {
  return html`
    <h1 class="page-title">إتمام الطلب</h1>
    ${error ? html`<p class="alert error">${error}</p>` : ''}
    <div class="cart-layout">
      <form method="post" action="/checkout" class="form panel">
        <input type="hidden" name="_csrf" value="${csrf}">
        <fieldset>
          <legend>معلوماتك</legend>
          <label>الاسم <input name="name" required autocomplete="name" value="${values.name ?? ''}"></label>
          <label>رقم الهاتف <input name="phone" required inputmode="tel" autocomplete="tel" dir="ltr" placeholder="07XX XXX XXXX" value="${values.phone ?? ''}"></label>
          <label><span>البريد الإلكتروني <span class="optional">(اختياري)</span></span><input name="email" type="email" autocomplete="email" dir="ltr" value="${values.email ?? ''}"></label>
        </fieldset>
        <fieldset>
          <legend>وين نوصلك؟</legend>
          <label>المحافظة <input name="city" required autocomplete="address-level1" placeholder="مثلاً: بغداد" value="${values.city ?? ''}"></label>
          <label>العنوان <span class="optional">المنطقة، المحلة، وأقرب نقطة دالة</span> <textarea name="address" required rows="2" autocomplete="street-address">${values.address ?? ''}</textarea></label>
          <label><span>ملاحظات للمندوب <span class="optional">(اختياري)</span></span><textarea name="notes" rows="2">${values.notes ?? ''}</textarea></label>
        </fieldset>
        <fieldset>
          <legend>طريقة الدفع</legend>
          <label class="choice"><input type="radio" name="payment_method" value="cod" ${values.payment_method !== 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.cod}</label>
          ${settings.bank_details ? html`<label class="choice"><input type="radio" name="payment_method" value="bank_transfer" ${values.payment_method === 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.bank_transfer}</label>` : ''}
        </fieldset>
        <label class="check"><input type="checkbox" name="marketing_opt_in" value="1" ${values.marketing_opt_in ? raw('checked') : ''}> دزّولي العروض على واتساب</label>
        <button class="btn buy block" type="submit">أكّد الطلب، ${formatMoney(view.total, settings.currency)}</button>
        <p class="hint">بتأكيد الطلب أنت توافق على <a href="/policies">سياسات المتجر</a>.</p>
      </form>
      <aside class="summary">
        <h2>طلبك</h2>
        ${view.items.map((i) => html`<div class="row"><span>${i.name} × ${i.quantity}</span><span>${formatMoney(i.price * i.quantity, settings.currency)}</span></div>`)}
        <div class="row"><span>التوصيل</span><span>${view.shipping ? formatMoney(view.shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(view.total, settings.currency)}</span></div>
      </aside>
    </div>`;
}

export function orderPlaced({ settings, order }) {
  return html`
    <section class="placed">
      <div class="arch seal" aria-hidden="true"><span>✓</span></div>
      <h1>وصلنا طلبك</h1>
      <p class="order-number">رقم الطلب <strong dir="ltr">${order.number}</strong></p>
      <p>الإجمالي ${formatMoney(order.total, order.currency)}، ${PAYMENT_METHODS[order.payment_method]}.</p>
      ${order.payment_method === 'bank_transfer' && settings.bank_details ? html`<div class="alert">بيانات التحويل:<br>${settings.bank_details}<br>نأكد طلبك بعد ما نتحقق من التحويل.</div>` : ''}
      <p class="muted">راح نتصل بيك حتى نأكد الطلب. وتكدر تتابعه برقم الطلب ورقم هاتفك.</p>
      <a class="btn ghost" href="/track?number=${order.number}">تتبع الطلب</a>
    </section>`;
}

const ORDER_FLOW = ['new', 'confirmed', 'processing', 'shipped', 'delivered'];
function stepClass(current, step) {
  if (current === 'cancelled') return '';
  const [a, b] = [ORDER_FLOW.indexOf(step), ORDER_FLOW.indexOf(current)];
  return a < b ? 'done' : a === b ? 'done current' : '';
}

export function track({ order, values = {}, notFound }) {
  return html`
    <h1 class="page-title">تتبع طلبك</h1>
    <form method="get" action="/track" class="form panel inline-form">
      <label>رقم الطلب <input name="number" required dir="ltr" value="${values.number ?? ''}"></label>
      <label>رقم الهاتف <input name="phone" required dir="ltr" inputmode="tel" placeholder="07XX XXX XXXX" value="${values.phone ?? ''}"></label>
      <button class="btn primary" type="submit">تتبع</button>
    </form>
    ${notFound ? html`<p class="alert error">لم نجد طلباً بهذه البيانات. تأكد من رقم الطلب ورقم الهاتف اللي سجلت بيه.</p>` : ''}
    ${order ? html`
      <section class="panel tracked">
        <h2>طلب #${order.number}</h2>
        ${order.status === 'cancelled'
          ? html`<p class="alert error">تم إلغاء هذا الطلب.</p>`
          : html`<ol class="steps">${ORDER_FLOW.map((s) => html`<li class="${stepClass(order.status, s)}">${ORDER_STATUS[s]}</li>`)}</ol>`}
        <dl class="facts">
          <dt>الدفع</dt><dd>${PAYMENT_STATUS[order.payment_status]}</dd>
          ${order.tracking_number ? html`<dt>رقم الشحنة</dt><dd dir="ltr">${order.tracking_number}</dd>` : ''}
          <dt>تاريخ الطلب</dt><dd>${formatDate(order.created_at)}</dd>
        </dl>
        <ul class="tracked-items">${order.items.map((i) => html`<li>${i.name} × ${i.quantity}</li>`)}</ul>
      </section>` : ''}`;
}

export function policies({ settings }) {
  const p = settings.policies;
  return html`
    <h1 class="page-title">سياسات المتجر</h1>
    <section class="prose">
      <h2>الشحن والتوصيل</h2><p>${p.shipping}</p>
      <h2>الاسترجاع والاستبدال</h2><p>${p.returns}</p>
      <h2>الدفع</h2><p>${p.payment}</p>
      <h2>الخصوصية</h2><p>${p.privacy}</p>
    </section>`;
}

export function notFound() {
  return html`
    <section class="placed">
      <div class="arch seal" aria-hidden="true"><span>؟</span></div>
      <h1>الصفحة غير موجودة</h1>
      <p class="muted">يمكن الرابط تغيّر أو المنتج انشال.</p>
      <a class="btn primary" href="/">ارجع للرئيسية</a>
    </section>`;
}
