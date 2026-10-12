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
   | `UPSTASH_REDIS_REST_URL` | Existing Redis REST URL (or paired `KV_REST_API_URL`) |
   | `UPSTASH_REDIS_REST_TOKEN` | Existing writable Redis REST credential (or paired `KV_REST_API_TOKEN`) |
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

## Deployment handoff (2026-10-12)

- Target project: `1045264407qqcoms-projects/worldmonitor`; public origin: `https://worldmonitor-one-zeta-33.vercel.app`. Four Production Config variables (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `BILLING_APP_ORIGIN`, `STRIPE_PORTAL_URL`) were saved successfully through the signed-in local Chrome dashboard. They require a new deployment to take effect.
- The approved live account is `acct_1UJSAI4KWWL6pVSi`. Existing live monthly/yearly Prices must be reused; do not create them again.
- Live webhook `we_1UPfoB4KWWL6pVSiiEqhKJIK` was created and read back successfully with the eight events listed above, API version `2026-09-30.endive`, and URL `https://worldmonitor-one-zeta-33.vercel.app/api/billing/webhook`. Do not duplicate it. The user confirmed direct secure entry, and the Vercel dashboard shows `STRIPE_WEBHOOK_SECRET` as Secret in Production; its value was not inspected.
- Live portal configuration `bpc_1UPfrB4KWWL6pVSiqSP4HWkn` was created with email login, invoice history and payment method updates enabled. Its public login URL is `https://billing.stripe.com/p/login/00w7sE2HT7OL68Bdd74ow00`; set this as Production Config `STRIPE_PORTAL_URL`. Subscription changes and customer detail updates are disabled. Cancellation was enabled after user confirmation with `mode=at_period_end` and `proration_behavior=none`: the current billing period continues and renewal stops at its end. The existing configuration was updated and read back; no customer subscription was modified. Persistent Redis is Available. The user confirmed the broad-scope application key was created and securely entered; the dashboard was checked without revealing values and shows `STRIPE_API_KEY` as Secret in Production. The user completed the Redis connection; Production Secret metadata confirms `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Billing now accepts this complete pair as a fallback after the original Upstash pair; read-only tokens are never used. No secrets have been uploaded by the agent.
- The user confirmed no existing Redis. Use an explicitly selected Upstash Free plan with no paid upgrades or add-ons; account/terms/integration permissions require their own approval before provisioning. Do not use the anonymous 72-hour Redis for persistent billing records.
- The local Chrome flow reached **Install Integration → Accept and Create** for Upstash for Redis. This first step accepts the Vercel Integration Marketplace End User Addendum, Upstash Terms and Privacy Policy, and states Vercel may share Vercel ID, email address or usage data with Upstash. The user subsequently approved this installation, these three terms and this data sharing, and the terms step was accepted. The actual Free plan was selected (500,000 commands per month, one database per account), with primary region `iad1`, no read regions and eviction disabled. Persistent resource `worldmonitor-billing` was subsequently confirmed in the team Storage list as Free and Available (resource `store_BhHfPICh11Sonitq`, integration `icfg_HzYhXfGJYdRkaGcycOY7BqlK`). The original provisioning page remained stale at 0%; do not create another database. The user connected it to `worldmonitor`; the dashboard success notification and Production Secret variable metadata were confirmed. While inspecting the resource Guides page, its accessibility text unexpectedly exposed Redis credentials in one tool output. The agent did not copy or use them, and token rotation was recommended to the user. No credential value is recorded here.
- Official Vercel CLI 63.1.2 is prepared outside the repository. The user completed the existing device authorization; CLI readback confirmed account `1045264407-8870`, team `1045264407qqcoms-projects`, and project `prj_xoUXeSAVAaCS2UIpADd3GbJxlcyT`. The local directory is linked to that project. `vercel link` unexpectedly downloaded a fresh OIDC token automatically; its value was not inspected, and the added `VERCEL_OIDC_TOKEN` entry was removed from `.env.local`. No OAuth approval was performed by the agent. Project metadata confirms Node.js 24.x and Vite. The user subsequently explicitly confirmed Redis credentials were updated. `.vercelignore` explicitly excludes environment files and local Vercel metadata from uploads.
- Initial deployment `dpl_HeyjnVAZGzdSGPkFhpt9htay1NPk` built successfully but hit the Hobby limit of 12 Node functions because colocated API tests were deployed as functions. `.vercelignore` now excludes `api/**/*.test.mjs`. Deployment `dpl_G7fKhKJpdcfNsUuXdMULgapHSkJn` then reached Ready, but was based on an uncommitted snapshot. The user requested merging and pushing to the latest main, then deploying that exact committed source; that final deployment and canonical domain verification remain pending. No paid plan upgrade was performed.
- Root `typecheck:all`, root `build`, billing tests (20, including Redis fallback regression tests), Pro lint/build, and mocked browser tests (8) passed locally. Root default-layer omissions and an unused import were repaired to unblock the build. No real payment transaction has been tested. Business verification remains pending according to the account handoff, not approved by these checks.

- Key handoff: after explicit user approval of the current broad scope, the draft was verified as 125 permissions (own account 77 read / 48 write; Connect 74 read / 43 write; 8 high-risk permissions), named `worldmonitor-production-billing`, and Create was clicked. The post-create page was deliberately not inspected because it may display the secret. The user subsequently confirmed creation and direct secure entry, and the dashboard confirmed `STRIPE_API_KEY` exists as Production Secret. Do not create a duplicate. The key is not a least-privilege key.

- Protected-deployment verification incident: CLI curl unexpectedly created an automation bypass secret despite an initial local guard; the request then failed during option parsing. The secret was not printed or used. Further token creation is now blocked in the temporary CLI, and the user must remove this unintended automation bypass in Deployment Protection. Protection itself was not disabled. Final deployment verification remains pending.
