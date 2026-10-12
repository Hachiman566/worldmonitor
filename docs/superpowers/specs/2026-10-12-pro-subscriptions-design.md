# World Monitor Pro subscription checkout

## Agreed outcome

Add subscription purchasing to the existing `/pro` page. Pro costs USD 10 per month or USD 100 per year, billed automatically until canceled. Purchases are associated with the customer's email. This release does not add application login or unlock Pro functionality. Do not imply that paying automatically grants features currently described as planned on the Pro landing page.

## Interface

Keep the existing dark background and green accent. Add an accessible, responsive subscription section with monthly and annual choices, total recurring price, email input, renewal disclosure, and a checkout button. Annual pricing is USD 100 billed yearly; any monthly equivalent must clearly distinguish the actual yearly charge. Link the relevant purchase calls to action to this section while retaining unrelated waitlist flows.

Display loading, validation, unavailable-configuration, and recoverable API errors. Disable repeated submissions while checkout is being created. A canceled checkout returns to the section with a cancellation message. A successful redirect initiates server-side verification and displays confirmed or processing status; URL parameters alone never establish payment success. Clear checkout parameters from the browser address once handled. Do not expose customer details in the public status response.

Add a manage-subscription link to the Stripe hosted customer portal login page. Stripe verifies email ownership. Never create portal access from an unverified email supplied to a public API.

## Payment architecture

Use Stripe Billing with hosted Checkout Sessions in subscription mode. The existing Vercel API layer owns Stripe credentials and session creation. Frontend requests select only a fixed monthly or yearly plan and provide an email. The server maps the plan to configured Stripe recurring Price IDs and validates active status, currency, amount, interval, and interval count against this spec. Browser-provided amounts, Price IDs, or return URLs are not accepted.

Use a configured canonical application origin for return URLs. Restrict browser API access to the configured application origin, validate payload size and email, and apply appropriate rate limiting using existing project facilities. Stripe SDK configuration remains server-only. Enable payment methods through Stripe's Dashboard configuration instead of an explicit payment-method allowlist.

Provide a server endpoint to retrieve minimal checkout status by session ID. Verify that the retrieved session belongs to this integration and configured product prices. Return only payment/processing state; no email, customer ID, subscription ID, or account access token. This endpoint is for feedback, not feature fulfillment.

## Webhooks and state

Provide a required webhook endpoint that verifies Stripe's signature against the raw request body. Support completed and asynchronous checkout payments, recurring invoice payment success/failure, and subscription updates/deletion. Validate events belong to this integration before updating state. Never log raw events, email addresses, or secrets.

Use the existing server-side Redis infrastructure to store minimal subscription and payment status keyed by Stripe object IDs, with explicit retention and no card data. Event handling must tolerate duplicate delivery and avoid stale subscription updates: retrieve the current subscription state from Stripe for applicable changes, then atomically persist state and processed-event receipt. Return a non-success response if required persistence fails so Stripe retries. No event grants application access in this release.

## Configuration and delivery

Document server-only Stripe API key, webhook signing secret, monthly/yearly Price IDs, canonical application origin, existing Redis requirements, and the hosted customer portal login URL. Recommend a restricted key with the permissions required by these endpoints. Keep credentials out of frontend environment variables. Do not create live products, enable real charges, or deploy as part of local implementation.

Configuration absent: render a useful unavailable state rather than a working-looking payment button. Provide sandbox setup and webhook forwarding instructions, and document activation of the portal's email login link. A real Stripe sandbox transaction requires configured account credentials and prices; mocked validation cannot establish live readiness.

## Validation

Test invalid plans/emails, absent configuration, price mismatches, fixed return URLs, API failures, and privacy of status responses. Test invalid webhook signatures, duplicate delivery, unrelated events, and persistence failures. Verify plan selection, loading/error states, successful and canceled return flows, keyboard use, and narrow-screen layout. Run root frontend/API type checks, Pro TypeScript validation, and builds affected by the change. Report any checks blocked by missing dependencies or credentials.

## Sources

- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/customer-management/activate-no-code-customer-portal
- https://docs.stripe.com/webhooks
