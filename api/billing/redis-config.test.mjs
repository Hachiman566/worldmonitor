import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings, billingRedisConfig } from '../_billing.js';
import { billingDependencies } from '../_billing-runtime.js';
const required = { STRIPE_API_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_MONTHLY: 'price_month', STRIPE_PRICE_YEARLY: 'price_year', BILLING_APP_ORIGIN: 'https://example.com' };
test('billing accepts Vercel writable KV REST credentials', () => {
  const env = { ...required, KV_REST_API_URL: 'https://example.redis', KV_REST_API_TOKEN: 'fixture' };
  assert.equal(settings(env).origin, required.BILLING_APP_ORIGIN);
  assert.ok(billingDependencies(env).redis);
});
test('billing rejects readonly credentials and incomplete cross-prefix pairs', () => {
  for (const credentials of [
    { KV_REST_API_URL: 'https://example.redis', KV_REST_API_READ_ONLY_TOKEN: 'fixture' },
    { UPSTASH_REDIS_REST_URL: 'https://example.redis', KV_REST_API_TOKEN: 'fixture' },
  ]) {
    const env = { ...required, ...credentials };
    assert.throws(() => settings(env), /Billing configuration missing/);
    assert.equal(billingDependencies(env).redis, null);
  }
});
test('billing preserves a complete Upstash pair ahead of KV fallback', () => {
  const env = { ...required, UPSTASH_REDIS_REST_URL: 'https://primary.redis', UPSTASH_REDIS_REST_TOKEN: 'primary', KV_REST_API_URL: 'https://fallback.redis', KV_REST_API_TOKEN: 'fallback' };
  assert.deepEqual(billingRedisConfig(env), { url: 'https://primary.redis', token: 'primary' });
  assert.equal(settings(env).origin, required.BILLING_APP_ORIGIN);
  assert.ok(billingDependencies(env).redis);
});
