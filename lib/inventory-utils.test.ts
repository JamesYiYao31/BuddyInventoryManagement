import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getEarliestExpiry } from './expiry-utils.ts';
import { getLotTotalCount, type LotEntry } from './inventory-utils.ts';

describe('getEarliestExpiry', () => {
  test('returns date1 if it is earlier than date2', () => {
    const d1 = '2023-01-01';
    const d2 = '2023-01-02';
    assert.strictEqual(getEarliestExpiry(d1, d2), d1);
  });

  test('returns date2 if it is earlier than date1', () => {
    const d1 = '2023-01-02';
    const d2 = '2023-01-01';
    assert.strictEqual(getEarliestExpiry(d1, d2), d2);
  });

  test('returns either if they are the same', () => {
    const d1 = '2023-01-01';
    const d2 = '2023-01-01';
    assert.strictEqual(getEarliestExpiry(d1, d2), d1);
  });

  test('returns date2 if date1 is empty', () => {
    const d1 = '';
    const d2 = '2023-01-01';
    assert.strictEqual(getEarliestExpiry(d1, d2), d2);
  });

  test('returns date1 if date2 is empty', () => {
    const d1 = '2023-01-01';
    const d2 = '';
    assert.strictEqual(getEarliestExpiry(d1, d2), d1);
  });

  test('returns empty string if both are empty', () => {
    assert.strictEqual(getEarliestExpiry('', ''), '');
  });
});

describe('getLotTotalCount', () => {
  test('returns units when quantityType is units_only', () => {
    const lot = { quantityType: 'units_only', units: 5, count: 10 } as LotEntry;
    assert.strictEqual(getLotTotalCount(lot), 5);
  });

  test('returns count when quantityType is count_only', () => {
    const lot = { quantityType: 'count_only', units: 5, count: 10 } as LotEntry;
    assert.strictEqual(getLotTotalCount(lot), 10);
  });

  test('returns units * count when quantityType is units_and_count', () => {
    const lot = { quantityType: 'units_and_count', units: 5, count: 10 } as LotEntry;
    assert.strictEqual(getLotTotalCount(lot), 50);
  });

  test('handles zero units correctly', () => {
    const lot = { quantityType: 'units_and_count', units: 0, count: 10 } as LotEntry;
    assert.strictEqual(getLotTotalCount(lot), 0);
  });

  test('handles zero count correctly', () => {
    const lot = { quantityType: 'units_and_count', units: 5, count: 0 } as LotEntry;
    assert.strictEqual(getLotTotalCount(lot), 0);
  });
});
