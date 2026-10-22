import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { migrate } from './migrate.js';
import { db, pool } from './pool.js';

const DEMO_PRODUCTS = [
  { name: 'عطر مسك الليل', category: 'العطور', price: 45000, compare: 55000, stock: 25, image: 'perfume', tags: ['مسك', 'عطر', 'رجالي', 'نسائي'],
    description: 'عطر مسك ناعم يدوم طويلاً، مناسب للاستخدام اليومي والمناسبات.\n• حجم 100 مل\n• ثبات يصل إلى 12 ساعة' },
  { name: 'دهن عود كمبودي', category: 'العطور', price: 95000, stock: 6, image: 'oud', tags: ['عود', 'دهن', 'فاخر'],
    description: 'دهن عود كمبودي أصلي برائحة دافئة وعميقة.\n• 3 مل\n• مناسب للمناسبات الخاصة' },
  { name: 'شمعة معطرة بالعنبر', category: 'المنزل', price: 15000, stock: 40, image: 'candle', tags: ['شمعة', 'عنبر', 'هدية'],
    description: 'شمعة من شمع الصويا الطبيعي بعطر العنبر، تشتعل حتى 40 ساعة.' },
  { name: 'حقيبة جلد يدوية', category: 'الإكسسوارات', price: 75000, stock: 3, image: 'bag', tags: ['حقيبة', 'جلد', 'نسائي'],
    description: 'حقيبة يد من الجلد الطبيعي بخياطة يدوية وجيوب داخلية منظمة.' },
  { name: 'محفظة رجالية نحيفة', category: 'الإكسسوارات', price: 25000, stock: 30, image: 'wallet', tags: ['محفظة', 'رجالي', 'جلد'],
    description: 'محفظة جلدية نحيفة تتسع لـ 8 بطاقات مع حماية RFID.' },
  { name: 'صندوق هدايا فاخر', category: 'الهدايا', price: 60000, stock: 15, image: 'gift', tags: ['هدية', 'عطر', 'شمعة'],
    description: 'صندوق هدية يضم عطراً صغيراً وشمعة معطرة وبطاقة إهداء مكتوبة بخط اليد.' },
];

const DEMO_ACCOUNTS = ['owner@store.local', 'staff@store.local', 'manager@store.local'];

// Their passwords are in this repository. A production database must never keep them usable, so they are
// switched off (not deleted, orders and audit history still point at them) and their sessions dropped.
async function disableDemoAccounts() {
  const admin = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const off = await db.many(
    `UPDATE users SET active = false WHERE email = ANY($1) AND email <> $2 AND active RETURNING id, email`,
    [DEMO_ACCOUNTS, admin],
  );
  if (!off.length) return;
  await db.query('DELETE FROM sessions WHERE user_id = ANY($1::bigint[])', [off.map((u) => u.id)]);
  console.log(`disabled demo accounts: ${off.map((u) => u.email).join(', ')}`);
}

/**
 * demo: demo accounts with published passwords; never in production.
 * catalog: sample products, for previewing a fresh deployment (SEED_DEMO_CATALOG=true).
 */
export async function seed({ demo = !config.isProduction, catalog = demo || process.env.SEED_DEMO_CATALOG === 'true' } = {}) {
  await migrate();
  if (!demo) await disableDemoAccounts();
  const email = (process.env.ADMIN_EMAIL || (demo ? 'owner@store.local' : '')).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (demo ? 'Demo-Owner-2026' : '');
  if (email && password && password.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  }
  if (email && password) {
    await db.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner') ON CONFLICT (email) DO NOTHING`,
      ['المالك', email, await hashPassword(password)],
    );
    console.log(`owner account: ${email}`);
  } else {
    console.log('set ADMIN_EMAIL and ADMIN_PASSWORD to create the owner account');
  }
  if (demo && !(await db.one(`SELECT 1 FROM users WHERE email = 'staff@store.local'`))) {
    await db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('موظف تجريبي', 'staff@store.local', $1, 'staff')`,
      [await hashPassword('Demo-Staff-2026')]);
  }
  if (!catalog) return;
  if ((await db.one('SELECT COUNT(*)::int AS n FROM products')).n > 0) return;

  const categoryIds = {};
  let sort = 0;
  for (const name of [...new Set(DEMO_PRODUCTS.map((p) => p.category))]) {
    const slug = name.replace(/\s+/g, '-');
    categoryIds[name] = (await db.one('INSERT INTO categories (name, slug, sort) VALUES ($1, $2, $3) RETURNING id', [name, slug, sort += 1])).id;
  }
  const productIds = {};
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    const row = await db.one(
      `INSERT INTO products (slug, sku, name, description, category_id, price, compare_at_price, stock, status, tags, seo_title, faq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $3, $10) RETURNING id`,
      [p.name.replace(/\s+/g, '-'), `DEMO-${i + 1}`, p.name, p.description, categoryIds[p.category], p.price, p.compare ?? null, p.stock, p.tags,
        JSON.stringify([{ q: 'شكد يطول التوصيل؟', a: 'من 1 إلى 2 يوم داخل بغداد، ومن 2 إلى 4 أيام لباقي المحافظات.' }])],
    );
    productIds[p.image] = row.id;
    await db.query('INSERT INTO product_images (product_id, url, alt) VALUES ($1, $2, $3)', [row.id, `/static/img/products/${p.image}.webp`, p.name]);
  }
  const relate = async (a, b, kind) => db.query('INSERT INTO product_relations (product_id, related_id, kind) VALUES ($1, $2, $3)', [productIds[a], productIds[b], kind]);
  await relate('perfume', 'candle', 'complement');
  await relate('perfume', 'oud', 'alternative');
  await relate('bag', 'wallet', 'complement');
  console.log(`demo catalog: ${DEMO_PRODUCTS.length} products`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then(() => pool.end()).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
