import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATION } from '../_billing.js';
import { handleWebhook, processBillingEvent } from '../_billing-state.js';
import Stripe from 'stripe';

function fixture() {
  const writes = []; const receipts = new Set(); let locked = false;
  const subscription = { id: 'sub_fixture', metadata: { integration: INTEGRATION }, status: 'active', cancel_at_period_end: false, latest_invoice: 'in_latest', items: { data: [{ quantity: 1, price: { id: 'price_monthly' } }] } };
  const stripe = { subscriptions: { retrieve: async () => subscription }, invoices: { retrieve: async () => ({ id: 'in_latest', status: 'paid', paid: true, created: 100 }) }, webhooks: { constructEventAsync: async () => { throw new Error('Bad signature'); } } };
  const redis = { get: async key => receipts.has(key) ? '1' : null, set: async () => { if (locked) return null; locked = true; return 'OK'; }, eval: async (script, keys, args) => { if (script.includes('billing-write')) { writes.push(JSON.parse(args[1])); receipts.add(keys[2]); } else { locked = false; } return 1; } };
  const env = { STRIPE_API_KEY: 'fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_YEARLY: 'price_yearly', BILLING_APP_ORIGIN: 'https://example.com', UPSTASH_REDIS_REST_URL: 'https://example.redis', UPSTASH_REDIS_REST_TOKEN: 'fixture' };
  return { stripe, redis, env, writes, subscription };
}
const event = (type, object = { id: 'sub_fixture' }) => ({ id: `evt_${type}`, type, data: { object } });
test('invalid signatures are rejected without writes', async () => {
  const f = fixture();
  const response = await handleWebhook(new Request('https://example.com', { method: 'POST', headers: { 'stripe-signature': 'bad' }, body: '{}' }), f);
  assert.equal(response.status, 400); assert.equal(f.writes.length, 0);
});
test('subscription updates and deletion persist authoritative state; duplicates skip', async () => {
  const f = fixture(); const e = event('customer.subscription.updated');
  await processBillingEvent(e, f); await processBillingEvent(e, f);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].status, 'active');
  f.subscription.status = 'canceled';
  await processBillingEvent(event('customer.subscription.deleted'), f);
  assert.equal(f.writes[1].status, 'canceled');
});
test('checkout and asynchronous payments persist only paid integration sessions', async () => {
  const f = fixture();
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) await processBillingEvent(event(type, { metadata: { integration: INTEGRATION }, payment_status: 'paid', subscription: 'sub_fixture' }), f);
  assert.equal(f.writes.length, 2);
  await processBillingEvent(event('checkout.session.completed', { metadata: { integration: INTEGRATION }, payment_status: 'unpaid', subscription: 'sub_fixture' }), fixture());
});
test('stale invoice failure retrieves current latest invoice rather than overwriting success', async () => {
  const f = fixture();
  for (const type of ['invoice.paid', 'invoice.payment_failed']) await processBillingEvent(event(type, { parent: { subscription_details: { subscription: 'sub_fixture' } } }), f);
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].paymentStatus, 'paid');
  assert.equal(JSON.stringify(f.writes).includes('email'), false);
});
test('unrelated events/subscriptions are ignored and Redis outages retry', async () => {
  const f = fixture(); await processBillingEvent(event('other'), f);
  f.subscription.metadata = {}; await processBillingEvent(event('customer.subscription.updated'), f);
  assert.equal(f.writes.length, 0);
  const broken = fixture(); broken.redis.set = async () => { throw new Error('Unavailable'); };
  broken.stripe.webhooks.constructEventAsync = async () => event('customer.subscription.updated');
  const response = await handleWebhook(new Request('https://example.com', { method: 'POST', headers: { 'stripe-signature': 'fixture' }, body: '{}' }), broken);
  assert.equal(response.status, 503);
});
test('lost lock prevents stale write and concurrent delivery retries', async () => {
  const f = fixture(); f.redis.eval = async script => script.includes('billing-write') ? 0 : 1;
  await assert.rejects(() => processBillingEvent(event('customer.subscription.updated'), f));
  const busy = fixture(); busy.redis.set = async () => null;
  await assert.rejects(() => processBillingEvent(event('customer.subscription.updated'), busy));
});
test('real Stripe SDK verifies raw signed body and rejects tampering', async () => {
  const f = fixture(); const sdk = new Stripe('rk_test_fixture'); f.stripe.webhooks = sdk.webhooks;
  const payload = JSON.stringify(event('other'));
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: f.env.STRIPE_WEBHOOK_SECRET });
  const request = body => new Request('https://example.com', { method: 'POST', headers: { 'stripe-signature': signature }, body });
  assert.equal((await handleWebhook(request(payload), f)).status, 200);
  assert.equal((await handleWebhook(request(payload + ' '), f)).status, 400);
});
test('signed delayed failure atomically saves a session marker and current subscription state', async () => {
  const f = fixture(); let marker;
  f.stripe.checkout = { sessions: { retrieve: async () => ({ metadata: { integration: INTEGRATION }, mode: 'subscription', payment_status: 'unpaid', subscription: 'sub_fixture' }) } };
  const original = f.redis.eval;
  f.redis.eval = async (script, keys, args) => { if (script.includes('billing-write')) marker = [keys[3], args[2]]; return original(script, keys, args); };
  await processBillingEvent(event('checkout.session.async_payment_failed', { id: 'cs_test_fixture', metadata: { integration: INTEGRATION }, subscription: 'sub_fixture' }), f);
  assert.deepEqual(marker, ['billing:checkout:cs_test_fixture', 'failed']);
  assert.equal(f.writes.length, 1);
});
