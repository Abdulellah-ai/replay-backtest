import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleFromIdx, sessionRanges, indicatorValues } from '../src/ui/indicators-logic.js';
import { rsi, sma } from '../src/core/indicators.js';
import * as logic from '../src/ui/indicators-logic.js';

test('labels need seven pixels per character plus six pixels padding', () => {
  assert.equal(logic.labelFits(33, 'ASIA'), false);
  assert.equal(logic.labelFits(34, 'ASIA'), true);
  assert.equal(logic.labelFits(40, 'LNDN'), true);
  assert.equal(logic.labelFits(20, 'NYAM'), false);
  assert.equal(logic.labelFits(0, 'NYPM'), false);
});

const levelTimes = [0, 1, 2, 3, 4, 5];
const levelHighs = [9, 10, 10, 11, 12, 999];
const levelLows = [5, 4, 4, 4, 3, -999];
const levelBox = { zoneId: 'ASIA', firstIdx: 0, lastIdx: 1,
  startTs: 0, endTs: 2, high: 10, low: 4, complete: true };

test('session levels stop at the first strictly swept high and low', () => {
  assert.deepEqual(logic.sessionLevelLines([levelBox], levelTimes, levelHighs, levelLows, 5), [
    { id: 'ASIA', kind: 'high', price: 10, fromTs: 2, toTs: 3, swept: true },
    { id: 'ASIA', kind: 'low', price: 4, fromTs: 2, toTs: 4, swept: true },
  ]);
});

test('equal prices do not sweep and unswept levels end at the cursor', () => {
  assert.deepEqual(logic.sessionLevelLines([levelBox], levelTimes, levelHighs, levelLows, 2), [
    { id: 'ASIA', kind: 'high', price: 10, fromTs: 2, toTs: 2, swept: false },
    { id: 'ASIA', kind: 'low', price: 4, fromTs: 2, toTs: 2, swept: false },
  ]);
});

test('session levels cannot see future sweep bars or incomplete session extremes', () => {
  const full = logic.sessionLevelLines([levelBox], levelTimes, levelHighs, levelLows, 3);
  assert.deepEqual(full, logic.sessionLevelLines([levelBox], levelTimes.slice(0, 4),
    levelHighs.slice(0, 4), levelLows.slice(0, 4), 3));
  assert.deepEqual(full[1], { id: 'ASIA', kind: 'low', price: 4, fromTs: 2, toTs: 3, swept: false });
  assert.deepEqual(logic.sessionLevelLines([levelBox], levelTimes, levelHighs, levelLows, 1), []);
  assert.deepEqual(logic.sessionLevelLines([{ ...levelBox, complete: false }],
    levelTimes, levelHighs, levelLows, 3), []);
});

test('only the four main sessions have levels; empty and unrevealed data have none', () => {
  for (const id of ['NYL', 'RTH', 'custom', 'grey', 'toString', '__proto__']) {
    assert.deepEqual(logic.sessionLevelLines([{ ...levelBox, zoneId: id }],
      levelTimes, levelHighs, levelLows, 5), []);
  }
  assert.deepEqual(logic.sessionLevelLines([], levelTimes, levelHighs, levelLows, 5), []);
  assert.deepEqual(logic.sessionLevelLines([levelBox], [], [], [], -1), []);
});

test('session colours distinguish main zones and default all other ids to neutral grey', () => {
  assert.equal(typeof logic.sessionColor, 'function');
  const main = ['ASIA', 'LNDN', 'NYAM', 'NYPM'].map(logic.sessionColor);
  assert.equal(new Set(main.map(color => color.fill)).size, 4);
  assert.equal(new Set(main.map(color => color.border)).size, 4);
  for (const color of main) {
    assert.match(color.fill, /,0\.16\)$/);
    assert.match(color.border, /,0\.7\)$/);
  }
  for (const id of ['NYL', 'RTH', 'custom', 'toString', '__proto__']) {
    assert.deepEqual(logic.sessionColor(id), {
      fill: 'rgba(128,128,128,0.16)', border: 'rgba(128,128,128,0.7)',
    });
  }
});

test('fromIdx uses first existing M1 in oldest visible bucket, bounded by cursor', () => {
  const times = [2, 3, 10, 11, 20, 21];
  const bars = [{ timestamp: 0 }, { timestamp: 10 }, { timestamp: 20 }];
  assert.equal(visibleFromIdx(times, 4, bars, { from: 0, to: 3 }), 0);
  assert.equal(visibleFromIdx(times, 4, bars, { from: 1.8, to: 3 }), 2);
  assert.equal(visibleFromIdx(times, 4, bars, { from: 2, to: 3 }), 4);
  assert.equal(visibleFromIdx(times, 3, bars, { from: 2, to: 3 }), 4);
  assert.equal(visibleFromIdx(times, 4, [], { from: 0, to: 0 }), 5);
  assert.equal(visibleFromIdx(times, 4, bars, { from: 3, to: 4 }), 5);
});

test('session lookback binary-searches 24 hours before the visible bucket in revealed rows', () => {
  const day = 24 * 60 * 60 * 1000;
  const times = [0, day - 1, day + 1, 2 * day, 3 * day];
  const bars = [{ timestamp: 2 * day }, { timestamp: 3 * day }];
  assert.equal(visibleFromIdx(times, 3, bars, { from: 0, to: 1 }, day), 2);
  assert.equal(visibleFromIdx(times, 3, bars, { from: 1, to: 2 }, day), 3);
  assert.equal(visibleFromIdx(times, 3, [], { from: 0, to: 0 }, day), 4);
});

test('session drawing ranges end at revealed rows, never scheduled future end', () => {
  const times = [2, 3, 10, 11, 20, 21];
  const bars = [{ timestamp: 0 }, { timestamp: 10 }, { timestamp: 20 }];
  const boxes = [{ zoneId: 'ASIA', firstIdx: 1, lastIdx: 4,
    startTs: 0, endTs: 999, high: 8, low: 2, complete: false }];
  assert.deepEqual(sessionRanges(boxes, times, 4, bars), [
    { zoneId: 'ASIA', from: -0.5, to: 2.5, high: 8, low: 2 },
  ]);
  assert.equal(sessionRanges(boxes, times, 3, bars)[0].to, 1.5);
  assert.deepEqual(sessionRanges(boxes, times, 0, bars), []);
  assert.deepEqual(sessionRanges(boxes, times, 4, []), []);
});

test('session mapping respects missing buckets and single-bar sessions', () => {
  const times = [100, 101, 5000];
  const bars = [{ timestamp: 100 }, { timestamp: 5000 }];
  const boxes = [{ zoneId: 'LNDN', firstIdx: 2, lastIdx: 2, high: 9, low: 4 }];
  assert.deepEqual(sessionRanges(boxes, times, 2, bars), [
    { zoneId: 'LNDN', from: 0.5, to: 1.5, high: 9, low: 4 },
  ]);
});

test('indicator results use our formulas over the complete data list including forming close', () => {
  const bars = Array.from({ length: 80 }, (_, i) => ({ close: 100 + i % 7 }));
  const closes = bars.map(b => b.close);
  const values = indicatorValues(bars, 'rsi', 14);
  assert.deepEqual(values, rsi(closes).map(v => v === null ? {} : { rsi: v }));
  assert.deepEqual(indicatorValues(bars, 'ma', 50), sma(closes, 50)
    .map(v => v === null ? {} : { ma: v }));
  bars.at(-1).close = 900;
  const updated = indicatorValues(bars, 'rsi', 14);
  assert.deepEqual(updated.slice(0, -1), values.slice(0, -1));
  assert.notEqual(updated.at(-1).rsi, values.at(-1).rsi);
});
