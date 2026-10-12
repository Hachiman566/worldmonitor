import { createHash } from 'node:crypto';

export const INTEGRATION = 'worldmonitor-pro-v1';
export const PLANS = Object.freeze({ monthly: { amount: 1000, interval: 'month' }, yearly: { amount: 10000, interval: 'year' } });
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export function settings(env) {
  const origin = new URL(env.BILLING_APP_ORIGIN);
  if (origin.origin !== env.BILLING_APP_ORIGIN || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new Error('Invalid billing origin');
  for (const key of ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) if (!env[key]) throw new Error('Billing configuration missing');
  return { origin: origin.origin, prices: { monthly: env.STRIPE_PRICE_MONTHLY, yearly: env.STRIPE_PRICE_YEARLY } };
}
export function portalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'billing.stripe.com' && url.pathname.startsWith('/p/login/') && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function planForPrice(priceId, config) { return Object.keys(PLANS).find(plan => config.prices[plan] === priceId); }
export function validatePrice(price, plan) {
  const expected = PLANS[plan];
  if (!expected || !price.active || price.currency !== 'usd' || price.unit_amount !== expected.amount || price.billing_scheme !== 'per_unit' || price.transform_quantity || price.recurring?.interval !== expected.interval || price.recurring?.interval_count !== 1 || price.recurring?.usage_type !== 'licensed') throw new Error('Invalid subscription price');
}
const rateScript = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n";
async function rateLimit(request, redis, kind, maximum) {
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const hash = createHash('sha256').update(ip).digest('hex');
  const count = await redis.eval(rateScript, [`billing:rate:${kind}:${hash}`], [60]);
  return Number(count) <= maximum;
}
async function boundedBody(request, limit = 4096) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('Oversized body'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createBillingHandlers({ stripe, redis, env }) {
  return {
    async configuration(request) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const plans = Object.entries(PLANS).map(([id, value]) => ({ id, amount: value.amount, currency: 'usd', interval: value.interval }));
      try {
        const config = settings(env);
        await Promise.all(Object.entries(config.prices).map(async ([plan, id]) => validatePrice(await stripe.prices.retrieve(id), plan)));
        return json({ available: true, plans, portalUrl: portalUrl(env.STRIPE_PORTAL_URL) });
      } catch { return json({ available: false, plans, portalUrl: portalUrl(env.STRIPE_PORTAL_URL) }); }
    },
    async checkout(request) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      let config; try { config = settings(env); } catch { return json({ error: 'Subscription checkout is not configured.' }, 503); }
      if (request.headers.get('origin') !== config.origin) return json({ error: 'Origin not allowed' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 400);
      let body; try { body = await boundedBody(request); } catch { return json({ error: 'Invalid request' }, 400); }
      const { plan, attemptId } = body || {};
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (!Object.hasOwn(PLANS, plan) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof attemptId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(attemptId)) return json({ error: 'Choose a plan and enter a valid email.' }, 400);
      try {
        if (!await rateLimit(request, redis, 'checkout', 10)) return json({ error: 'Too many attempts. Try again in a minute.' }, 429);
        validatePrice(await stripe.prices.retrieve(config.prices[plan]), plan);
        const digest = createHash('sha256').update(JSON.stringify([config.origin, plan, email, attemptId])).digest('hex');
        const suffix = [...digest.slice(0, 8)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
        const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: email, line_items: [{ price: config.prices[plan], quantity: 1 }], metadata: { integration: INTEGRATION }, subscription_data: { metadata: { integration: INTEGRATION } }, integration_identifier: `worldmonitor-pro-${suffix}`, success_url: `${config.origin}/pro?checkout=success&session_id={CHECKOUT_SESSION_ID}#subscribe`, cancel_url: `${config.origin}/pro?checkout=canceled#subscribe`, adaptive_pricing: { enabled: false } }, { idempotencyKey: `billing-${digest}` });
        const url = new URL(session.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Invalid checkout URL');
        return json({ url: url.href });
      } catch { return json({ error: 'Checkout is temporarily unavailable. Please try again.' }, 503); }
    },
    async status(request) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const id = new URL(request.url).searchParams.get('session_id');
      if (!id || !/^cs_(test_|live_)?[A-Za-z0-9_]{1,250}$/.test(id)) return json({ error: 'Invalid session' }, 400);
      try {
        const config = settings(env);
        if (!await rateLimit(request, redis, 'status', 60)) return json({ error: 'Too many requests' }, 429);
        const session = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] });
        const items = session.line_items?.data;
        if (session.mode !== 'subscription' || session.metadata?.integration !== INTEGRATION || items?.length !== 1 || items[0].quantity !== 1 || !planForPrice(items[0].price?.id, config)) return json({ error: 'Session not found' }, 404);
        if (session.status === 'complete' && session.payment_status === 'paid') return json({ status: 'confirmed' });
        if (session.status === 'expired') return json({ status: 'canceled' });
        const failed = await redis.get(`billing:checkout:${id}`);
        return json({ status: failed === 'failed' ? 'failed' : 'processing' });
      } catch { return json({ error: 'Unable to verify payment. Please retry.' }, 503); }
    },
  };
}
