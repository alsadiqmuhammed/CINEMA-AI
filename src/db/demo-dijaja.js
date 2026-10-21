// Proposal demo for Dijaja Store (DEMO_STORE=dijaja): their settings and a dozen products from their Instagram posts.
import { db } from './pool.js';
import { saveSettings } from '../services/settings.js';

const OB = 'حالة: أوبن بوكس', NEW = 'حالة: جديد', SILVER = 'تقييم: Silver Eggstar', GOLD = 'تقييم: Gold Eggstar';
// [name, category, price, market price, stock, image, tags, description]
const PRODUCTS = [
  ['Sony WH-1000XM6', 'سماعات رأس', 449000, null, 6, 'xm6', [OB, SILVER], 'أحدث جيل من سوني بعزل الضوضاء، معالج أقوى ومايكات أكثر للمكالمات.'],
  ['Sony WH-1000XM5', 'سماعات رأس', 279000, null, 8, 'xm5', [OB, SILVER], 'عزل ضوضاء من الأقوى بالسوگ، خفيفة ومريحة للسفر والدوام.'],
  ['Sony WH-1000XM4', 'سماعات رأس', 229000, null, 10, 'xm4', [OB, SILVER], 'الخيار الذكي لعزل ممتاز بسعر أقل، تدعم LDAC وبطارية 30 ساعة.'],
  ['Marshall Major V', 'سماعات رأس', 165000, 240000, 9, 'marshall', [OB, SILVER], 'أكثر من 100 ساعة تشغيل لاسلكي، وصوت مارشال المعروف بزر M القابل للتخصيص.'],
  ['Skullcandy Crusher Evo', 'سماعات رأس', 209000, 335000, 7, 'evo', [OB, SILVER], 'بيس تحسه بالاهتزاز، للي يحب الجهير القوي، وبطارية تكفي 40 ساعة.'],
  ['Skullcandy Crusher ANC 2', 'سماعات رأس', 289000, 405000, 5, 'anc2', [OB, SILVER], 'Crusher Bass ويه عزل ضوضاء نشط، للي يريد البيس والهدوء سوا.'],
  ['AirPods Pro 3', 'سماعات أذن', 249000, null, 6, 'airpods', [OB, SILVER], 'الجيل الثالث من آبل، عزل أقوى وصوت مكاني، ويه ضمان دجاجة.'],
  ['Jabra Elite 4 Active', 'سماعات أذن', 109000, null, 3, 'jabra', [OB, SILVER], 'سماعات رياضية تتحمل التعرق والماء، ثابتة بالأذن أثناء التمرين.'],
  ['Samsung Galaxy Watch 7', 'ساعات ذكية', 219000, null, 4, 'gw7', [OB, SILVER], 'ساعة سامسونج تتابع صحتك ونومك وتمرينك، وتستلم إشعاراتك.'],
  ['Amazfit GTR 4', 'ساعات ذكية', 209000, null, 6, 'amazfit', [OB, SILVER], 'تصميم كلاسيكي للدوام ومزايا رياضية متقدمة، وبطارية تطول أيام.'],
  ['Meta Quest 3', 'ألعاب وواقع افتراضي', 675000, null, 2, 'quest', [OB, SILVER], 'واقع افتراضي ومختلط، العب وتفرج على شاشة ضخمة بأي مكان.'],
  ['Nintendo Switch 2', 'ألعاب وواقع افتراضي', 680000, null, 2, 'switch2', [NEW, GOLD], 'إصدار 2025 الجديد، العب محمول أو على التلفزيون.'],
];
const ALTERNATIVES = [['xm5', 'xm6'], ['xm5', 'xm4'], ['evo', 'anc2'], ['marshall', 'evo'], ['quest', 'switch2'], ['gw7', 'amazfit']];

/** Runs once on an empty catalog; safe to call on every start. */
export async function seedDijaja() {
  if ((await db.one('SELECT COUNT(*)::int AS n FROM products')).n > 0) return;
  await saveSettings({
    store_name: 'دجاجة ستور',
    store_tagline: 'متجر إلكتروني متخصص بالسماعات والإكسسوارات والتقنيات اليومية، منتجات أصلية بخدمة سريعة ودعم طول الوقت.',
    shipping_fee: 0,
    free_shipping_over: 0,
    policies: {
      shipping: 'التوصيل مجاني لكل محافظات العراق، خلال 1 إلى 3 أيام.',
      returns: 'كل قطعة عليها ضمان دجاجة. إذا طلعت بيها مشكلة خلال فترة الضمان نصلحها أو نبدلها.',
      payment: 'الدفع نقداً عند الاستلام، وتكدر تفحص القطعة قبل ما تدفع.',
      privacy: 'نستخدم بياناتك لتوصيل طلبك والتواصل وياك بس.',
    },
  });
  const categories = {};
  let sort = 0;
  for (const name of [...new Set(PRODUCTS.map((p) => p[1]))]) {
    categories[name] = (await db.one('INSERT INTO categories (name, slug, sort) VALUES ($1, $2, $3) RETURNING id', [name, name.replace(/\s+/g, '-'), ++sort])).id;
  }
  const ids = {};
  for (const [i, [name, category, price, market, stock, image, tags, description]] of PRODUCTS.entries()) {
    const row = await db.one(
      `INSERT INTO products (slug, sku, name, description, category_id, price, compare_at_price, stock, low_stock_at, status, tags, seo_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 3, 'active', $9, $3) RETURNING id`,
      [name.replace(/\s+/g, '-'), `DJ-${i + 1}`, name, description, categories[category], price, market, stock, [category, ...tags]],
    );
    ids[image] = row.id;
    await db.query('INSERT INTO product_images (product_id, url, alt) VALUES ($1, $2, $3)', [row.id, `/static/img/dijaja/${image}.jpg`, name]);
  }
  for (const [a, b] of ALTERNATIVES) {
    await db.query(`INSERT INTO product_relations (product_id, related_id, kind) VALUES ($1, $2, 'alternative')`, [ids[a], ids[b]]);
  }
  console.log(`dijaja demo catalog: ${PRODUCTS.length} products`);
}
