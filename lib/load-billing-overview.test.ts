import { test, describe } from 'node:test';
import assert from 'node:assert';
import { loadBillingOverview } from './load-billing-overview.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loadBillingOverview', () => {
  test('no access token → ok:false, 401, not_authenticated', async () => {
    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: null }),
      fetchFn: async () => {
        throw new Error('fetch must not be called');
      },
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.status, 401);
      assert.strictEqual(result.code, 'not_authenticated');
    }
  });

  test('403 with JSON error_code → ok:false, 403, that code', async () => {
    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: 'tok' }),
      fetchFn: async () =>
        jsonResponse(403, { error: 'Forbidden.', error_code: 'forbidden' }),
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.code, 'forbidden');
    }
  });

  test('500 with non-JSON body → ok:false, 500, resolver fallback', async () => {
    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: 'tok' }),
      fetchFn: async () =>
        new Response('<html>nope</html>', { status: 500 }),
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.status, 500);
      assert.strictEqual(result.code, 'request_failed');
    }
  });

  test('fetch throws → ok:false, 0, request_failed', async () => {
    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: 'tok' }),
      fetchFn: async () => {
        throw new Error('network down');
      },
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.code, 'request_failed');
    }
  });

  test('200 well-formed body → ok:true, all four fields correct', async () => {
    const tenant = {
      key: 'lab:1',
      name: 'Oakwood',
      type: 'Lab' as const,
      labCount: 1,
      billingStatus: 'active',
      currentPeriodEnd: '2026-08-19T00:00:00.000Z',
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      expectedMonthlyUsd: 200,
    };
    const anomaly = { kind: 'orphan_billing_row' as const, detail: 'x' };
    const event = {
      eventId: 'evt_1',
      eventType: 'invoice.paid',
      receivedAt: '2026-07-19T00:00:00.000Z',
      appliedAt: '2026-07-19T00:00:01.000Z',
      tenantLabel: 'Oakwood',
      amountUsd: 200,
      stripeCustomerId: 'cus_x',
    };
    const generatedAt = '2026-08-02T12:00:00.000Z';

    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: 'tok' }),
      fetchFn: async () =>
        jsonResponse(200, {
          tenants: [tenant],
          anomalies: [anomaly],
          events: [event],
          generatedAt,
        }),
    });
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.data.tenants, [tenant]);
      assert.deepStrictEqual(result.data.anomalies, [anomaly]);
      assert.deepStrictEqual(result.data.events, [event]);
      assert.strictEqual(result.data.generatedAt, generatedAt);
    }
  });

  test('200 body missing arrays → ok:true, arrays are [], generatedAt null', async () => {
    const result = await loadBillingOverview({
      getSession: async () => ({ accessToken: 'tok' }),
      fetchFn: async () => jsonResponse(200, { generatedAt: 123 }),
    });
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.data.tenants, []);
      assert.deepStrictEqual(result.data.anomalies, []);
      assert.deepStrictEqual(result.data.events, []);
      assert.strictEqual(result.data.generatedAt, null);
    }
  });
});
