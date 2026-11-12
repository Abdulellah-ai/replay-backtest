import test from 'node:test';
import assert from 'node:assert/strict';
import { inZone, computeSessions } from '../src/core/sessions.js';
import { parseStore } from '../src/core/data.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const lndn = DEFAULT_SETTINGS.zones.find(zone => zone.id === 'LNDN');
const asia = DEFAULT_SETTINGS.zones.find(zone => zone.id === 'ASIA');
const ts = value => Date.parse(value);

function storeOf(rows) {
  return parseStore({
    symbol: 'XAUUSD',
    t: rows.map(([time]) => ts(time)),
    o: rows.map(() => 10),
    h: rows.map(([, high = 12]) => high),
    l: rows.map(([, , low = 8]) => low),
    c: rows.map(() => 10),
    v: rows.map(() => 1),
  });
}

test('LNDN includes 02:00 NY and excludes 05:00', () => {
  for (const [time, want] of [
    ['2026-03-06T06:59Z', false],
    ['2026-03-06T07:00Z', true],
    ['2026-03-06T09:59Z', true],
    ['2026-03-06T10:00Z', false],
  ]) assert.equal(inZone(ts(time), lndn), want, time);
});

test('ASIA includes 20:00 and 23:59 NY but excludes midnight', () => {
  for (const [time, want] of [
    ['2026-11-02T00:59Z', false],
    ['2026-11-02T01:00Z', true],
    ['2026-11-02T04:59Z', true],
    ['2026-11-02T05:00Z', false],
  ]) assert.equal(inZone(ts(time), asia), want, time);
});

test('ASIA on the 25-hour November 1 NY day is one box', () => {
  const store = storeOf([
    ['2026-11-02T01:00Z', 13, 7],
    ['2026-11-02T03:00Z', 18, 6],
    ['2026-11-02T04:59Z', 14, 8],
    ['2026-11-02T05:00Z', 999999, -999999],
  ]);
  assert.deepEqual(computeSessions(store, 3, 0, [asia]), [{
    zoneId: 'ASIA', startTs: ts('2026-11-02T01:00Z'),
    endTs: ts('2026-11-02T05:00Z'), firstIdx: 0, lastIdx: 2,
    high: 18, low: 6, complete: true,
  }]);
});

test('LNDN on March 8 starts at 07:00Z after the nonexistent 02:00 NY', () => {
  const store = storeOf([
    ['2026-03-08T06:59Z', 999999, -999999],
    ['2026-03-08T07:00Z', 15, 7],
    ['2026-03-08T08:59Z', 20, 5],
    ['2026-03-08T09:00Z', 999999, -999999],
  ]);
  assert.equal(inZone(store.t[0], lndn), false);
  assert.deepEqual(computeSessions(store, 3, 0, [lndn]), [{
    zoneId: 'LNDN', startTs: ts('2026-03-08T07:00Z'),
    endTs: ts('2026-03-08T09:00Z'), firstIdx: 1, lastIdx: 2,
    high: 20, low: 5, complete: true,
  }]);
});

test('LNDN on March 6 starts at 07:00Z in EST', () => {
  const store = storeOf([['2026-03-06T07:00Z']]);
  assert.deepEqual(computeSessions(store, 0, 0, [lndn]), [{
    zoneId: 'LNDN', startTs: ts('2026-03-06T07:00Z'),
    endTs: ts('2026-03-06T10:00Z'), firstIdx: 0, lastIdx: 0,
    high: 12, low: 8, complete: false,
  }]);
});

test('disabled zones produce no boxes', () => {
  const store = storeOf([['2026-03-06T07:00Z']]);
  assert.deepEqual(computeSessions(store, 0, 0, [{ ...lndn, enabled: false }]), []);
});

test('high/low and indices use only fromIdx through cursor', () => {
  const store = storeOf([
    ['2026-03-06T07:00Z', 999999, -999999],
    ['2026-03-06T07:01Z', 15, 7],
    ['2026-03-06T07:02Z', 18, 6],
    ['2026-03-06T07:03Z', 999999, -999999],
  ]);
  assert.deepEqual(computeSessions(store, 2, 1, [lndn]), [{
    zoneId: 'LNDN', startTs: ts('2026-03-06T07:00Z'),
    endTs: ts('2026-03-06T10:00Z'), firstIdx: 1, lastIdx: 2,
    high: 18, low: 6, complete: false,
  }]);
});

test('truncation and future rows set to 999999 do not change output', () => {
  const rows = [
    ['2026-03-06T07:00Z', 15, 7],
    ['2026-03-06T07:01Z', 18, 6],
    ['2026-03-06T07:02Z', 20, 5],
    ['2026-03-06T10:00Z'],
    ['2026-03-07T07:00Z'],
  ];
  const store = storeOf(rows);
  const expected = computeSessions(storeOf(rows.slice(0, 2)), 1, 0, [lndn]);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].high, 18);
  assert.equal(expected[0].low, 6);
  assert.equal(expected[0].complete, false);
  assert.deepEqual(computeSessions(store, 1, 0, [lndn]), expected);
  for (const key of ['t', 'o', 'h', 'l', 'c', 'v']) store[key].fill(999999, 2);
  assert.deepEqual(computeSessions(store, 1, 0, [lndn]), expected);
});

test('completion changes at scheduled end even with missing rows', () => {
  const store = storeOf([
    ['2026-03-06T07:15Z'], ['2026-03-06T09:59Z'],
    ['2026-03-06T10:00Z'], ['2026-03-06T12:00Z'],
  ]);
  const forming = computeSessions(store, 1, 0, [lndn])[0];
  assert.equal(forming.startTs, ts('2026-03-06T07:00Z'));
  assert.equal(forming.endTs, ts('2026-03-06T10:00Z'));
  assert.equal(forming.complete, false);
  for (const cursor of [2, 3]) {
    assert.deepEqual(computeSessions(store, cursor, 0, [lndn]), [
      { ...forming, complete: true },
    ]);
  }
});

test('a zone wrapping past midnight keeps the start date and one high/low', () => {
  const zone = { ...asia, end: '02:00' };
  const store = storeOf([
    ['2026-11-01T00:00Z', 13, 7],
    ['2026-11-01T03:59Z', 16, 6],
    ['2026-11-01T04:00Z', 18, 5],
    ['2026-11-01T05:30Z', 20, 4],
    ['2026-11-01T06:30Z', 22, 3],
    ['2026-11-01T07:00Z', 999999, -999999],
  ]);
  assert.deepEqual(computeSessions(store, 5, 0, [zone]), [{
    zoneId: 'ASIA', startTs: ts('2026-11-01T00:00Z'),
    endTs: ts('2026-11-01T07:00Z'), firstIdx: 0, lastIdx: 4,
    high: 22, low: 3, complete: true,
  }]);
});

test('separate NY start dates produce separate boxes', () => {
  const store = storeOf([
    ['2026-10-31T00:00Z', 15, 7],
    ['2026-10-31T00:01Z', 16, 6],
    ['2026-11-01T00:00Z', 18, 5],
    ['2026-11-01T00:01Z', 20, 4],
  ]);
  assert.deepEqual(computeSessions(store, 3, 0, [asia]), [
    { zoneId: 'ASIA', startTs: ts('2026-10-31T00:00Z'),
      endTs: ts('2026-10-31T04:00Z'), firstIdx: 0, lastIdx: 1,
      high: 16, low: 6, complete: true },
    { zoneId: 'ASIA', startTs: ts('2026-11-01T00:00Z'),
      endTs: ts('2026-11-01T04:00Z'), firstIdx: 2, lastIdx: 3,
      high: 20, low: 4, complete: false },
  ]);
});

test('nonexistent 02:30 start or end maps to the first existing minute', () => {
  const store = storeOf([
    ['2026-03-08T06:59Z'], ['2026-03-08T07:00Z'],
    ['2026-03-08T09:00Z'],
  ]);
  const startGap = computeSessions(store, 2, 0, [{ ...lndn, start: '02:30' }])[0];
  assert.equal(startGap.startTs, ts('2026-03-08T07:00Z'));
  assert.equal(startGap.firstIdx, 1);
  const endGap = computeSessions(store, 1, 0, [
    { ...lndn, start: '01:00', end: '02:30' },
  ])[0];
  assert.equal(endGap.endTs, ts('2026-03-08T07:00Z'));
  assert.equal(endGap.lastIdx, 0);
  assert.equal(endGap.complete, true);
});

test('equal start and end wraps for a full NY day', () => {
  const zone = { ...asia, start: '20:00', end: '20:00' };
  assert.equal(inZone(ts('2026-11-01T18:00Z'), zone), true);
  const store = storeOf([['2026-11-01T18:00Z']]);
  const [box] = computeSessions(store, 0, 0, [zone]);
  assert.equal(box.startTs, ts('2026-11-01T00:00Z'));
  assert.equal(box.endTs, ts('2026-11-02T01:00Z'));
});

test('empty revealed ranges produce no boxes', () => {
  assert.deepEqual(computeSessions(storeOf([]), -1, 0, [asia, lndn]), []);
  assert.deepEqual(computeSessions(storeOf([['2026-03-06T07:00Z']]), 0, 1, [lndn]), []);
});
