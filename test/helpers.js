// Shared setup: a clean test database and an HTTP client that keeps cookies.
process.env.DATABASE_URL ??= 'postgres://store:store@localhost:5432/store_test';
process.env.NODE_ENV = 'test';
process.env.AUTOMATION_ENABLED = 'false';
// Never call the real API from tests; ai.test.js points the SDK at a local mock instead.
if (process.env.TEST_AI_MOCK !== '1') process.env.ANTHROPIC_API_KEY = '';
process.env.DEFAULT_COUNTRY_CODE = '';

const { pool, db } = await import('../src/db/pool.js');
const { seed } = await import('../src/db/seed.js');
const { createApp } = await import('../src/server.js');
const { clearSettingsCache } = await import('../src/services/settings.js');
const { hashPassword } = await import('../src/lib/auth.js');

export { db, pool };

export async function resetDatabase() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  clearSettingsCache();
  await seed({ demo: true });
  await db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('مدير', 'manager@store.local', $1, 'manager')`,
    [await hashPassword('Demo-Manager-2026')]);
}

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  async request(path, { method = 'GET', form, json, headers = {} } = {}) {
    const init = { method, redirect: 'manual', headers: { ...headers } };
    if (form) {
      init.body = new URLSearchParams(form);
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (json) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    }
    if (this.cookies.size) init.headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, init);
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const body = await res.text();
    return { status: res.status, location: res.headers.get('location'), body, json: () => JSON.parse(body) };
  }

  get(path) {
    return this.request(path);
  }

  post(path, form) {
    return this.request(path, { method: 'POST', form });
  }

  csrfFrom(html) {
    return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  }

  async login(email, password) {
    await this.get('/admin/login');
    const res = await this.post('/admin/login', { email, password });
    if (res.status !== 302) throw new Error(`login failed: ${res.status}`);
    const page = await this.get('/admin');
    this.csrf = this.csrfFrom(page.body);
    return page;
  }

  adminPost(path, form = {}) {
    return this.post(path, { _csrf: this.csrf, ...form });
  }
}

export async function productBySku(sku) {
  return db.one('SELECT * FROM products WHERE sku = $1', [sku]);
}

/** Puts a product in a fresh visitor's cart and returns the client and the page CSRF token. */
export async function visitorWithCart(base, productId, quantity = 1) {
  const visitor = new Client(base);
  const home = await visitor.get('/');
  const csrf = visitor.csrfFrom(home.body) ?? visitor.cookies.get('store_csrf');
  await visitor.post('/cart/add', { _csrf: csrf, product_id: String(productId), quantity: String(quantity) });
  return { visitor, csrf };
}

export const checkoutForm = (csrf, extra = {}) => ({
  _csrf: csrf, name: 'سارة أحمد', phone: '0501234567', city: 'الرياض', address: 'حي النخيل، شارع 12', payment_method: 'cod', ...extra,
});
