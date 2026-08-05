import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  billingStatusBadgeClass,
  billingStatusLabel,
} from './billing-status-badge.ts';

describe('billingStatusLabel', () => {
  test('null → No billing account', () => {
    assert.strictEqual(billingStatusLabel(null), 'No billing account');
  });

  test('past_due → Payment issue', () => {
    assert.strictEqual(billingStatusLabel('past_due'), 'Payment issue');
  });

  test('active → active', () => {
    assert.strictEqual(billingStatusLabel('active'), 'active');
  });

  test('some_new_status → some new status', () => {
    assert.strictEqual(billingStatusLabel('some_new_status'), 'some new status');
  });
});

describe('billingStatusBadgeClass', () => {
  test('null returns the zinc class', () => {
    assert.strictEqual(
      billingStatusBadgeClass(null),
      'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
    );
  });

  test('unrecognised status returns the same default (does not throw)', () => {
    assert.strictEqual(
      billingStatusBadgeClass('totally_unknown'),
      'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
    );
  });
});
