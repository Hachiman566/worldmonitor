import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBillingHandlers, INTEGRATION } from '../_billing.js';

// Generated synthetic addresses use the reserved .invalid domain.
const testEmail = name => [name, 'example.invalid'].join('@');
const env = { STRIPE_API_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_YEARLY: 'price_yearly', BILLING_APP_ORIGIN: 'https://example.com', STRIPE_PORTAL_URL: 'https://billing.stripe.com/p/login/test_fixture', UPSTASH_REDIS_REST_URL: 'https://example.redis', UPSTASH_REDIS_REST_TOKEN: 'fixture' };
function fixtures() {
  const calls = [];
  const stripe = { prices: { retrieve: async id => ({ id, active: true, currency: 'usd', unit_amount: id === 'price_monthly' ? 1000 : 10000, billing_scheme: 'per_unit', recurring: { interval: id === 'price_monthly' ? 'month' : 'year', interval_count: 1, usage_type: 'licensed' } }) }, checkout: { sessions: { create: async (...args) => { calls.push(args); return { url: 'https://checkout.stripe.com/c/pay/fixture' }; }, retrieve: async () => ({ mode: 'subscription', metadata: { integration: INTEGRATION }, status: 'complete', payment_status: 'paid', customer_email: testEmail('private'), customer: 'cus_private', line_items: { data: [{ quantity: 1, price: { id: 'price_monthly' } }] } }) } } };
  return { stripe, redis: { eval: async () => 1, get: async () => null }, env: { ...env }, calls };
}
const request = (body, origin = env.BILLING_APP_ORIGIN) => new Request('https://example.com/api/billing/checkout', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const body = { plan: 'monthly', email: testEmail('test'), attemptId: '12345678-1234-4234-8234-123456789012' };
test('monthly/yearly fixed prices and canonical return URLs', async () => {
  for (const plan of ['monthly', 'yearly']) {
    const f = fixtures();
    const response = await createBillingHandlers(f).checkout(request({ ...body, plan, returnUrl: 'https://evil.com' }));
    assert.equal(response.status, 200);
    const [params] = f.calls[0];
    assert.equal(params.line_items[0].price, `price_${plan}`);
    assert.equal(params.customer_email, body.email);
    assert.equal(params.mode, 'subscription');
    assert.ok(params.success_url.startsWith('https://example.com/pro?'));
    assert.equal(params.payment_method_types, undefined);
    assert.match(params.integration_identifier, /worldmonitor-pro-[a-z]{8}$/);
  }
});
test('invalid plans, email, attempt IDs and origins are rejected', async () => {
  for (const patch of [{ plan: 'bogus' }, { plan: 'toString' }, { email: 'bad' }, { attemptId: 'bad' }]) assert.equal((await createBillingHandlers(fixtures()).checkout(request({ ...body, ...patch }))).status, 400);
  assert.equal((await createBillingHandlers(fixtures()).checkout(request(body, 'https://evil.com'))).status, 403);
});
test('missing configuration and mismatched price fail closed', async () => {
  const f = fixtures(); f.env.STRIPE_API_KEY = '';
  assert.equal((await createBillingHandlers(f).checkout(request(body))).status, 503);
  const bad = fixtures(); bad.stripe.prices.retrieve = async () => ({ active: true, currency: 'usd', unit_amount: 999, recurring: { interval: 'month', interval_count: 1 } });
  assert.equal((await createBillingHandlers(bad).checkout(request(body))).status, 503);
  assert.equal(bad.calls.length, 0);
});
test('retries preserve idempotency and changed payload changes scope', async () => {
  const f = fixtures(); const handlers = createBillingHandlers(f);
  await handlers.checkout(request(body)); await handlers.checkout(request(body)); await handlers.checkout(request({ ...body, email: testEmail('different') }));
  assert.equal(f.calls[0][1].idempotencyKey, f.calls[1][1].idempotencyKey);
  assert.notEqual(f.calls[0][1].idempotencyKey, f.calls[2][1].idempotencyKey);
  assert.equal(f.calls[0][0].integration_identifier, f.calls[1][0].integration_identifier);
});
test('status exposes only state, rejects unrelated sessions', async () => {
  const f = fixtures(); const req = new Request('https://example.com/api/billing/status?session_id=cs_test_fixture');
  assert.deepEqual(await (await createBillingHandlers(f).status(req)).json(), { status: 'confirmed' });
  f.stripe.checkout.sessions.retrieve = async () => ({ metadata: {}, mode: 'subscription' });
  assert.equal((await createBillingHandlers(f).status(req)).status, 404);
});
test('rate limiting and Redis outage block new purchases', async () => {
  const f = fixtures(); f.redis.eval = async () => 11;
  assert.equal((await createBillingHandlers(f).checkout(request(body))).status, 429);
  f.redis.eval = async () => { throw new Error('secret'); };
  assert.equal((await createBillingHandlers(f).checkout(request(body))).status, 503);
});
test('unconfigured public config is unavailable without secrets', async () => {
  const f = fixtures(); f.env.STRIPE_WEBHOOK_SECRET = '';
  const result = await (await createBillingHandlers(f).configuration(new Request('https://example.com/api/billing/config'))).json();
  assert.equal(result.available, false);
  assert.equal(JSON.stringify(result).includes('rk_test'), false);
});
test('transformed prices and oversized payload cannot create checkout', async () => {
  const f = fixtures(); const retrieve = f.stripe.prices.retrieve;
  f.stripe.prices.retrieve = async id => ({ ...await retrieve(id), transform_quantity: { divide_by: 10, round: 'down' } });
  assert.equal((await createBillingHandlers(f).checkout(request(body))).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal((await createBillingHandlers(fixtures()).checkout(request({ ...body, padding: 'x'.repeat(5000) }))).status, 400);
});
test('signed delayed failure is terminal, but a later paid session takes precedence', async () => {
  const f = fixtures(); const retrieve = f.stripe.checkout.sessions.retrieve;
  f.stripe.checkout.sessions.retrieve = async () => ({ ...await retrieve(), payment_status: 'unpaid' });
  f.redis.get = async () => 'failed';
  const req = () => new Request('https://example.com/api/billing/status?session_id=cs_test_fixture');
  assert.deepEqual(await (await createBillingHandlers(f).status(req())).json(), { status: 'failed' });
  f.stripe.checkout.sessions.retrieve = retrieve;
  assert.deepEqual(await (await createBillingHandlers(f).status(req())).json(), { status: 'confirmed' });
});
