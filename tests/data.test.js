import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DataError, parseStore, findGaps } from '../src/core/data.js';

function columnar(t = [0, 60000]) {
  return {
    symbol: 'XAUUSD', source: 'dukascopy', priceType: 'bid', t,
    o: t.map(() => 10), h: t.map(() => 12), l: t.map(() => 9),
    c: t.map(() => 11), v: t.map(() => 1.5)
  };
}

test('parseStore rejects unsorted t', () => {
  assert.throws(() => parseStore(columnar([60000, 0])), DataError);
});

test('rejects duplicate t', () => {
  assert.throws(() => parseStore(columnar([0, 0])), DataError);
});

test('rejects h < close', () => {
  const json = columnar();
  json.h[0] = 10;
  assert.throws(() => parseStore(json), DataError);
});

test('accepts valid columnar', () => {
  const json = columnar();
  const store = parseStore(json);
  assert.equal(store.symbol, 'XAUUSD');
  assert.equal(store.length, 2);
  for (const key of ['t', 'o', 'h', 'l', 'c', 'v']) {
    assert.ok(store[key] instanceof Float64Array);
    assert.deepEqual([...store[key]], json[key]);
  }
});

test('rejects unequal column lengths', () => {
  const json = columnar();
  json.v.pop();
  assert.throws(() => parseStore(json), DataError);
});

test('rejects timestamps off the minute boundary', () => {
  assert.throws(() => parseStore(columnar([0, 60001])), DataError);
});

test('rejects l > open', () => {
  const json = columnar();
  json.l[0] = 10.5;
  assert.throws(() => parseStore(json), DataError);
});

for (const [name, start, minutes, kind] of [
  ['findGaps marks 60-min break at 20:59 UTC expected', '2026-11-02T20:59:00Z', 60, 'expected'],
  ['findGaps marks a 1-hour hole at 12:00 UTC unexplained', '2026-11-02T12:00:00Z', 60, 'unexplained'],
  ['findGaps marks a 3-minute hole unexplained', '2026-11-02T12:00:00Z', 3, 'unexplained'],
  ['findGaps marks a weekend at 21:59 UTC expected', '2026-11-06T21:59:00Z', 2880, 'expected'],
  ['findGaps marks 54 missing minutes at 20:59 UTC unexplained', '2026-11-02T20:59:00Z', 54, 'unexplained'],
  ['findGaps marks 55 missing minutes at 20:59 UTC expected', '2026-11-02T20:59:00Z', 55, 'expected']
]) {
  test(name, () => {
    const startTs = Date.parse(start);
    const endTs = startTs + (minutes + 1) * 60000;
    const store = parseStore(columnar([startTs - 60000, startTs, endTs]));
    assert.deepEqual(findGaps(store), [{ fromIdx: 1, startTs, endTs, minutes, kind }]);
    assert.equal(store.length, 3);
  });
}

test('findGaps returns no gaps for contiguous or empty stores', () => {
  assert.deepEqual(findGaps(parseStore(columnar())), []);
  assert.deepEqual(findGaps(parseStore(columnar([]))), []);
});

test('real data parses', (t) => {
  const path = new URL('../data/XAUUSD_m1.json', import.meta.url);
  if (!existsSync(path)) {
    t.skip('data/XAUUSD_m1.json is absent');
    return;
  }
  const store = parseStore(JSON.parse(readFileSync(path, 'utf8')));
  assert.ok(store.length > 100000);
});
