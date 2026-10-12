import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { createBillingHandlers, billingRedisConfig } from './_billing.js';

export function billingDependencies(env = process.env) {
  // The SDK pins its supported API version; credentials never reach the browser.
  const stripe = env.STRIPE_API_KEY ? new Stripe(env.STRIPE_API_KEY, { maxNetworkRetries: 2, timeout: 10000 }) : null;
  const redisConfig = billingRedisConfig(env);
  const redis = redisConfig ? new Redis(redisConfig) : null;
  return { stripe, redis, env };
}
export function billingHandlers() { return createBillingHandlers(billingDependencies()); }
