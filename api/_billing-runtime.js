import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { createBillingHandlers } from './_billing.js';

export function billingDependencies() {
  const env = process.env;
  // The SDK pins its supported API version; credentials never reach the browser.
  const stripe = env.STRIPE_API_KEY ? new Stripe(env.STRIPE_API_KEY, { maxNetworkRetries: 2, timeout: 10000 }) : null;
  const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;
  return { stripe, redis, env };
}
export function billingHandlers() { return createBillingHandlers(billingDependencies()); }
