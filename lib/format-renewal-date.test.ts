import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatRenewalDate } from './format-renewal-date.ts';

const SAMPLE_ISO = '2026-08-19T12:00:00.000Z';

describe('formatRenewalDate', () => {
  test('Intl regression guard: valid ISO + explicit timeZone returns NON-EMPTY string (old dateStyle+timeZoneName combo returned null)', () => {
    const result = formatRenewalDate(SAMPLE_ISO, 'America/Chicago');
    assert.strictEqual(typeof result, 'string');
    assert.ok(result && result.length > 0, 'must not return null/empty — that was the C5 Intl bug');
  });

  test('same timestamp with two different timeZones produces different results', () => {
    const chicago = formatRenewalDate(SAMPLE_ISO, 'America/Chicago');
    const tokyo = formatRenewalDate(SAMPLE_ISO, 'Asia/Tokyo');
    assert.ok(chicago && tokyo);
    assert.notStrictEqual(chicago, tokyo);
  });

  test('result contains a timezone label, not a bare date', () => {
    const result = formatRenewalDate(SAMPLE_ISO, 'UTC');
    assert.ok(result);
    assert.match(result, /\(.+\)/, 'expected parenthesized timezone label');
  });

  test('null input -> null, no throw', () => {
    assert.strictEqual(formatRenewalDate(null), null);
  });

  test('undefined input -> null, no throw', () => {
    assert.strictEqual(formatRenewalDate(undefined), null);
  });

  test('malformed date string -> null, no throw, and console.warn fired', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
    };
    try {
      assert.strictEqual(formatRenewalDate('not-a-date'), null);
      assert.ok(warnings.length >= 1, 'console.warn must fire on malformed input');
    } finally {
      console.warn = original;
    }
  });
});
