import { db } from '../db/pool.js';
import { token } from '../lib/auth.js';
import { normalizeEmail, normalizePhone, round3 } from '../lib/format.js';
import { getSettings } from './settings.js';

export const MAX_QUANTITY = 20;

export async function findOpen(cartToken) {
  if (!cartToken) return null;
  return db.one(`SELECT * FROM carts WHERE token = $1 AND status = 'open'`, [cartToken]);
}

export async function create(source = 'web') {
  return db.one('INSERT INTO carts (token, source) VALUES ($1, $2) RETURNING *', [token(18), source]);
}

export async function getOrCreate(cartToken, source = 'web') {
  return (await findOpen(cartToken)) ?? create(source);
}

export async function setItem(cartId, productId, quantity, { add = false } = {}) {
  const product = await db.one(`SELECT id, stock FROM products WHERE id = $1 AND status = 'active'`, [productId]);
  if (!product) throw new Error('المنتج غير متوفر');
  const current = await db.one('SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
  let next = add ? (current?.quantity ?? 0) + quantity : quantity;
  next = Math.min(next, MAX_QUANTITY, product.stock);
  if (next <= 0) {
    await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
  } else {
    await db.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [cartId, productId, next],
    );
  }
  await db.query('UPDATE carts SET updated_at = now(), reminded_at = NULL WHERE id = $1', [cartId]);
  return next;
}

export async function setContact(cartId, { phone, email, customerId }) {
  await db.query(
    `UPDATE carts SET contact_phone = COALESCE($2, contact_phone), contact_email = COALESCE($3, contact_email),
            customer_id = COALESCE($4, customer_id) WHERE id = $1`,
    [cartId, normalizePhone(phone), normalizeEmail(email), customerId ?? null],
  );
}

export async function lines(cartId, client = db) {
  return client.many(
    `SELECT ci.product_id, ci.quantity, p.name, p.slug, p.price, p.stock, p.status,
            (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_url
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY p.name`,
    [cartId],
  );
}

export function totals(items, settings) {
  const subtotal = round3(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const freeOver = Number(settings.free_shipping_over) || 0;
  const shipping = subtotal === 0 || (freeOver > 0 && subtotal >= freeOver) ? 0 : Number(settings.shipping_fee) || 0;
  return { subtotal, shipping, total: round3(subtotal + shipping) };
}

export async function view(cart) {
  if (!cart) return { cart: null, items: [], subtotal: 0, shipping: 0, total: 0 };
  const items = await lines(cart.id);
  return { cart, items, ...totals(items, await getSettings()) };
}

// Used by the chat assistant: a fresh cart pre-filled with the requested items, opened via a link.
export async function createCheckoutLink(items, { source = 'web', phone, customerId } = {}) {
  const cart = await create(source);
  for (const { product_id, quantity } of items) {
    await setItem(cart.id, product_id, quantity);
  }
  if (phone || customerId) await setContact(cart.id, { phone, customerId });
  return { cart, url: `/cart/open/${cart.token}` };
}
