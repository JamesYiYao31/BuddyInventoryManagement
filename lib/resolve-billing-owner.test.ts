import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  resolveBillingOwner,
  type BillingOwner,
} from './resolve-billing-owner.ts';

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type FakeClientConfig = {
  profile?: QueryResult;
  lab?: QueryResult;
};

function createFakeClient(config: FakeClientConfig) {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  if (table === 'profiles') {
                    return config.profile ?? { data: null, error: null };
                  }
                  if (table === 'labs') {
                    return config.lab ?? { data: null, error: null };
                  }
                  throw new Error(`unexpected table: ${table}`);
                },
              };
            },
          };
        },
      };
    },
  };
}

/** Fail-closed: a denial must never return a purchasable owner. */
function assertFailClosedDenial(result: BillingOwner) {
  assert.ok(
    result.kind !== 'lab' && result.kind !== 'org',
    'denial must never return a purchasable owner',
  );
  assert.strictEqual(result.kind, 'denied');
}

const USER_ID = '00000000-0000-4000-8000-000000000001';
const LAB_ID = '447da352-fadf-4c54-83b7-7019cc4bf714';
const ORG_ID = '5b15d0ec-06c8-4eed-92c9-762bcfbb4c60';

describe('resolveBillingOwner', () => {
  test('profile read returns an error -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: { data: null, error: { message: 'connection refused' } },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('profile row missing (data null) -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: { data: null, error: null },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('org_admin with org_id -> { kind: "org", orgId }', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'org_admin', org_id: ORG_ID, lab_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assert.deepStrictEqual(result, { kind: 'org', orgId: ORG_ID });
  });

  test('org_admin with org_id null -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'org_admin', org_id: null, lab_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('manager with lab_id null -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'manager', lab_id: null, org_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('manager, lab read returns an error -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'manager', lab_id: LAB_ID, org_id: null },
        error: null,
      },
      lab: { data: null, error: { message: 'timeout' } },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('manager, lab row missing -> denied profile_incomplete', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'manager', lab_id: LAB_ID, org_id: null },
        error: null,
      },
      lab: { data: null, error: null },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'profile_incomplete');
    }
  });

  test('Oakwood standalone lab: manager with lab.org_id IS NULL -> { kind: "lab", labId }', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'manager', lab_id: LAB_ID, org_id: null },
        error: null,
      },
      lab: { data: { org_id: null }, error: null },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assert.deepStrictEqual(result, { kind: 'lab', labId: LAB_ID });
  });

  test('org-managed lab defect closed: manager with lab.org_id set -> denied org_managed_billing', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'manager', lab_id: LAB_ID, org_id: null },
        error: null,
      },
      lab: { data: { org_id: ORG_ID }, error: null },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'org_managed_billing');
    }
  });

  test('technician -> denied role_not_permitted', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'technician', lab_id: LAB_ID, org_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'role_not_permitted');
    }
  });

  test('super_admin -> denied role_not_permitted', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: 'super_admin', lab_id: null, org_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'role_not_permitted');
    }
  });

  test('unrecognised / null role -> denied role_not_permitted', async () => {
    const client = createFakeClient({
      profile: {
        data: { role: null, lab_id: null, org_id: null },
        error: null,
      },
    });
    const result = await resolveBillingOwner(USER_ID, client as never);
    assertFailClosedDenial(result);
    if (result.kind === 'denied') {
      assert.strictEqual(result.code, 'role_not_permitted');
    }
  });
});
