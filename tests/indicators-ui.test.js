import test from 'node:test';
import assert from 'node:assert/strict';
import { attachIndicators } from '../src/ui/indicators.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

function fixture() {
  const templates = new Map();
  const registrations = [];
  globalThis.klinecharts = { registerIndicator(template) {
    registrations.push(template.name);
    templates.set(template.name, template);
  } };
  const active = new Map();
  const listeners = new Map();
  const overrides = [];
  const base = Date.parse('2026-06-01T06:00Z'); // 02:00 NY
  const store = { t: [base, base + 60000, base + 120000],
    h: [10, 12, 999999], l: [5, 4, -999999] };
  const bars = store.t.slice(0, 2).map(timestamp => ({ timestamp, close: 8 }));
  const instance = {
    createIndicator(value) { active.set(value.name, value); return `${value.name}_id`; },
    removeIndicator({ name }) { return active.delete(name); },
    overrideIndicator(value) { overrides.push(value); return true; },
    setPaneOptions(options) {
      const rsi = [...active.values()].find(value => value.name.includes('RSI'));
      assert.equal(options.id, rsi.paneId, 'pane height must use paneId, not indicator id');
    }, setStyles() {},
    getDataList: () => bars,
    getVisibleRange: () => ({ from: 0, to: bars.length }),
    subscribeAction(type, fn) { listeners.set(type, fn); },
    unsubscribeAction(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    convertToPixel(points) {
      const convert = ({ dataIndex, value }) => ({ x: 20 + dataIndex * 10, y: 100 - value });
      return Array.isArray(points) ? points.map(convert) : convert(points);
    },
  };
  return { chart: { instance, sourceStore: store }, replay: { cursor: 1, generation: 0 },
    templates, registrations, active, listeners, overrides, bars };
}

test('Kill zones and RSI can be switched off and on again, idempotently', () => {
  const f = fixture();
  const a = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  assert.equal(f.active.size, 3);
  a.setZones(false);
  a.setZones(false);
  assert.equal(f.active.has('replay_kill_zones') || [...f.active.keys()].some(name => /zone/i.test(name)), false);
  assert.equal(f.active.size, 2);
  a.setRsi(false);
  a.setRsi(false);
  assert.equal(f.active.size, 1);
  a.update();
  a.setZones(true);
  a.setRsi(true);
  assert.equal(f.active.size, 3);
  a.destroy();
  a.setZones(false);
  assert.equal(f.active.size, 0);
});

test('registration is once per API; MA toggle, updates and destruction are idempotent', () => {
  const f = fixture();
  const a = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  assert.equal(f.registrations.length, 3);
  assert.equal(f.active.size, 3);
  a.setMa50(false);
  a.setMa50(false);
  assert.equal(f.active.size, 2);
  a.setMa50(true);
  a.update();
  assert.ok(f.overrides.length >= 3);
  a.destroy();
  a.destroy();
  assert.equal(f.active.size, 0);
  assert.equal(f.listeners.size, 0);
  a.update();
  a.setMa50(true);
  assert.equal(f.active.size, 0);
  const b = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  assert.equal(f.registrations.length, 3);
  b.destroy();
});

test('kill-zone draw uses current revealed data and does not read future highs/lows', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const template = [...f.templates.values()].find(t => t.shortName === 'Kill zones');
  const indicator = f.active.get(template.name);
  const rects = [];
  const labels = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(...args) { rects.push(args); }, setLineDash() {}, moveTo() {}, lineTo() {},
    stroke() {}, fillText(text) { labels.push(text); } };
  const params = { ctx, chart: f.chart.instance, indicator,
    bounding: { width: 300, height: 150 } };
  template.draw(params);
  assert.deepEqual(rects, [[15, 88, 20, 8]]);
  assert.deepEqual(labels, [], 'narrow boxes deliberately omit labels');
  // A step changes both the range and H/L, with no settings or pane rebuild.
  f.replay.cursor = 2;
  f.bars.push({ timestamp: f.chart.sourceStore.t[2], close: 9 });
  handle.update();
  template.draw(params);
  assert.equal(rects.at(-1)[2], 30);
  assert.equal(rects.at(-1)[1], 100 - 999999);
  handle.destroy();
});

test('kill-zone rendering uses separate blue, red, green, purple and fallback grey styles', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const template = [...f.templates.values()].find(t => t.shortName === 'Kill zones');
  const fills = [];
  const borders = [];
  const labels = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    setLineDash() {}, moveTo() {}, lineTo() {},
    fillRect() { fills.push(this.fillStyle); },
    stroke() { borders.push(this.strokeStyle); },
    fillText() { labels.push(this.fillStyle); } };
  template.draw({ ctx, chart: f.chart.instance, bounding: { width: 500, height: 150 },
    indicator: { paneId: 'candle_pane', extendData: { getRanges: () =>
      ['ASIA', 'LNDN', 'NYAM', 'NYPM', 'custom'].map((zoneId, index) =>
        ({ zoneId, from: index * 7, to: index * 7 + 6, high: 12, low: 4 })) } } });
  assert.deepEqual(fills, ['rgba(55,100,180,0.16)', 'rgba(165,55,65,0.16)',
    'rgba(35,125,90,0.16)', 'rgba(115,65,155,0.16)', 'rgba(128,128,128,0.16)']);
  assert.deepEqual(borders, ['rgba(55,100,180,0.7)', 'rgba(165,55,65,0.7)',
    'rgba(35,125,90,0.7)', 'rgba(115,65,155,0.7)', 'rgba(128,128,128,0.7)']);
  assert.deepEqual(labels, Array(5).fill('#d1d4dc'));
  handle.destroy();
});

test('RSI draw places dashed levels at exactly 30, 50, 70 and retains native line', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const template = [...f.templates.values()].find(t => t.shortName === 'RSI');
  const levels = [];
  const fills = [];
  const dashes = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(...args) { fills.push(args); }, setLineDash(value) { dashes.push(value); },
    moveTo(x, y) { levels.push(y); }, lineTo() {}, stroke() {}, closePath() {}, fill() {} };
  const indicator = { ...f.active.get(template.name), result: [] };
  assert.equal(template.draw({ ctx, chart: f.chart.instance, indicator,
    bounding: { width: 300, height: 100 }, yAxis: { convertToPixel: value => 100 - value } }), false);
  assert.deepEqual(levels, [70, 50, 30]);
  assert.deepEqual(dashes, [[4, 4]]);
  assert.deepEqual(fills, [[0, 30, 300, 40]]);
  assert.equal(template.minValue, 0);
  assert.equal(template.maxValue, 100);
  assert.deepEqual(template.calcParams, [14]);
  handle.destroy();
});

test('zone draw follows scroll and newly loaded history without an explicit update', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const indicator = [...f.active.values()].find(t => t.name.includes('KILL'));
  assert.equal(indicator.extendData.getRanges()[0].high, 12);
  // Oldest visible bucket now contains only the last revealed M1 row.
  f.chart.instance.getVisibleRange = () => ({ from: 1, to: 2 });
  const ranges = indicator.extendData.getRanges();
  assert.equal(ranges[0].low, 4);
  assert.equal(ranges[0].from, 0.5);
  // A history page prepends a candle. Existing session indices move right.
  f.bars.unshift({ timestamp: f.chart.sourceStore.t[0] - 60000, close: 7 });
  f.chart.instance.getVisibleRange = () => ({ from: 0, to: 3 });
  assert.equal(indicator.extendData.getRanges()[0].from, 0.5);
  handle.destroy();
});

test('LNDN high and low include the whole revealed session after scrolling', () => {
  const f = fixture();
  const base = f.chart.sourceStore.t[0];
  Object.assign(f.chart.sourceStore, {
    t: [-1, 0, 1, 2, 3].map(minute => base + minute * 60000),
    h: [1, 100, 90, 95, 999999], l: [0, 10, 20, 15, -999999],
  });
  f.bars.splice(0, f.bars.length, ...f.chart.sourceStore.t.slice(0, 4)
    .map(timestamp => ({ timestamp, close: 50 })));
  f.replay.cursor = 3;
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const indicator = [...f.active.values()].find(t => t.name.includes('KILL'));
  const getRanges = indicator.extendData.getRanges;
  assert.equal(getRanges()[0].high, 100);
  assert.equal(getRanges()[0].low, 10);
  f.chart.instance.getVisibleRange = () => ({ from: 2, to: 4 });
  const scrolled = getRanges();
  assert.equal(scrolled[0].high, 100);
  assert.equal(scrolled[0].low, 10);
  assert.strictEqual(getRanges(), scrolled, 'unchanged frames reuse calculated ranges');
  f.replay.cursor = 1;
  f.chart.instance.getVisibleRange = () => ({ from: 1, to: 2 });
  assert.equal(getRanges()[0].high, 100);
  assert.equal(getRanges()[0].low, 10);
  handle.destroy();
});

test('labels fit the clipped box and skip later overlapping x ranges', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const template = [...f.templates.values()].find(t => t.shortName === 'Kill zones');
  const labels = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    setLineDash() {}, moveTo() {}, lineTo() {}, fillRect() {}, stroke() {},
    fillText(text, x) { labels.push([text, x]); } };
  const ranges = [
    { zoneId: 'ASIA', from: 0, to: 4 },
    { zoneId: 'LNDN', from: 2, to: 6 },
    { zoneId: 'NYAM', from: 5, to: 9 },
    { zoneId: 'NYPM', from: -5, to: 0 },
    { zoneId: 'RTH', from: 27, to: 31 },
  ].map(box => ({ ...box, high: 12, low: 4 }));
  template.draw({ ctx, chart: f.chart.instance, bounding: { width: 300, height: 150 },
    indicator: { paneId: 'candle_pane', extendData: { getRanges: () => ranges } } });
  assert.deepEqual(labels, [['ASIA', 23], ['NYAM', 73]]);
  handle.destroy();
});

test('completed levels respect cursor, zone flags, viewport, rewind and toggle', () => {
  const f = fixture();
  const base = f.chart.sourceStore.t[0];
  // London ends at 09:00Z. Later rows equal, then sweep high, then low.
  Object.assign(f.chart.sourceStore, { t: [base, base + 60000, base + 3 * 3600000,
    base + 4 * 3600000, base + 5 * 3600000], h: [10, 12, 12, 13, 14], l: [5, 4, 4, 4, 3] });
  f.bars.splice(0, f.bars.length, ...f.chart.sourceStore.t.slice(0, 3).map(timestamp => ({ timestamp })));
  f.replay.cursor = 2;
  const settings = structuredClone(DEFAULT_SETTINGS);
  const handle = attachIndicators(f.chart, f.replay, settings);
  const template = [...f.templates.values()].find(t => t.shortName === 'Kill zones');
  const indicator = f.active.get(template.name);
  const levels = () => indicator.extendData.getLevelLines();
  assert.deepEqual(levels(), []);
  settings.sessionLevels = true;
  handle.update();
  assert.deepEqual(levels().map(l => [l.kind, l.from, l.to, l.price, l.swept]),
    [['high', 2, 2, 12, false], ['low', 2, 2, 4, false]]);
  f.replay.cursor = 3;
  f.bars.push({ timestamp: f.chart.sourceStore.t[3] });
  handle.update();
  assert.deepEqual(levels().map(l => [l.kind, l.to, l.swept]),
    [['high', 3, true], ['low', 3, false]]);
  f.replay.cursor = 4;
  f.bars.push({ timestamp: f.chart.sourceStore.t[4] });
  handle.update();
  f.chart.instance.getVisibleRange = () => ({ from: 4, to: 5 });
  assert.deepEqual(levels().map(l => [l.kind, l.to, l.swept]), [['low', 4, true]]);
  f.replay.cursor = 2;
  f.bars.splice(3);
  f.chart.instance.getVisibleRange = () => ({ from: 0, to: 3 });
  handle.update();
  assert.ok(levels().every(l => !l.swept));
  settings.zones.find(z => z.id === 'LNDN').enabled = false;
  handle.update();
  assert.deepEqual(levels(), []);
  handle.destroy();
  assert.deepEqual(levels(), []);
});

test('session level renderer draws thin lines in the session color', () => {
  const f = fixture();
  const handle = attachIndicators(f.chart, f.replay, DEFAULT_SETTINGS);
  const template = [...f.templates.values()].find(t => t.shortName === 'Kill zones');
  const paths = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    setLineDash() {}, moveTo(x, y) { this.start = [x, y]; },
    lineTo(x, y) { this.end = [x, y]; },
    stroke() { paths.push([this.start, this.end, this.strokeStyle, this.lineWidth]); } };
  template.draw({ ctx, chart: f.chart.instance, bounding: { width: 300, height: 150 },
    indicator: { paneId: 'candle_pane', extendData: { getRanges: () => [],
      getLevelLines: () => [{ id: 'NYPM', from: 1, to: 4, price: 12 }] } } });
  assert.deepEqual(paths, [[[30, 88], [60, 88], 'rgba(115,65,155,0.7)', 1]]);
  handle.destroy();
});

test('old unswept levels survive beyond the box lookback without rescanning old prices', () => {
  const f = fixture();
  const base = f.chart.sourceStore.t[0];
  Object.assign(f.chart.sourceStore, {
    t: [base, base + 60000, base + 3 * 3600000, base + 3 * 86400000 + 3 * 3600000],
    h: [10, 12, 11, 11], l: [5, 4, 5, 5],
  });
  f.bars.splice(0, f.bars.length, ...f.chart.sourceStore.t.slice(0, 3).map(timestamp => ({ timestamp })));
  f.replay.cursor = 2;
  const handle = attachIndicators(f.chart, f.replay, { ...DEFAULT_SETTINGS, sessionLevels: true });
  const indicator = [...f.active.values()].find(t => t.name.includes('KILL'));
  const levels = () => indicator.extendData.getLevelLines();
  assert.equal(levels().length, 2);
  f.replay.cursor = 3;
  f.bars.push({ timestamp: f.chart.sourceStore.t[3] });
  handle.update();
  f.chart.instance.getVisibleRange = () => ({ from: 3, to: 4 });
  assert.deepEqual(indicator.extendData.getRanges(), []);
  assert.deepEqual(levels().map(l => [l.price, l.to, l.swept]), [[12, 3, false], [4, 3, false]]);
  const highs = f.chart.sourceStore.h;
  const lows = f.chart.sourceStore.l;
  const noRead = { get() { throw new Error('unchanged cursor must not rescan prices'); } };
  f.chart.sourceStore.h = new Proxy(highs, noRead);
  f.chart.sourceStore.l = new Proxy(lows, noRead);
  assert.equal(levels().length, 2);
  f.replay.generation += 1; // A timeframe change keeps the same immutable M1 prefix.
  assert.equal(levels().length, 2);
  f.bars.unshift({ timestamp: base - 60000 });
  f.chart.instance.getVisibleRange = () => ({ from: 4, to: 5 });
  assert.deepEqual(levels().map(l => [l.from, l.to]), [[3, 4], [3, 4]]);
  f.chart.sourceStore.h = highs;
  f.chart.sourceStore.l = lows;
  handle.destroy();
});

test('a completed session ending inside the last visible aggregate bucket retains its levels', () => {
  const f = fixture();
  const base = f.chart.sourceStore.t[0];
  Object.assign(f.chart.sourceStore, { t: [base, base + 29 * 60000, base + 45 * 60000],
    h: [10, 12, 11], l: [5, 4, 5] });
  f.bars.splice(0, f.bars.length, { timestamp: base });
  f.replay.cursor = 2;
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.sessionLevels = true;
  settings.zones.find(z => z.id === 'LNDN').end = '02:30';
  const handle = attachIndicators(f.chart, f.replay, settings);
  const indicator = [...f.active.values()].find(t => t.name.includes('KILL'));
  assert.deepEqual(indicator.extendData.getLevelLines().map(l => [l.kind, l.from, l.to]),
    [['high', 0, 0], ['low', 0, 0]]);
  handle.destroy();
});

test('swept history is queried before mapping on draws, steps and historical scrolls', () => {
  const f = fixture();
  const base = f.chart.sourceStore.t[0];
  const t = [], h = [], l = [];
  for (let day = 0; day < 80; day += 1) {
    for (const [minute, high, low] of [[0, 10, 5], [1, 12, 4], [60, 12, 4],
      [61, 13, 3], [62, 11, 5]]) {
      t.push(base + day * 86400000 + minute * 60000);
      h.push(high);
      l.push(low);
    }
  }
  Object.assign(f.chart.sourceStore, { t, h, l });
  let reads = 0;
  f.bars.splice(0, f.bars.length, ...t.map(timestamp => ({
    get timestamp() { reads += 1; return timestamp; },
  })));
  let range = { from: 397, to: 399 };
  f.chart.instance.getVisibleRange = () => range;
  f.replay.cursor = 398;
  const settings = { ...DEFAULT_SETTINGS, sessionLevels: true,
    zones: [{ id: 'LNDN', start: '02:00', end: '03:00', enabled: true }] };
  const handle = attachIndicators(f.chart, f.replay, settings);
  const indicator = [...f.active.values()].find(value => value.name.includes('KILL'));
  const levels = () => indicator.extendData.getLevelLines();
  assert.equal(levels().length, 2); // Initial discovery is allowed to read history.
  const check = expected => {
    reads = 0;
    assert.deepEqual(levels().map(line => [line.kind, line.from, line.to, line.swept]), expected);
    assert.ok(reads < 200, `small viewport read ${reads} bar timestamps for swept history`);
  };
  check([['high', 397, 398, true], ['low', 397, 398, true]]);
  f.replay.cursor = 399;
  check([['high', 397, 398, true], ['low', 397, 398, true]]);
  range = { from: 102, to: 104 };
  check([['high', 102, 103, true], ['low', 102, 103, true]]);
  range = { from: 104, to: 105 };
  check([]);
  handle.destroy();
});
