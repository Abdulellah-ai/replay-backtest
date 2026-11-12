import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStore } from '../src/core/data.js';
import { bucketStart, aggregateAll, buildPartial } from '../src/core/aggregate.js';

const minute = 60000;
const hour = 60 * minute;
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D'];
const ts = (value) => Date.parse(value);
const fixture = (name) => JSON.parse(readFileSync(
  new URL(`./fixtures/xauusd_${name}.json`, import.meta.url), 'utf8',
));
const week = parseStore(fixture('m1_week'));
const nativeM5 = fixture('m5_native');
const nativeH4 = fixture('h4_native');
const nativeD1 = fixture('d1_native');

function storeFromRows(rows) {
  return parseStore({
    symbol: 'XAUUSD',
    t: rows.map((row) => ts(row[0])),
    ...Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(
      (key, i) => [key, rows.map((row) => row[i + 1])],
    )),
  });
}

// Report every mismatch, with original values and signed differences.
function compareNative(bars, native, fields = ['o', 'h', 'l', 'c']) {
  const names = { o: 'open', h: 'high', l: 'low', c: 'close' };
  const expected = new Map(native.map((row) => [row.timestamp, row]));
  const diffs = [];
  for (const bar of bars) {
    const row = expected.get(bar.t);
    assert.ok(row, `No native row at ${new Date(bar.t).toISOString()}`);
    for (const field of fields) {
      const actual = bar[field];
      const want = row[names[field]];
      const delta = actual - want;
      if (!Number.isFinite(delta) || Math.abs(delta) > 1e-9) {
        diffs.push(`${new Date(bar.t).toISOString()} ${field}: actual=${actual}, native=${want}, delta=${delta}`);
      }
    }
  }
  assert.equal(diffs.length, 0, diffs.join('\n'));
}

test('5m fixture OHLC equals provider-native with zero differences', () => {
  const bars = aggregateAll(week, '5m', 'UTC');
  assert.deepEqual(bars.map((bar) => bar.t), nativeM5.map((row) => row.timestamp));
  compareNative(bars, nativeM5);
});

test('15m fixture OHLC equals the independent provider-native M5 reference', () => {
  // No native M15 fixture is supplied: combine provider M5 rows, never M1.
  const reference = [];
  for (const row of nativeM5) {
    const start = Math.floor(row.timestamp / (15 * minute)) * 15 * minute;
    const previous = reference.at(-1);
    if (!previous || previous.timestamp !== start) {
      reference.push({ ...row, timestamp: start });
    } else {
      previous.high = Math.max(previous.high, row.high);
      previous.low = Math.min(previous.low, row.low);
      previous.close = row.close;
    }
  }
  const bars = aggregateAll(week, '15m', 'UTC');
  assert.deepEqual(bars.map((bar) => bar.t), reference.map((row) => row.timestamp));
  compareNative(bars, reference);
});

test('4h fixture OHL equals provider-native at UTC 00/04/08/12/16/20', () => {
  const bars = aggregateAll(week, '4h', 'UTC');
  assert.deepEqual(bars.map((bar) => bar.t), nativeH4.map((row) => row.timestamp));
  assert.deepEqual([...new Set(bars.map((bar) => new Date(bar.t).getUTCHours()))],
    [0, 4, 8, 12, 16, 20]);
  for (const bar of bars) assert.equal(bar.t % (4 * hour), 0);
  compareNative(bars, nativeH4, ['o', 'h', 'l']);
});

test('1D UTC fixture OHL equals native on every common day, at least four', () => {
  const bars = aggregateAll(week, '1D', 'UTC');
  const nativeDays = new Set(nativeD1.map((row) => row.timestamp));
  const common = bars.filter((bar) => nativeDays.has(bar.t));
  assert.ok(common.length >= 4, `Only ${common.length} common days`);
  for (const bar of bars) assert.equal(bar.t % (24 * hour), 0);
  compareNative(common, nativeD1, ['o', 'h', 'l']);
});

for (const [tf, input, expected] of [
  ['1m', '2026-06-01T13:59:59.999Z', '2026-06-01T13:59:00Z'],
  ['5m', '2026-06-01T13:59:59.999Z', '2026-06-01T13:55:00Z'],
  ['15m', '2026-06-01T13:59:59.999Z', '2026-06-01T13:45:00Z'],
  ['1h', '2026-06-01T13:59:59.999Z', '2026-06-01T13:00:00Z'],
  ['4h', '2026-06-01T13:59:59.999Z', '2026-06-01T12:00:00Z'],
  ['1D', '2026-06-01T23:59:59.999Z', '2026-06-01T00:00:00Z'],
]) {
  test(`${tf} uses UTC multiples and includes the exact bucket boundary`, () => {
    assert.equal(bucketStart(ts(input), tf, 'UTC'), ts(expected));
    assert.equal(bucketStart(ts(expected), tf, 'UTC'), ts(expected));
  });
}

for (const [name, start, end, hours] of [
  ['spring', '2026-03-07T22:00:00Z', '2026-03-08T21:00:00Z', 23],
  ['fall', '2026-10-31T21:00:00Z', '2026-11-01T22:00:00Z', 25],
]) {
  test(`NY17 ${name} DST bucket lasts ${hours} hours`, () => {
    const first = ts(start);
    const next = ts(end);
    assert.equal(bucketStart(first, '1D', 'NY17'), first);
    assert.equal(bucketStart(next - 1, '1D', 'NY17'), first);
    assert.equal(bucketStart(next, '1D', 'NY17'), next);
    assert.equal(bucketStart(next, '1D', 'NY17') - bucketStart(first, '1D', 'NY17'), hours * hour);
  });
}

for (const [input, expected] of [
  ['2026-01-01T00:00:00Z', '2025-12-31T22:00:00Z'],
  ['2026-06-01T20:59:59.999Z', '2026-05-31T21:00:00Z'],
  ['2026-06-01T21:00:00Z', '2026-06-01T21:00:00Z'],
]) {
  test(`NY17 uses the most recent local 17:00 at ${input}`, () => {
    assert.equal(bucketStart(ts(input), '1D', 'NY17'), ts(expected));
    assert.equal(bucketStart(ts(input), '1D'), ts(expected));
  });
}

test('1m preserves each existing atomic candle and its source index', () => {
  const store = storeFromRows([
    ['2026-06-01T00:01:00Z', 10, 14, 8, 12, 1.5],
    ['2026-06-01T00:03:00Z', 12, 15, 9, 11, 2.5],
  ]);
  assert.deepEqual(aggregateAll(store, '1m', 'UTC'), [
    { t: ts('2026-06-01T00:01:00Z'), o: 10, h: 14, l: 8, c: 12, v: 1.5, firstIdx: 0, lastIdx: 0 },
    { t: ts('2026-06-01T00:03:00Z'), o: 12, h: 15, l: 9, c: 11, v: 2.5, firstIdx: 1, lastIdx: 1 },
  ]);
});

test('no timeframe creates bars for empty weekend buckets', () => {
  const store = storeFromRows([
    ['2026-06-05T20:59:00Z', 10, 14, 8, 12, 1.5],
    ['2026-06-07T22:00:00Z', 12, 15, 9, 11, 2.5],
  ]);
  for (const tf of timeframes) {
    for (const anchor of ['UTC', 'NY17']) {
      const bars = aggregateAll(store, tf, anchor);
      assert.equal(bars.length, 2, `${tf} ${anchor}`);
      assert.deepEqual(bars.map(({ firstIdx, lastIdx }) => [firstIdx, lastIdx]), [[0, 0], [1, 1]]);
    }
  }
});

test('missing M1 rows aggregate only existing rows and retain the final candidate', () => {
  const store = storeFromRows([
    ['2026-06-01T00:01:00Z', 10, 14, 8, 12, 1.5],
    ['2026-06-01T00:03:00Z', 12, 15, 9, 11, 2.5],
    ['2026-06-01T00:06:00Z', 11, 16, 7, 13, 4],
  ]);
  assert.deepEqual(aggregateAll(store, '5m', 'UTC'), [
    { t: ts('2026-06-01T00:00:00Z'), o: 10, h: 15, l: 8, c: 11, v: 4, firstIdx: 0, lastIdx: 1 },
    { t: ts('2026-06-01T00:05:00Z'), o: 11, h: 16, l: 7, c: 13, v: 4, firstIdx: 2, lastIdx: 2 },
  ]);
});

test('1h and NY17 daily bars combine existing rows with summed volume', () => {
  const store = storeFromRows([
    ['2026-06-01T20:59:00Z', 10, 14, 8, 12, 1.5],
    ['2026-06-01T21:01:00Z', 12, 15, 9, 11, 2.5],
    ['2026-06-01T21:59:00Z', 11, 16, 7, 13, 4],
  ]);
  const expected = [
    { t: ts('2026-06-01T20:00:00Z'), o: 10, h: 14, l: 8, c: 12, v: 1.5, firstIdx: 0, lastIdx: 0 },
    { t: ts('2026-06-01T21:00:00Z'), o: 12, h: 16, l: 7, c: 13, v: 6.5, firstIdx: 1, lastIdx: 2 },
  ];
  assert.deepEqual(aggregateAll(store, '1h', 'UTC'), expected);
  assert.deepEqual(aggregateAll(store, '1D', 'NY17'), [
    { ...expected[0], t: ts('2026-05-31T21:00:00Z') }, expected[1],
  ]);
});

test('buildPartial aggregates firstIdx..cursor inclusively and ignores poisoned future rows', () => {
  const store = storeFromRows([
    ['2026-06-01T00:00:00Z', 50, 90, 1, 60, 100],
    ['2026-06-01T00:02:00Z', 10, 14, 8, 12, 1.5],
    ['2026-06-01T00:03:00Z', 12, 15, 9, 11, 2.5],
    ['2026-06-01T00:04:00Z', 11, 80, 2, 70, 200],
  ]);
  const expected = { t: ts('2026-06-01T00:02:00Z'), o: 10, h: 15, l: 8, c: 11, v: 4, firstIdx: 1, lastIdx: 2 };
  assert.deepEqual(buildPartial(store, 1, 2), expected);
  for (const key of ['o', 'h', 'l', 'c', 'v']) store[key].fill(999999, 3);
  assert.deepEqual(buildPartial(store, 1, 2), expected);
  assert.deepEqual(buildPartial(store, 1, 1), {
    t: ts('2026-06-01T00:02:00Z'), o: 10, h: 14, l: 8, c: 12, v: 1.5, firstIdx: 1, lastIdx: 1,
  });
});

test('empty stores produce no bars in every timeframe', () => {
  const store = storeFromRows([]);
  for (const tf of timeframes) assert.deepEqual(aggregateAll(store, tf, 'NY17'), []);
});
