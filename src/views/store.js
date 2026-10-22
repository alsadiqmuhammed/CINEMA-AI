import { config } from '../config.js';
import { html, raw, toString } from '../lib/html.js';
import { formatDate, formatMoney, GOVERNORATES, ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from '../lib/format.js';
import { SORTS } from '../services/products.js';

// Small inline icons (stroke follows currentColor); inline SVG keeps them inside the CSP.
const icon = {
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  bag: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  chat: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>'),
  menu: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>'),
  cash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>'),
  eye: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'),
  truck: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/></svg>'),
  back: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h16"/></svg>'),
  phone: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/></svg>'),
  next: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>'),
  prev: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'),
};

export { GOVERNORATES };

/** Delivery time by governorate, as the shipping policy states it. */
function deliveryDays(governorate) {
  return governorate === 'بغداد' ? 'خلال يوم أو يومين' : 'خلال 2 إلى 4 أيام';
}

/** The delivery fee in one phrase, so it is known before the cart. */
function deliveryFee(settings) {
  const fee = Number(settings.shipping_fee);
  const free = Number(settings.free_shipping_over);
  if (!(fee > 0)) return 'والتوصيل مجاني';
  return free > 0
    ? `بـ ${formatMoney(fee, settings.currency)}، ومجاني إذا طلبك فوق ${formatMoney(free, settings.currency)}`
    : `بـ ${formatMoney(fee, settings.currency)}`;
}

/** The fee in a few words for the notice strip. */
function shortFee(settings) {
  const fee = Number(settings.shipping_fee);
  const free = Number(settings.free_shipping_over);
  if (!(fee > 0)) return 'مجاناً';
  return free > 0 ? `بـ ${formatMoney(fee, settings.currency)}، ومجاني فوق ${formatMoney(free, settings.currency)}` : `بـ ${formatMoney(fee, settings.currency)}`;
}

export function toast() {
  return html`<div class="toast" role="status"><span>انضاف للسلة</span><a href="/cart">شوف السلة</a><a href="/checkout" class="toast-go">كمّل الطلب</a><button type="button" class="toast-close" aria-label="سد التنبيه">×</button></div>`;
}

/** wa.me link for the store's support number (local 07… numbers become 9647…). */
function whatsappLink(settings) {
  return `https://wa.me/${String(settings.support_phone ?? '').replace(/\D/g, '').replace(/^0/, '964')}`;
}

export function layout({ settings, title, description, body, cartCount = 0, canonical, jsonLd, ogImage, categories = [], path = '', added = false }) {
  const pageTitle = title ? `${title} | ${settings.store_name}` : `${settings.store_name} | تسوّق أونلاين بالعراق، والدفع عند الاستلام`;
  const metaDescription = String(description ?? settings.store_tagline).replace(/\s*[\n•]+\s*/g, ' ').trim();
  const current = (href) => (path === href ? raw('aria-current="page"') : '');
  const links = html`
    <a href="/products" ${current('/products')}>كل المنتجات</a>
    ${categories.map((c) => html`<a href="/c/${encodeURIComponent(c.slug)}" ${current(`/c/${c.slug}`)}>${c.name}</a>`)}
    <a href="/offers" ${current('/offers')}>العروض</a>
    <a href="/track" ${current('/track')}>تتبع طلبك</a>`;
  return '<!doctype html>' + toString(html`
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f5f5f7">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDescription}">
  ${canonical ? html`<link rel="canonical" href="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${settings.store_name}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDescription}">
  ${canonical ? html`<meta property="og:url" content="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:image" content="${ogImage ?? `${config.baseUrl}/static/img/products/gift.jpg`}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/static/fonts/noto-sans-arabic-arabic-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/css/store.css?v=${config.assetVersion}">
  ${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
</head>
<body>
  <a class="skip" href="#main">انتقل للمحتوى</a>
  <header class="gnav">
    <div class="gnav-in">
      <a class="wordmark" href="/" translate="no">${settings.store_name}</a>
      <nav class="gnav-links" aria-label="روابط المتجر">${links}</nav>
      <details class="gnav-menu">
        <summary aria-label="القائمة">${icon.menu}</summary>
        <nav aria-label="روابط المتجر">${links}</nav>
      </details>
      <div class="gnav-end">
        <form class="bar-search" action="/search" method="get" role="search">
          <input type="search" name="q" placeholder="دوّر: عود، مسك، هدية…" aria-label="بحث في المنتجات">
          <button type="submit" aria-label="ابحث">${icon.search}</button>
        </form>
        <a href="/cart" class="cart-button" aria-label="السلة، فيها ${cartCount} منتج">${icon.bag}<b id="cart-count" ${cartCount ? '' : raw('hidden')}>${cartCount}</b></a>
      </div>
    </div>
  </header>
  <p class="ribbon">الدفع عند الاستلام، وتفحص طلبك قبل ما تدفع. توصيل لكل المحافظات ${shortFee(settings)}. <a href="/policies">اعرف أكثر</a></p>
  ${added ? toast() : ''}
  <main id="main" class="wrap">${body}</main>
  <footer class="footer">
    <div class="footer-in">
      <p class="footer-note">الدفع نقداً عند الاستلام بكل المحافظات، وتكدر تفحص طلبك قبل ما تدفع. الترجيع خلال 7 أيام إذا المنتج بحالته الأصلية. صور المنتجات توضيحية.</p>
      <div class="footer-cols">
        ${categories.length ? html`<div><b>تسوّق</b>${categories.map((c) => html`<a href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}<a href="/offers">العروض</a></div>` : ''}
        <div><b>طلبك</b><a href="/cart">السلة</a><a href="/track">تتبع طلبك</a><a href="/policies">الشحن والترجيع</a></div>
        <div><b>تواصل ويانا</b><button type="button" class="link" data-open-chat>اسألنا بالمحادثة</button>${settings.support_phone ? html`<a href="${whatsappLink(settings)}" rel="noopener">واتساب <span dir="ltr">${settings.support_phone}</span></a>` : ''}${settings.support_email ? html`<a href="mailto:${settings.support_email}">${settings.support_email}</a>` : ''}</div>
      </div>
      <div class="footer-legal">
        <p translate="no">${settings.store_name}</p>
        <p>متجر عراقي أونلاين. <a href="/policies">السياسات</a> <a href="/policies#privacy">الخصوصية</a></p>
      </div>
    </div>
  </footer>
  <div id="chat-root"></div>
  <script src="/static/js/chat.js?v=${config.assetVersion}" defer></script>
  <script src="/static/js/site.js?v=${config.assetVersion}" defer></script>
</body>
</html>`);
}

// Our own pictures are cached for a week; the version makes a redrawn one show at once.
const asset = (url) => (url.startsWith('/static/') ? `${url}?v=${config.assetVersion}` : url);

/** Our photographs come in a 480px copy too; the browser picks the size the slot needs. */
function srcset(url, sizes) {
  const m = /^(\/static\/img\/products\/[a-z]+)\.webp$/.exec(url ?? '');
  return m ? raw(`srcset="${asset(`${m[1]}-480.webp`)} 480w, ${asset(url)} 896w" sizes="${sizes}"`) : '';
}

function productImage(p, { lazy = true, w = 800, h = 1000, sizes = '(max-width: 760px) 50vw, 30vw' } = {}) {
  return p.image_url
    ? html`<img src="${asset(p.image_url)}" ${srcset(p.image_url, sizes)} alt="${p.name}" width="${w}" height="${h}" ${lazy ? raw('loading="lazy"') : raw('fetchpriority="high"')}>`
    : html`<span class="noimg" aria-hidden="true">${p.name.slice(0, 1)}</span>`;
}

function priceTag(p, currency) {
  const onSale = p.compare_at_price > p.price;
  return html`<span class="price"><span>${formatMoney(p.price, currency)}</span>${onSale ? html`<s>${formatMoney(p.compare_at_price, currency)}</s>` : ''}</span>`;
}

function quickAdd(p, csrf, back, label = 'ضيف') {
  if (!csrf || !(p.stock > 0)) return '';
  return html`
    <form method="post" action="/cart/add" class="quick-add">
      <input type="hidden" name="_csrf" value="${csrf}">
      <input type="hidden" name="product_id" value="${p.id}">
      <input type="hidden" name="back" value="${back ?? '/'}">
      <button type="submit" class="btn small" aria-label="ضيف ${p.name} للسلة">${icon.plus}<span>${label}</span></button>
    </form>`;
}

/** The line under a product's name: the first sentence of its description. */
const teaser = (p) => String(p.description ?? '').split(/\n+|(?<=[.!؟])\s/)[0].slice(0, 90);

function flagOf(p) {
  const onSale = p.compare_at_price > p.price;
  if (!(p.stock > 0)) return 'نفدت الكمية';
  if (onSale) return `وفّر ${Math.round((1 - p.price / p.compare_at_price) * 100)}%`;
  if (p.stock <= (p.low_stock_at ?? 0)) return `باقي ${p.stock} بس`;
  return '';
}

function productCard(p, currency, { csrf, back, eyebrow } = {}) {
  const flag = eyebrow ?? flagOf(p);
  return html`
    <article class="tile">
      <a class="tile-link" href="/p/${encodeURIComponent(p.slug)}">
        ${productImage(p, { sizes: '(max-width: 760px) 80vw, 400px' })}
        <span class="tile-text">
          ${flag ? html`<span class="tile-eyebrow">${flag}</span>` : ''}
          <h3 class="tile-name">${p.name}</h3>
          <span class="tile-desc">${teaser(p)}</span>
          ${priceTag(p, currency)}
        </span>
      </a>
      ${quickAdd(p, csrf, back)}
    </article>`;
}

export function grid(items, currency, options = {}) {
  if (!items.length) return html`<p class="empty">هذا القسم يتجهّز، ارجعلنا قريب. <a href="/products">شوف كل المنتجات</a></p>`;
  return html`<div class="grid">${items.map((p) => productCard(p, currency, options))}</div>`;
}

/** A row of cards that scrolls sideways, with arrows on wide screens (Apple's store shelf). */
function shelf({ id, lead, rest, items, more }) {
  return html`
    <section class="shelf" aria-labelledby="${id}">
      <div class="shelf-head">
        <h2 class="shelf-title" id="${id}"><b>${lead}</b> ${rest}</h2>
        ${more ?? ''}
      </div>
      <div class="shelf-row" data-shelf tabindex="0" aria-label="${lead}">${items}</div>
      <div class="paddles"><button type="button" class="paddle" data-dir="-1" aria-label="السابق">${icon.prev}</button><button type="button" class="paddle" data-dir="1" aria-label="التالي">${icon.next}</button></div>
    </section>`;
}

function categoryNav(categories, current) {
  if (!categories?.length) return '';
  return html`
    <nav class="pills" aria-label="الأقسام">
      <a class="pill ${current ? '' : 'active'}" href="/products">الكل</a>
      ${categories.map((c) => html`<a class="pill ${current === c.slug ? 'active' : ''}" href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}
    </nav>`;
}

export function home({ settings, categories, newest, onSale, bestSellers, csrf }) {
  const latest = (newest.length ? newest : [...onSale, ...bestSellers]).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
  const card = (p, eyebrow) => productCard(p, settings.currency, { csrf, back: '/', eyebrow });
  const why = [
    [icon.cash, 'الدفع عند الاستلام.', 'تدفع نقداً للمندوب من يوصلك الطلب. ماكو بطاقة ولا تحويل.'],
    [icon.eye, 'تفحص قبل ما تدفع.', 'تفتح طلبك ويه المندوب وتشوفه بعينك، وتدفع بس إذا عجبك.'],
    [icon.phone, 'نتصل نأكد قبل الشحن.', 'ما نشحن أي طلب قبل ما نسمع صوتك ونتأكد من العنوان.'],
    [icon.back, 'ترجيع خلال 7 أيام.', 'إذا ما عجبك والمنتج بحالته الأصلية، نرتب الرجعة وياك.'],
  ];
  return html`
    <section class="store-head">
      <h1 class="store-title" translate="no">${settings.store_name}</h1>
      <div class="store-pitch">
        <p>أحلى طريقة تشتري بيها العطور والعود والهدايا.</p>
        <button type="button" class="more" data-open-chat>اسأل مختص</button>
        <a class="more" href="/track">تتبع طلبك</a>
      </div>
    </section>

    ${categories.length ? html`
      <nav class="catnav" aria-label="الأقسام">
        ${categories.map((c) => html`
          <a class="catnav-item" href="/c/${encodeURIComponent(c.slug)}">
            <span class="catnav-img">${c.image_url ? html`<img src="${asset(c.image_url)}" ${srcset(c.image_url, '120px')} alt="" width="120" height="150" loading="lazy">` : ''}</span>
            <span>${c.name}</span>
          </a>`)}
        <a class="catnav-item" href="/offers"><span class="catnav-img catnav-word">٪</span><span>العروض</span></a>
      </nav>` : ''}

    ${latest.length ? shelf({ id: 'latest', lead: 'الأحدث.', rest: 'شوف شنو وصل جديد.', items: latest.map((p, i) => card(p, i < 2 && newest.length ? 'جديد' : undefined)) }) : ''}

    ${shelf({ id: 'why', lead: 'الفرق بسوگ.', rest: 'أسباب أكثر تتسوّق ويانا مرتاح.', items: html`
      ${why.map(([ic, title, text]) => html`<article class="tile tile-light"><span class="tile-icon">${ic}</span><h3 class="tile-name">${title}</h3><p class="tile-desc">${text}</p></article>`)}
      <article class="tile tile-light tile-wide" data-estimate data-fee="${deliveryFee(settings)}">
        <span class="tile-icon">${icon.truck}</span>
        <h3 class="tile-name">شكد يطول التوصيل؟</h3>
        <label for="gov" class="tile-desc">اختار محافظتك</label>
        <select id="gov">${GOVERNORATES.map((g) => html`<option data-days="${deliveryDays(g)}">${g}</option>`)}</select>
        <output for="gov" aria-live="polite"><b>${deliveryDays('بغداد')}</b><span>التوصيل ${deliveryFee(settings)}</span></output>
      </article>` })}

    ${onSale.length ? shelf({ id: 'offers', lead: 'العروض.', rest: 'أسعار أقل لحد ما تخلص الكمية.', items: onSale.map((p) => card(p)), more: html`<a class="more" href="/offers">كل العروض</a>` }) : ''}

    <section class="help">
      <div class="help-card">
        <h2>عندك سؤال؟ <span>احجي ويانا.</span></h2>
        <p>مساعدنا يرد بثواني على الأسعار والتوفّر وطلبك. وإذا تريد موظف، يحوّلك لواحد من الفريق.</p>
        <div class="help-actions"><button type="button" class="btn primary" data-open-chat>ابدي المحادثة</button><a class="btn" href="/track">تتبع طلبك</a></div>
      </div>
    </section>

    <section class="faq-home" aria-labelledby="faq-title">
      <h2 class="shelf-title" id="faq-title"><b>أسئلة الزبائن.</b></h2>
      <details><summary>شلون أدفع؟</summary><p>${settings.policies.payment}</p></details>
      <details><summary>إذا ما عجبني، أكدر أرجّعه؟</summary><p>${settings.policies.returns}</p></details>
      <details><summary>شلون أتابع طلبي؟</summary><p>من <a href="/track">تتبع طلبك</a> برقم الطلب ورقم هاتفك، أو اسألنا بالمحادثة.</p></details>
      <details><summary>أحجي ويه منو بالمحادثة؟</summary><p>مساعد آلي يرد بثواني على الأسعار والتوفّر. إذا تريد موظف، اكتب "أريد موظف" ويحوّلك لواحد من الفريق.</p></details>
    </section>`;
}

export function listing({ settings, heading, intro, items, query, sort, categories, currentCategory, here, csrf, page = 1, hasNext = false }) {
  const back = here ?? '/';
  return html`
    <div class="listing-head">
      <h1 class="page-title">${heading}</h1>
      ${intro ? html`<p class="lead">${intro}</p>` : ''}
    </div>
    <div class="listing-tools">
      <form class="search" action="/search" method="get" role="search">
        ${icon.search}
        <input type="search" name="q" value="${query ?? ''}" placeholder="شنو تدوّر عليه…" aria-label="بحث في المنتجات">
      </form>
      ${sort && items.length > 1 ? html`
        <form class="sort" method="get">
          <label for="sort">رتّب</label>
          <select id="sort" name="sort">${Object.entries(SORTS).map(([key, s]) => html`<option value="${key}" ${key === sort ? raw('selected') : ''}>${s.label}</option>`)}</select>
          <button class="btn small quiet sort-apply" type="submit">طبّق</button>
        </form>` : ''}
    </div>
    ${query === undefined ? categoryNav(categories, currentCategory) : ''}
    ${items.length && page === 1 && !hasNext ? html`<p class="count">${items.length} ${items.length > 10 || items.length < 3 ? 'منتج' : 'منتجات'}</p>` : ''}
    ${query !== undefined && !items.length
      ? html`<p class="empty">ما لكينا "${query}". جرّب: <a href="/search?q=عود">عود</a>، <a href="/search?q=مسك">مسك</a>، <a href="/search?q=هدية">هدية</a>، أو <button class="link" type="button" data-open-chat>اسألنا</button> ونلكاه إلك.</p>`
      : grid(items, settings.currency, { csrf, back })}
    ${page > 1 || hasNext ? html`<nav class="pager" aria-label="الصفحات">
      ${page > 1 ? html`<a class="btn quiet" href="${pageLink(here, page - 1)}" rel="prev">الصفحة السابقة</a>` : html`<span></span>`}
      <span class="muted">صفحة ${page}</span>
      ${hasNext ? html`<a class="btn quiet" href="${pageLink(here, page + 1)}" rel="next">الصفحة الجاية</a>` : html`<span></span>`}
    </nav>` : ''}`;
}

function pageLink(here, page) {
  const url = new URL(here ?? '/products', 'http://local');
  if (page > 1) url.searchParams.set('page', page); else url.searchParams.delete('page');
  return url.pathname + url.search;
}

export function product({ settings, product: p, related, csrf }) {
  const images = p.images;
  const onSale = p.compare_at_price > p.price;
  return html`
    <nav class="crumbs" aria-label="المسار"><a href="/">الرئيسية</a>${p.category_slug ? html`<span aria-hidden="true">/</span><a href="/c/${encodeURIComponent(p.category_slug)}">${p.category_name}</a>` : ''}<span aria-hidden="true">/</span><span aria-current="page">${p.name}</span></nav>
    <article class="product">
      <div class="gallery">
        <div class="frame large">
          ${images.length ? html`<img src="${asset(images[0].url)}" ${srcset(images[0].url, '(max-width: 760px) 100vw, 50vw')} alt="${images[0].alt || p.name}" width="800" height="1000" fetchpriority="high">` : html`<span class="noimg">${p.name.slice(0, 1)}</span>`}
        </div>
        ${images.length > 1 ? html`<div class="thumbs">${images.map((img, i) => html`<button type="button" class="thumb ${i ? '' : 'current'}" data-src="${asset(img.url)}" aria-label="عرض الصورة ${i + 1}"><img src="${asset(img.url)}" alt="" loading="lazy"></button>`)}</div>` : ''}
      </div>
      <div class="info">
        ${flagOf(p) ? html`<p class="eyebrow-new">${flagOf(p)}</p>` : ''}
        <h1>${p.name}</h1>
        <p class="info-teaser">${teaser(p)}</p>
        <p class="price big"><span>${formatMoney(p.price, settings.currency)}</span>${onSale ? html`<s>${formatMoney(p.compare_at_price, settings.currency)}</s>` : ''}</p>
        ${p.stock > 0
          ? html`<form method="post" action="/cart/add" class="buy-form">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="back" value="/p/${encodeURIComponent(p.slug)}">
              <input type="hidden" name="product_id" value="${p.id}">
              <label class="qty-field">الكمية <input type="number" name="quantity" value="1" min="1" max="${Math.min(p.stock, 20)}" inputmode="numeric"></label>
              <span class="buy-price" aria-hidden="true">${formatMoney(p.price, settings.currency)}</span>
              <button class="btn primary" type="submit">ضيف للسلة</button>
            </form>
            ${p.stock <= p.low_stock_at ? html`<p class="stock-note">باقي ${p.stock} بس</p>` : ''}`
          : html`<p class="stock-note">خلص هسة. <button class="link" type="button" data-open-chat data-ask="أريد أعرف شوكت يرجع ${p.name}">اسألنا</button> ونبلغك أول ما يرجع.</p>`}
        <dl class="assurances">
          <div>${icon.truck}<dt>التوصيل</dt><dd>لكل المحافظات ${deliveryFee(settings)}. ${settings.policies.shipping}</dd></div>
          <div>${icon.cash}<dt>الدفع عند الاستلام</dt><dd>نقداً للمندوب، وتفحص طلبك قبل ما تدفع.</dd></div>
          <div>${icon.back}<dt>ترجيع خلال 7 أيام</dt><dd>إذا المنتج بحالته الأصلية.</dd></div>
        </dl>
        <p class="product-ways">
          <button class="more" type="button" data-open-chat data-ask="عندي سؤال عن ${p.name}">عندك سؤال؟ احجي ويا مختص</button>
          <a class="more" href="https://wa.me/?text=${encodeURIComponent(`${p.name}، ${formatMoney(p.price, settings.currency)}: ${config.baseUrl}/p/${encodeURIComponent(p.slug)}`)}" rel="noopener">دزّه لواحد بالواتساب</a>
        </p>
        <div class="description">${p.description.split(/\n+/).filter(Boolean).map((line) => html`<p>${line}</p>`)}</div>
        ${p.faq?.length ? html`<section class="faq"><h2>أسئلة عن المنتج</h2>${p.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</section>` : ''}
      </div>
    </article>
    ${related.length ? shelf({ id: 'related', lead: 'قد يعجبك أيضاً.', rest: 'يمشي ويا اختيارك.', items: related.map((r) => productCard(r, settings.currency, { csrf, back: `/p/${encodeURIComponent(p.slug)}` })) }) : ''}`;
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
  const progress = Math.max(0, Math.min(100, Math.round((subtotal / threshold) * 100)));
  return html`
    <div class="free-ship">
      <p>ضيف ${formatMoney(threshold - subtotal, settings.currency)} ويصير التوصيل مجاني</p>
      <progress max="100" value="${progress}">${progress}%</progress>
    </div>`;
}

export function cart({ settings, view, csrf, error, suggestions = [] }) {
  const { items, subtotal, shipping, total } = view;
  if (!items.length) {
    return html`
      <h1 class="page-title">السلة</h1>
      ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
      <section class="empty-state">
        <p class="lead">سلتك بعدها فارغة. شوف العطور والهدايا اللي اخترناها.</p>
        <a class="btn primary" href="/products">ابدي التسوّق</a>
      </section>
      ${suggestions.length ? shelf({ id: 'start', lead: 'تبدي منها.', rest: 'مختارات من المتجر.', items: suggestions.map((p) => productCard(p, settings.currency, { csrf, back: '/cart' })) }) : ''}`;
  }
  return html`
    <header class="bag-head">
      <h1 class="page-title">مجموع سلتك ${formatMoney(total, settings.currency)}.</h1>
      <p class="lead">${shipping ? `التوصيل ${formatMoney(shipping, settings.currency)}، والدفع عند الاستلام.` : 'التوصيل مجاني، والدفع عند الاستلام.'}</p>
      <a class="btn primary" href="/checkout">إتمام الطلب</a>
    </header>
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    <div class="cart-layout">
      <ul class="cart-items">
        ${items.map((item) => html`
          <li class="cart-line">
            <a href="/p/${encodeURIComponent(item.slug)}" class="cart-thumb" aria-label="${item.name}">${item.image_url ? html`<img src="${asset(item.image_url)}" alt="" width="72" height="90" loading="lazy">` : ''}</a>
            <div class="grow">
              <a class="cart-name" href="/p/${encodeURIComponent(item.slug)}">${item.name}</a>
              <div class="muted">${formatMoney(item.price, settings.currency)}</div>
              ${item.status !== 'active' || item.stock < item.quantity ? html`<div class="alert small">الكمية المتوفرة ${item.stock}</div>` : ''}
            </div>
            <div class="stepper" role="group" aria-label="كمية ${item.name}">
              <form method="post" action="/cart/update">
                <input type="hidden" name="_csrf" value="${csrf}">
                <input type="hidden" name="product_id" value="${item.product_id}">
                <input type="hidden" name="quantity" value="${item.quantity + 1}">
                <button type="submit" aria-label="زيد واحد" ${item.quantity >= Math.min(item.stock, 20) ? raw('disabled') : ''}>+</button>
              </form>
              <output aria-live="polite">${item.quantity}</output>
              <form method="post" action="/cart/update">
                <input type="hidden" name="_csrf" value="${csrf}">
                <input type="hidden" name="product_id" value="${item.product_id}">
                <input type="hidden" name="quantity" value="${item.quantity - 1}">
                <button type="submit" aria-label="نقّص واحد">−</button>
              </form>
            </div>
            <form method="post" action="/cart/update" class="remove">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="product_id" value="${item.product_id}">
              <input type="hidden" name="quantity" value="0">
              <button class="link" type="submit" aria-label="احذف ${item.name} من السلة">احذف</button>
            </form>
          </li>`)}
      </ul>
      <aside class="summary">
        <h2>ملخص الطلب</h2>
        <div class="row"><span>المجموع</span><span>${formatMoney(subtotal, settings.currency)}</span></div>
        <div class="row"><span>التوصيل</span><span>${shipping ? formatMoney(shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(total, settings.currency)}</span></div>
        ${freeShippingNote(settings, subtotal, shipping)}
        <a class="btn primary block" href="/checkout">إتمام الطلب</a>
        <p class="hint">الدفع نقداً عند الاستلام، وتفحص قبل ما تدفع</p>
        <a class="continue" href="/products">كمّل التسوّق</a>
      </aside>
    </div>`;
}

export function checkout({ settings, view, csrf, error, values = {} }) {
  return html`
    <h1 class="page-title">إتمام الطلب</h1>
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    <div class="cart-layout">
      <form method="post" action="/checkout" class="form" data-remember>
        <input type="hidden" name="_csrf" value="${csrf}">
        <fieldset>
          <legend>معلوماتك</legend>
          <label>الاسم <input name="name" required autocomplete="name" value="${values.name ?? ''}"></label>
          <label>رقم الهاتف <input name="phone" type="tel" required inputmode="tel" autocomplete="tel" dir="ltr" placeholder="07XX XXX XXXX" pattern="[\s\d+٠-٩]{10,16}" title="رقم موبايل عراقي، مثل 07701234567" value="${values.phone ?? ''}"></label>
          <label><span>البريد الإلكتروني <span class="optional">(اختياري)</span></span><input name="email" type="email" autocomplete="email" spellcheck="false" dir="ltr" value="${values.email ?? ''}"></label>
        </fieldset>
        <fieldset>
          <legend>وين نوصلك؟</legend>
          <label>المحافظة
            <select name="city" required autocomplete="address-level1" data-days-for="city-days">
              <option value="">اختار محافظتك</option>
              ${GOVERNORATES.map((g) => html`<option data-days="${deliveryDays(g)}" ${values.city === g ? raw('selected') : ''}>${g}</option>`)}
            </select>
            <span class="optional" id="city-days" aria-live="polite">${values.city ? `يوصلك ${deliveryDays(values.city)}` : ''}</span>
          </label>
          <label><span>العنوان <span class="optional">المنطقة، المحلة، وأقرب نقطة دالة</span></span><textarea name="address" required rows="2" autocomplete="street-address">${values.address ?? ''}</textarea></label>
          <label><span>ملاحظات للمندوب <span class="optional">(اختياري)</span></span><textarea name="notes" rows="2">${values.notes ?? ''}</textarea></label>
        </fieldset>
        <fieldset>
          <legend>طريقة الدفع</legend>
          <label class="choice"><input type="radio" name="payment_method" value="cod" ${values.payment_method !== 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.cod}</label>
          ${settings.bank_details ? html`<label class="choice"><input type="radio" name="payment_method" value="bank_transfer" ${values.payment_method === 'bank_transfer' ? raw('checked') : ''}> ${PAYMENT_METHODS.bank_transfer}</label>` : ''}
        </fieldset>
        <label class="check"><input type="checkbox" name="marketing_opt_in" value="1" ${values.marketing_opt_in ? raw('checked') : ''}> دزّولي العروض على واتساب</label>
        <button class="btn primary block" type="submit" data-busy="نأكد طلبك…">أكّد الطلب، ${formatMoney(view.total, settings.currency)}</button>
        <p class="hint">بتأكيد الطلب أنت توافق على <a href="/policies">سياسات المتجر</a>.</p>
      </form>
      <aside class="summary">
        <h2>طلبك</h2>
        ${view.items.map((i) => html`<div class="row line"><span class="cart-thumb small">${i.image_url ? html`<img src="${asset(i.image_url)}" alt="" width="40" height="50" loading="lazy">` : ''}</span><span class="grow">${i.name} × ${i.quantity}</span><span>${formatMoney(i.price * i.quantity, settings.currency)}</span></div>`)}
        <div class="row"><span>التوصيل</span><span>${view.shipping ? formatMoney(view.shipping, settings.currency) : 'مجاني'}</span></div>
        <div class="row total"><span>الإجمالي</span><span>${formatMoney(view.total, settings.currency)}</span></div>
      </aside>
    </div>`;
}

export function orderPlaced({ settings, order }) {
  return html`
    <section class="placed">
      <h1>وصلنا طلبك</h1>
      <p class="order-number">رقم الطلب <strong dir="ltr">${order.number}</strong></p>
      <p class="lead">الإجمالي ${formatMoney(order.total, order.currency)}، ${PAYMENT_METHODS[order.payment_method]}.</p>
      ${order.payment_method === 'bank_transfer' && settings.bank_details ? html`<div class="alert">بيانات التحويل:<br>${settings.bank_details}<br>نأكد طلبك بعد ما نتحقق من التحويل.</div>` : ''}
      <p>راح نتصل بيك حتى نأكد الطلب. وتكدر تتابعه برقم الطلب ورقم هاتفك.</p>
      <div class="placed-actions">
        <a class="btn primary" href="/track?number=${order.number}">تتبع الطلب</a>
        <button class="btn quiet" type="button" data-copy="${order.number}">انسخ رقم الطلب</button>
        ${settings.support_phone ? html`<a class="btn quiet" href="${whatsappLink(settings)}?text=${encodeURIComponent(`مرحبا، طلبي رقم ${order.number}`)}" rel="noopener">راسلنا بالواتساب</a>` : ''}
      </div>
    </section>`;
}

const ORDER_FLOW = ['new', 'confirmed', 'processing', 'shipped', 'delivered'];
function stepClass(current, step) {
  if (current === 'cancelled') return '';
  const [a, b] = [ORDER_FLOW.indexOf(step), ORDER_FLOW.indexOf(current)];
  return a < b ? 'done' : a === b ? 'done current' : '';
}

export function track({ order, values = {}, notFound, error, csrf }) {
  return html`
    <h1 class="page-title">تتبع طلبك</h1>
    <p class="lead">رقم الطلب يطلعلك بصفحة التأكيد بعد ما تطلب، وبرسالة الواتساب إذا وصلتك. اكتبه ويه رقم الهاتف اللي طلبت بيه.</p>
    <form method="post" action="/track" class="form inline-form">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label>رقم الطلب <input name="number" required dir="ltr" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="7K2QX9P" aria-describedby="number-hint" value="${values.number ?? ''}"><span class="optional" id="number-hint">7 حروف وأرقام، مثل 7K2QX9P</span></label>
      <label>رقم الهاتف <input name="phone" type="tel" required dir="ltr" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXXX" value="${values.phone ?? ''}"></label>
      <button class="btn primary" type="submit">تتبع</button>
    </form>
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    ${notFound ? html`<p class="alert">ما لكينا طلب بهالمعلومات. تأكد من رقم الطلب ورقم الهاتف اللي سجلت بيه.</p>` : ''}
    ${order ? html`
      <section class="tracked">
        <h2>طلب #${order.number}</h2>
        ${order.status === 'cancelled'
          ? html`<p class="alert">هذا الطلب ملغي. إذا انلغى بالغلط، احجي ويانا بالمحادثة ونرتبه.</p>`
          : html`<ol class="steps">${ORDER_FLOW.map((s) => html`<li class="${stepClass(order.status, s)}" ${s === order.status ? raw('aria-current="step"') : ''}>${ORDER_STATUS[s]}</li>`)}</ol>`}
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
    <section class="bands">
      <div class="band"><h2>الشحن والتوصيل</h2><p>${p.shipping}</p></div>
      <div class="band"><h2>الترجيع والاستبدال</h2><p>${p.returns}</p></div>
      <div class="band"><h2>الدفع</h2><p>${p.payment}</p></div>
      <div class="band" id="privacy"><h2>الخصوصية</h2><p>${p.privacy}</p></div>
    </section>`;
}

export function notFound() {
  return html`
    <section class="placed">
      <h1>هالصفحة ما موجودة</h1>
      <p class="lead">يمكن المنتج خلص أو الرابط تغيّر.</p>
      <a class="btn primary" href="/products">ارجع للمتجر</a>
    </section>`;
}
