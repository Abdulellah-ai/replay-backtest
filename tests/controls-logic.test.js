import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback, parseSettingsForm, gapsInVisibleWindow, MIN_WARN_GAP_MINUTES, visibleTimeWindow,
  clampDivider, nearestRevealedBar, parseJumpDate } from '../src/ui/controls-logic.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as controlsLogic from '../src/ui/controls-logic.js';

test('scroll target matches timestamps across different timeframes', () => {
  assert.equal(typeof controlsLogic.syncScrollTarget, 'function');
  const minutes = Array.from({ length: 121 }, (_, i) => i * 60000);
  assert.deepEqual(controlsLogic.syncScrollTarget({ fromTs: 3600000, toTs: 7200000 }, minutes),
    { fromIndex: 60, toIndex: 120 });
  assert.deepEqual(controlsLogic.syncScrollTarget({ fromTs: 60000, toTs: 540000 },
    [0, 300000, 600000]), { fromIndex: 0, toIndex: 1 });
});

test('scroll target handles sparse, outside, single and empty target timestamps', () => {
  assert.equal(typeof controlsLogic.syncScrollTarget, 'function');
  const map = controlsLogic.syncScrollTarget;
  assert.deepEqual(map({ fromTs: 100, toTs: 800 }, [100, 300, 900]),
    { fromIndex: 0, toIndex: 1 });
  assert.equal(map({ fromTs: -100, toTs: 1000 }, [100, 300, 900]), null);
  assert.equal(map({ fromTs: 1000, toTs: 2000 }, [100]), null);
  assert.deepEqual(map({ fromTs: 100, toTs: 100 }, [100]),
    { fromIndex: 0, toIndex: 0 });
  assert.equal(map({ fromTs: 100, toTs: 200 }, []), null);
  assert.equal(map(null, [100]), null);
  assert.equal(map({ fromTs: 200, toTs: 100 }, [100]), null);
});

for (const [name, window] of [
  ['before range', { fromTs: -100, toTs: 0 }],
  ['after range', { fromTs: 1000, toTs: 2000 }],
  ['overlapping the start', { fromTs: 99, toTs: 300 }],
  ['overlapping the end', { fromTs: 300, toTs: 901 }],
]) {
  test(`scroll target rejects windows ${name}`, () => {
    assert.equal(controlsLogic.syncScrollTarget(window, [100, 300, 900]), null);
  });
}

test('scroll target accepts windows on both loaded boundaries', () => {
  assert.deepEqual(controlsLogic.syncScrollTarget({ fromTs: 100, toTs: 900 }, [100, 300, 900]),
    { fromIndex: 0, toIndex: 2 });
});

test('play consumes fractional frames without drift at every supported speed', () => {
  for (const speed of [1, 5, 20, 60]) {
    let accumulator = 0;
    let rows = 0;
    for (let frame = 0; frame < 3600; frame += 1) {
      const next = advancePlayback(accumulator, 1000 / 60, speed, 100000);
      accumulator = next.accumulator;
      rows += next.rows;
    }
    assert.equal(rows, 60 * speed);
    assert.ok(Math.abs(accumulator) < 1e-8);
  }
});

test('play carries partial rows through irregular frames and speed changes', () => {
  const first = advancePlayback(0, 125, 5, 100);
  assert.equal(first.rows, 0);
  assert.equal(first.accumulator, 0.625);
  const next = advancePlayback(first.accumulator, 125, 20, 100);
  assert.equal(next.rows, 3);
  assert.equal(next.accumulator, 0.125);
  assert.equal(next.done, false);
});

test('play caps a long frame at remaining rows and discards credit at the end', () => {
  assert.deepEqual(advancePlayback(0.75, 10000, 60, 2),
    { rows: 2, accumulator: 0, done: true });
  assert.deepEqual(advancePlayback(0, 1000, 60, 0),
    { rows: 0, accumulator: 0, done: true });
});

test('settings form preserves identity and sync while accepting midnight wrapping', () => {
  const rows = DEFAULT_SETTINGS.zones.map(zone => ({ ...zone }));
  rows[0] = { ...rows[0], start: '21:00', end: '01:00', enabled: false };
  const parsed = parseSettingsForm(DEFAULT_SETTINGS, rows);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.zones[0],
    { id: 'ASIA', label: 'ASIA', start: '21:00', end: '01:00', enabled: false });
  assert.equal(parsed.value.syncCrosshair, false);
  assert.equal(DEFAULT_SETTINGS.zones[0].start, '20:00');
});

for (const [start, end] of [['10:00', '10:00'], ['25:99', '11:00'], ['', '11:00']]) {
  test(`settings form rejects ${start}/${end} without mutating settings`, () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    const rows = DEFAULT_SETTINGS.zones.map(zone => ({ ...zone }));
    rows[2] = { ...rows[2], start, end };
    const result = parseSettingsForm(DEFAULT_SETTINGS, rows);
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
    assert.equal(JSON.stringify(DEFAULT_SETTINGS), before);
  });
}

test('settings form rejects incomplete zone rows', () => {
  assert.equal(parseSettingsForm(DEFAULT_SETTINGS, []).ok, false);
});

test('gap selection includes intersecting unexplained gaps but never future ones', () => {
  const gaps = [
    { startTs: 60, endTs: 180, minutes: 20, kind: 'unexplained' },
    { startTs: 190, endTs: 250, minutes: 60, kind: 'expected' },
    { startTs: 300, endTs: 500, minutes: 20, kind: 'unexplained' },
  ];
  assert.deepEqual(gapsInVisibleWindow(gaps, { fromTs: 100, toTs: 350 }, 400), [gaps[0]]);
  assert.deepEqual(gapsInVisibleWindow(gaps, { fromTs: 200, toTs: 299 }, 600), []);
  assert.deepEqual(gapsInVisibleWindow(gaps, null, 600), []);
});

test('short gaps below the warning threshold are not shown', () => {
  const short = { startTs: 60, endTs: 180, minutes: MIN_WARN_GAP_MINUTES - 1, kind: 'unexplained' };
  const edge = { startTs: 60, endTs: 180, minutes: MIN_WARN_GAP_MINUTES, kind: 'unexplained' };
  assert.deepEqual(gapsInVisibleWindow([short], { fromTs: 0, toTs: 400 }, 600), []);
  assert.deepEqual(gapsInVisibleWindow([edge], { fromTs: 0, toTs: 400 }, 600), [edge]);
});

test('visible time window includes the full last visible bucket and clamps to master', () => {
  const bars = [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 400 }];
  assert.deepEqual(visibleTimeWindow(bars, { from: 0, to: 2 }, 450),
    { fromTs: 100, toTs: 399 });
  assert.deepEqual(visibleTimeWindow(bars, { from: 1, to: 9 }, 450),
    { fromTs: 200, toTs: 450 });
  assert.equal(visibleTimeWindow(bars, { from: 4, to: 9 }, 450), null);
  assert.equal(visibleTimeWindow([], { from: 0, to: 1 }, 450), null);
});

test('divider leaves at least 20 percent for each pane', () => {
  assert.equal(clampDivider(-0.1), 0.2);
  assert.equal(clampDivider(0.42), 0.42);
  assert.equal(clampDivider(1.1), 0.8);
});

test('crosshair selects nearest earlier loaded bar and never exceeds master time', () => {
  const bars = [{ timestamp: 100 }, { timestamp: 300 }, { timestamp: 500 }];
  assert.equal(nearestRevealedBar(bars, 490, 600), bars[1]);
  assert.equal(nearestRevealedBar(bars, 900, 400), bars[1]);
  assert.equal(nearestRevealedBar(bars, 50, 600), null);
  assert.equal(nearestRevealedBar([], 500, 600), null);
});

test('jump date is UTC midnight and rejects empty, malformed and nonexistent dates', () => {
  assert.equal(parseJumpDate('2026-06-01'), Date.UTC(2026, 5, 1));
  for (const value of ['', '2026-02-30', '06/01/2026']) {
    assert.equal(parseJumpDate(value), null);
  }
});
