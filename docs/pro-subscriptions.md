# Pro subscription checkout

The `/pro#subscribe` section offers USD 10 billed monthly and USD 100 billed yearly. Stripe hosts payment collection and email-authenticated subscription management. Buying a subscription does not unlock application features in this release. Existing waitlist forms remain available separately.

## Configure a Stripe sandbox

1. Create an isolated [Stripe sandbox](https://docs.stripe.com/sandboxes) and a World Monitor Pro product. Add two active, fixed, licensed recurring USD prices: 1000 cents every one month and 10000 cents every one year. Do not use tiered, metered, transformed-quantity, or custom-amount prices. Copy the two Price IDs.
2. Create a restricted API key for this sandbox. Grant Checkout Sessions write/read, Prices read, Subscriptions read, Invoices read, and the dependent Customers/payment resources required by Checkout. Check permission requirements and any 403s in Stripe Workbench while testing. Keep this key server-only; store deployment credentials as sensitive Vercel environment variables.
3. Set the following in the root `.env.local` for development, or server environment for deployment:

   | Variable | Value |
   | --- | --- |
   | `STRIPE_API_KEY` | Sandbox restricted API key |
   | `STRIPE_PRICE_MONTHLY` | USD 10 monthly recurring Price ID |
   | `STRIPE_PRICE_YEARLY` | USD 100 yearly recurring Price ID |
   | `BILLING_APP_ORIGIN` | Exact public origin, without a trailing slash |
   | `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for this environment |
   | `UPSTASH_REDIS_REST_URL` | Existing Redis REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | Existing Redis REST credential |
   | `STRIPE_PORTAL_URL` | Stripe customer portal email-login URL |

4. Activate a customer portal login link in [Stripe portal settings](https://dashboard.stripe.com/settings/billing/portal). Enable subscription cancellation, payment method updates and invoices as appropriate. Stripe sends customers an email login link; the website never creates portal sessions from unverified email addresses. Configure branding, receipts and renewal communication in Stripe.
5. Configure the required `/api/billing/webhook` endpoint with these snapshot events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Use the endpoint's signing secret, not an API key. Stripe SDK 23 pins API version `2026-09-30.endive`; choose that version for snapshot events where available.

No API key or webhook secret belongs in a `VITE_` variable. Without required configuration, checkout is disabled. Incorrect Price amounts, currencies, or billing intervals fail closed. Automatic tax is not enabled: configure tax obligations and registrations before adding tax collection to this integration. Adaptive Pricing is disabled to retain the stated USD charges.

## Local development

Use Node 22+ with support for `--env-file-if-exists`. Install the root and `pro-test` dependencies from their lockfiles. Set `BILLING_APP_ORIGIN=http://localhost:3000` in root `.env.local`; the exact host must match the browser origin.

In separate terminals:

```sh
npm run dev:billing
npm --prefix pro-test run dev
stripe listen --forward-to http://127.0.0.1:3001/api/billing/webhook
```

The listener prints a local signing secret. Set `STRIPE_WEBHOOK_SECRET` to that value and restart `dev:billing`. Open `http://localhost:3000/pro/#subscribe`. The Pro Vite server proxies only `/api/billing` to localhost port 3001. Override `BILLING_DEV_API_ORIGIN` in the Pro development environment if needed; never point local purchase requests at production.

Select each plan and complete a sandbox payment using a [Stripe test payment method](https://docs.stripe.com/testing). Verify Checkout displays the correct recurring amount, cancellation returns correctly, confirmed payment returns correctly, and Redis receives `billing:subscription:<id>`. Open Manage subscription, verify email ownership, inspect invoices and cancel renewal. Replay a webhook and confirm it does not create another state change. Test a failed renewal and delayed payment with Stripe's sandbox tools. Production requires its own live Prices, restricted key, webhook destination/signing secret and portal login link.

## API behavior and retained state

- `GET /api/billing/config` exposes availability, fixed plan details and the validated portal login link.
- `POST /api/billing/checkout` accepts `plan`, `email`, and a UUID v4 `attemptId`. Only the configured origin can initiate checkout. The server chooses price and return URLs. Retry the same request with the same attempt ID; changing email or plan starts a distinct attempt. A new attempt can create another subscription, so customers with existing subscriptions should use Manage subscription.
- `GET /api/billing/status?session_id=…` returns only confirmed, processing, canceled or signed-event-verified failed state for this integration's sessions. It does not authorize access or expose customer records.
- `POST /api/billing/webhook` requires a valid Stripe signature over the unchanged raw body. Duplicate receipts expire after 30 days. Subscription records retain only billing status, plan, renewal cancellation flag, current invoice payment state and update time, for 400 days from the last relevant event. Signed delayed-payment failure markers retain the checkout session ID and failure state for 400 days. A later paid session takes precedence. No email or card details are stored in Redis. Records are internal billing state and do not grant feature access.

Redis outages block new checkouts and return retryable errors for webhooks. Webhook handling retrieves the current Stripe subscription and latest invoice under a per-subscription lock. An expired owner cannot write; state and event receipt commit atomically. The SDK uses bounded network retries. Checkout attempt IDs provide Stripe's standard idempotency window, not permanent cross-device subscription deduplication.

## Validation

```sh
npm run test:billing
npm --prefix pro-test run lint
npm --prefix pro-test run build
npx playwright test --config e2e/pro-subscriptions.config.ts
```

The browser tests use an installed Chrome and mocked Stripe responses. They prove UI behavior, not a working sandbox account. Also run the root's `typecheck:all` and `build` checks; failures in untouched files remain project build limitations. A real sandbox transaction and deployed Vercel smoke test are required before live activation. This implementation does not create live products, deploy, or charge money.

Run `npm run build:pro` before deployment to regenerate the static Pro assets consumed by the root app. Generated assets are not part of the source-only implementation commits.
