// Unit tests for src/lib/money.ts. Run with `npm run test:unit` (Node's own test
// runner; Node >= 22.6 strips the TypeScript types). Kept outside `tests/e2e`
// so Playwright does not collect it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney as rawFormatMoney, formatAmount as rawFormatAmount, fractionDigits, safeLocale } from '../../src/lib/money.ts';

// Intl separates symbol and number with a no-break space (U+00A0 / U+202F),
// which is correct on screen; compare with ordinary spaces.
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
const formatMoney = (...a) => plain(rawFormatMoney(...a));
const formatAmount = (...a) => plain(rawFormatAmount(...a));

const BOB = { code: 'BOB', symbol: 'Bs.', rounding_precision: '0.0100', rounding_method: 'NEAREST', locale: 'es-BO' };

test('fraction digits follow the rounding precision, however it is serialised', () => {
  assert.equal(fractionDigits('0.0100'), 2);
  assert.equal(fractionDigits('0.01'), 2);
  assert.equal(fractionDigits(0.01), 2);
  assert.equal(fractionDigits('1'), 0);
  assert.equal(fractionDigits('1.0000'), 0);
  assert.equal(fractionDigits(1), 0);
});

test('a Bolivian tenant sees its configured symbol, grouped, with two decimals', () => {
  assert.equal(formatMoney(1299.5, BOB), 'Bs. 1.299,50');
  assert.equal(formatMoney('12999.5', BOB), 'Bs. 12.999,50');
});

test('with no configured symbol Intl picks one for the locale', () => {
  assert.equal(formatMoney(1299.5, { ...BOB, symbol: null }), 'Bs 1.299,50');
});

test('another tenant is formatted by its own currency and locale, not Bolivia', () => {
  const TRY = { code: 'TRY', symbol: null, rounding_precision: '0.01', rounding_method: 'NEAREST', locale: 'tr-TR' };
  const out = formatMoney(1299.5, TRY);
  assert.match(out, /₺/);
  assert.match(out, /1\.299,50/);
  assert.doesNotMatch(out, /Bs/);
});

test('a zero-decimal currency renders no decimals', () => {
  const out = formatMoney(1299.4, { ...BOB, code: 'CLP', symbol: null, rounding_precision: '1', locale: 'es-CL' });
  assert.doesNotMatch(out, /,\d/);
});

test('an invalid locale degrades instead of throwing', () => {
  assert.equal(safeLocale('es_BO'), undefined);
  assert.equal(safeLocale('es-bo'), 'es-BO');
  assert.equal(safeLocale(undefined), undefined);
  assert.doesNotThrow(() => formatAmount(1299.5, { ...BOB, locale: 'es_BO' }));
  assert.doesNotThrow(() => formatMoney(1299.5, { ...BOB, locale: 'es_BO' }));
});

test('the bare amount carries no currency', () => {
  assert.equal(formatAmount(1299.5, BOB), '1.299,50');
});
