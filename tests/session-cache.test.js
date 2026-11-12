import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCache } from '../src/ui/session-cache.js';
import * as sessionCache from '../src/ui/session-cache.js';
import { computeSessions } from '../src/core/sessions.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

function store(length = 6100, start = Date.UTC(2026, 5, 1)) {
  return { t: Array.from({ length }, (_, i) => start + i * 60000),
    h: Array.from({ length }, (_, i) => 100 + i % 47),
    l: Array.from({ length }, (_, i) => 50 - i % 31) };
}

test('historical session discovery compresses membership runs and preserves core results', () => {
  for (const start of [Date.UTC(2026, 2, 7), Date.UTC(2026, 9, 31), Date.UTC(2026, 5, 1)]) {
    const source = store(4400, start);
    source.t = source.t.map((time, i) => time + (i >= 2000 ? 600000 : 0));
    const zones = structuredClone(DEFAULT_SETTINGS.zones);
    zones.push({ id: 'minute', start: '02:17', end: '02:18', enabled: true });
    for (const cursor of [10, 2001, 4399]) {
      let rows = 0;
      const actual = sessionCache.historicalSessions(source, cursor, zones, (s, end, from, z) => {
        rows += end - from + 1;
        return computeSessions(s, end, from, z);
      });
      assert.deepEqual(actual, computeSessions(source, cursor, 0, zones));
      if (cursor > 2000) assert.ok(rows < 100, `core scanned ${rows} compressed rows`);
    }
  }
});

test('historical discovery never reads future rows and handles empty data', () => {
  const source = store(100);
  const prefix = { t: source.t.slice(0, 51), h: source.h.slice(0, 51), l: source.l.slice(0, 51) };
  for (const key of ['t', 'h', 'l']) source[key] = new Proxy(source[key], {
    get(target, property) {
      if (/^\d+$/.test(String(property)) && Number(property) > 50) throw new Error('future read');
      return target[property];
    },
  });
  assert.deepEqual(sessionCache.historicalSessions(source, 50, DEFAULT_SETTINGS.zones),
    computeSessions(prefix, 50, 0, DEFAULT_SETTINGS.zones));
  assert.deepEqual(sessionCache.historicalSessions({ t: [], h: [], l: [] }, -1, DEFAULT_SETTINGS.zones), []);
});

test('historical discovery splits separate wrapping sessions across a missing daytime gap', () => {
  const source = { t: [Date.parse('2026-06-01T05:00Z'), Date.parse('2026-06-02T01:00Z')],
    h: [10, 20], l: [5, 15] };
  const zones = [{ id: 'ASIA', start: '20:00', end: '04:00', enabled: true }];
  const actual = sessionCache.historicalSessions(source, 1, zones);
  assert.deepEqual(actual, computeSessions(source, 1, 0, zones));
  assert.deepEqual(actual.map(box => [box.high, box.low, box.complete]),
    [[10, 5, true], [20, 15, false]]);
});

test('session cache scans only bounded new/boundary rows during scrolling playback', () => {
  const source = store();
  let scanned = 0;
  const cache = createSessionCache(source, (s, cursor, fromIdx, zones) => {
    scanned += cursor - fromIdx + 1;
    return computeSessions(s, cursor, fromIdx, zones);
  });
  cache.get(5999, 100, DEFAULT_SETTINGS.zones);
  scanned = 0;
  let result;
  for (let step = 1; step <= 40; step += 1) {
    result = cache.get(5999 + step, 100 + step, DEFAULT_SETTINGS.zones);
  }
  assert.ok(scanned <= 40 * 33, `rescanned ${scanned} rows for 40 advancing windows`);
  assert.deepEqual(result, computeSessions(source, 6039, 140, DEFAULT_SETTINGS.zones));
});

test('session cache never leaks future highs after a backward seek or window change', () => {
  const source = store(180);
  source.h[150] = 999999;
  const cache = createSessionCache(source);
  for (const [cursor, fromIdx] of [[170, 0], [130, 10], [145, 10], [145, 145], [170, 0]]) {
    assert.deepEqual(cache.get(cursor, fromIdx, DEFAULT_SETTINGS.zones),
      computeSessions(source, cursor, fromIdx, DEFAULT_SETTINGS.zones));
  }
  assert.deepEqual(cache.get(10, 11, DEFAULT_SETTINGS.zones), []);
});

test('session cache reflects zone edits and disabling without changing the settings identity', () => {
  const source = store(180);
  const zones = DEFAULT_SETTINGS.zones.map(zone => ({ ...zone }));
  const cache = createSessionCache(source);
  cache.get(100, 0, zones);
  zones[0].enabled = false;
  zones[2].start = '00:00';
  zones[2].end = '04:00';
  assert.deepEqual(cache.get(110, 0, zones), computeSessions(source, 110, 0, zones));
});

test('chunk merging preserves midnight/DST sessions, missing rows and completion flags', () => {
  const source = store(2000, Date.UTC(2026, 10, 1));
  source.t = source.t.map((time, i) => time + (i >= 1000 ? 600000 : 0));
  const cache = createSessionCache(source);
  for (const cursor of [900, 1005, 1100, 1500]) {
    assert.deepEqual(cache.get(cursor, 100, DEFAULT_SETTINGS.zones),
      computeSessions(source, cursor, 100, DEFAULT_SETTINGS.zones));
  }
});
