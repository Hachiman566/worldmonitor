# Pro Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans for inline execution or subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Sell email-associated Pro subscriptions for USD 10 monthly or USD 100 yearly from `/pro`.

**Architecture:** Hosted Stripe Checkout handles payment. Vercel endpoints create and verify sessions; signed webhooks persist billing state in existing Redis infrastructure. Stripe's hosted email-login portal manages subscriptions.

**Tech Stack:** React, TypeScript, Vite, Vercel Web Request handlers, Stripe Node SDK, Upstash Redis, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-pro-subscriptions-design.md`

## Global Constraints

- USD 10 per month or USD 100 per year, billed automatically until canceled.
- This release does not add application login or unlock Pro functionality.
- Browser-provided amounts, Price IDs, or return URLs are not accepted.
- No email, customer ID, subscription ID, or account access token in public status responses.
- Never log raw events, email addresses, or secrets.
- Do not create live products, enable real charges, or deploy as part of local implementation.

## Review Focus

- Duplicate checkout clicks and network retries must reuse the same attempt rather than create multiple subscriptions.
- Older webhook deliveries must not replace newer billing state.
- Incorrectly configured prices must block checkout rather than charge the wrong amount.
- Unconfigured environments must visibly disable purchase and portal controls.
- Payment redirects and status requests must not expose customer details or claim access is unlocked.

### Task 1: Checkout API and configuration

**Files:** Create `api/_billing.js`, `api/billing/config.js`, `api/billing/checkout.js`, `api/billing/status.js`, `api/billing/checkout.test.mjs`; modify `package.json`, lockfile, `.env.example`.

**Interfaces:** `createBillingHandlers({ stripe, redis, env })` exposes Request-to-Promise<Response> configuration, checkout, and status handlers with injectable dependencies. Public configuration returns `{ available, plans, portalUrl }`; checkout consumes `{ plan: 'monthly' | 'yearly', email, attemptId }` and returns `{ url }`; status consumes `session_id` and returns only `{ status: 'confirmed' | 'processing' | 'canceled' | 'failed' }`.

- [ ] Write failing tests: monthly validates USD/1000/month/1; yearly validates USD/10000/year/1; invalid email/plan returns 400; missing configuration returns 503; wrong price blocks session creation; supplied return URL cannot alter canonical URLs; duplicate attempt IDs reuse Stripe idempotency key; status JSON has no customer data; unrelated sessions are rejected.
- [ ] Run `node --test api/billing/checkout.test.mjs` and confirm tests fail for missing implementation.
- [ ] Implement server-only Stripe client and environment validation in `_billing.js`. Retrieve and validate prices; reuse existing API rate-limit conventions and Redis-backed limits for checkout; bound body size. Configure canonical redirects to `/pro`, session/subscription integration metadata, fixed line items, and stable attempt idempotency scoped to payload. Validate hosted checkout and portal URLs. Status validates integration ownership and configured prices.
- [ ] Add public config, checkout and status Request handler wrappers, SDK dependency and example environment settings. Local frontend must use its configured development API, never silently send purchases to the production API.
- [ ] Run the checkout tests and `npm run typecheck:api`; expect passing tests and successful type check.
- [ ] Commit only Task 1 files with message `feat: add Pro subscription checkout API`.

### Task 2: Required signed webhook processing

**Files:** Create `api/_billing-state.js`, `api/billing/webhook.js`, `api/billing/webhook.test.mjs`.

**Interfaces:** `processBillingEvent(event, { stripe, redis, env }): Promise<void>` validates integration and retrieves authoritative subscription state. `handleWebhook(request, dependencies): Promise<Response>` verifies the raw payload and signature before calling it. Redis state is keyed by subscription ID and stores status, plan, latest invoice payment state, and update time without emails/card data; receipts keyed by event ID expire after 30 days, subscription records expire after 400 days and refresh on relevant events.

- [ ] Write failing tests: bad signature returns 400 without writes; checkout completed/async succeeded and invoice paid/failed and subscription updated/deleted persist appropriate state; duplicate events do not repeat state mutation; unrelated events are acknowledged without mutation; Redis failure returns 503; older delivery uses current Stripe subscription state.
- [ ] Run `node --test api/billing/webhook.test.mjs`; confirm missing implementation fails.
- [ ] Implement raw-body signature verification, event ownership/price validation and authoritative subscription retrieval. Serialize writes per subscription with a bounded Redis lock; contention returns retryable failure. Atomically persist minimal state and event receipt with Redis Lua. For invoice events retrieve current invoice state so stale payment failures cannot replace newer success. Release locks only when the owner token matches.
- [ ] Run both billing test files; expect all tests pass.
- [ ] Commit Task 2 files with message `feat: persist verified Stripe billing events`.

### Task 3: Subscription purchase interface and integration guide

**Files:** Create `pro-test/src/components/SubscriptionCheckout.tsx`, `e2e/pro-subscriptions.spec.ts`, `docs/pro-subscriptions.md`; modify `pro-test/src/App.tsx`, `pro-test/vite.config.ts`, `pro-test/.env.example` and English/Chinese locale JSON files.

**Interfaces:** `SubscriptionCheckout(): ReactElement` fetches Task 1 configuration and renders plan/email selection, Checkout redirect, return status and hosted portal entry. Existing Pro navigation and relevant purchase calls to action point to `#subscribe`; unrelated waitlist controls retain their behavior.

- [ ] Write browser tests with mocked billing API: prices show USD 10 monthly and USD 100 billed yearly; invalid email cannot submit; one in-flight request despite double-click; unavailable config disables purchase; network failure allows retry with the same attempt ID; confirmed/processing/canceled returns have distinct copy; return parameters clear; portal link is disabled when absent; keyboard selection and 375px layout remain usable.
- [ ] Run the focused browser test and confirm the new subscription section is missing.
- [ ] Implement the accessible component using the current dark/green styling, clear recurring-charge disclosure, loading/error states and stable attempt IDs. Reset attempt IDs when plan/email changes. Abort obsolete status requests; show retry on failures and bounded polling for processing. Explicitly say application feature access is not automatically enabled by this purchase.
- [ ] Integrate the component and relevant CTA anchors. Add English/Chinese copy with English fallback for other existing locales. Configure local API proxy or explicit development origin without routing payments to production.
- [ ] Write sandbox setup guide: recurring prices, restricted key permissions, canonical origin, Redis, signature secret, webhook events, Stripe CLI forwarding, portal activation and a sandbox transaction. Document that mock checks do not establish account readiness.
- [ ] Run focused browser tests, `npm run typecheck:all`, `npm --prefix pro-test run lint`, `npm --prefix pro-test run build`, and `npm run build`. Inspect desktop and mobile screenshots; expect no overflow and visible validation/status feedback.
- [ ] Commit Task 3 files with message `feat: add Pro subscription purchase interface`.

## Final verification

- [ ] Review the final diff against every spec section, check no secrets or generated build artifacts are staged, and rerun only checks affected by subsequent fixes.
- [ ] Report verified behavior, local preview details, and any remaining account configuration or sandbox checks without claiming live payment readiness.

## Execution results

Implemented on `codex/pro-subscriptions`. Backend tests: 17 passed; browser tests: 8 passed; Pro lint and build pass. Independent review identified delayed payment failure handling, fixed with signed `checkout.session.async_payment_failed` markers and paid-state precedence; targeted review confirmed the fix. Root frontend/API type checks and root build remain blocked by missing miningSites/processingPlants/commodityPorts defaults in untouched map configuration files. Sandbox payment and deployment checks require account configuration. Source-only delivery; generated Pro assets can be rebuilt with `npm run build:pro`.
