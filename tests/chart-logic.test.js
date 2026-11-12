import test from 'node:test';
import assert from 'node:assert/strict';
import { toCandle, toPeriod, loadReplayPage } from '../src/ui/chart-logic.js';
import { Replay } from '../src/core/replay.js';
import { parseStore } from '../src/core/data.js';

function makeReplay() {
  const t = Array.from({ length: 1600 }, (_, i) => Date.UTC(2026, 5, 1) + i * 60000);
  const prices = t.map((_, i) => 100 + i);
  return new Replay(parseStore({ symbol: 'TEST', t, o: prices, h: prices,
    l: prices, c: prices, v: t.map(() => 1) }),
  { startIdx: 1599, tf: '1m', dayAnchor: 'NY17' });
}

test('candle mapping preserves OHLCV and timestamp without source indices', () => {
  const bar = { t: 60000, o: 10, h: 14, l: 8, c: 12, v: 0, firstIdx: 2, lastIdx: 3 };
  assert.deepEqual(toCandle(bar), {
    timestamp: 60000, open: 10, high: 14, low: 8, close: 12, volume: 0,
  });
  assert.equal(bar.firstIdx, 2);
});

for (const [tf, type, span] of [
  ['1m', 'minute', 1], ['5m', 'minute', 5], ['15m', 'minute', 15],
  ['1h', 'hour', 1], ['4h', 'hour', 4], ['1D', 'day', 1],
]) {
  test(`${tf} maps to the library period unit and span`, () => {
    assert.deepEqual(toPeriod(tf), { type, span });
  });
}

test('unsupported timeframe is rejected', () => {
  assert.throws(() => toPeriod('1w'), /Unsupported timeframe/);
});

test('initial window and older pages contain only revealed bars without overlap', async () => {
  const replay = makeReplay();
  const initial = await loadReplayPage(replay);
  assert.equal(initial.length, 1500);
  assert.equal(initial[0].t, Date.UTC(2026, 5, 1, 1, 40));
  const older = await loadReplayPage(replay, { beforeTs: initial[0].t });
  assert.equal(older.length, 100);
  assert.ok(older.at(-1).t < initial[0].t);
  assert.ok(initial.at(-1).t <= replay.time);
  assert.deepEqual(await loadReplayPage(replay, { beforeTs: older[0].t }), []);
});

for (const action of ['timeframe', 'seek', 'refresh', 'destroy']) {
  test(`delayed page is dropped after ${action}`, async () => {
    const replay = makeReplay();
    let release;
    let current = true;
    const pending = loadReplayPage(replay, {
      beforeTs: replay.time, isCurrent: () => current,
      loadHook: () => new Promise((resolve) => { release = resolve; }),
    });
    if (action === 'timeframe') replay.setTimeframe('1h');
    else if (action === 'seek') replay.seekToTime(replay.time - 60000);
    else current = false;
    release();
    assert.equal(await pending, null);
  });
}

test('a delayed page is returned while its generation is still current', async () => {
  const replay = makeReplay();
  const page = await loadReplayPage(replay, { limit: 2, loadHook: async () => {} });
  assert.deepEqual(page.map(toCandle), [
    { timestamp: replay.time - 60000, open: 1698, high: 1698, low: 1698, close: 1698, volume: 1 },
    { timestamp: replay.time, open: 1699, high: 1699, low: 1699, close: 1699, volume: 1 },
  ]);
});
