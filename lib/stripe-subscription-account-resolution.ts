/**
 * Pure decision for resolving a billing_accounts id from a Stripe
 * customer.subscription.* event (F-7 fix).
 *
 * Prefer stripe_subscription_id lookup; fall back to metadata; never treat a
 * failed lookup as "no match".
 */

export type SubscriptionLookupResult = {
  data: { id: string } | null
  error: { message: string } | null
}

export type SubscriptionAccountDecision =
  | {
      kind: "account"
      accountId: string
      source: "subscription_id" | "metadata"
    }
  | { kind: "unmatched" }
  | { kind: "lookup_failed"; reason: string }

export function decideSubscriptionBillingAccount(args: {
  lookup: SubscriptionLookupResult
  metadataAccountId: string | null
}): SubscriptionAccountDecision {
  if (args.lookup.error) {
    return { kind: "lookup_failed", reason: args.lookup.error.message }
  }
  if (args.lookup.data?.id) {
    return {
      kind: "account",
      accountId: args.lookup.data.id,
      source: "subscription_id",
    }
  }
  if (args.metadataAccountId && args.metadataAccountId.length > 0) {
    return {
      kind: "account",
      accountId: args.metadataAccountId,
      source: "metadata",
    }
  }
  return { kind: "unmatched" }
}
