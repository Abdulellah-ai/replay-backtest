import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/ui/chart.js';
import { Replay } from '../src/core/replay.js';
import { parseStore } from '../src/core/data.js';

// Only the external rendering/data-loader boundary is replaced; use real Replay.
function setup(tf = '1m') {
  const t = Array.from({ length: 180 }, (_, i) => Date.UTC(2026, 5, 1) + i * 60000);
  const price = t.map((_, i) => 100 + i);
  const store = parseStore({ symbol: 'TEST', t, o: price, h: price, l: price, c: price, v: price });
  const replay = new Replay(store, { startIdx: 0, tf, dayAnchor: 'NY17' });
  let loader;
  let resets = 0;
  let data = [];
  const styles = [];
  const instance = {
    setStyles(value) { styles.push(value); },
    setSymbol() {},
    setDataLoader(value) { loader = value; },
    setPeriod() {
      resets += 1;
      loader.unsubscribeBar();
      loader.getBars({ type: 'init', callback: bars => { data = bars; } });
      loader.subscribeBar({ callback: bar => {
        if (data.at(-1)?.timestamp === bar.timestamp) data[data.length - 1] = bar;
        else data.push(bar);
      } });
    },
    getDataList: () => data,
  };
  globalThis.klinecharts = { init: () => instance, dispose() {} };
  const chart = createChart({}, replay, { store });
  return { replay, chart, instance, styles, resets: () => resets,
    older: hook => loader.getBars({ type: 'forward', timestamp: t[0], callback: hook }) };
}

test('each chart receives the built-in dark theme at creation', () => {
  const usd = setup();
  const eur = setup();
  assert.equal(usd.styles[0], 'dark');
  assert.equal(eur.styles[0], 'dark');
  for (const chart of [usd, eur]) {
    const bar = chart.styles[1].candle.bar;
    assert.equal(bar.upColor, bar.upBorderColor);
    assert.equal(bar.upColor, bar.upWickColor);
    assert.equal(bar.downColor, bar.downBorderColor);
    assert.equal(bar.downColor, bar.downWickColor);
    assert.notEqual(bar.upColor, bar.downColor);
  }
});

test('a batch push includes every intervening bar on the finer timeframe', () => {
  const { replay, chart, instance } = setup();
  for (let i = 0; i < 100; i += 1) replay.stepM1();
  chart.push();
  assert.equal(instance.getDataList().length, 101);
  assert.equal(instance.getDataList()[60].close, 160);
  assert.equal(instance.getDataList().at(-1).close, 200);
});

test('continuous forward seek updates a forming bar without resetting the chart', () => {
  const { replay, chart, instance, resets } = setup('1h');
  replay.seekToTime(Date.UTC(2026, 5, 1, 0, 20));
  chart.push({ continuous: true });
  assert.equal(instance.getDataList().length, 1);
  assert.equal(instance.getDataList()[0].close, 120);
  assert.equal(resets(), 1);
  replay.seekToTime(Date.UTC(2026, 5, 1, 1, 20));
  chart.push({ continuous: true });
  assert.deepEqual(instance.getDataList().map(bar => bar.close), [159, 180]);
  assert.equal(resets(), 1);
});

test('backward seek and timeframe change rebuild instead of leaving future bars', () => {
  const { replay, chart, instance, resets } = setup();
  replay.seekToTime(Date.UTC(2026, 5, 1, 1));
  chart.push({ continuous: true });
  replay.seekToTime(Date.UTC(2026, 5, 1, 0, 5));
  chart.push({ continuous: true });
  assert.equal(instance.getDataList().length, 6);
  assert.equal(resets(), 2);
  replay.setTimeframe('1h');
  chart.push({ continuous: true });
  assert.equal(instance.getDataList().length, 1);
  assert.equal(instance.getDataList()[0].close, 105);
  assert.equal(resets(), 3);
});

test('continuous seek with a pending page rebuilds and drops the stale callback', async () => {
  const { replay, chart, older, resets } = setup();
  let called = false;
  const pending = older(() => { called = true; });
  replay.seekToTime(Date.UTC(2026, 5, 1, 0, 5));
  chart.push({ continuous: true });
  await pending;
  assert.equal(called, false);
  assert.equal(resets(), 2);
});
