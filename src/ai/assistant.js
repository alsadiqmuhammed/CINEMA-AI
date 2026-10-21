import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { audit, AI_ACTOR } from '../lib/audit.js';
import { CONVERSATION_LABELS, formatMoney, ORDER_STATUS, PAYMENT_STATUS } from '../lib/format.js';
import * as carts from '../services/carts.js';
import * as conversations from '../services/conversations.js';
import * as orders from '../services/orders.js';
import * as products from '../services/products.js';
import { getSettings } from '../services/settings.js';
import { aiEnabled, createMessage, textOf } from './client.js';

const MAX_TOOL_ROUNDS = 6;

const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the store catalog. Returns active products with price, stock and link. Use before recommending or quoting any product.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words in the customer language' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product',
    description: 'Full details of one product: description, FAQ, stock, and complementary or alternative products.',
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'integer' } },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_order_status',
    description: 'Look up an order. Both the order number and the phone number used on the order are required.',
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['order_number', 'phone'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_checkout_link',
    description: 'Create a cart with the chosen products and return a link where the customer completes the order and payment on the website.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'integer' },
              quantity: { type: 'integer' },
            },
            required: ['product_id', 'quantity'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_customer_details',
    description: 'Save contact details or interests the customer shared, so the team can follow up. Only save what the customer actually said.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        interests: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'classify_conversation',
    description: 'Set the conversation stage for the CRM. Call it whenever the stage changes.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', enum: ['interested', 'lead', 'confirmed_order', 'follow_up', 'complaint'] },
      },
      required: ['label'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_human',
    description: 'Transfer the conversation to a staff member and stop answering. Use for refunds, payment problems, complaints, account or login issues, requests for discounts or exceptions, anything not covered by the catalog or policies, or when the customer asks for a person.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Short reason, in Arabic, for the staff member' } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
].map((tool) => ({ ...tool, strict: true }));

const SCHEMAS = {
  search_products: z.object({ query: z.string().min(1) }),
  get_product: z.object({ product_id: z.number().int() }),
  get_order_status: z.object({ order_number: z.string(), phone: z.string() }),
  create_checkout_link: z.object({
    items: z.array(z.object({ product_id: z.number().int(), quantity: z.number().int().min(1).max(carts.MAX_QUANTITY) })).min(1).max(20),
  }),
  save_customer_details: z.object({
    name: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), interests: z.array(z.string()).optional(),
  }),
  classify_conversation: z.object({ label: z.enum(['interested', 'lead', 'confirmed_order', 'follow_up', 'complaint']) }),
  handoff_to_human: z.object({ reason: z.string().min(1) }),
};

function systemPrompt(settings) {
  const p = settings.policies;
  return `أنت مساعد المبيعات وخدمة العملاء لمتجر "${settings.store_name}". تتحدث مع العملاء عبر الموقع أو واتساب أو منصات التواصل.

أسلوب الكلام: ${settings.brand_voice}
رد بنفس لغة العميل ولهجته، برسائل قصيرة مناسبة للموبايل.

طريقة العمل:
- معلوماتك عن المنتجات تأتي فقط من أدوات الكتالوج. ابحث قبل أن تذكر أي منتج أو سعر أو توفر، ولا تخترع منتجات أو مواصفات أو أسعاراً.
- عند السؤال عن منتج اقترح الأنسب، ويمكنك اقتراح منتج مكمل أو بديل من نتائج الأدوات.
- عندما يقرر العميل الشراء، أنشئ رابط إتمام الطلب وأرسله له. الدفع وإدخال العنوان يتمان في صفحة المتجر فقط، ولا تطلب أبداً بيانات بطاقة أو كلمات مرور.
- إذا شارك العميل اسمه أو رقم هاتفه أو اهتماماته فاحفظها.
- صنّف المحادثة عندما تتضح مرحلتها: مهتم، عميل محتمل، طلب مؤكد، متابعة، أو شكوى.
- لتتبع طلب تحتاج رقم الطلب ورقم الهاتف المسجل عليه.
- حوّل المحادثة لموظف فوراً في: الاسترجاع والاستبدال، مشاكل الدفع، الشكاوى، طلب خصم أو استثناء، أي شيء غير موجود في الكتالوج أو السياسات، أو إذا طلب العميل التحدث مع شخص. أخبر العميل أن أحد الفريق سيتواصل معه.
- لا تعِد بخصومات أو استرجاع أو مواعيد توصيل غير مذكورة في السياسات.

سياسات المتجر:
- الشحن: ${p.shipping}
- الاسترجاع: ${p.returns}
- الدفع: ${p.payment}
- الخصوصية: ${p.privacy}
- رسوم التوصيل: ${formatMoney(settings.shipping_fee, settings.currency)}${Number(settings.free_shipping_over) > 0 ? `، ومجاني للطلبات فوق ${formatMoney(settings.free_shipping_over, settings.currency)}` : ''}
${settings.support_phone ? `- رقم خدمة العملاء: ${settings.support_phone}` : ''}`;
}

function productSummary(p, settings) {
  return {
    product_id: p.id,
    name: p.name,
    price: formatMoney(p.price, settings.currency),
    in_stock: p.stock > 0,
    stock: p.stock,
    category: p.category_name ?? null,
    url: `${config.baseUrl}/p/${encodeURIComponent(p.slug)}`,
  };
}

/** Executes one tool call. Returns the JSON-serialisable result for the model. */
async function runTool(name, input, ctx) {
  const { conversation, settings, actions } = ctx;
  switch (name) {
    case 'search_products': {
      const found = await products.listActive({ q: input.query, limit: 6 });
      return found.length ? found.map((p) => productSummary(p, settings)) : { results: [], note: 'لا توجد منتجات مطابقة' };
    }
    case 'get_product': {
      const p = await products.getById(input.product_id);
      if (!p || p.status !== 'active') return { error: 'المنتج غير موجود' };
      const related = await products.recommendations(p.id, 3);
      return {
        ...productSummary(p, settings),
        description: p.description,
        faq: p.faq,
        suggestions: related.map((r) => productSummary(r, settings)),
      };
    }
    case 'get_order_status': {
      const order = await orders.track(input.order_number, input.phone);
      if (!order) return { error: 'لم نجد طلباً بهذا الرقم ورقم الهاتف' };
      return {
        number: order.number,
        status: ORDER_STATUS[order.status],
        payment: PAYMENT_STATUS[order.payment_status],
        total: formatMoney(order.total, order.currency),
        tracking_number: order.tracking_number,
        items: order.items.map((i) => `${i.name} × ${i.quantity}`),
      };
    }
    case 'create_checkout_link': {
      const { url } = await carts.createCheckoutLink(input.items, {
        source: conversation.channel,
        customerId: conversation.customer_id,
        phone: conversation.channel === 'whatsapp' ? conversation.external_id : undefined,
      });
      actions.push({ type: 'checkout_link', url });
      return { checkout_url: `${config.baseUrl}${url}` };
    }
    case 'save_customer_details': {
      const result = await conversations.captureContact(conversation, {
        name: input.name, phone: input.phone, email: input.email, interests: (input.interests ?? []).slice(0, 10),
      });
      if (!result) return { error: 'نحتاج رقم هاتف أو بريد صحيح' };
      if (result.customer) conversation.customer_id = result.customer.id;
      await audit({
        actor: AI_ACTOR,
        action: result.verified ? 'customer.capture' : 'customer.capture_unverified',
        entity: result.customer ? 'customer' : 'conversation',
        entityId: result.customer?.id ?? conversation.id,
        data: { conversation_id: conversation.id },
      });
      // The same answer either way, so a chat can't learn whether a number belongs to an existing customer.
      return { saved: true };
    }
    case 'classify_conversation': {
      await conversations.setLabel(conversation.id, input.label, AI_ACTOR);
      actions.push({ type: 'label', label: input.label });
      return { label: CONVERSATION_LABELS[input.label] };
    }
    case 'handoff_to_human': {
      await conversations.handoff(conversation.id, input.reason, AI_ACTOR);
      actions.push({ type: 'handoff', reason: input.reason });
      return { transferred: true };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

/**
 * Produces the assistant's reply to the latest customer message in a conversation.
 * The customer message must already be stored. Returns { text, actions }.
 */
export async function reply(conversation) {
  const settings = await getSettings();
  const actions = [];
  const ctx = { conversation, settings, actions };
  if (!aiEnabled()) return basicReply(conversation, ctx);

  const history = await conversations.history(conversation.id);
  const messages = toApiMessages(history);
  if (!messages.length) return { text: '', actions };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let response;
    try {
      response = await createMessage({
        max_tokens: 4000,
        system: [{ type: 'text', text: systemPrompt(settings), cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        messages,
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error('assistant API error', error.status, error.message);
        await conversations.handoff(conversation.id, 'تعذر الوصول لخدمة الذكاء الاصطناعي', AI_ACTOR);
        return { text: 'عذراً، صارت مشكلة تقنية. حوّلت محادثتك لواحد من الفريق وراح يتواصل وياك قريباً.', actions: [{ type: 'handoff', reason: 'api_error' }] };
      }
      throw error;
    }

    if (response.stop_reason === 'refusal') {
      await conversations.handoff(conversation.id, 'رفض المساعد الآلي الرد على الرسالة', AI_ACTOR);
      return { text: 'حوّلت سؤالك لواحد من الفريق وراح يرد عليك قريباً.', actions: [{ type: 'handoff', reason: 'refusal' }] };
    }

    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      return { text: textOf(response), actions };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const block of toolUses) {
      const parsed = SCHEMAS[block.name]?.safeParse(block.input);
      if (!parsed?.success) {
        results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Invalid input for this tool.' });
        continue;
      }
      try {
        const result = await runTool(block.name, parsed.data, ctx);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (error) {
        console.error(`tool ${block.name} failed`, error);
        results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Tool failed. Apologise and offer a staff member.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  await conversations.handoff(conversation.id, 'المحادثة احتاجت خطوات أكثر من المسموح', AI_ACTOR);
  return { text: 'حوّلت محادثتك لواحد من الفريق حتى يكمل وياك طلبك.', actions };
}

// Stored history → alternating user/assistant turns. Staff replies count as assistant turns.
function toApiMessages(history) {
  const out = [];
  for (const m of history) {
    const role = m.role === 'customer' ? 'user' : 'assistant';
    const last = out.at(-1);
    if (last?.role === role) last.content += `\n${m.content}`;
    else out.push({ role, content: m.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.at(-1)?.role !== 'user') return [];
  return out;
}

// --- Fallback when no API key is configured: keyword rules over the same tools. ---

const HANDOFF_WORDS = ['استرجاع', 'استرداد', 'ارجاع', 'إرجاع', 'استبدال', 'تبديل', 'شكوى', 'مشكلة', 'خصم', 'تخفيض', 'موظف', 'refund', 'complaint', 'human', 'agent'];
const GREETINGS = ['السلام', 'مرحبا', 'هلا', 'اهلا', 'أهلا', 'شلونك', 'hi', 'hello'];

async function basicReply(conversation, ctx) {
  const history = await conversations.history(conversation.id, 1);
  const text = history.at(-1)?.content?.trim() ?? '';
  const lower = text.toLowerCase();

  if (HANDOFF_WORDS.some((w) => lower.includes(w))) {
    const isComplaint = ['شكوى', 'مشكلة', 'complaint'].some((w) => lower.includes(w));
    if (isComplaint) await runTool('classify_conversation', { label: 'complaint' }, ctx);
    await runTool('handoff_to_human', { reason: `طلب العميل: ${text.slice(0, 120)}` }, ctx);
    return { text: 'وصلت رسالتك، حوّلتها لواحد من الفريق وراح يتواصل وياك قريباً.', actions: ctx.actions };
  }

  const orderMatch = text.match(/\b([A-Z0-9]{7})\b/i);
  const phoneMatch = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).match(/\+?\d{8,15}/);
  if (orderMatch && phoneMatch) {
    const status = await runTool('get_order_status', { order_number: orderMatch[1], phone: phoneMatch[0] }, ctx);
    if (status.error) return { text: status.error, actions: ctx.actions };
    return { text: `طلبك #${status.number}: ${status.status} (${status.payment}). الإجمالي ${status.total}.${status.tracking_number ? ` رقم الشحنة: ${status.tracking_number}` : ''}`, actions: ctx.actions };
  }
  if (/طلب|order|تتبع/i.test(text) && !orderMatch) {
    return { text: 'حتى أتتبع طلبك، دزلي رقم الطلب ورقم الهاتف المسجل عليه برسالة وحدة.', actions: ctx.actions };
  }

  if (GREETINGS.some((w) => lower.startsWith(w)) && text.length < 25) {
    return { text: `أهلاً بيك في ${ctx.settings.store_name}! شنو المنتج اللي تدوّر عليه؟ اكتب اسمه أو نوعه وأساعدك.`, actions: ctx.actions };
  }

  const found = await runTool('search_products', { query: text }, ctx);
  if (Array.isArray(found) && found.length) {
    await runTool('classify_conversation', { label: 'interested' }, ctx);
    const lines = found.slice(0, 4).map((p) => `• ${p.name}: ${p.price}${p.in_stock ? '' : ' (غير متوفر حالياً)'}\n${p.url}`);
    return { text: `هاي المنتجات اللي لكيتها:\n${lines.join('\n')}\n\nتريد أجهزلك رابط الطلب لأي واحد منها؟`, actions: ctx.actions };
  }
  return { text: 'ما لكيت منتج مطابق. وضّحلي شنو تريد أكثر، أو اكتب "موظف" وأحوّلك لواحد من الفريق.', actions: ctx.actions };
}
