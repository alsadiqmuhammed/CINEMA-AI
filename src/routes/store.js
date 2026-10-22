import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { token } from '../lib/auth.js';
import { RateLimiter } from '../lib/rate-limit.js';
import * as carts from '../services/carts.js';
import * as orders from '../services/orders.js';
import * as products from '../services/products.js';
import { getSettings } from '../services/settings.js';
import * as views from '../views/store.js';

export const CART_COOKIE = 'store_cart';
const VISITOR_CSRF = 'store_csrf';
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/' };

export const store = Router();

// Double-submit CSRF token for the storefront's forms (visitors have no session).
store.use((req, res, next) => {
  let csrf = req.cookies[VISITOR_CSRF];
  if (!csrf) {
    csrf = token(18);
    res.cookie(VISITOR_CSRF, csrf, { ...cookieOptions, maxAge: 30 * 86_400_000 });
  }
  res.locals.csrf = csrf;
  if (req.method === 'POST' && req.body?._csrf !== csrf) {
    return res.status(403).send('انتهت صلاحية الصفحة، حدّثها وحاول مرة ثانية.');
  }
  next();
});

async function render(req, res, page, { status = 200, ...props } = {}) {
  const [settings, categories, cart] = await Promise.all([
    getSettings(), products.activeCategories(), carts.findOpen(req.cookies[CART_COOKIE]),
  ]);
  const count = cart ? (await carts.lines(cart.id)).reduce((n, i) => n + i.quantity, 0) : 0;
  // Where "add to cart" returns to: this page with its query (sort etc.), minus the toast marker.
  const here = new URL(req.originalUrl, 'http://local');
  here.searchParams.delete('added');
  const body = page({ settings, csrf: res.locals.csrf, categories, path: req.path, here: here.pathname + here.search, ...props });
  res.status(status).type('html').send(views.layout({
    settings, body, cartCount: count, categories, path: req.path, added: req.query.added !== undefined, ...props.meta,
  }));
}

// Only same-site paths, so a crafted form can't bounce visitors elsewhere.
function safeBack(value) {
  const back = String(value ?? '');
  return back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/\\') ? back : null;
}

const checkoutLimiter = new RateLimiter({ name: 'checkout-ip', limit: 6, windowMs: 3_600_000 });
const trackLimiter = new RateLimiter({ name: 'track-ip', limit: 20, windowMs: 15 * 60_000 });
const contactLimiter = new RateLimiter({ name: 'contact-ip', limit: 10, windowMs: 3_600_000 });
const TOO_MANY = 'محاولات كثيرة من نفس الجهاز. انتظر شوية وحاول مرة ثانية، أو احجي ويانا بالمحادثة.';

const CART_ERRORS = { unavailable: 'هذا المنتج مو متوفر هسة، أو خلصت كميته.' };

const sortOf = (req) => (products.SORTS[req.query.sort] ? req.query.sort : 'new');

// Listings come a page at a time; one extra row tells whether there is a next page.
const PER_PAGE = 24;
async function paged(req, query) {
  const page = Math.max(1, Math.min(200, Math.trunc(Number(req.query.page)) || 1));
  const rows = await products.listActive({ ...query, limit: PER_PAGE + 1, offset: (page - 1) * PER_PAGE });
  return { items: rows.slice(0, PER_PAGE), page, hasNext: rows.length > PER_PAGE };
}

function setCart(res, cart) {
  res.cookie(CART_COOKIE, cart.token, { ...cookieOptions, maxAge: 30 * 86_400_000 });
}

store.get('/', async (req, res) => {
  const [latest, onSale, bestSellers] = await Promise.all([
    products.listActive({ limit: 16 }), products.listActive({ onSale: true, limit: 8 }), products.bestSellers(8),
  ]);
  // Offers already have their own row; don't show the same products twice.
  const onSaleIds = new Set(onSale.map((p) => p.id));
  const fresh = latest.filter((p) => !onSaleIds.has(p.id));
  // Full rows only (four to a row on desktop); a lone card on its own row reads as a mistake.
  const newest = fresh.length >= 8 ? fresh.slice(0, 8) : fresh.length >= 4 ? fresh.slice(0, 4) : fresh;
  await render(req, res, views.home, { newest, onSale, bestSellers, meta: { canonical: '/' } });
});

store.get('/products', async (req, res) => {
  const sort = sortOf(req);
  const list = await paged(req, { sort });
  await render(req, res, views.listing, { heading: 'كل المنتجات', ...list, sort, meta: { title: 'كل المنتجات', canonical: '/products' } });
});

store.get('/offers', async (req, res) => {
  const sort = sortOf(req);
  const list = await paged(req, { onSale: true, sort });
  await render(req, res, views.listing, {
    heading: 'العروض', intro: 'منتجات سعرها هسة أقل من سعرها المعتاد، لحد ما تخلص الكمية.', ...list, sort, meta: { title: 'العروض', canonical: '/offers' },
  });
});

store.get('/c/:slug', async (req, res) => {
  const category = (await products.categories()).find((c) => c.slug === req.params.slug);
  if (!category) return render(req, res, views.notFound, { status: 404, meta: { title: 'الصفحة غير موجودة' } });
  const sort = sortOf(req);
  const list = await paged(req, { categorySlug: category.slug, sort });
  await render(req, res, views.listing, { heading: category.name, ...list, sort, currentCategory: category.slug, meta: { title: category.name, canonical: `/c/${category.slug}` } });
});

store.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (!q) return res.redirect('/products');
  const items = q ? await products.listActive({ q, limit: 48 }) : [];
  await render(req, res, views.listing, { heading: `نتائج البحث: ${q}`, items, query: q, meta: { title: 'بحث' } });
});

store.get('/p/:slug', async (req, res) => {
  const product = await products.getBySlug(req.params.slug);
  if (!product) return render(req, res, views.notFound, { status: 404, meta: { title: 'الصفحة غير موجودة' } });
  const settings = await getSettings();
  let related = await products.recommendations(product.id);
  // A product page never ends empty: with nothing related, show the newest others.
  if (!related.length) related = (await products.listActive({ limit: 5 })).filter((p) => p.id !== product.id);
  // Full rows only: four across on a desktop, two on a phone.
  related = related.slice(0, related.length >= 4 ? 4 : 2);
  await render(req, res, views.product, {
    product,
    related,
    meta: {
      ogImage: product.images[0] ? `${config.baseUrl}${product.images[0].url.replace(/\.webp$/, '.jpg')}` : undefined,
      title: product.seo_title || product.name,
      description: product.seo_description || product.description.slice(0, 155),
      canonical: `/p/${product.slug}`,
      jsonLd: views.productJsonLd(product, settings),
    },
  });
});

store.get('/cart', async (req, res) => {
  const view = await carts.view(await carts.findOpen(req.cookies[CART_COOKIE]));
  // An empty cart suggests where to start instead of ending the visit.
  const suggestions = view.items.length ? [] : await products.listActive({ limit: 4 });
  await render(req, res, views.cart, { view, suggestions, error: CART_ERRORS[req.query.error], meta: { title: 'السلة' } });
});

// Links sent by the chat assistant and cart reminders open that cart in the browser.
store.get('/cart/open/:token', async (req, res) => {
  const cart = await carts.findOpen(req.params.token);
  if (cart) setCart(res, cart);
  res.redirect('/cart');
});

store.post('/cart/add', async (req, res) => {
  const cart = await carts.getOrCreate(req.cookies[CART_COOKIE]);
  setCart(res, cart);
  try {
    await carts.setItem(cart.id, Math.trunc(Number(req.body.product_id)) || 0, Math.max(1, Math.trunc(Number(req.body.quantity)) || 1), { add: true });
    // The page's script adds without leaving the page; it only needs the new count.
    if (req.get('X-Requested-With') === 'fetch') {
      return res.json({ count: (await carts.lines(cart.id)).reduce((n, i) => n + i.quantity, 0) });
    }
    // Stay where the shopper was and confirm with a toast; without a page to return to, open the cart.
    const back = safeBack(req.body.back);
    if (!back) return res.redirect('/cart');
    const url = new URL(back, 'http://local');
    url.searchParams.set('added', '1');
    res.redirect(url.pathname + url.search + url.hash);
  } catch (error) {
    if (req.get('X-Requested-With') === 'fetch') return res.status(422).json({ error: CART_ERRORS.unavailable });
    res.redirect('/cart?error=unavailable');
  }
});

store.post('/cart/update', async (req, res) => {
  const cart = await carts.findOpen(req.cookies[CART_COOKIE]);
  if (cart) {
    // A typo ("abc", -5) must not empty the line; only a real number changes it (0 removes it).
    const quantity = Number(req.body.quantity);
    if (Number.isFinite(quantity)) {
      await carts.setItem(cart.id, Number(req.body.product_id), Math.max(0, Math.trunc(quantity)), { onlyExisting: true }).catch(() => {});
    }
  }
  res.redirect('/cart');
});

store.get('/checkout', async (req, res) => {
  const view = await carts.view(await carts.findOpen(req.cookies[CART_COOKIE]));
  if (!view.items.length) return res.redirect('/cart');
  await render(req, res, views.checkout, { view, meta: { title: 'إتمام الطلب' } });
});

store.post('/checkout', async (req, res) => {
  const cartToken = req.cookies[CART_COOKIE];
  try {
    orders.checkForm(req.body);
  } catch (error) {
    if (!(error instanceof orders.OrderError)) throw error;
    const view = await carts.view(await carts.findOpen(cartToken));
    if (!view.items.length) return res.redirect('/cart');
    return render(req, res, views.checkout, { view, error: error.message, values: req.body, status: 422, meta: { title: 'إتمام الطلب' } });
  }
  if (!(await checkoutLimiter.take(req.ip))) {
    const view = await carts.view(await carts.findOpen(cartToken));
    if (!view.items.length) return res.redirect('/cart');
    return render(req, res, views.checkout, { view, error: TOO_MANY, values: req.body, status: 429, meta: { title: 'إتمام الطلب' } });
  }
  try {
    const order = await orders.placeOrder(cartToken, req.body);
    res.clearCookie(CART_COOKIE, { path: '/' });
    res.redirect(`/order/${order.number}?t=${encodeURIComponent(orderViewToken(order))}`);
  } catch (error) {
    if (!(error instanceof orders.OrderError)) throw error;
    const view = await carts.view(await carts.findOpen(cartToken));
    if (!view.items.length) return res.redirect('/cart');
    await render(req, res, views.checkout, { view, error: error.message, values: req.body, status: 422, meta: { title: 'إتمام الطلب' } });
  }
});

// Save the contact as soon as it is typed so an abandoned cart can be followed up.
store.post('/cart/contact', async (req, res) => {
  if (!(await contactLimiter.take(req.ip))) return res.status(429).end();
  const cart = await carts.findOpen(req.cookies[CART_COOKIE]);
  if (cart) await carts.setContact(cart.id, { phone: req.body.phone, email: req.body.email });
  res.status(204).end();
});

// The confirmation page is only shown with a token derived from the order, not by number alone.
function orderViewToken(order) {
  return createHmac('sha256', config.secret).update(`${order.id}:${order.number}`).digest('base64url').slice(0, 22);
}

store.get('/order/:number', async (req, res) => {
  const order = await orders.getByNumber(req.params.number);
  if (!order || req.query.t !== orderViewToken(order)) return render(req, res, views.notFound, { status: 404, meta: { title: 'الصفحة غير موجودة' } });
  await render(req, res, views.orderPlaced, { order, meta: { title: 'تم استلام طلبك' } });
});

// The form posts, so the phone number stays out of URLs and history; GET still works for old links.
async function trackPage(req, res, source) {
  const values = { number: source.number, phone: source.phone };
  if (values.number && values.phone && !(await trackLimiter.take(req.ip))) {
    return render(req, res, views.track, { values: {}, error: TOO_MANY, status: 429, meta: { title: 'تتبع طلبك' } });
  }
  const order = values.number && values.phone ? await orders.track(values.number, values.phone) : null;
  await render(req, res, views.track, {
    order, values, notFound: Boolean(values.number && values.phone && !order), meta: { title: 'تتبع طلبك' },
  });
}
store.get('/track', (req, res) => trackPage(req, res, req.query));
store.post('/track', (req, res) => trackPage(req, res, req.body));

store.get('/policies', async (req, res) => {
  await render(req, res, views.policies, { meta: { title: 'السياسات', canonical: '/policies' } });
});

store.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

store.get('/sitemap.xml', async (req, res) => {
  const [items, categories] = await Promise.all([products.listActive({ limit: 5000 }), products.activeCategories()]);
  const urls = ['/', '/products', '/offers', '/policies', ...categories.map((c) => `/c/${encodeURIComponent(c.slug)}`), ...items.map((p) => `/p/${encodeURIComponent(p.slug)}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${config.baseUrl}${u}</loc></url>`).join('')}</urlset>`);
});

// Anything else under the store gets the store's own not-found page.
store.use((req, res) => render(req, res, views.notFound, { status: 404, meta: { title: 'الصفحة غير موجودة' } }));
