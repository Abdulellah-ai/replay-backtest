import test from 'node:test';
import assert from 'node:assert/strict';
import { attachControls } from '../src/ui/controls.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { startDrawing } from '../src/ui/drawing.js';
import { readFileSync } from 'node:fs';

function node() {
  const listeners = new Map();
  const children = new Map();
  const lists = new Map();
  return {
    lists,
    attributes: new Map([['aria-pressed', 'false']]),
    getAttribute(name) { return this.attributes.get(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    style: { setProperty() {} },
    append() {}, replaceChildren() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, node());
      return children.get(selector);
    },
    querySelectorAll: selector => lists.get(selector) ?? [],
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type, event = {}) { listeners.get(type)?.(event); },
  };
}

test('Magnet defaults on and synchronizes aria-pressed in both panes', t => {
  const { usd, eur } = fixture(t);
  const a = usd.root.querySelector('.magnet');
  const b = eur.root.querySelector('.magnet');
  assert.equal(a.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  a.emit('click');
  assert.equal(a.getAttribute('aria-pressed'), 'false');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  a.emit('click');
  assert.equal(a.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  b.emit('click');
  assert.equal(a.getAttribute('aria-pressed'), 'false');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  b.emit('click');
});

test('each pane wires Rect and its own swatches without changing Trend swatches', t => {
  const f = fixture(t);
  const previous = globalThis.klinecharts;
  t.after(() => { globalThis.klinecharts = previous; });
  globalThis.klinecharts = { registerOverlay() {}, registerHotkey() {} };
  for (const pane of [f.usd, f.eur]) {
    const rect = pane.root.querySelectorAll('[data-draw]')[0];
    rect.emit('click');
    assert.equal(pane.drawings[0].kind, 'rect');
    const swatches = pane.root.querySelectorAll('[data-rect-colour]');
    const trends = pane.root.querySelectorAll('[data-trend-colour]');
    const trendState = trends.map(button => button.getAttribute('aria-pressed'));
    const created = [];
    pane.chart.instance.createOverlay = request => { created.push(request); return 'r'; };
    for (const [i, color] of ['#ffffff', '#26a69a', '#d4af37'].entries()) {
      swatches[i].emit('click');
      assert.deepEqual(swatches.map(button => button.getAttribute('aria-pressed')),
        swatches.map((_, j) => String(i === j)));
      startDrawing(pane.chart, 'rect');
      assert.equal(created.at(-1).styles.rect.borderColor, color);
    }
    assert.deepEqual(trends.map(button => button.getAttribute('aria-pressed')), trendState);
  }
});

test('shared toolbar template and label dialog contain the rectangle and editing controls', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-draw="rect"[^>]*>Rect<\/button>/);
  for (const id of ['white', 'green', 'gold']) assert.ok(html.includes(`data-rect-colour="${id}"`));
  assert.match(html, /<dialog id="drawing-label-dialog"/);
  assert.match(html, /<input[^>]*maxlength="40"/);
  for (const id of ['drawing-label-cancel', 'drawing-label-clear']) assert.ok(html.includes(`id="${id}"`));
});

function fixture(t) {
  const previous = { document: globalThis.document, window: globalThis.window,
    cancelAnimationFrame: globalThis.cancelAnimationFrame };
  t.after(() => Object.assign(globalThis, previous));
  globalThis.document = node();
  globalThis.document.createElement = () => node();
  globalThis.window = node();
  globalThis.cancelAnimationFrame = () => {};
  function pane() {
    const actions = [];
    const listeners = new Map();
    const bars = [{ timestamp: 60000, close: 10 }, { timestamp: 120000, close: 20 }];
    const instance = {
      setStyles() {}, resize() {},
      getDataList: () => bars,
      getVisibleRange: () => ({ from: 0, to: 2 }),
      convertFromPixel: () => [{ timestamp: 60000 }],
      convertToPixel: () => ({ x: 10, y: 20 }),
      executeAction(type, data) { actions.push({ type, data }); },
      subscribeAction(type, callback) { listeners.set(type, callback); },
    };
    const root = node();
    for (const [selector, field, ids] of [
      ['[data-rect-colour]', 'rectColour', ['white', 'green', 'gold']],
      ['[data-trend-colour]', 'trendColour', ['white', 'yellow', 'blue']],
      ['[data-draw]', 'draw', ['rect']],
    ]) {
      root.lists.set(selector, ids.map(id => Object.assign(node(), { dataset: { [field]: id } })));
    }
    const drawings = [];
    root.querySelector('.timeframe').value = '1h';
    const replay = { time: 120000, tf: '1h', setTimeframe(value) { this.tf = value; } };
    const refreshes = [];
    const moves = [];
    const windows = [];
    let space = 6;
    let limits = { min: 1, max: 50 };
    let leftMin = 2;
    let rightMin = 2;
    instance.setLeftMinVisibleBarCount = value => { leftMin = Math.ceil(value); };
    instance.setRightMinVisibleBarCount = value => { rightMin = Math.ceil(value); };
    instance.getSize = () => ({ width: 600, height: 300 });
    instance.getBarSpace = () => ({ bar: space, halfBar: space / 2, gapBar: 0, halfGapBar: 0 });
    instance.getLayoutOptions = () => ({ barSpaceLimit: { ...limits } });
    instance.setLayoutOptions = value => { limits = { ...value.barSpaceLimit }; };
    instance.setBarSpace = value => {
      if (value < limits.min || value > limits.max) return;
      space = value;
      listeners.get('onZoom')?.();
    };
    instance.scrollToDataIndex = (index, duration) => {
      moves.push({ index, duration });
      // v10's endpoint scroll limits and exclusive range rounding.
      const length = instance.getDataList().length;
      const visible = instance.getSize().width / space;
      const offset = Math.max(-length + Math.min(rightMin, length),
        Math.min(visible - Math.min(leftMin, length), index - length + 1));
      const to = Math.min(length, Math.round(offset + length + 0.5));
      windows.push({ from: Math.max(0, Math.round(to - visible) - 1), to });
      listeners.get('onScroll')?.();
    };
    return { root, chart: { instance, refresh() { refreshes.push(replay.tf); }, push() {} },
      indicators: { update() {} }, actions, listeners, refreshes, moves, windows,
      store: { symbol: 'XAU', t: [60000, 120000], length: 2 },
      replay, gaps: [], drawings,
      drawing: { startDrawing: (kind, options) => drawings.push({ kind, options }) } };
  }
  const usd = pane();
  const eur = pane();
  const settings = { ...structuredClone(DEFAULT_SETTINGS), syncCrosshair: true };
  const master = { time: 120000, stepM1: () => true };
  const controls = attachControls({ usd, eur, master, settings, save(candidate) {
    Object.assign(settings, candidate);
    controls.settingsChanged();
  } });
  eur.replay.seekToTime = time => { eur.replay.time = time; };
  return { usd, eur, settings, controls, master };
}

function changeTimeframe(pane, value) {
  const select = pane.root.querySelector('.timeframe');
  select.value = value;
  select.emit('change', { target: select });
}

test('Session H/L checkbox saves both states and follows settings changes', t => {
  const f = fixture(t);
  const input = document.querySelector('#session-levels');
  assert.equal(input.checked, false);
  for (const checked of [true, false]) {
    input.checked = checked;
    input.emit('change');
    assert.equal(f.settings.sessionLevels, checked);
  }
  f.settings.sessionLevels = true;
  f.controls.settingsChanged();
  assert.equal(input.checked, true);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<label><input id="session-levels" type="checkbox" disabled> Session H\/L<\/label>/);
});

test('Gap warnings checkbox saves both states and follows settings changes', t => {
  const f = fixture(t);
  const input = document.querySelector('#gap-warnings');
  assert.equal(f.settings.gapWarnings, true);
  for (const checked of [false, true]) {
    input.checked = checked;
    input.emit('change');
    assert.equal(f.settings.gapWarnings, checked);
  }
  f.settings.gapWarnings = false;
  f.controls.settingsChanged();
  assert.equal(input.checked, false);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<label><input id="gap-warnings" type="checkbox" checked> Gap warnings<\/label>/);
});

test('timeframe sync changes both selects, replays and refreshes through the manual path', t => {
  const f = fixture(t);
  assert.equal(document.querySelector('#sync-timeframe').checked, true);
  changeTimeframe(f.eur, '5m');
  for (const pane of [f.usd, f.eur]) {
    assert.equal(pane.root.querySelector('.timeframe').value, '5m');
    assert.equal(pane.replay.tf, '5m');
    assert.deepEqual(pane.refreshes, ['5m']);
  }
});

test('independent timeframes reconcile to the last manually changed pane on re-enable', t => {
  const f = fixture(t);
  const input = document.querySelector('#sync-timeframe');
  input.checked = false;
  input.emit('change');
  changeTimeframe(f.usd, '15m');
  changeTimeframe(f.eur, '4h');
  assert.equal(f.usd.replay.tf, '15m');
  assert.equal(f.eur.replay.tf, '4h');
  input.checked = true;
  input.emit('change');
  assert.equal(f.usd.replay.tf, '4h');
  assert.deepEqual(f.usd.refreshes, ['15m', '4h']);
  assert.deepEqual(f.eur.refreshes, ['4h']);
  assert.equal(f.settings.syncTimeframe, true);
});

test('scroll and zoom map the time window, fit target width, and suppress feedback', t => {
  const f = fixture(t);
  assert.equal(document.querySelector('#sync-scroll').checked, true);
  f.usd.chart.instance.getDataList = () => [{ timestamp: 300000 }, { timestamp: 600000 }];
  f.eur.chart.instance.getDataList = () => Array.from({ length: 11 }, (_, i) => ({ timestamp: i * 60000 }));
  f.eur.chart.instance.getVisibleRange = () => ({ from: 0, to: 11, realFrom: 0, realTo: 11 });
  for (const action of ['onScroll', 'onZoom']) {
    f.usd.listeners.get(action)?.();
    assert.equal(f.eur.chart.instance.getBarSpace().bar, 120);
    assert.deepEqual(f.eur.moves.at(-1), { index: 9.5, duration: 0 });
  }
  assert.equal(f.eur.moves.length, 2);
  assert.equal(f.usd.moves.length, 0, 'target actions must not bounce back');
  document.querySelector('#sync-scroll').checked = false;
  document.querySelector('#sync-scroll').emit('change');
  f.usd.listeners.get('onScroll')?.();
  assert.equal(f.eur.moves.length, 2);
  assert.equal(f.settings.syncScroll, false);
});

test('data range changes and replay push scroll/zoom actions do not synchronize', t => {
  const f = fixture(t);
  f.usd.listeners.get('onVisibleRangeChange')();
  f.usd.chart.push = () => {
    f.usd.listeners.get('onScroll')?.();
    f.usd.listeners.get('onZoom')?.();
  };
  f.controls.stepM1();
  assert.deepEqual(f.eur.moves, []);
  f.usd.listeners.get('onScroll')?.();
  assert.equal(f.eur.moves.length, 1, 'suppression must end after the replay update');
});

test('scroll sync tolerates empty panes', t => {
  const f = fixture(t);
  f.eur.chart.instance.getDataList = () => [];
  f.usd.listeners.get('onScroll')?.();
  assert.deepEqual(f.eur.moves, []);
});

for (const [name, timestamps] of [
  ['before', [0, 30000]], ['after', [180000, 240000]],
  ['overlapping the start of', [0, 90000]], ['overlapping the end of', [90000, 180000]],
]) {
  test(`scroll sync preserves the target view when the source is ${name} loaded history`, t => {
    const f = fixture(t);
    f.usd.chart.instance.getDataList = () => timestamps.map(timestamp => ({ timestamp }));
    const space = f.eur.chart.instance.getBarSpace();
    const layout = f.eur.chart.instance.getLayoutOptions();
    for (const action of ['onScroll', 'onZoom']) f.usd.listeners.get(action)();
    assert.deepEqual(f.eur.moves, []);
    assert.deepEqual(f.eur.windows, []);
    assert.deepEqual(f.eur.chart.instance.getBarSpace(), space);
    assert.deepEqual(f.eur.chart.instance.getLayoutOptions(), layout);
  });
}

test('scroll sync fits subpixel spacing and handles a hidden chart without moving it', t => {
  const f = fixture(t);
  f.eur.chart.instance.getDataList = () => Array.from({ length: 1001 }, (_, i) => ({ timestamp: i * 120 }));
  f.usd.chart.instance.getDataList = () => [{ timestamp: 0 }, { timestamp: 120000 }];
  f.usd.listeners.get('onZoom')?.();
  assert.equal(f.eur.chart.instance.getBarSpace().bar, 0.6);
  f.eur.chart.instance.getSize = () => ({ width: 0, height: 300 });
  f.usd.listeners.get('onScroll')?.();
  assert.equal(f.eur.moves.length, 1);
});

test('refresh-generated actions do not sync scroll and the timeframe guard prevents recursion', t => {
  const f = fixture(t);
  f.usd.chart.refresh = () => {
    f.usd.listeners.get('onScroll')?.();
    changeTimeframe(f.eur, '5m');
  };
  changeTimeframe(f.usd, '15m');
  assert.deepEqual(f.eur.moves, []);
  assert.equal(f.usd.replay.tf, '15m');
  assert.equal(f.eur.replay.tf, '15m');
});

test('a single target candle uses less than one bar interval so its predecessor stays outside', t => {
  const f = fixture(t);
  f.eur.chart.instance.getDataList = () => [{ timestamp: 0 }, { timestamp: 300000 }];
  f.usd.listeners.get('onScroll')?.();
  assert.equal(f.eur.chart.instance.getBarSpace().bar, 1200);
  assert.deepEqual(f.eur.moves, [{ index: -0.5, duration: 0 }]);
  assert.deepEqual(f.eur.windows, [{ from: 0, to: 1 }]);
  f.usd.chart.instance.getDataList = () => [{ timestamp: 300000 }];
  f.usd.chart.instance.getVisibleRange = () => ({ from: 0, to: 1, realFrom: 0, realTo: 1 });
  f.usd.listeners.get('onScroll')();
  assert.deepEqual(f.eur.windows.at(-1), { from: 1, to: 2 });
});

test('re-enabling timeframe sync guards refresh-generated timeframe events', t => {
  const f = fixture(t);
  const input = document.querySelector('#sync-timeframe');
  input.checked = false;
  input.emit('change');
  changeTimeframe(f.eur, '4h');
  f.usd.chart.refresh = () => changeTimeframe(f.eur, '5m');
  input.checked = true;
  input.emit('change');
  assert.equal(f.usd.replay.tf, '4h');
  assert.equal(f.eur.replay.tf, '4h');
});

for (const trigger of ['sync off', 'pointer leave']) {
  test(`mirrored crosshair state is cleared on ${trigger}`, t => {
    const f = fixture(t);
    f.usd.listeners.get('onCrosshairChange')({ x: 5, y: 10, paneId: 'candle_pane' });
    assert.deepEqual(f.eur.actions, [
      { type: 'onCrosshairChange', data: { x: 10, y: 20, paneId: 'candle_pane' } },
    ]);
    if (trigger === 'sync off') {
      f.settings.syncCrosshair = false;
      f.controls.settingsChanged();
    } else f.usd.root.querySelector('.chart').emit('pointerleave');
    assert.deepEqual(f.eur.actions.at(-1), { type: 'onCrosshairChange', data: {} });
    assert.equal(f.eur.actions.length, 2);
    assert.deepEqual(f.usd.actions, [], 'clearing targets the mirrored chart');
  });
}
