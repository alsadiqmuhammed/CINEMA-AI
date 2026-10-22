import { config } from '../config.js';
import { html, raw, toString } from '../lib/html.js';
import { formatDate, formatMoney, ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } from '../lib/format.js';
import { SORTS } from '../services/products.js';

// Small inline icons (stroke follows currentColor); inline SVG keeps them inside the CSP.
const icon = {
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  bag: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  chat: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>'),
};

export const GOVERNORATES = ['بغداد', 'البصرة', 'نينوى', 'أربيل', 'النجف', 'كربلاء', 'بابل', 'ذي قار', 'ميسان', 'واسط', 'القادسية', 'المثنى', 'ديالى', 'الأنبار', 'صلاح الدين', 'كركوك', 'السليمانية', 'دهوك'];

/** Real pictures of Iraqi souqs from open archives; credits are printed in the footer. */
const SOUQ_PHOTOS = {
  alley: { src: '/static/img/souq/baghdad-copper-bazaar-1932.jpg', w: 1600, h: 1133, caption: 'سوق الصفافير ببغداد، 1932', credit: 'Matson Collection، ملكية عامة', page: 'https://commons.wikimedia.org/wiki/File:Iraq._(Mesopotamia)._Baghdad._Copper_bazaar_LOC_matpc.13278.tif' },
  creek: { src: '/static/img/souq/basra-ashar-creek-1915.jpg', w: 1400, h: 1038, caption: 'شط العشار وسوگه بالبصرة، حوالي 1915', credit: 'Nationaal Archief، CC0', page: 'https://commons.wikimedia.org/wiki/File:Ashar_Creek_and_Bazaar,_Bestanddeelnr_158-1494.jpg' },
  gold: { src: '/static/img/souq/basra-gold-market-2016.jpg', w: 1024, h: 768, caption: 'سوگ الذهب بالبصرة، 2016', credit: 'David Stanley، CC BY 2.0', page: 'https://commons.wikimedia.org/wiki/File:Basra_Gold_Market_(30363366263).jpg' },
  painting: { src: '/static/img/souq/copper-bazaar-watercolour.jpg', w: 968, h: 1300, caption: 'سوق الصفافير، لوحة مائية من أيام الحرب العالمية الأولى', credit: 'John Daniel Revel، ملكية عامة', page: 'https://commons.wikimedia.org/wiki/File:The_Copper_Bazaar,_Baghdad_Art.IWMART4041.jpg' },
};

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

/** wa.me link for the store's support number (local 07… numbers become 9647…). */
function whatsappLink(settings) {
  return `https://wa.me/${String(settings.support_phone ?? '').replace(/\D/g, '').replace(/^0/, '964')}`;
}

export function layout({ settings, title, description, body, cartCount = 0, canonical, jsonLd, ogImage, categories = [], path = '', added = false }) {
  const pageTitle = title ? `${title} | ${settings.store_name}` : `${settings.store_name} | تسوّق أونلاين بالعراق، والدفع عند الاستلام`;
  const metaDescription = String(description ?? settings.store_tagline).replace(/\s*[\n•]+\s*/g, ' ').trim();
  const current = (href) => (path === href ? raw('aria-current="page"') : '');
  return '<!doctype html>' + toString(html`
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0c0a08">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDescription}">
  ${canonical ? html`<link rel="canonical" href="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${settings.store_name}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDescription}">
  ${canonical ? html`<meta property="og:url" content="${config.baseUrl}${canonical}">` : ''}
  <meta property="og:image" content="${ogImage ?? `${config.baseUrl}${SOUQ_PHOTOS.alley.src}`}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/static/fonts/noto-sans-arabic-arabic-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/css/store.css?v=${config.assetVersion}">
  ${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
</head>
<body>
  <a class="skip" href="#main">انتقل للمحتوى</a>
  <header class="bar">
    <a class="wordmark" href="/">${settings.store_name}</a>
    <nav aria-label="روابط المتجر">
      <a href="/products" ${current('/products')}>المنتجات</a>
      <a href="/offers" ${current('/offers')}>العروض</a>
      <a href="/track" ${current('/track')}>تتبع طلبك</a>
    </nav>
    <a href="/cart" class="cart-button" aria-label="السلة، فيها ${cartCount} منتج">${icon.bag}<span>السلة</span><b id="cart-count">${cartCount}</b></a>
  </header>
  ${added ? html`<div class="toast" role="status"><span>انضاف للسلة</span><a href="/cart">شوف السلة</a><a href="/checkout" class="toast-go">أكمل الطلب</a></div>` : ''}
  <main id="main" class="wrap">${body}</main>
  <footer class="footer">
    <div class="footer-name" aria-hidden="true">${settings.store_name}</div>
    <div class="footer-row">
      <div class="footer-ways">
        <button type="button" class="way" data-open-chat>اسأل المساعد</button>
        <a class="way" href="/track">تتبع طلبك</a>
        ${settings.support_phone ? html`<a class="way" href="${whatsappLink(settings)}" rel="noopener">واتساب <span dir="ltr">${settings.support_phone}</span></a>` : ''}
      </div>
      <div class="footer-cols">
        ${categories.length ? html`<div><b>الأقسام</b>${categories.map((c) => html`<a href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}</div>` : ''}
        <div><b>تسوّق</b><a href="/products">كل المنتجات</a><a href="/offers">العروض</a><a href="/cart">السلة</a></div>
        <div><b>المساعدة</b><a href="/policies">الشحن والاسترجاع</a><a href="/policies#privacy">الخصوصية</a>${settings.support_email ? html`<a href="mailto:${settings.support_email}">${settings.support_email}</a>` : ''}</div>
      </div>
    </div>
    <div class="footer-legal">
      <p>${settings.store_name}، ${settings.store_tagline}. صور السوگ من أرشيفات مفتوحة عبر ويكيميديا كومنز: ${Object.values(SOUQ_PHOTOS).map((p, i) => html`${i ? '، ' : ''}<a href="${p.page}" rel="noopener">${p.caption}</a> (${p.credit})`)}.</p>
      <a href="#main">للأعلى</a>
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

function productImage(p, { lazy = true, w = 800, h = 1000 } = {}) {
  return p.image_url
    ? html`<img src="${asset(p.image_url)}" alt="${p.name}" width="${w}" height="${h}" ${lazy ? raw('loading="lazy"') : ''}>`
    : html`<span class="noimg" aria-hidden="true">${p.name.slice(0, 1)}</span>`;
}

function priceTag(p, currency) {
  const onSale = p.compare_at_price > p.price;
  return html`<span class="price"><span>${formatMoney(p.price, currency)}</span>${onSale ? html`<s>${formatMoney(p.compare_at_price, currency)}</s>` : ''}</span>`;
}

function quickAdd(p, csrf, back, label = 'أضف') {
  if (!csrf || !(p.stock > 0)) return '';
  return html`
    <form method="post" action="/cart/add" class="quick-add">
      <input type="hidden" name="_csrf" value="${csrf}">
      <input type="hidden" name="product_id" value="${p.id}">
      <input type="hidden" name="back" value="${back ?? '/'}">
      <button type="submit" class="btn small" aria-label="أضف ${p.name} للسلة">${icon.plus}<span>${label}</span></button>
    </form>`;
}

function productCard(p, currency, { csrf, back } = {}) {
  const onSale = p.compare_at_price > p.price;
  const saving = onSale ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0;
  return html`
    <article class="product-card">
      <a class="card-link" href="/p/${encodeURIComponent(p.slug)}">
        <div class="frame">
          ${productImage(p)}
          ${p.stock > 0
            ? (onSale ? html`<span class="flag">وفّر ${saving}%</span>` : p.stock <= (p.low_stock_at ?? 0) ? html`<span class="flag">باقي ${p.stock}</span>` : '')
            : html`<span class="flag out">نفدت الكمية</span>`}
        </div>
        <h3>${p.name}</h3>
      </a>
      <div class="card-foot">${priceTag(p, currency)}${quickAdd(p, csrf, back)}</div>
    </article>`;
}

export function grid(items, currency, options = {}) {
  if (!items.length) return html`<p class="empty">ماكو منتجات هنا حالياً. <a href="/products">شوف كل المنتجات</a></p>`;
  return html`<div class="grid">${items.map((p) => productCard(p, currency, options))}</div>`;
}

function categoryNav(categories, current) {
  if (!categories?.length) return '';
  return html`
    <nav class="chips" aria-label="الأقسام">
      <a class="chip ${current ? '' : 'active'}" href="/products">الكل</a>
      ${categories.map((c) => html`<a class="chip ${current === c.slug ? 'active' : ''}" href="/c/${encodeURIComponent(c.slug)}">${c.name}</a>`)}
    </nav>`;
}

export function home({ settings, categories, newest, onSale, bestSellers, csrf }) {
  const [before, after] = String(settings.store_tagline).split(/،\s*/);
  // The reel: what the store sells, passing through the frame while the name holds still.
  const reel = [...onSale, ...bestSellers, ...newest].filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i).slice(0, 6);
  const list = newest.length ? newest : reel;
  const first = list[0];
  const policies = settings.policies;
  return html`
    <section class="poster" aria-labelledby="hero-title" data-pin="reel">
      <div class="poster-stage">
        <h1 id="hero-title" class="poster-title">${settings.store_name}</h1>
        <div class="poster-foot">
          <p>عطور وعود وهدايا وأغراض بيت. تطلبها من موبايلك، يوصلك لكل المحافظات، وتدفع من تستلم.</p>
          <a class="btn primary" href="/products">تسوّق هسة</a>
        </div>
        <p class="half half-start">${before}</p>
        <div class="reel" data-steps="${reel.length}">
          <div class="reel-track">
            ${reel.map((p, i) => html`
              <a class="reel-frame" href="/p/${encodeURIComponent(p.slug)}">
                ${productImage(p, { lazy: i > 0, w: 1200, h: 900 })}
                <span class="reel-caption">${p.name}، ${formatMoney(p.price, settings.currency)}</span>
              </a>`)}
          </div>
        </div>
        ${after ? html`<p class="half half-end">${after}</p>` : ''}
      </div>
    </section>

    ${categories.length ? html`
      <section class="showcase" aria-labelledby="cats-title" data-pin="track">
        <div class="showcase-stage">
          <img class="held" src="${SOUQ_PHOTOS.alley.src}" alt="${SOUQ_PHOTOS.alley.caption}" width="${SOUQ_PHOTOS.alley.w}" height="${SOUQ_PHOTOS.alley.h}" loading="lazy">
          <h2 id="cats-title" class="showcase-title">تسوّق حسب القسم</h2>
          <p class="held-caption">${SOUQ_PHOTOS.alley.caption}</p>
          <div class="cards">
            ${categories.map((c) => html`
              <a class="cat-card" href="/c/${encodeURIComponent(c.slug)}">
                <span class="cat-photo">${c.image_url ? html`<img src="${asset(c.image_url)}" alt="" width="720" height="380" loading="lazy">` : ''}</span>
                <span class="cat-panel">
                  <b>${c.name}</b>
                  <span>${c.product_count} منتج، تبدي من ${formatMoney(c.min_price, settings.currency)}</span>
                </span>
              </a>`)}
          </div>
        </div>
      </section>` : ''}

    ${list.length ? html`
      <section class="picklist" aria-labelledby="new-title">
        <div class="picklist-photo">
          ${list.map((p, i) => html`<div class="pick-image ${i ? '' : 'active'}" data-pick="${p.id}">${productImage(p, { w: 800, h: 1000 })}</div>`)}
        </div>
        <div class="picklist-body">
          <h2 id="new-title" class="section-title">${newest.length ? 'وصل جديد' : 'من السوگ'}</h2>
          <ol class="picks">
            ${list.map((p, i) => html`
              <li class="pick ${i ? '' : 'active'}" data-pick="${p.id}">
                <a href="/p/${encodeURIComponent(p.slug)}" class="pick-row"><span class="pick-name">${p.name}</span>${priceTag(p, settings.currency)}</a>
                <div class="pick-more">
                  <p>${String(p.description).split(/\n+/)[0]}</p>
                  ${quickAdd(p, csrf, '/', 'أضف للسلة')}
                </div>
              </li>`)}
          </ol>
          <a class="more" href="/products">كل المنتجات</a>
        </div>
      </section>` : ''}

    <section class="verbs" aria-label="شلون تطلب">
      <div class="verb-panel">
        <img src="${SOUQ_PHOTOS.gold.src}" alt="${SOUQ_PHOTOS.gold.caption}" width="${SOUQ_PHOTOS.gold.w}" height="${SOUQ_PHOTOS.gold.h}" loading="lazy">
        <div class="verb-hold"><h2 class="verb">اختار</h2></div>
        <p class="verb-note">تصفح الأقسام أو اسأل المساعد، وضيف اللي يعجبك للسلة.</p>
      </div>
      <div class="verb-panel">
        <img src="${SOUQ_PHOTOS.creek.src}" alt="${SOUQ_PHOTOS.creek.caption}" width="${SOUQ_PHOTOS.creek.w}" height="${SOUQ_PHOTOS.creek.h}" loading="lazy">
        <div class="verb-hold"><h2 class="verb">نوصّل</h2></div>
        <p class="verb-note">اسمك ورقمك وعنوانك بأقرب نقطة دالة. نتصل بيك نأكد قبل ما نشحن.</p>
      </div>
      <div class="verb-panel">
        <img src="${SOUQ_PHOTOS.painting.src}" alt="${SOUQ_PHOTOS.painting.caption}" width="${SOUQ_PHOTOS.painting.w}" height="${SOUQ_PHOTOS.painting.h}" loading="lazy">
        <div class="verb-hold"><h2 class="verb">تستلم</h2></div>
        <p class="verb-note">افحص طلبك ويه المندوب، وادفع نقداً من يعجبك.</p>
      </div>
    </section>

    <section class="estimate" aria-labelledby="estimate-title">
      <h2 id="estimate-title" class="section-title">شكد يطول التوصيل لمحافظتك؟</h2>
      <div class="estimate-body" data-estimate data-fee="${deliveryFee(settings)}">
        <label for="gov">محافظتك</label>
        <select id="gov">${GOVERNORATES.map((g) => html`<option data-days="${deliveryDays(g)}">${g}</option>`)}</select>
        <output for="gov" aria-live="polite"><b>${deliveryDays('بغداد')}</b> <span>${deliveryFee(settings)}</span></output>
      </div>
    </section>

    <section class="bands" aria-labelledby="faq-title">
      <div class="band band-head"><h2 id="faq-title" class="section-title">أسئلة تتكرر</h2></div>
      <div class="band"><h3>شلون أدفع؟</h3><p>${policies.payment}</p></div>
      <div class="band"><h3>إذا ما عجبني المنتج؟</h3><p>${policies.returns}</p></div>
      <div class="band"><h3>شلون أتابع طلبي؟</h3><p>من <a href="/track">تتبع طلبك</a> برقم الطلب ورقم هاتفك، أو اسأل المساعد بالمحادثة.</p></div>
      <div class="band"><h3>المساعد إنسان لو آلي؟</h3><p>مساعد آلي يعرف كل منتجاتنا وأسعارها ويرد خلال ثواني. إذا تحتاج موظف، يحوّلك لواحد من الفريق.</p></div>
    </section>`;
}

export function listing({ settings, heading, intro, items, query, sort, categories, currentCategory, here, csrf }) {
  const back = here ?? '/';
  return html`
    <div class="listing-head">
      <h1 class="page-title">${heading}</h1>
      ${intro ? html`<p class="lead">${intro}</p>` : ''}
    </div>
    <div class="listing-tools">
      <form class="search" action="/search" method="get" role="search">
        ${icon.search}
        <input type="search" name="q" value="${query ?? ''}" placeholder="شنو تدوّر عليه؟" aria-label="بحث في المنتجات">
      </form>
      ${sort && items.length > 1 ? html`
        <form class="sort" method="get">
          <label for="sort">رتّب</label>
          <select id="sort" name="sort">${Object.entries(SORTS).map(([key, s]) => html`<option value="${key}" ${key === sort ? raw('selected') : ''}>${s.label}</option>`)}</select>
          <button class="btn small quiet" type="submit">طبّق</button>
        </form>` : ''}
    </div>
    ${query === undefined ? categoryNav(categories, currentCategory) : ''}
    ${items.length ? html`<p class="count">${items.length} منتج</p>` : ''}
    ${query !== undefined && !items.length
      ? html`<p class="empty">ما لكينا شي لـ "${query}". جرّب كلمة ثانية، أو <button class="link" type="button" data-open-chat>اسأل المساعد</button> وهو يدوّرلك.</p>`
      : grid(items, settings.currency, { csrf, back })}`;
}

export function product({ settings, product: p, related, csrf }) {
  const images = p.images;
  const onSale = p.compare_at_price > p.price;
  return html`
    <nav class="crumbs" aria-label="المسار"><a href="/">الرئيسية</a>${p.category_slug ? html`<span aria-hidden="true">/</span><a href="/c/${encodeURIComponent(p.category_slug)}">${p.category_name}</a>` : ''}</nav>
    <article class="product">
      <div class="gallery">
        <div class="frame large">
          ${images.length ? html`<img src="${asset(images[0].url)}" alt="${images[0].alt || p.name}" width="800" height="1000">` : html`<span class="noimg">${p.name.slice(0, 1)}</span>`}
        </div>
        ${images.length > 1 ? html`<div class="thumbs">${images.map((img, i) => html`<button type="button" class="thumb ${i ? '' : 'current'}" data-src="${asset(img.url)}" aria-label="عرض الصورة ${i + 1}"><img src="${asset(img.url)}" alt="" loading="lazy"></button>`)}</div>` : ''}
      </div>
      <div class="info">
        <h1>${p.name}</h1>
        <p class="price big"><span>${formatMoney(p.price, settings.currency)}</span>${onSale ? html`<s>${formatMoney(p.compare_at_price, settings.currency)}</s>` : ''}</p>
        ${p.stock > 0
          ? html`<form method="post" action="/cart/add" class="buy-form">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="back" value="/p/${encodeURIComponent(p.slug)}">
              <input type="hidden" name="product_id" value="${p.id}">
              <label class="qty-field">الكمية <input type="number" name="quantity" value="1" min="1" max="${Math.min(p.stock, 20)}" inputmode="numeric"></label>
              <button class="btn primary" type="submit">أضف للسلة</button>
            </form>
            ${p.stock <= p.low_stock_at ? html`<p class="stock-note">باقي ${p.stock} بس</p>` : ''}`
          : html`<p class="stock-note">نفدت الكمية حالياً. اسأل المساعد ونبلغك من يرجع.</p>`}
        <dl class="assurances">
          <dt>الدفع</dt><dd>نقداً عند الاستلام، وتفحص طلبك قبل ما تدفع.</dd>
          <dt>التوصيل</dt><dd>لكل المحافظات ${deliveryFee(settings)}. ${settings.policies.shipping}</dd>
        </dl>
        <div class="description">${p.description.split(/\n+/).filter(Boolean).map((line) => html`<p>${line}</p>`)}</div>
        ${p.faq?.length ? html`<section class="faq"><h2>أسئلة عن المنتج</h2>${p.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</section>` : ''}
      </div>
    </article>
    ${related.length ? html`<section class="shelf"><h2 class="section-title">قد يعجبك أيضاً</h2>${grid(related, settings.currency, { csrf, back: `/p/${encodeURIComponent(p.slug)}` })}</section>` : ''}`;
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

export function cart({ settings, view, csrf, error }) {
  const { items, subtotal, shipping, total } = view;
  if (!items.length) {
    return html`
      <h1 class="page-title">السلة</h1>
      <section class="empty-state">
        <p class="lead">سلتك فارغة.</p>
        <a class="btn primary" href="/products">تصفح المنتجات</a>
      </section>`;
  }
  return html`
    <h1 class="page-title">السلة</h1>
    ${error ? html`<p class="alert">${error}</p>` : ''}
    <div class="cart-layout">
      <ul class="cart-items">
        ${items.map((item) => html`
          <li class="cart-line">
            <a href="/p/${encodeURIComponent(item.slug)}" class="cart-thumb">${item.image_url ? html`<img src="${asset(item.image_url)}" alt="">` : ''}</a>
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
        <p class="hint">الدفع نقداً عند الاستلام</p>
      </aside>
    </div>`;
}

export function checkout({ settings, view, csrf, error, values = {} }) {
  return html`
    <h1 class="page-title">إتمام الطلب</h1>
    ${error ? html`<p class="alert">${error}</p>` : ''}
    <div class="cart-layout">
      <form method="post" action="/checkout" class="form">
        <input type="hidden" name="_csrf" value="${csrf}">
        <fieldset>
          <legend>معلوماتك</legend>
          <label>الاسم <input name="name" required autocomplete="name" value="${values.name ?? ''}"></label>
          <label>رقم الهاتف <input name="phone" required inputmode="tel" autocomplete="tel" dir="ltr" placeholder="07XX XXX XXXX" value="${values.phone ?? ''}"></label>
          <label><span>البريد الإلكتروني <span class="optional">(اختياري)</span></span><input name="email" type="email" autocomplete="email" dir="ltr" value="${values.email ?? ''}"></label>
        </fieldset>
        <fieldset>
          <legend>وين نوصلك؟</legend>
          <label>المحافظة
            <select name="city" required autocomplete="address-level1">
              <option value="">اختار محافظتك</option>
              ${GOVERNORATES.map((g) => html`<option ${values.city === g ? raw('selected') : ''}>${g}</option>`)}
            </select>
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
        <button class="btn primary block" type="submit">أكّد الطلب، ${formatMoney(view.total, settings.currency)}</button>
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
      <h1>وصلنا طلبك</h1>
      <p class="order-number">رقم الطلب <strong dir="ltr">${order.number}</strong></p>
      <p class="lead">الإجمالي ${formatMoney(order.total, order.currency)}، ${PAYMENT_METHODS[order.payment_method]}.</p>
      ${order.payment_method === 'bank_transfer' && settings.bank_details ? html`<div class="alert">بيانات التحويل:<br>${settings.bank_details}<br>نأكد طلبك بعد ما نتحقق من التحويل.</div>` : ''}
      <p>راح نتصل بيك حتى نأكد الطلب. وتكدر تتابعه برقم الطلب ورقم هاتفك.</p>
      <a class="btn primary" href="/track?number=${order.number}">تتبع الطلب</a>
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
    <form method="post" action="/track" class="form inline-form">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label>رقم الطلب <input name="number" required dir="ltr" value="${values.number ?? ''}"></label>
      <label>رقم الهاتف <input name="phone" required dir="ltr" inputmode="tel" placeholder="07XX XXX XXXX" value="${values.phone ?? ''}"></label>
      <button class="btn primary" type="submit">تتبع</button>
    </form>
    ${error ? html`<p class="alert">${error}</p>` : ''}
    ${notFound ? html`<p class="alert">ما لكينا طلب بهالمعلومات. تأكد من رقم الطلب ورقم الهاتف اللي سجلت بيه.</p>` : ''}
    ${order ? html`
      <section class="tracked">
        <h2>طلب #${order.number}</h2>
        ${order.status === 'cancelled'
          ? html`<p class="alert">هذا الطلب انلغى. إذا عندك سؤال احجي ويانا بالمحادثة.</p>`
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
    <section class="bands">
      <div class="band"><h2>الشحن والتوصيل</h2><p>${p.shipping}</p></div>
      <div class="band"><h2>الاسترجاع والاستبدال</h2><p>${p.returns}</p></div>
      <div class="band"><h2>الدفع</h2><p>${p.payment}</p></div>
      <div class="band" id="privacy"><h2>الخصوصية</h2><p>${p.privacy}</p></div>
    </section>`;
}

export function notFound() {
  return html`
    <section class="placed">
      <h1>الصفحة غير موجودة</h1>
      <p class="lead">يمكن الرابط تغيّر أو المنتج انشال.</p>
      <a class="btn primary" href="/">ارجع للرئيسية</a>
    </section>`;
}
