import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveBillingOverviewErrorCode } from './billing-overview-error-code.ts';

describe('resolveBillingOverviewErrorCode', () => {
  test('body with error_code returns that code', () => {
    assert.strictEqual(
      resolveBillingOverviewErrorCode(
        JSON.stringify({ error: 'Forbidden.', error_code: 'forbidden' }),
      ),
      'forbidden',
    );
  });

  test('body with code (alternate key) returns that code', () => {
    assert.strictEqual(
      resolveBillingOverviewErrorCode(JSON.stringify({ code: 'actor_inactive' })),
      'actor_inactive',
    );
  });

  test('body without code returns request_failed', () => {
    assert.strictEqual(
      resolveBillingOverviewErrorCode(JSON.stringify({ error: 'Not authenticated' })),
      'request_failed',
    );
  });

  test('non-JSON body returns request_failed', () => {
    assert.strictEqual(
      resolveBillingOverviewErrorCode('<html>nope</html>'),
      'request_failed',
    );
  });

  test('empty body returns request_failed', () => {
    assert.strictEqual(resolveBillingOverviewErrorCode(''), 'request_failed');
    assert.strictEqual(resolveBillingOverviewErrorCode('   '), 'request_failed');
  });
});
