import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rsi, sma } from '../src/core/indicators.js';

const reference = JSON.parse(readFileSync(
  new URL('./fixtures/rsi_reference.json', import.meta.url), 'utf8',
));
const week = JSON.parse(readFileSync(
  new URL('./fixtures/xauusd_m1_week.json', import.meta.url), 'utf8',
));

// Fixed seed gives reproducible random cursors with a following close available.
function randomCursors(length) {
  let state = 0x5a17;
  return Array.from({ length: 200 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return 50 + (state % (length - 51));
  });
}

const cursors = randomCursors(reference.closes.length);

function truncationMismatches(indicator, closes, indices) {
  const full = indicator(closes);
  let mismatches = 0;
  for (const n of indices) {
    const prefix = indicator(closes.slice(0, n + 1));
    if (!Object.is(prefix[n], full[n])) mismatches += 1;
  }
  return mismatches;
}

test('rsi matches TA-Lib within 1e-10 on 3000 values', () => {
  assert.equal(reference.closes.length, 3000);
  assert.equal(reference.rsi14.length, 3000);
  const actual = rsi(reference.closes);
  assert.equal(actual.length, 3000);
  for (let i = 0; i < actual.length; i += 1) {
    if (reference.rsi14[i] === null) {
      assert.equal(actual[i], null, `warmup at ${i}`);
    } else {
      assert.ok(Number.isFinite(actual[i]), `finite RSI at ${i}`);
      assert.ok(Math.abs(actual[i] - reference.rsi14[i]) <= 1e-10,
        `TA-Lib mismatch at ${i}: ${actual[i]} vs ${reference.rsi14[i]}`);
    }
  }
});

test('rsi first 14 values are null and index 14 is seeded', () => {
  const actual = rsi(reference.closes);
  assert.deepEqual(actual.slice(0, 14), Array(14).fill(null));
  assert.equal(typeof actual[14], 'number');
});

test('rsi of flat series is not NaN and zero-loss branches are defined', () => {
  assert.deepEqual(rsi(Array(30).fill(7)).slice(14), Array(16).fill(50));
  assert.deepEqual(rsi(Array.from({ length: 30 }, (_, i) => i)).slice(14),
    Array(16).fill(100));
  assert.deepEqual(rsi(Array.from({ length: 30 }, (_, i) => 30 - i)).slice(14),
    Array(16).fill(0));
});

test('rsi uses the requested period and accepts ArrayLike closes', () => {
  assert.deepEqual(rsi({ 0: 1, 1: 3, 2: 2, 3: 4, length: 4 }, 2),
    [null, null, 100 * (2 / 3), 100 * (6 / 7)]);
});

test('indicators preserve empty and shorter-than-warmup lengths', () => {
  assert.deepEqual(rsi([]), []);
  assert.deepEqual(rsi([1, 2, 3]), [null, null, null]);
  assert.deepEqual(rsi(Array(14).fill(1)), Array(14).fill(null));
  assert.deepEqual(sma([], 50), []);
  assert.deepEqual(sma([1, 2, 3], 50), [null, null, null]);
});

test('sma with period 50 matches a naive mean on the fixture', () => {
  const actual = sma(week.c, 50);
  assert.equal(actual.length, week.c.length);
  assert.deepEqual(actual.slice(0, 49), Array(49).fill(null));
  for (let i = 49; i < week.c.length; i += 1) {
    const expected = week.c.slice(i - 49, i + 1).reduce((sum, c) => sum + c, 0) / 50;
    assert.ok(Math.abs(actual[i] - expected) <= 1e-10, `SMA mismatch at ${i}`);
  }
});

test('sma includes the current close and accepts ArrayLike closes', () => {
  assert.deepEqual(sma(new Float64Array([2, 4, 9, 11]), 2), [null, 3, 6.5, 10]);
  assert.deepEqual(sma([2, 4, 9], 1), [2, 4, 9]);
});

for (const [name, indicator] of [['rsi', rsi], ['sma', (closes) => sma(closes, 50)]]) {
  test(`${name} truncation is bit-exact at 200 seeded random cursors`, () => {
    assert.equal(truncationMismatches(indicator, reference.closes, cursors), 0);
  });

  test(`${name} truncated arrays equal every full-array prefix`, () => {
    const full = indicator(reference.closes);
    for (const n of [0, 1, 13, 14, 15, 48, 49, 50, ...cursors, 2999]) {
      assert.deepEqual(indicator(reference.closes.slice(0, n + 1)),
        full.slice(0, n + 1), `prefix ending at ${n}`);
    }
  });
}

test('sabotage: the same truncation helper detects at least 199/200 future reads', (t) => {
  // Local contaminated RSI copy: leak the next close into each computed value.
  const contaminatedRsi = (closes) => rsi(closes).map((value, n) => (
    value === null || n + 1 === closes.length ? value : value + closes[n + 1]
  ));
  const mismatches = truncationMismatches(contaminatedRsi, reference.closes, cursors);
  t.diagnostic(`Sabotage truncation mismatches: ${mismatches}/200`);
  assert.ok(mismatches >= 199, `only ${mismatches}/200 mismatches`);
});
