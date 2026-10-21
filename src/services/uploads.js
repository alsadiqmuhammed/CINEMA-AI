import { db } from '../db/pool.js';
import { token } from '../lib/auth.js';

export const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** Stores an image and returns its public URL. The extension comes from the allowed type, never the uploaded name. */
export async function saveImage(buffer, contentType) {
  const name = `${Date.now().toString(36)}-${token(8)}${IMAGE_TYPES[contentType]}`;
  await db.query('INSERT INTO uploads (name, content_type, data, size) VALUES ($1, $2, $3, $4)', [name, contentType, buffer, buffer.length]);
  return `/uploads/${name}`;
}

export async function find(name) {
  return db.one('SELECT content_type, data FROM uploads WHERE name = $1', [name]);
}

export async function removeByUrl(url) {
  if (url?.startsWith('/uploads/')) await db.query('DELETE FROM uploads WHERE name = $1', [url.slice('/uploads/'.length)]);
}
