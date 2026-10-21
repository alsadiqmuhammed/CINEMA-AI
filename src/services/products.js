import { db } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { slugify } from '../lib/format.js';

const WITH_IMAGE = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_url
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

const SEARCH_TEXT = 'product_search_text(p.name, p.description, p.tags)';

// Conversational filler that should not be searched for ("أبي عطر" → "عطر").
const STOPWORDS = new Set(['أبي', 'ابي', 'ابغى', 'أبغى', 'ابغي', 'أبغي', 'اريد', 'أريد', 'ابا', 'أبا', 'عندكم', 'عندك', 'هل', 'في', 'فيه',
  'شي', 'شيء', 'ممكن', 'لو', 'سمحت', 'من', 'عن', 'على', 'وش', 'ايش', 'شنو', 'بكم', 'كم', 'سعر', 'عطوني', 'عطني', 'ابحث', 'دور', 'أدور', 'ادور',
  'يا', 'و', 'او', 'أو', 'عدكم', 'عدك', 'اكو', 'أكو', 'شكد', 'بيش', 'اريده', 'أريده', 'داريد', 'دا', 'احتاج', 'أحتاج', 'تريد', 'the', 'a', 'i', 'want', 'do', 'you', 'have']);

export function searchTerms(q) {
  return String(q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .slice(0, 8);
}

export const SORTS = {
  new: { label: 'الأحدث', order: 'p.created_at DESC' },
  price_asc: { label: 'السعر: من الأقل', order: 'p.price ASC, p.created_at DESC' },
  price_desc: { label: 'السعر: من الأعلى', order: 'p.price DESC, p.created_at DESC' },
};

export async function listActive({ categorySlug, q, onSale = false, sort = 'new', limit = 24, offset = 0 } = {}) {
  const where = [`p.status = 'active'`];
  const params = [];
  if (categorySlug) {
    params.push(categorySlug);
    where.push(`c.slug = $${params.length}`);
  }
  if (onSale) where.push('p.compare_at_price > p.price AND p.stock > 0');
  let order = (SORTS[sort] ?? SORTS.new).order;
  if (q !== undefined) {
    const terms = searchTerms(q);
    if (!terms.length) return [];
    params.push(terms);
    const i = params.length;
    // A product matches when any word appears in it, or the words are close (typos, plurals).
    const hits = `(SELECT COUNT(*) FROM unnest($${i}::text[]) t WHERE ${SEARCH_TEXT} ILIKE '%' || t || '%')`;
    params.push(terms.join(' '));
    const j = params.length;
    where.push(`(${hits} > 0 OR word_similarity($${j}, ${SEARCH_TEXT}) > 0.4)`);
    order = `${hits} DESC, (SELECT COUNT(*) FROM unnest($${i}::text[]) t WHERE p.name ILIKE '%' || t || '%') DESC, word_similarity($${j}, ${SEARCH_TEXT}) DESC`;
  }
  params.push(limit, offset);
  return db.many(
    `${WITH_IMAGE} WHERE ${where.join(' AND ')} ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function listAll({ q, status } = {}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  if (q) {
    params.push(q);
    where.push(`(p.name ILIKE '%' || $${params.length} || '%' OR p.sku ILIKE '%' || $${params.length} || '%')`);
  }
  return db.many(`${WITH_IMAGE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.updated_at DESC`, params);
}

export async function getBySlug(slug) {
  const product = await db.one(`${WITH_IMAGE} WHERE p.slug = $1 AND p.status = 'active'`, [slug]);
  return product && withImages(product);
}

export async function getById(id) {
  const product = await db.one(`${WITH_IMAGE} WHERE p.id = $1`, [id]);
  return product && withImages(product);
}

async function withImages(product) {
  product.images = await db.many('SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort, id', [product.id]);
  return product;
}

// Curated relations first, then same-category products, so every page has suggestions.
export async function recommendations(productId, limit = 4) {
  const curated = await db.many(
    `${WITH_IMAGE} JOIN product_relations r ON r.related_id = p.id
      WHERE r.product_id = $1 AND p.status = 'active' AND p.stock > 0
      ORDER BY r.kind, p.id LIMIT $2`,
    [productId, limit],
  );
  if (curated.length >= limit) return curated;
  const exclude = [productId, ...curated.map((p) => p.id)];
  const similar = await db.many(
    `${WITH_IMAGE}
      WHERE p.status = 'active' AND p.stock > 0 AND p.id <> ALL($1::bigint[])
        AND p.category_id IS NOT DISTINCT FROM (SELECT category_id FROM products WHERE id = $2)
      ORDER BY p.created_at DESC LIMIT $3`,
    [exclude, productId, limit - curated.length],
  );
  return [...curated, ...similar];
}

export async function categories() {
  return db.many('SELECT * FROM categories ORDER BY sort, name');
}

/** Categories shown to shoppers: only those with active products, with a count and a cover image. */
export async function activeCategories() {
  return db.many(`SELECT c.*, COUNT(p.id)::int AS product_count,
                         (SELECT i.url FROM products p2 JOIN product_images i ON i.product_id = p2.id
                           WHERE p2.category_id = c.id AND p2.status = 'active'
                           ORDER BY p2.created_at DESC, i.sort, i.id LIMIT 1) AS image_url
                    FROM categories c JOIN products p ON p.category_id = c.id AND p.status = 'active'
                   GROUP BY c.id ORDER BY c.sort, c.name`);
}

/** Most ordered in the last 90 days (cancelled orders excluded); empty until there are orders. */
export async function bestSellers(limit = 8) {
  return db.many(
    `${WITH_IMAGE} JOIN (
        SELECT oi.product_id, SUM(oi.quantity) AS sold FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status <> 'cancelled' AND o.created_at > now() - interval '90 days' GROUP BY oi.product_id
      ) s ON s.product_id = p.id
      WHERE p.status = 'active' AND p.stock > 0 ORDER BY s.sold DESC, p.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function createCategory(name) {
  return db.one('INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *', [name, await uniqueSlug('categories', name)]);
}

async function uniqueSlug(table, text, ignoreId = null) {
  const base = slugify(text);
  let slug = base;
  for (let n = 2; ; n += 1) {
    const taken = await db.one(`SELECT id FROM ${table} WHERE slug = $1 AND id IS DISTINCT FROM $2`, [slug, ignoreId]);
    if (!taken) return slug;
    slug = `${base}-${n}`;
  }
}

const EDITABLE = ['name', 'sku', 'description', 'seo_title', 'seo_description', 'category_id', 'price',
  'compare_at_price', 'stock', 'low_stock_at', 'status', 'tags', 'faq'];

export async function saveProduct({ id, actor, ...fields }) {
  const values = {};
  for (const key of EDITABLE) if (key in fields) values[key] = fields[key];
  if ('faq' in values) values.faq = JSON.stringify(values.faq ?? []);

  let product;
  if (id) {
    const before = await db.one('SELECT * FROM products WHERE id = $1', [id]);
    if (!before) throw new Error('المنتج غير موجود');
    const keys = Object.keys(values);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      product = await db.one(
        `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, ...keys.map((k) => values[k])],
      );
    } else {
      product = before;
    }
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(product[k]));
    await audit({ actor, action: 'product.update', entity: 'product', entityId: id, data: { changed } });
  } else {
    values.slug = await uniqueSlug('products', values.name);
    const keys = Object.keys(values);
    product = await db.one(
      `INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      keys.map((k) => values[k]),
    );
    await audit({ actor, action: 'product.create', entity: 'product', entityId: product.id });
  }
  return product;
}

export async function addImage(productId, url, alt = '') {
  return db.one(
    `INSERT INTO product_images (product_id, url, alt, sort)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_images WHERE product_id = $1))
     RETURNING *`,
    [productId, url, alt],
  );
}

export async function removeImage(productId, imageId) {
  return db.one('DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING *', [imageId, productId]);
}

export async function setRelations(productId, kind, relatedIds) {
  await db.query('DELETE FROM product_relations WHERE product_id = $1 AND kind = $2', [productId, kind]);
  for (const relatedId of relatedIds) {
    if (relatedId === productId) continue;
    await db.query(
      'INSERT INTO product_relations (product_id, related_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [productId, relatedId, kind],
    );
  }
}

export async function relationIds(productId) {
  return db.many('SELECT related_id, kind FROM product_relations WHERE product_id = $1', [productId]);
}

export async function lowStock() {
  return db.many(`SELECT id, name, stock, low_stock_at FROM products
                   WHERE status = 'active' AND stock <= low_stock_at ORDER BY stock, name`);
}
