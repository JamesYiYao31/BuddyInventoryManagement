import { test, describe } from 'node:test';
import assert from 'node:assert';
import { decideSubscriptionBillingAccount } from './stripe-subscription-account-resolution.ts';

describe('decideSubscriptionBillingAccount', () => {
  test('subscription_id lookup hit wins over metadata', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: { id: 'ba-from-sub' }, error: null },
      metadataAccountId: 'ba-from-meta',
    });
    assert.deepStrictEqual(result, {
      kind: 'account',
      accountId: 'ba-from-sub',
      source: 'subscription_id',
    });
  });

  test('empty lookup falls back to metadata', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: null, error: null },
      metadataAccountId: 'ba-from-meta',
    });
    assert.deepStrictEqual(result, {
      kind: 'account',
      accountId: 'ba-from-meta',
      source: 'metadata',
    });
  });

  test('empty lookup and no metadata -> unmatched', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: null, error: null },
      metadataAccountId: null,
    });
    assert.deepStrictEqual(result, { kind: 'unmatched' });
  });

  test('lookup error is lookup_failed even when metadata is present', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: null, error: { message: 'connection refused' } },
      metadataAccountId: 'ba-from-meta',
    });
    assert.deepStrictEqual(result, {
      kind: 'lookup_failed',
      reason: 'connection refused',
    });
  });

  test('empty metadata string is treated as absent', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: null, error: null },
      metadataAccountId: '',
    });
    assert.deepStrictEqual(result, { kind: 'unmatched' });
  });

  test('subscription_id hit with null metadata still wins', () => {
    const result = decideSubscriptionBillingAccount({
      lookup: { data: { id: 'ba-only-sub' }, error: null },
      metadataAccountId: null,
    });
    assert.deepStrictEqual(result, {
      kind: 'account',
      accountId: 'ba-only-sub',
      source: 'subscription_id',
    });
  });
});
