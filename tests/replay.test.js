import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStore } from '../src/core/data.js';
import { Replay } from '../src/core/replay.js';

const week = parseStore(JSON.parse(readFileSync(
  new URL('./fixtures/xauusd_m1_week.json', import.meta.url), 'utf8',
)));
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D'];
const indexAt = (iso) => {
  const index = week.t.indexOf(Date.parse(iso));
  assert.ok(index >= 0, `Missing fixture row: ${iso}`);
  return index;
};
const replayAt = (iso, tf = '1h') => new Replay(week, {
  startIdx: indexAt(iso), tf, dayAnchor: 'NY17',
});

function copyStore(store) {
  return {
    symbol: store.symbol,
    length: store.length,
    ...Object.fromEntries(['t', 'o', 'h', 'l', 'c', 'v'].map(
      (key) => [key, store[key].slice()],
    )),
  };
}

function sparseStore(times) {
  return parseStore({
    symbol: week.symbol,
    t: times.map(Date.parse),
    ...Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(
      (key) => [key, times.map((_, i) => week[key][i])],
    )),
  });
}

test('stepM1 advances exactly one row and time equals store.t[cursor]', () => {
  const replay = replayAt('2026-06-01T10:37:00Z');
  const cursor = replay.cursor;
  assert.equal(replay.time, week.t[cursor]);
  assert.equal(replay.stepM1(), true);
  assert.equal(replay.cursor, cursor + 1);
  assert.equal(replay.time, week.t[cursor + 1]);
});

test('forming 1h bar at 10:37 contains rows 10:00..10:37 only', () => {
  const replay = replayAt('2026-06-01T10:37:00Z');
  const firstIdx = indexAt('2026-06-01T10:00:00Z');
  const lastIdx = replay.cursor;
  assert.deepEqual(replay.barsAt(1), [{
    t: Date.parse('2026-06-01T10:00:00Z'),
    o: week.o[firstIdx],
    h: Math.max(...week.h.slice(firstIdx, lastIdx + 1)),
    l: Math.min(...week.l.slice(firstIdx, lastIdx + 1)),
    c: week.c[lastIdx],
    v: week.v.slice(firstIdx, lastIdx + 1).reduce((a, b) => a + b, 0),
    firstIdx,
    lastIdx,
  }]);
  assert.ok(replay.barsAt(1000).every((bar) => bar.lastIdx <= lastIdx));
});

test('setTimeframe keeps cursor and time', () => {
  const replay = replayAt('2026-06-01T10:37:00Z', '1m');
  const cursor = replay.cursor;
  const time = replay.time;
  for (const tf of timeframes) {
    replay.setTimeframe(tf);
    assert.equal(replay.tf, tf);
    assert.equal(replay.cursor, cursor);
    assert.equal(replay.time, time);
    assert.equal(replay.barsAt(1)[0].lastIdx, cursor);
    assert.equal(replay.barsAt(1)[0].c, week.c[cursor]);
  }
});

test('generation increments on setTimeframe', () => {
  const replay = replayAt('2026-06-01T10:37:00Z');
  assert.equal(replay.generation, 0);
  for (const tf of ['5m', '5m', '1D']) {
    const generation = replay.generation;
    replay.setTimeframe(tf);
    assert.equal(replay.generation, generation + 1);
  }
});

test("stepBar reveals the next bar's last row for 1h", () => {
  const replay = replayAt('2026-06-01T10:37:00Z');
  assert.equal(replay.stepBar(), true);
  assert.equal(replay.cursor, indexAt('2026-06-01T10:59:00Z'));
  assert.equal(replay.time, Date.parse('2026-06-01T10:59:00Z'));
  assert.equal(replay.stepBar(), true);
  assert.equal(replay.cursor, indexAt('2026-06-01T11:59:00Z'));
  assert.equal(replay.time, Date.parse('2026-06-01T11:59:00Z'));
  assert.equal(replay.barsAt(1)[0].c, week.c[replay.cursor]);
});

test('stepM1 at the last row returns false and does not move', () => {
  const replay = new Replay(week, {
    startIdx: week.length - 1, tf: '1h', dayAnchor: 'NY17',
  });
  assert.equal(replay.stepM1(), false);
  assert.equal(replay.stepM1(), false);
  assert.equal(replay.cursor, week.length - 1);
  assert.equal(replay.time, week.t[week.length - 1]);
});

test('stepM1 across the weekend gap jumps to the next existing row', () => {
  // The fixture ends Friday; reuse its prices with explicit weekend timestamps.
  const store = sparseStore(['2026-06-05T20:59:00Z', '2026-06-07T22:00:00Z']);
  const replay = new Replay(store, { startIdx: 0, tf: '1h', dayAnchor: 'NY17' });
  for (const tf of timeframes) {
    replay.setTimeframe(tf);
    assert.equal(replay.cursor, 0);
    assert.equal(replay.time, store.t[0]);
    assert.equal(replay.barsAt(100).length, 1);
  }
  assert.equal(replay.stepM1(), true);
  assert.equal(replay.cursor, 1);
  assert.equal(replay.time, store.t[1]);
  for (const tf of timeframes) {
    replay.setTimeframe(tf);
    assert.equal(replay.cursor, 1);
    assert.deepEqual(replay.barsAt(100).map((bar) => bar.firstIdx), [0, 1]);
  }
});

test('barsAt(limit, beforeTs) pages backwards without overlap', () => {
  const replay = replayAt('2026-06-04T10:37:00Z');
  const all = replay.barsAt(Infinity);
  const pages = [];
  let beforeTs;
  for (;;) {
    const page = replay.barsAt(7, beforeTs);
    if (page.length === 0) break;
    assert.ok(page.length <= 7);
    assert.ok(page.every((bar) => beforeTs === undefined || bar.t < beforeTs));
    pages.unshift(...page);
    beforeTs = page[0].t;
  }
  assert.deepEqual(pages, all);
  assert.equal(new Set(pages.map((bar) => bar.t)).size, all.length);
  assert.deepEqual(replay.barsAt(0), []);
  assert.deepEqual(replay.barsAt(3, all[0].t), []);
});

test('seekToTime selects the last row at or before the time and increments generation', () => {
  const store = sparseStore([
    '2026-06-05T20:58:00Z', '2026-06-05T20:59:00Z', '2026-06-07T22:00:00Z',
  ]);
  const replay = new Replay(store, { startIdx: 2, tf: '1m', dayAnchor: 'NY17' });
  for (const [ms, cursor] of [
    [store.t[1], 1],
    [store.t[1] + 30000, 1],
    [Date.parse('2026-06-06T12:00:00Z'), 1],
    [store.t[2] + 60000, 2],
    [store.t[0] - 1, -1],
    [store.t[0], 0],
    [store.t[0], 0],
  ]) {
    const generation = replay.generation;
    assert.equal(replay.seekToTime(ms), cursor);
    assert.equal(replay.cursor, cursor);
    assert.equal(replay.time, store.t[cursor]);
    assert.equal(replay.generation, generation + 1);
    if (cursor < 0) assert.deepEqual(replay.barsAt(100), []);
  }
});

test('stepBar on 1m advances one row and at the last row returns false', () => {
  const replay = new Replay(week, {
    startIdx: week.length - 2, tf: '1m', dayAnchor: 'NY17',
  });
  assert.equal(replay.stepBar(), true);
  assert.equal(replay.cursor, week.length - 1);
  replay.setTimeframe('1h');
  assert.equal(replay.stepBar(), false);
  assert.equal(replay.cursor, week.length - 1);
});

test('forming bars retain the bucket start when its first M1 is missing', () => {
  const store = sparseStore(['2026-06-01T10:02:00Z', '2026-06-01T10:37:00Z']);
  const replay = new Replay(store, { startIdx: 0, tf: '1h', dayAnchor: 'NY17' });
  assert.equal(replay.barsAt(1)[0].t, Date.parse('2026-06-01T10:00:00Z'));
  assert.equal(replay.barsAt(1)[0].lastIdx, 0);
  assert.equal(replay.stepBar(), true);
  assert.equal(replay.cursor, 1);
  assert.equal(replay.barsAt(1)[0].t, Date.parse('2026-06-01T10:00:00Z'));
});

for (const tf of timeframes) {
  test(`barsAt() ignores poisoned future rows for 200 seeded random cursors (${tf})`, () => {
    let seed = 0x4a17c0de;
    const randomCursor = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 0x100000000) * week.length);
    };
    for (let sample = 0; sample < 200; sample += 1) {
      const cursor = randomCursor();
      const poisoned = copyStore(week);
      // Keep timestamps: they define the same buckets and source row indices.
      for (const key of ['o', 'h', 'l', 'c', 'v']) {
        poisoned[key].fill(999999, cursor + 1);
      }
      const opts = { startIdx: cursor, tf, dayAnchor: 'NY17' };
      const real = new Replay(week, opts);
      const changed = new Replay(poisoned, opts);
      assert.deepEqual(changed.barsAt(Infinity), real.barsAt(Infinity),
        `tf=${tf}, sample=${sample}, cursor=${cursor}`);
    }
  });
}
