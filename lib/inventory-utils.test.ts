import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getEarliestExpiry } from './inventory-utils.ts';

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
