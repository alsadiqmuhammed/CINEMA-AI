import { z } from 'zod';
import { audit, AI_ACTOR } from '../lib/audit.js';
import { formatMoney } from '../lib/format.js';
import * as approvals from '../services/approvals.js';
import { getSettings } from '../services/settings.js';
import { aiEnabled, createMessage, textOf } from './client.js';

const ProductContent = z.object({
  name: z.string(),
  description: z.string(),
  seo_title: z.string(),
  seo_description: z.string(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Clear product title, under 70 characters' },
    description: { type: 'string', description: 'Product page description, 80-200 words, short paragraphs and bullet lines starting with "• "' },
    seo_title: { type: 'string', description: 'Under 60 characters' },
    seo_description: { type: 'string', description: 'Under 155 characters' },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'description', 'seo_title', 'seo_description', 'faq'],
  additionalProperties: false,
};

const AdCampaign = z.object({
  name: z.string(),
  objective: z.string(),
  audiences: z.array(z.object({ name: z.string(), description: z.string() })),
  ad_copies: z.array(z.object({ headline: z.string(), primary_text: z.string(), call_to_action: z.string() })),
  creative_ideas: z.array(z.string()),
  budget_plan: z.string(),
  success_metrics: z.array(z.string()),
});

const AD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    objective: { type: 'string' },
    audiences: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' } },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
    ad_copies: {
      type: 'array',
      items: {
        type: 'object',
        properties: { headline: { type: 'string' }, primary_text: { type: 'string' }, call_to_action: { type: 'string' } },
        required: ['headline', 'primary_text', 'call_to_action'],
        additionalProperties: false,
      },
    },
    creative_ideas: { type: 'array', items: { type: 'string' } },
    budget_plan: { type: 'string', description: 'How to split the given budget, never exceeding it' },
    success_metrics: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'objective', 'audiences', 'ad_copies', 'creative_ideas', 'budget_plan', 'success_metrics'],
  additionalProperties: false,
};

async function structured(prompt, jsonSchema, zodSchema, settings) {
  const response = await createMessage({
    max_tokens: 8000,
    system: `أنت كاتب محتوى تجاري لمتجر "${settings.store_name}". أسلوب العلامة: ${settings.brand_voice}
اكتب بالعربية الفصحى المبسطة ما لم يُطلب غير ذلك. لا تذكر معلومة غير موجودة في البيانات المعطاة، ولا تعد بشيء غير مذكور في السياسات.`,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: jsonSchema } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('رفض النموذج إنشاء هذا المحتوى');
  if (response.stop_reason === 'max_tokens') throw new Error('الرد انقطع قبل اكتماله');
  return zodSchema.parse(JSON.parse(textOf(response)));
}

/** Drafts product page copy. The draft is queued for approval and never published directly. */
export async function draftProductContent(product, { notes = '' } = {}) {
  const settings = await getSettings();
  let fields;
  let source;
  if (aiEnabled()) {
    const facts = {
      الاسم_الحالي: product.name,
      الوصف_الحالي: product.description,
      السعر: formatMoney(product.price, settings.currency),
      التصنيف: product.category_name,
      الوسوم: product.tags,
      الأسئلة_الحالية: product.faq,
    };
    fields = await structured(
      `جهز محتوى صفحة المنتج التالي: عنوان، وصف مقنع وواضح، عنوان ووصف SEO، و3 إلى 5 أسئلة شائعة بإجاباتها من البيانات فقط.
سياسات الشحن والاسترجاع للإجابة عنها إن لزم: ${settings.policies.shipping} / ${settings.policies.returns}
${notes ? `ملاحظات الفريق: ${notes}` : ''}

بيانات المنتج:
${JSON.stringify(facts, null, 2)}`,
      PRODUCT_SCHEMA,
      ProductContent,
      settings,
    );
    source = 'claude';
  } else {
    fields = templateProductContent(product, settings);
    source = 'template';
  }
  const approval = await approvals.create({
    kind: 'product_content',
    title: `محتوى مقترح للمنتج: ${product.name}`,
    payload: { product_id: product.id, source, fields, before: pick(product) },
    requestedBy: 'ai',
  });
  await audit({ actor: AI_ACTOR, action: 'content.draft', entity: 'product', entityId: product.id, data: { approval_id: approval.id, source } });
  return approval;
}

function pick(product) {
  return {
    name: product.name,
    description: product.description,
    seo_title: product.seo_title,
    seo_description: product.seo_description,
    faq: product.faq,
  };
}

function templateProductContent(product, settings) {
  const description = product.description?.trim()
    || `${product.name} من ${settings.store_name}.\n• جودة مضمونة\n• توصيل سريع\n• دفع عند الاستلام متاح`;
  return {
    name: product.name,
    description,
    seo_title: `${product.name} | ${settings.store_name}`.slice(0, 60),
    seo_description: `اشترِ ${product.name} أونلاين من ${settings.store_name} بسعر ${formatMoney(product.price, settings.currency)}. ${settings.policies.shipping}`.slice(0, 155),
    faq: [
      { q: 'كم مدة التوصيل؟', a: settings.policies.shipping },
      { q: 'هل يمكنني الاسترجاع؟', a: settings.policies.returns },
      { q: 'ما طرق الدفع المتاحة؟', a: settings.policies.payment },
    ],
  };
}

/**
 * Proposes an ad campaign. The system only suggests: launching it or spending
 * any budget needs a person's explicit approval, and launching is done by staff.
 */
export async function draftAdCampaign({ goal, budget, products, user }) {
  const settings = await getSettings();
  let plan;
  let source;
  if (aiEnabled()) {
    plan = await structured(
      `اقترح حملة إعلانية على فيسبوك وانستقرام.
الهدف: ${goal}
الميزانية القصوى: ${formatMoney(budget, settings.currency)} (لا تتجاوزها)
المنتجات:
${products.map((p) => `- ${p.name} (${formatMoney(p.price, settings.currency)}): ${p.description.slice(0, 300)}`).join('\n')}

أعطِ شرائح جمهور، 3 نصوص إعلانية، أفكار تصاميم أو فيديوهات قصيرة، توزيع الميزانية، ومؤشرات النجاح.`,
      AD_SCHEMA,
      AdCampaign,
      settings,
    );
    source = 'claude';
  } else {
    plan = {
      name: `حملة: ${goal}`.slice(0, 80),
      objective: goal,
      audiences: [{ name: 'جمهور مشابه للعملاء', description: 'Lookalike من قائمة العملاء الحاليين' }, { name: 'إعادة استهداف', description: 'زوار الموقع آخر 30 يوم' }],
      ad_copies: products.slice(0, 3).map((p) => ({ headline: p.name, primary_text: `${p.name} الآن بسعر ${formatMoney(p.price, settings.currency)}. اطلبه اليوم!`, call_to_action: 'تسوّق الآن' })),
      creative_ideas: ['صورة المنتج على خلفية بسيطة', 'فيديو قصير 10 ثواني يعرض المنتج قيد الاستخدام'],
      budget_plan: `70% لإعادة الاستهداف و30% للجمهور المشابه، بحد أقصى ${formatMoney(budget, settings.currency)}`,
      success_metrics: ['تكلفة الطلب', 'نسبة النقر', 'العائد على الإنفاق الإعلاني'],
    };
    source = 'template';
  }
  return approvals.create({
    kind: 'ad_campaign',
    title: `حملة مقترحة: ${plan.name}`,
    payload: { source, goal, budget: Number(budget), currency: settings.currency, product_ids: products.map((p) => p.id), plan },
    requestedBy: `user:${user.id}`,
  });
}
