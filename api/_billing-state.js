import { randomUUID } from 'node:crypto';
import { INTEGRATION, json, planForPrice, settings } from './_billing.js';

// The owner token fences writes after a lock expires. State and receipt commit together.
const writeScript = `-- billing-write
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('EXISTS', KEYS[3]) == 1 then return 1 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', 34560000)
if ARGV[3] == 'failed' then redis.call('SET', KEYS[4], 'failed', 'EX', 34560000) end
redis.call('SET', KEYS[3], '1', 'EX', 2592000)
return 1`;
const releaseScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0";
const subscriptionEvents = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const checkoutEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']);
const invoiceEvents = new Set(['invoice.paid', 'invoice.payment_failed']);
const objectId = value => typeof value === 'string' ? value : value?.id;

export async function processBillingEvent(event, { stripe, redis, env }) {
  let id; const object = event.data.object;
  if (subscriptionEvents.has(event.type)) id = object.id;
  else if (checkoutEvents.has(event.type)) {
    if (object.metadata?.integration !== INTEGRATION || (event.type !== 'checkout.session.async_payment_failed' && object.payment_status !== 'paid')) return;
    id = objectId(object.subscription);
  } else if (invoiceEvents.has(event.type)) id = objectId(object.parent?.subscription_details?.subscription || object.subscription);
  else return;
  if (!id) return;
  const config = settings(env);
  const receiptKey = `billing:event:${event.id}`;
  if (await redis.get(receiptKey)) return;
  const lockKey = `billing:lock:${id}`; const token = randomUUID();
  if (!await redis.set(lockKey, token, { nx: true, ex: 60 })) throw new Error('Billing state busy');
  try {
    let failure = '';
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = await stripe.checkout.sessions.retrieve(object.id);
      if (session.mode !== 'subscription' || session.metadata?.integration !== INTEGRATION || objectId(session.subscription) !== id) return;
      if (session.payment_status !== 'paid') failure = 'failed';
    }
    const subscription = await stripe.subscriptions.retrieve(id);
    if (subscription.metadata?.integration !== INTEGRATION) return;
    const items = subscription.items?.data;
    const plan = items?.length === 1 && items[0].quantity === 1 ? planForPrice(items[0].price?.id, config) : null;
    if (!plan) return;
    const latestInvoice = objectId(subscription.latest_invoice);
    const invoice = latestInvoice ? await stripe.invoices.retrieve(latestInvoice) : null;
    const state = { status: subscription.status, plan, cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end), paymentStatus: invoice?.paid || invoice?.status === 'paid' ? 'paid' : invoice?.status || 'unknown', updatedAt: Date.now() };
    const result = await redis.eval(writeScript, [lockKey, `billing:subscription:${id}`, receiptKey, `billing:checkout:${object.id}`], [token, JSON.stringify(state), failure]);
    if (Number(result) !== 1) throw new Error('Billing lock expired');
  } finally { await redis.eval(releaseScript, [lockKey], [token]); }
}

export async function handleWebhook(request, dependencies) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { stripe, env } = dependencies;
  try { settings(env); } catch { return json({ error: 'Billing not configured' }, 503); }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Signature required' }, 400);
  let event;
  try { event = await stripe.webhooks.constructEventAsync(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET); } catch { return json({ error: 'Invalid webhook signature' }, 400); }
  try { await processBillingEvent(event, dependencies); return json({ received: true }); } catch { return json({ error: 'Billing update unavailable' }, 503); }
}
