import test from 'node:test';
import assert from 'node:assert/strict';
import { startDrawing, clearDrawings, setTrendColour, setMagnet, isMagnetEnabled } from '../src/ui/drawing.js';
import * as drawing from '../src/ui/drawing.js';
import { dialogFixture } from './helpers/drawing-dialog.js';

// Capture our library-boundary payloads; no DOM, mouse, or library rendering is simulated.
function fixture() {
  const templates = new Map();
  const hotkeys = [];
  const created = [];
  const removed = [];
  const overridden = [];
  globalThis.klinecharts = {
    registerOverlay: template => templates.set(template.name, template),
    registerHotkey: hotkey => hotkeys.push(hotkey),
  };
  const instance = {
    createOverlay(value) { created.push(value); return `drawing-${created.length}`; },
    removeOverlay(filter) { removed.push(filter); return true; },
    overrideOverlay(value) { overridden.push(value); return true; },
    convertToPixel(point) { return { x: point.dataIndex ?? point.timestamp, y: point.value * 10 }; },
  };
  return { chart: { instance }, templates, hotkeys, created, removed, overridden };
}

test('rectangle shows six keyed colour handles on hover or selection for either diagonal', () => {
  const f = fixture();
  startDrawing(f.chart, 'rect');
  const request = f.created[0];
  const template = f.templates.get(request.name);
  const overlay = { ...request, id: 'handles', styles: { rect: { borderColor: '#d4af37' } } };
  const event = { chart: f.chart.instance, overlay };
  const render = coordinates => template.createPointFigures({ coordinates, overlay });
  const coords = [{ x: 10, y: 20 }, { x: 110, y: 80 }];
  assert.equal(render(coords).length, 1);
  request.onMouseEnter(event);
  assert.deepEqual(f.overridden.at(-1), { id: 'handles' }, 'hover must request redraw');
  for (const coordinates of [coords, [...coords].reverse(),
    [{ x: 10, y: 80 }, { x: 110, y: 20 }], [{ x: 110, y: 20 }, { x: 10, y: 80 }]]) {
    const handles = render(coordinates).filter(figure => figure.key?.startsWith('rect_handle_'));
    const nativeTLBR = coordinates[0].x < coordinates[1].x === (coordinates[0].y < coordinates[1].y);
    const corners = nativeTLBR ? [['tr', 110, 20], ['bl', 10, 80]] : [['tl', 10, 20], ['br', 110, 80]];
    assert.deepEqual(handles.map(h => [h.key, h.attrs.x, h.attrs.y]),
      [...corners, ['t', 60, 20], ['b', 60, 80], ['l', 10, 50], ['r', 110, 50]]
        .map(([id, x, y]) => [`rect_handle_${id}`, x, y]));
    assert.ok(handles.every(h => h.type === 'circle' && h.attrs.r === 4 &&
      h.styles.color === '#d4af37' && h.ignoreEvent !== true));
  }
  request.onMouseLeave(event);
  assert.equal(render(coords).length, 1);
  request.onSelected(event);
  request.onMouseEnter(event);
  request.onMouseLeave(event);
  assert.equal(render(coords).length, 7, 'selected handles persist after mouse leaves');
  request.onDeselected(event);
  assert.equal(render(coords).length, 1);
  request.onMouseEnter(event);
  request.onRemoved(event);
  assert.equal(render(coords).length, 1);
});

for (const [handle, expected] of [
  ['tr', [{ timestamp: 10, dataIndex: 1, value: 40 }, { timestamp: 5, dataIndex: 0, value: 10 }]],
  ['bl', [{ timestamp: 5, dataIndex: 0, value: 20 }, { timestamp: 30, dataIndex: 3, value: 40 }]],
  ['t', [{ timestamp: 10, dataIndex: 1, value: 40 }, { timestamp: 30, dataIndex: 3, value: 10 }]],
  ['b', [{ timestamp: 10, dataIndex: 1, value: 20 }, { timestamp: 30, dataIndex: 3, value: 40 }]],
  ['l', [{ timestamp: 5, dataIndex: 0, value: 20 }, { timestamp: 30, dataIndex: 3, value: 10 }]],
  ['r', [{ timestamp: 10, dataIndex: 1, value: 20 }, { timestamp: 5, dataIndex: 0, value: 10 }]],
]) {
  test(`rectangle ${handle} callback replaces native body movement using raw pane mouse and drag-start points`, () => {
    const f = fixture();
    startDrawing(f.chart, 'rect');
    const request = f.created[0];
    const original = [{ timestamp: 10, dataIndex: 1, value: 20 }, { timestamp: 30, dataIndex: 3, value: 10 }];
    const overlay = { ...request, id: handle, points: structuredClone(original), extendData: { text: 'label' } };
    const override = f.chart.instance.overrideOverlay;
    f.chart.instance.overrideOverlay = update => {
      override(update);
      if (update.points) overlay.points = structuredClone(update.points);
      return true;
    };
    const figure = { key: `rect_handle_${handle}`, type: 'circle' };
    const event = { chart: f.chart.instance, overlay, figure, x: 50, y: 60 };
    f.chart.instance.convertFromPixel = (coords, filter) => {
      assert.deepEqual(coords, [{ x: 50, y: 60 }]);
      assert.deepEqual(filter, { paneId: 'candle_pane' });
      return [{ timestamp: 5, dataIndex: 0, value: 40 }];
    };
    request.onPressedMoveStart(event);
    for (let i = 0; i < 2; i++) {
      // The library translates all points BEFORE invoking onPressedMoving.
      overlay.points = original.map(p => ({ timestamp: p.timestamp + 99, dataIndex: p.dataIndex + 99, value: p.value + 99 }));
      request.onPressedMoving(event);
      assert.deepEqual(overlay.points, expected, 'successive events must not drift or swap sides after crossing');
      assert.deepEqual(f.overridden.at(-1), { id: handle, points: expected });
      assert.deepEqual(overlay.extendData, { text: 'label' });
    }
    request.onPressedMoveEnd(event);
    const count = f.overridden.length;
    request.onPressedMoving(event);
    assert.equal(f.overridden.length, count, 'end releases drag state');
    for (const bodyFigure of [undefined, { type: 'rect' }]) {
      request.onPressedMoveStart({ ...event, figure: bodyFigure });
      request.onPressedMoving({ ...event, figure: bodyFigure });
      assert.equal(f.overridden.length, count, 'native corners and body keep library movement');
    }
    request.onPressedMoveStart(event);
    request.onRemoved(event);
    request.onPressedMoving(event);
    assert.equal(f.overridden.length, count, 'removal releases drag state');
  });
}

test('rectangle has two native corner handles, body figure and independent selected colours', () => {
  const f = fixture();
  startDrawing(f.chart, 'rect');
  const request = f.created[0];
  assert.equal(request.name, 'replay_rect');
  assert.equal(request.mode, 'weak_magnet');
  assert.equal(request.modeSensitivity, 20);
  assert.equal(request.lock, false);
  const template = f.templates.get(request.name);
  assert.equal(template.totalStep, 3);
  assert.equal(template.needDefaultPointFigure, true);
  assert.equal(request.styles.rect.borderColor, '#ffffff');
  assert.equal(request.styles.rect.color, '#ffffff26');
  assert.equal(request.styles.rect.style, 'stroke_fill');
  for (const coordinates of [
    [{ x: 10, y: 20 }, { x: 110, y: 80 }],
    [{ x: 110, y: 80 }, { x: 10, y: 20 }],
  ]) {
    const result = template.createPointFigures({ coordinates, overlay: request });
    assert.equal(result[0].type, 'rect');
    assert.deepEqual(result[0].attrs, { x: 10, y: 20, width: 100, height: 60 });
    assert.notEqual(result[0].ignoreEvent, true, 'body must retain native drag events');
  }
  assert.deepEqual(template.createPointFigures({ coordinates: [], overlay: request }), []);
  request.onSelected({ chart: f.chart.instance, overlay: { ...request, id: 'r' } });
  drawing.setRectColour(f.chart, 'gold');
  assert.equal(f.overridden.at(-1).id, 'r');
  assert.equal(f.overridden.at(-1).styles.rect.borderColor, '#d4af37');
  assert.equal(f.overridden.at(-1).styles.rect.color, '#d4af3726');
  const other = fixture();
  drawing.setRectColour(other.chart, 'green');
  assert.deepEqual(other.overridden, []);
  startDrawing(f.chart, 'rect');
  assert.equal(f.created.at(-1).styles.rect.borderColor, '#d4af37');
  startDrawing(f.chart, 'trend');
  const trend = f.created.at(-1);
  assert.equal(trend.styles.line.color, '#ffffff');
  trend.onSelected({ chart: f.chart.instance, overlay: { ...trend, id: 't' } });
  const before = f.overridden.length;
  drawing.setRectColour(f.chart, 'white');
  assert.equal(f.overridden.length, before);
  setMagnet(false);
  assert.equal(f.overridden.at(-1).mode, 'normal');
  startDrawing(f.chart, 'rect');
  assert.equal(f.created.at(-1).mode, 'normal');
  setMagnet(true);
});

for (const kind of ['trend', 'rect']) {
  test(`${kind} labels render at the midpoint/top and follow drawing colour`, () => {
    const f = fixture();
    startDrawing(f.chart, kind);
    const request = f.created[0];
    const template = f.templates.get(request.name);
    const coordinates = [{ x: 110, y: 80 }, { x: 10, y: 20 }];
    const overlay = { ...request, extendData: { text: 'CISD' },
      styles: kind === 'trend' ? { line: { color: '#2962ff' } }
        : { rect: { borderColor: '#d4af37' } } };
    const result = template.createPointFigures({ coordinates, overlay });
    const text = result.find(figure => figure.type === 'text');
    assert.equal(text.attrs.text, 'CISD');
    assert.equal(text.attrs.x, 60);
    assert.equal(text.attrs.y, kind === 'trend' ? 46 : 24);
    assert.equal(text.attrs.align, 'center');
    assert.equal(text.attrs.baseline, kind === 'trend' ? 'bottom' : 'top');
    assert.equal(text.styles.color, kind === 'trend' ? '#2962ff' : '#d4af37');
    for (const extendData of [undefined, { text: null }, { text: '' }]) {
      assert.equal(template.createPointFigures({ coordinates,
        overlay: { ...overlay, extendData } }).filter(figure => figure.type === 'text').length, 0);
    }
  });

  test(`${kind} selected double-click edits extendData and input hotkeys preserve drawing`, t => {
    const previous = { document: globalThis.document, window: globalThis.window };
    t.after(() => Object.assign(globalThis, previous));
    const editor = dialogFixture();
    globalThis.document = {
      addEventListener() {},
      querySelector(selector) {
        if (selector === '#drawing-label-dialog') return editor.dialog;
        if (selector === 'dialog[open]') return editor.dialog.open ? editor.dialog : null;
        throw new Error(selector);
      },
    };
    globalThis.window = { addEventListener() {} };
    const f = fixture();
    startDrawing(f.chart, kind);
    const request = f.created[0];
    const overlay = { ...request, id: 'labelled', extendData: { text: 'old' } };
    const event = { chart: f.chart.instance, overlay };
    assert.equal(typeof request.onDoubleClick, 'function');
    request.onDoubleClick(event);
    assert.equal(editor.dialog.open, false, 'unselected drawings do not open editor');
    request.onSelected(event);
    request.onDoubleClick(event);
    assert.equal(editor.dialog.open, true);
    assert.equal(editor.input.value, 'old');
    editor.input.value = '  CISD  ';
    for (const hotkey of f.hotkeys) {
      for (const target of [null, { closest: selector => selector.startsWith('input') ? editor.input : null }]) {
        const params = { chart: f.chart.instance, event: { target } };
        assert.equal(hotkey.check(params), false);
        if (hotkey.check(params)) hotkey.action(params);
      }
    }
    assert.deepEqual(f.removed, []);
    editor.submit();
    assert.deepEqual(f.overridden.at(-1), { id: 'labelled', extendData: { text: 'CISD' } });
    assert.equal(editor.dialog.open, false);
    const params = { chart: f.chart.instance, event: { target: null } };
    assert.equal(f.hotkeys[0].check(params), true, 'selection survives editing');
    f.hotkeys[0].action(params);
    assert.deepEqual(f.removed, [{ id: 'labelled' }]);
    for (const other of ['fib', 'long', 'short']) {
      startDrawing(f.chart, other);
      assert.equal(f.created.at(-1).onDoubleClick, undefined);
    }
  });
}

function figures(f, kind = 'long', values = [4070.59, 4050.726, 4110.928], xs = [480, 490, 495], width = 500) {
  startDrawing(f.chart, kind);
  const template = f.templates.get(f.created.at(-1).name);
  const points = values.map((value, i) => ({ timestamp: 1000 + i * 60000, value }));
  const coordinates = values.map((value, i) => ({ x: xs[i], y: 160 - (value - values[0]) }));
  return { template, points, coordinates, result: template.createPointFigures({
    overlay: { points }, coordinates, bounding: { width, height: 320 },
  }) };
}

test('drawing requests use the candle pane, custom overlays and an isolated clear group', () => {
  const f = fixture();
  for (const kind of ['trend', 'fib', 'long', 'short', 'rect']) startDrawing(f.chart, kind);
  assert.equal(f.created[0].name, 'replay_trend');
  assert.equal(f.created[1].name, 'replay_fib');
  assert.notEqual(f.created[2].name, f.created[3].name);
  for (const request of f.created) {
    assert.equal(request.paneId, 'candle_pane');
    assert.equal(request.lock, false);
    assert.equal(request.groupId, f.created[0].groupId);
    assert.equal(request.points, undefined, 'drawing must accept mouse-placed time/price points');
  }
  clearDrawings(f.chart);
  assert.deepEqual(f.removed, [{ groupId: f.created[0].groupId }]);
  assert.equal(f.templates.size, 5);
  assert.deepEqual(f.hotkeys.map(({ name, keys }) => ({ name, keys })), [
    { name: 'replay_delete_drawing', keys: 'Delete' },
    { name: 'replay_delete_drawing_backspace', keys: 'Backspace' },
  ]);
  assert.throws(() => startDrawing(f.chart, 'other'), /kind/i);
});

test('colour choices apply to new trends and only recolour the selected trend in that pane', () => {
  const f = fixture();
  startDrawing(f.chart, 'trend');
  assert.equal(f.created[0].styles.line.color, '#ffffff');
  f.created[0].onSelected({ chart: f.chart.instance, overlay: { id: 't', name: 'replay_trend' } });
  setTrendColour(f.chart, 'yellow');
  assert.deepEqual(f.overridden, [{ id: 't', styles: { line: { color: '#f5c518' } } }]);
  const other = fixture();
  setTrendColour(other.chart, 'blue');
  assert.deepEqual(other.overridden, []);
  startDrawing(f.chart, 'trend');
  assert.equal(f.created.at(-1).styles.line.color, '#f5c518');
  startDrawing(f.chart, 'fib');
  f.created.at(-1).onSelected({ chart: f.chart.instance, overlay: { id: 'f', name: 'replay_fib' } });
  setTrendColour(f.chart, 'white');
  assert.equal(f.overridden.length, 1);
});

test('magnet defaults on and toggles existing drawing groups and all new drawing kinds', () => {
  const f = fixture();
  assert.equal(isMagnetEnabled(), true);
  for (const kind of ['trend', 'fib', 'long', 'short']) startDrawing(f.chart, kind);
  for (const request of f.created) {
    assert.equal(request.mode, 'weak_magnet');
    assert.equal(request.modeSensitivity, 20);
  }
  const other = fixture();
  startDrawing(other.chart, 'trend');
  setMagnet(false);
  const expected = { groupId: 'replay_drawings', mode: 'normal', modeSensitivity: 20 };
  assert.deepEqual(f.overridden.at(-1), expected);
  assert.deepEqual(other.overridden.at(-1), expected);
  for (const kind of ['trend', 'fib', 'long', 'short']) startDrawing(f.chart, kind);
  assert.ok(f.created.slice(4).every(request => request.mode === 'normal'));
  setMagnet(true);
  assert.equal(f.overridden.at(-1).mode, 'weak_magnet');
});

test('Fib drawings copy preset levels and render percent/price with zero at the second point', () => {
  const f = fixture();
  const levels = [0, 0.5, 1, 2];
  startDrawing(f.chart, 'fib', { levels });
  levels[0] = -1;
  const request = f.created[0];
  assert.deepEqual(request.extendData.levels, [0, 0.5, 1, 2]);
  const template = f.templates.get(request.name);
  const params = { chart: { getSymbol: () => ({ pricePrecision: 2 }),
    getDecimalFold: () => ({ format: value => value }), getThousandsSeparator: () => ({ format: value => value }) },
    overlay: { ...request, points: [{ value: 200 }, { value: 100 }] },
    coordinates: [{ x: 10, y: 20 }, { x: 30, y: 120 }], bounding: { width: 400 } };
  const result = template.createPointFigures(params);
  assert.equal(result[1].ignoreEvent, true, 'level labels must not intercept line/point interaction');
  assert.equal(template.totalStep, 3);
  assert.deepEqual(result[0].attrs.map(line => line.coordinates[0].y), [120, 70, 20, -80]);
  assert.deepEqual(result[1].attrs.map(text => text.text), ['100.00 (0.0%)', '150.00 (50.0%)',
    '200.00 (100.0%)', '300.00 (200.0%)']);
  assert.deepEqual(template.createPointFigures({ ...params, coordinates: [] }), []);
});

test('Shift hooks snap either endpoint using its own chart pixels and clear on release/blur', t => {
  const previous = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, previous));
  const keys = new Map();
  const windowEvents = new Map();
  globalThis.document = { addEventListener: (name, callback) => keys.set(name, callback) };
  globalThis.window = { addEventListener: (name, callback) => windowEvents.set(name, callback) };
  const f = fixture();
  startDrawing(f.chart, 'trend');
  const request = f.created[0];
  const template = f.templates.get(request.name);
  const overlay = { ...request };
  request.onDrawStart({ chart: f.chart.instance, overlay });
  // Another chart becomes active: original overlay must still use its own chart.
  const other = fixture();
  other.chart.instance.convertToPixel = () => ({ x: 0, y: 0 });
  startDrawing(other.chart, 'trend');
  keys.get('keydown')({ key: 'Shift' });
  for (const index of [0, 1]) {
    for (const [moving, want] of [
      [{ timestamp: 100, dataIndex: 100, value: 11 }, { timestamp: 100, dataIndex: 100, value: 10 }],
      [{ timestamp: 2, dataIndex: 2, value: 30 }, { timestamp: 1, dataIndex: 1, value: 30 }],
    ]) {
      const anchor = { timestamp: 1, dataIndex: 1, value: 10 };
      const points = index === 1 ? [anchor, { ...moving }] : [{ ...moving }, anchor];
      template.performEventPressedMove.call(overlay, { points, performPointIndex: index, performPoint: points[index] });
      assert.deepEqual(points[index], want);
      assert.deepEqual(points[1 - index], anchor);
    }
  }
  const points = [{ timestamp: 1, value: 10 }, { timestamp: 100, value: 11 }];
  template.performEventMoveForDrawing.call(overlay, { currentStep: 2, points, performPointIndex: 1, performPoint: points[1] });
  assert.equal(points[1].value, 10);
  for (const clear of [() => keys.get('keyup')({ key: 'Shift' }), () => windowEvents.get('blur')()]) {
    clear();
    points[1].value = 11;
    template.performEventPressedMove.call(overlay, { points, performPointIndex: 1, performPoint: points[1] });
    assert.equal(points[1].value, 11);
    keys.get('keydown')({ key: 'Shift' });
  }
  windowEvents.get('blur')();
});

test('Shift already held before choosing Trend is tracked from module load', async t => {
  const previous = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, previous));
  const keys = new Map();
  globalThis.document = { addEventListener: (name, callback) => keys.set(name, callback) };
  globalThis.window = { addEventListener() {} };
  const drawing = await import('../src/ui/drawing.js?held-shift');
  assert.equal(typeof keys.get('keydown'), 'function');
  keys.get('keydown')({ key: 'Shift' });
  const f = fixture();
  drawing.startDrawing(f.chart, 'trend');
  const overlay = { ...f.created[0] };
  overlay.onDrawStart({ chart: f.chart.instance, overlay });
  const points = [{ timestamp: 0, value: 5 }, { timestamp: 100, value: 6 }];
  f.templates.get(overlay.name).performEventMoveForDrawing.call(overlay,
    { currentStep: 2, points, performPointIndex: 1, performPoint: points[1] });
  assert.equal(points[1].value, 5);
  keys.get('keyup')({ key: 'Shift' });
});

test('RR figures use unrounded stats and include prices, zones and an entry line', () => {
  const f = fixture();
  const { result, coordinates, template } = figures(f);
  assert.equal(template.totalStep, 4);
  assert.equal(template.needDefaultPointFigure, true);
  const labels = result.filter(figure => figure.type === 'text').map(figure => figure.attrs.text);
  assert.deepEqual(labels, [
    'Target: 40.338 (0.991%) 4110.928',
    'Stop: 19.864 (0.488%) 4050.726',
    'Risk/reward ratio: 2.03',
  ]);
  const zones = result.filter(figure => figure.type === 'rect');
  assert.equal(zones.length, 2);
  assert.equal(zones[0].attrs.y, coordinates[2].y);
  assert.equal(zones[1].attrs.y, coordinates[0].y);
  const entry = result.find(figure => figure.type === 'line');
  assert.ok(entry.attrs.coordinates.every(point => point.y === coordinates[0].y));
});

test('short zones mirror long and invalid drags replace numbers with an error', () => {
  const f = fixture();
  const { result, coordinates, template } = figures(f, 'short', [4000, 4010, 3970]);
  const zones = result.filter(figure => figure.type === 'rect');
  assert.equal(zones[0].attrs.y, coordinates[0].y);
  assert.equal(zones[1].attrs.y, coordinates[1].y);
  assert.equal(result.filter(figure => figure.type === 'text')[2].attrs.text, 'Risk/reward ratio: 3.00');
  for (const values of [[4000, 3990, 3970], [4000, 4000, 3970], [4000, 4010, 4030], [4000, NaN, 3970]]) {
    const invalid = template.createPointFigures({
      overlay: { points: values.map(value => ({ value })) },
      coordinates, bounding: { width: 500, height: 320 },
    });
    const labels = invalid.filter(figure => figure.type === 'text');
    assert.equal(labels.length, 1);
    assert.match(labels[0].attrs.text, /.+/);
    assert.doesNotMatch(labels[0].attrs.text, /Risk\/reward ratio:|Target:|Stop:|NaN|Infinity/);
  }
  assert.deepEqual(template.createPointFigures({ coordinates: [], overlay: { points: [] },
    bounding: { width: 500, height: 320 } }), []);
});

test('RR labels stay inside both pane edges and narrow panes', () => {
  const f = fixture();
  for (const [xs, width] of [[[480, 490, 495], 500], [[-20, -10, 0], 500], [[70, 90, 100], 110]]) {
    const { result } = figures(f, 'long', [4000, 3990, 4030], xs, width);
    for (const { attrs } of result.filter(figure => figure.type === 'text')) {
      const left = attrs.align === 'right' ? attrs.x - attrs.width : attrs.x;
      assert.ok(left >= 0);
      assert.ok(left + attrs.width <= width);
      assert.ok(attrs.y >= 0 && attrs.y + attrs.height <= 320);
    }
  }
});

test('same-time RR points retain the reference spike visible zone width', () => {
  const f = fixture();
  const { result } = figures(f, 'long', [4000, 3990, 4030], [200, 200, 200]);
  for (const zone of result.filter(figure => figure.type === 'rect')) {
    assert.equal(zone.attrs.x, 200);
    assert.equal(zone.attrs.width, 160);
  }
  const entry = result.find(figure => figure.type === 'line');
  assert.deepEqual(entry.attrs.coordinates, [{ x: 200, y: 160 }, { x: 360, y: 160 }]);
});

test('Delete removes only the selected drawing and selection callbacks clear stale state', () => {
  const f = fixture();
  startDrawing(f.chart, 'trend');
  startDrawing(f.chart, 'fib');
  const [trend, fib] = f.created;
  const hotkey = f.hotkeys[0];
  assert.equal(hotkey.keys, 'Delete');
  const params = { chart: f.chart.instance, event: { target: null } };
  assert.equal(hotkey.check(params), false);
  trend.onSelected({ chart: f.chart.instance, overlay: { id: 'trend' } });
  fib.onSelected({ chart: f.chart.instance, overlay: { id: 'fib' } });
  trend.onDeselected({ chart: f.chart.instance, overlay: { id: 'trend' } });
  assert.equal(hotkey.check(params), true);
  assert.equal(hotkey.check({ ...params, event: { target: { closest: () => ({}) } } }), false);
  assert.equal(hotkey.check({ ...params, chart: {} }), false);
  hotkey.action(params);
  assert.deepEqual(f.removed, [{ id: 'fib' }]);
  assert.equal(hotkey.check(params), false);
  trend.onSelected({ chart: f.chart.instance, overlay: { id: 'trend' } });
  trend.onRemoved({ chart: f.chart.instance, overlay: { id: 'trend' } });
  assert.equal(hotkey.check(params), false);
  trend.onSelected({ chart: f.chart.instance, overlay: { id: 'trend' } });
  clearDrawings(f.chart);
  assert.equal(hotkey.check(params), false);
});

test('selection across two charts gives Delete only to the most recently selected drawing', () => {
  const usd = fixture();
  startDrawing(usd.chart, 'trend');
  const eur = fixture();
  startDrawing(eur.chart, 'fib');
  const usdEvent = { chart: usd.chart.instance, overlay: { id: 'usd' } };
  const eurEvent = { chart: eur.chart.instance, overlay: { id: 'eur' } };
  const params = f => ({ chart: f.chart.instance, event: { target: null } });
  usd.created[0].onSelected(usdEvent);
  eur.created[0].onSelected(eurEvent);
  assert.equal(usd.hotkeys[0].check(params(usd)), false);
  assert.equal(eur.hotkeys[0].check(params(eur)), true);
  // Each chart has a document key listener; exercise both listener orders.
  for (const order of [[usd, eur], [eur, usd]]) {
    usd.created[0].onSelected(usdEvent);
    eur.created[0].onSelected(eurEvent);
    usd.created[0].onDeselected(usdEvent);
    for (const f of order) {
      if (f.hotkeys[0].check(params(f))) f.hotkeys[0].action(params(f));
    }
  }
  assert.deepEqual(usd.removed, []);
  assert.deepEqual(eur.removed, [{ id: 'eur' }, { id: 'eur' }]);
  usd.created[0].onSelected(usdEvent);
  eur.created[0].onRemoved(eurEvent);
  assert.equal(usd.hotkeys[0].check(params(usd)), true);
  clearDrawings(usd.chart);
});

test('clicking a drawing still locally selected in another chart transfers Delete ownership back', () => {
  const usd = fixture();
  startDrawing(usd.chart, 'trend');
  const eur = fixture();
  startDrawing(eur.chart, 'fib');
  const usdEvent = { chart: usd.chart.instance, overlay: { id: 'usd' } };
  const eurEvent = { chart: eur.chart.instance, overlay: { id: 'eur' } };
  usd.created[0].onSelected(usdEvent);
  eur.created[0].onSelected(eurEvent);
  // klinecharts sends onClick but no new onSelected for its same local overlay.
  usd.created[0].onClick?.(usdEvent);
  const params = f => ({ chart: f.chart.instance, event: { target: null } });
  assert.equal(usd.hotkeys[0].check(params(usd)), true);
  assert.equal(eur.hotkeys[0].check(params(eur)), false);
  usd.hotkeys[0].action(params(usd));
  assert.deepEqual(usd.removed, [{ id: 'usd' }]);
  assert.deepEqual(eur.removed, []);
});

test('Backspace removes only the selected drawing across two charts and ignores editable targets', () => {
  const usd = fixture();
  startDrawing(usd.chart, 'trend');
  const eur = fixture();
  startDrawing(eur.chart, 'fib');
  const select = f => f.created[0].onSelected({ chart: f.chart.instance,
    overlay: { id: f === usd ? 'usd' : 'eur' } });
  const hotkey = f => f.hotkeys.find(key => key.name === 'replay_delete_drawing_backspace');
  assert.ok(hotkey(usd), 'Backspace must be registered');
  assert.equal(hotkey(usd).keys, 'Backspace');
  for (const order of [[usd, eur], [eur, usd]]) {
    select(usd);
    select(eur);
    const before = eur.removed.length;
    for (const tag of ['input', 'textarea', 'select', 'contenteditable']) {
      const target = { closest(selector) {
        assert.equal(selector, 'input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        return { tag };
      } };
      for (const f of order) {
        const params = { chart: f.chart.instance, event: { target } };
        assert.equal(hotkey(f).check(params), false);
        if (hotkey(f).check(params)) hotkey(f).action(params);
      }
    }
    assert.deepEqual(usd.removed, []);
    assert.equal(eur.removed.length, before);
    for (const f of order) {
      const params = { chart: f.chart.instance, event: { target: null } };
      if (hotkey(f).check(params)) hotkey(f).action(params);
    }
  }
  assert.deepEqual(usd.removed, []);
  assert.deepEqual(eur.removed, [{ id: 'eur' }, { id: 'eur' }]);
});

for (const scope of ['target', 'document']) {
  test(`Delete and Backspace preserve selection while an open dialog is found via ${scope}`, t => {
    const previous = { document: globalThis.document, window: globalThis.window };
    t.after(() => Object.assign(globalThis, previous));
    let open = true;
    const dialog = {};
    globalThis.document = {
      addEventListener() {},
      querySelector(selector) {
        assert.equal(selector, 'dialog[open]');
        return scope === 'document' && open ? dialog : null;
      },
    };
    globalThis.window = { addEventListener() {} };
    const f = fixture();
    startDrawing(f.chart, 'trend');
    const target = { closest(selector) {
      return scope === 'target' && open && selector === 'dialog[open]' ? dialog : null;
    } };
    const params = { chart: f.chart.instance, event: { target } };
    for (const key of ['Delete', 'Backspace']) {
      const hotkey = f.hotkeys.find(hotkey => hotkey.keys === key);
      f.created[0].onSelected({ chart: f.chart.instance, overlay: { id: key } });
      open = true;
      assert.equal(hotkey.check(params), false);
      if (hotkey.check(params)) hotkey.action(params);
      assert.equal(f.removed.length, key === 'Delete' ? 0 : 1);
      open = false;
      assert.equal(hotkey.check(params), true, 'closing the dialog preserves the selected drawing');
      hotkey.action(params);
    }
    assert.deepEqual(f.removed, [{ id: 'Delete' }, { id: 'Backspace' }]);
  });
}
