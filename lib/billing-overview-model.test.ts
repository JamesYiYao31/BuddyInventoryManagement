import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  STALE_UNAPPLIED_EVENT_MS,
  buildTenantRows,
  findAnomalies,
  buildEventRows,
  type OrgInput,
  type LabInput,
  type BillingAccountInput,
  type StripeEventInput,
} from './billing-overview-model.ts';

const ORG: OrgInput = { id: 'org-1', name: 'Test Org' };
const LAB_A: LabInput = {
  id: 'lab-a',
  name: 'Lab A',
  org_id: 'org-1',
  is_archived: false,
};
const LAB_B: LabInput = {
  id: 'lab-b',
  name: 'Lab B',
  org_id: 'org-1',
  is_archived: false,
};
const LAB_ARCHIVED: LabInput = {
  id: 'lab-arch',
  name: 'Archived Lab',
  org_id: 'org-1',
  is_archived: true,
};
const STANDALONE: LabInput = {
  id: 'lab-solo',
  name: 'Oakwood',
  org_id: null,
  is_archived: false,
};

const ORG_ACCOUNT: BillingAccountInput = {
  id: 'ba-org',
  org_id: 'org-1',
  lab_id: null,
  billing_status: 'active',
  current_period_end: '2026-08-19T00:00:00.000Z',
  stripe_customer_id: 'cus_org',
  stripe_subscription_id: 'sub_org',
};

const SOLO_ACCOUNT: BillingAccountInput = {
  id: 'ba-solo',
  org_id: null,
  lab_id: 'lab-solo',
  billing_status: 'active',
  current_period_end: '2026-08-19T00:00:00.000Z',
  stripe_customer_id: 'cus_solo',
  stripe_subscription_id: 'sub_solo',
};

describe('buildTenantRows', () => {
  test('org with 2 active labs: labCount 2 and expectedMonthlyUsd 400 when active', () => {
    const rows = buildTenantRows([ORG], [LAB_A, LAB_B], [ORG_ACCOUNT]);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0], {
      key: 'org:org-1',
      name: 'Test Org',
      type: 'Org',
      labCount: 2,
      billingStatus: 'active',
      currentPeriodEnd: '2026-08-19T00:00:00.000Z',
      stripeCustomerId: 'cus_org',
      stripeSubscriptionId: 'sub_org',
      expectedMonthlyUsd: 400,
    });
  });

  test('org with 1 archived lab: archived excluded from labCount', () => {
    const rows = buildTenantRows(
      [ORG],
      [LAB_A, LAB_ARCHIVED],
      [ORG_ACCOUNT],
    );
    assert.strictEqual(rows[0].labCount, 1);
    assert.strictEqual(rows[0].expectedMonthlyUsd, 200);
  });

  test('standalone lab with no account: billingStatus null, not trialing', () => {
    const rows = buildTenantRows([ORG], [STANDALONE], []);
    const labRow = rows.find((r) => r.type === 'Lab');
    assert.ok(labRow);
    assert.strictEqual(labRow.billingStatus, null);
    assert.strictEqual(labRow.expectedMonthlyUsd, null);
    assert.notStrictEqual(labRow.billingStatus, 'trialing');
  });

  test('expectedMonthlyUsd is null when status is not active', () => {
    const pastDue: BillingAccountInput = {
      ...ORG_ACCOUNT,
      billing_status: 'past_due',
    };
    const rows = buildTenantRows([ORG], [LAB_A, LAB_B], [pastDue]);
    assert.strictEqual(rows[0].billingStatus, 'past_due');
    assert.strictEqual(rows[0].expectedMonthlyUsd, null);
  });
});

describe('findAnomalies', () => {
  const nowMs = Date.parse('2026-07-31T12:00:00.000Z');

  test('clean dataset returns []', () => {
    const anomalies = findAnomalies(
      [ORG],
      [LAB_A, STANDALONE],
      [ORG_ACCOUNT, SOLO_ACCOUNT],
      [
        {
          event_id: 'evt_ok',
          event_type: 'invoice.paid',
          received_at: '2026-07-31T11:50:00.000Z',
          applied_at: '2026-07-31T11:50:01.000Z',
          payload: {},
        },
      ],
      nowMs,
    );
    assert.deepStrictEqual(anomalies, []);
  });

  test('org_lab_billing_row when lab_id points at an org-owned lab', () => {
    const bad: BillingAccountInput = {
      id: 'ba-bad',
      org_id: null,
      lab_id: 'lab-a',
      billing_status: 'active',
      current_period_end: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    };
    const anomalies = findAnomalies([ORG], [LAB_A], [bad], [], nowMs);
    assert.strictEqual(anomalies.length, 1);
    assert.strictEqual(anomalies[0].kind, 'org_lab_billing_row');
  });

  test('orphan_billing_row when org_id matches no loaded org', () => {
    const orphan: BillingAccountInput = {
      id: 'ba-orphan',
      org_id: 'missing-org',
      lab_id: null,
      billing_status: 'trialing',
      current_period_end: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    };
    const anomalies = findAnomalies([ORG], [LAB_A], [orphan], [], nowMs);
    assert.ok(anomalies.some((a) => a.kind === 'orphan_billing_row'));
  });

  test('period_end_passed when active and current_period_end is past', () => {
    const stale: BillingAccountInput = {
      ...SOLO_ACCOUNT,
      current_period_end: '2026-07-01T00:00:00.000Z',
    };
    const anomalies = findAnomalies(
      [],
      [STANDALONE],
      [stale],
      [],
      nowMs,
    );
    assert.ok(anomalies.some((a) => a.kind === 'period_end_passed'));
  });

  test('stale_unapplied_event: 14 minutes old -> not flagged; 16 -> flagged', () => {
    const fourteenMin: StripeEventInput = {
      event_id: 'evt_14',
      event_type: 'invoice.paid',
      received_at: new Date(nowMs - 14 * 60 * 1000).toISOString(),
      applied_at: null,
      payload: {},
    };
    const sixteenMin: StripeEventInput = {
      event_id: 'evt_16',
      event_type: 'invoice.paid',
      received_at: new Date(nowMs - 16 * 60 * 1000).toISOString(),
      applied_at: null,
      payload: {},
    };

    assert.ok(16 * 60 * 1000 > STALE_UNAPPLIED_EVENT_MS);
    assert.ok(14 * 60 * 1000 < STALE_UNAPPLIED_EVENT_MS);

    const none = findAnomalies([], [], [], [fourteenMin], nowMs);
    assert.ok(!none.some((a) => a.kind === 'stale_unapplied_event'));

    const flagged = findAnomalies([], [], [], [sixteenMin], nowMs);
    assert.ok(flagged.some((a) => a.kind === 'stale_unapplied_event'));
  });
});

describe('buildEventRows', () => {
  test('resolvable event via subscription id yields tenant name', () => {
    const event: StripeEventInput = {
      event_id: 'evt_1',
      event_type: 'customer.subscription.updated',
      received_at: '2026-07-31T12:00:00.000Z',
      applied_at: '2026-07-31T12:00:01.000Z',
      payload: {
        data: { object: { id: 'sub_solo', customer: 'cus_solo' } },
      },
    };
    const rows = buildEventRows(
      [event],
      [SOLO_ACCOUNT],
      [ORG],
      [STANDALONE],
    );
    assert.strictEqual(rows[0].tenantLabel, 'Oakwood');
  });

  test('unresolvable event returns Unresolved and exposes stripeCustomerId', () => {
    const event: StripeEventInput = {
      event_id: 'evt_2',
      event_type: 'invoice.paid',
      received_at: '2026-07-31T12:00:00.000Z',
      applied_at: null,
      payload: {
        data: { object: { id: 'in_x', customer: 'cus_unknown' } },
      },
    };
    const rows = buildEventRows([event], [SOLO_ACCOUNT], [ORG], [STANDALONE]);
    assert.strictEqual(rows[0].tenantLabel, 'Unresolved');
    assert.strictEqual(rows[0].stripeCustomerId, 'cus_unknown');
  });

  test('invoice with amount_paid returns dollars', () => {
    const event: StripeEventInput = {
      event_id: 'evt_3',
      event_type: 'invoice.paid',
      received_at: '2026-07-31T12:00:00.000Z',
      applied_at: '2026-07-31T12:00:01.000Z',
      payload: {
        data: {
          object: {
            amount_paid: 40000,
            customer: 'cus_solo',
            subscription: 'sub_solo',
          },
        },
      },
    };
    const rows = buildEventRows([event], [SOLO_ACCOUNT], [], [STANDALONE]);
    assert.strictEqual(rows[0].amountUsd, 400);
  });

  test('invoice with amount field missing returns null (not 0)', () => {
    const event: StripeEventInput = {
      event_id: 'evt_4',
      event_type: 'invoice.paid',
      received_at: '2026-07-31T12:00:00.000Z',
      applied_at: null,
      payload: {
        data: { object: { customer: 'cus_solo' } },
      },
    };
    const rows = buildEventRows([event], [SOLO_ACCOUNT], [], [STANDALONE]);
    assert.strictEqual(rows[0].amountUsd, null);
    assert.notStrictEqual(rows[0].amountUsd, 0);
  });

  test('malformed payload does not throw; stripeCustomerId is null', () => {
    const event: StripeEventInput = {
      event_id: 'evt_5',
      event_type: 'invoice.paid',
      received_at: '2026-07-31T11:00:00.000Z',
      applied_at: null,
      payload: 'not-an-object',
    };
    assert.doesNotThrow(() => {
      const rows = buildEventRows([event], [SOLO_ACCOUNT], [], [STANDALONE]);
      assert.strictEqual(rows[0].tenantLabel, 'Unresolved');
      assert.strictEqual(rows[0].amountUsd, null);
      assert.strictEqual(rows[0].stripeCustomerId, null);
    });
  });

  test('rows sorted newest first by receivedAt', () => {
    const older: StripeEventInput = {
      event_id: 'evt_old',
      event_type: 'invoice.paid',
      received_at: '2026-07-30T00:00:00.000Z',
      applied_at: null,
      payload: {},
    };
    const newer: StripeEventInput = {
      event_id: 'evt_new',
      event_type: 'invoice.paid',
      received_at: '2026-07-31T00:00:00.000Z',
      applied_at: null,
      payload: {},
    };
    const rows = buildEventRows([older, newer], [], [], []);
    assert.strictEqual(rows[0].eventId, 'evt_new');
    assert.strictEqual(rows[1].eventId, 'evt_old');
  });
});
