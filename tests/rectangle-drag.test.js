import test from 'node:test';
import assert from 'node:assert/strict';
import { startDrawing } from '../src/ui/drawing.js';

const previousWindow = globalThis.window;
globalThis.window = { navigator: { userAgent: 'node' } };
await import('../web-vendor/klinecharts.js');
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
const api = globalThis.klinecharts;
const clone = value => structuredClone(value);
const pixel = point => ({ x: point.dataIndex * 20, y: 500 - point.value * 10 });
const point = ({ x, y }) => ({ dataIndex: x / 20, timestamp: x * 5, value: (500 - y) / 10 });
const store = { timestampToDataIndex: timestamp => timestamp / 100,
  dataIndexToTimestamp: index => index * 100 };
let nextId = 0;

function fixture(points) {
  globalThis.klinecharts = api;
  let overlay;
  const chart = {
    createOverlay(request) {
      const Overlay = api.getOverlayClass(request.name);
      overlay = new Overlay();
      overlay.override({ ...request, id: `rect-${++nextId}`, points: clone(points) });
      return overlay.id;
    },
    overrideOverlay(update) { overlay.override(update); return true; },
    convertToPixel(values) { return Array.isArray(values) ? values.map(pixel) : pixel(values); },
    convertFromPixel(values) { return values.map(point); },
  };
  startDrawing({ instance: chart }, 'rect');
  overlay.onSelected({ chart, overlay });
  return { chart, overlay };
}

function target(points, handle) {
  const coords = points.map(pixel);
  const left = Math.min(...coords.map(p => p.x));
  const right = Math.max(...coords.map(p => p.x));
  const top = Math.min(...coords.map(p => p.y));
  const bottom = Math.max(...coords.map(p => p.y));
  return { x: handle.includes('l') ? left : handle.includes('r') ? right : (left + right) / 2,
    y: handle.includes('t') ? top : handle.includes('b') ? bottom : (top + bottom) / 2 };
}

// Public vendor figures inherit Eventful, so use its actual child dispatcher
// as well as its hit tests. Match drawFigures/drawDefaultFigures insertion order.
function hitFigure(overlay, position) {
  const coordinates = overlay.points.map(pixel);
  const figures = overlay.createPointFigures({ coordinates, overlay });
  if (overlay.needDefaultPointFigure) {
    coordinates.forEach((attrs, index) => figures.push({ key: `overlay_figure_point_${index}`,
      type: 'circle', attrs: { ...attrs, r: 5 }, pointIndex: index }));
  }
  const Container = api.getFigureClass('rect');
  const container = new Container({ attrs: {}, styles: {} });
  let hit;
  for (const figure of figures) {
    const Figure = api.getFigureClass(figure.type);
    const child = new Figure({ attrs: figure.attrs, styles: figure.styles ?? {} });
    child.registerEvent('mouseDownEvent', () => {
      if (figure.ignoreEvent === true) return false;
      hit = figure;
      return true;
    });
    container.addChild(child);
  }
  assert.equal(container.dispatchEvent('mouseDownEvent', position), true, 'press must hit a figure');
  return hit;
}

function press(f, position, figure = hitFigure(f.overlay, position)) {
  const { chart, overlay } = f;
  // OverlayView._figureMouseDownEvent snapshots before our callback.
  overlay.startPressedMove(point(position));
  overlay.onPressedMoveStart({ chart, overlay, figure, ...position });
  return figure;
}

function move(f, figure, position) {
  const { chart, overlay } = f;
  // OverlayView pressedMouseMoveEvent mutates native geometry first.
  if (figure.pointIndex !== undefined) overlay.eventPressedPointMove(point(position), figure.pointIndex);
  else overlay.eventPressedOtherMove(point(position), store);
  const native = clone(overlay.points);
  overlay.onPressedMoving({ chart, overlay, figure, ...position });
  return native;
}

const placements = [
  ['tl-br', [{ timestamp: 1000, dataIndex: 10, value: 40 }, { timestamp: 3000, dataIndex: 30, value: 20 }]],
  ['br-tl', [{ timestamp: 3000, dataIndex: 30, value: 20 }, { timestamp: 1000, dataIndex: 10, value: 40 }]],
  ['bl-tr', [{ timestamp: 1000, dataIndex: 10, value: 20 }, { timestamp: 3000, dataIndex: 30, value: 40 }]],
  ['tr-bl', [{ timestamp: 3000, dataIndex: 30, value: 40 }, { timestamp: 1000, dataIndex: 10, value: 20 }]],
];

function expectedResize(original, handle, destination) {
  const result = clone(original);
  const left = original[0].dataIndex < original[1].dataIndex ? 0 : 1;
  const top = original[0].value > original[1].value ? 0 : 1;
  const mouse = point(destination);
  if (handle.includes('l') || handle.includes('r')) {
    const index = handle.includes('l') ? left : 1 - left;
    result[index].timestamp = mouse.timestamp;
    result[index].dataIndex = mouse.dataIndex;
  }
  if (handle.includes('t') || handle.includes('b')) result[handle.includes('t') ? top : 1 - top].value = mouse.value;
  return result;
}

for (const [placement, original] of placements) {
  for (const handle of ['t', 'l', 'r', 'b', 'tl', 'tr', 'bl', 'br']) {
    test(`vendor sequence resizes ${handle} only on ${placement}`, () => {
      const f = fixture(original);
      const start = target(original, handle);
      const figure = press(f, start);
      if (handle.length === 1) assert.equal(figure.key, `rect_handle_${handle}`);
      for (const destination of [{ x: start.x + 40, y: start.y - 30 }, { x: 800, y: 400 }]) {
        move(f, figure, destination);
        assert.deepEqual(f.overlay.points, expectedResize(original, handle, destination));
      }
    });
  }
}

for (const [placement, original] of placements) {
  for (const handle of ['t', 'l', 'r', 'b', 'tl', 'tr', 'bl', 'br']) {
    test(`body figure at ${handle} handle resizes only its sides on ${placement}`, () => {
      const f = fixture(original);
      const start = target(original, handle);
      const figure = press(f, start, { type: 'rect' });
      f.overlay.extendData = { text: 'label' };
      for (const destination of [{ x: start.x + 40, y: start.y - 30 }, { x: 800, y: 400 }, start]) {
        move(f, figure, destination);
        assert.deepEqual(f.overlay.points, expectedResize(original, handle, destination));
        assert.deepEqual(f.overlay.extendData, { text: 'label' });
      }
    });
  }
}

test('body interior and border outside handle disks retain native translation', () => {
  const original = placements[0][1];
  for (const start of [{ x: 400, y: 200 }, { x: 405, y: 100 }, { x: 200, y: 205 }]) {
    const f = fixture(original);
    const figure = press(f, start);
    assert.equal(figure.type, 'rect');
    move(f, figure, { x: start.x + 40, y: start.y - 30 });
    assert.deepEqual(f.overlay.points, original.map(p => ({ ...p,
      timestamp: p.timestamp + 200, dataIndex: p.dataIndex + 2, value: p.value + 3 })));
  }
});

test('native corner figures keep their native point movement and magnet result', () => {
  const original = placements[0][1];
  const f = fixture(original);
  const start = target(original, 'tl');
  const figure = press(f, start);
  assert.equal(figure.key, 'overlay_figure_point_0');
  // _coordinateToPoint can supply a magnet-snapped price before our callback.
  f.overlay.eventPressedPointMove({ dataIndex: 12, timestamp: 1200, value: 45 }, 0);
  f.overlay.onPressedMoving({ chart: f.chart, overlay: f.overlay, figure, x: 240, y: 70 });
  assert.deepEqual(f.overlay.points, [{ dataIndex: 12, timestamp: 1200, value: 45 }, original[1]]);
});

for (const handle of ['t', 'l']) {
  test(`${handle} fallback replaces pure-axis body translation before callback without drift`, () => {
    const original = placements[0][1];
    const f = fixture(original);
    const start = target(original, handle);
    const figure = press(f, start, { type: 'rect' });
    const destination = handle === 't' ? { x: start.x, y: start.y - 30 }
      : { x: start.x + 40, y: start.y };
    for (let i = 0; i < 2; i++) {
      const native = move(f, figure, destination);
      assert.deepEqual(native, original.map(p => ({ ...p,
        dataIndex: p.dataIndex + (handle === 'l' ? 2 : 0),
        timestamp: p.timestamp + (handle === 'l' ? 200 : 0),
        value: p.value + (handle === 't' ? 3 : 0) })));
      assert.deepEqual(f.overlay.points, expectedResize(original, handle, destination));
    }
    f.overlay.onPressedMoveEnd({ chart: f.chart, overlay: f.overlay, figure, ...destination });
    // A fresh body press must release the previous handle snapshot.
    const body = press(f, { x: 400, y: 200 });
    const before = clone(f.overlay.points);
    move(f, body, { x: 440, y: 170 });
    assert.deepEqual(f.overlay.points, before.map(p => ({ ...p,
      dataIndex: p.dataIndex + 2, timestamp: p.timestamp + 200, value: p.value + 3 })));
  });
}

// A same-ID payload must work even when selection, rendering, press and move
// callbacks each receive a different overlay object (as public snapshots can).
function snapshot(overlay) {
  return { id: overlay.id, points: clone(overlay.points), paneId: overlay.paneId,
    lock: overlay.lock, styles: overlay.styles };
}

for (const state of ['selected', 'hovered']) {
  for (const [placement, original] of placements) {
    test(`${state} ID preserves handle hit priority and paint order on ${placement}`, () => {
      const { chart, overlay } = fixture(original);
      overlay.onDeselected({ chart, overlay });
      if (state === 'selected') overlay.onSelected({ chart, overlay: snapshot(overlay) });
      else overlay.onMouseEnter({ chart, overlay: snapshot(overlay) });
      const renderOverlay = snapshot(overlay);
      const figures = overlay.createPointFigures({ coordinates: original.map(pixel), overlay: renderOverlay });
      const bodyIndex = figures.findIndex(figure => figure.type === 'rect');
      const handles = figures.filter(figure => figure.key?.startsWith('rect_handle_'));
      assert.equal(handles.length, 6);
      for (const handle of handles) {
        // Vendor child dispatch is last-to-first, while painting is first-to-last.
        assert.ok(figures.indexOf(handle) > bodyIndex, 'handles must paint above and hit before body');
        assert.notEqual(handle.ignoreEvent, true);
        const hit = hitFigure(overlay, handle.attrs);
        assert.equal(hit.key, handle.key);
      }
      if (state === 'selected') overlay.onDeselected({ chart, overlay: snapshot(overlay) });
      else overlay.onMouseLeave({ chart, overlay: snapshot(overlay) });
      assert.equal(overlay.createPointFigures({ coordinates: original.map(pixel), overlay }).length, 1);
      overlay.onRemoved({ chart, overlay: snapshot(overlay) });
    });

    for (const handle of ['t', 'l', 'r', 'b', 'tl', 'tr', 'bl', 'br']) {
      test(`${state} ID body fallback resizes ${handle} across callback objects on ${placement}`, () => {
        const f = fixture(original);
        const { chart, overlay } = f;
        overlay.onDeselected({ chart, overlay });
        if (state === 'selected') overlay.onSelected({ chart, overlay: snapshot(overlay) });
        else overlay.onMouseEnter({ chart, overlay: snapshot(overlay) });
        const start = target(original, handle);
        overlay.startPressedMove(point(start));
        const figure = { type: 'rect', key: null };
        overlay.onPressedMoveStart({ chart, overlay: snapshot(overlay), figure, ...start });
        for (const destination of [{ x: start.x + 40, y: start.y - 30 }, { x: 800, y: 400 }, start]) {
          overlay.eventPressedOtherMove(point(destination), store);
          overlay.onPressedMoving({ chart, overlay: snapshot(overlay), figure, ...destination });
          assert.deepEqual(overlay.points, expectedResize(original, handle, destination));
        }
        overlay.onPressedMoveEnd({ chart, overlay: snapshot(overlay) });
        // End must clear the ID-keyed snapshot even with a new callback object.
        overlay.onPressedMoving({ chart, overlay: snapshot(overlay), figure, x: 900, y: 450 });
        assert.deepEqual(overlay.points, original);
        overlay.onRemoved({ chart, overlay: snapshot(overlay) });
        assert.equal(overlay.createPointFigures({ coordinates: original.map(pixel), overlay }).length, 1);
      });
    }
  }
}

for (const handle of ['t', 'l']) {
  test(`${handle} handle one pixel inside body wins its inclusive rectangle hit`, () => {
    const original = placements[0][1];
    const f = fixture(original);
    const start = target(original, handle);
    if (handle === 't') start.y += 1;
    else start.x += 1;
    const figure = press(f, start);
    assert.equal(figure.key, `rect_handle_${handle}`);
    const destination = { x: start.x + 40, y: start.y - 30 };
    move(f, figure, destination);
    assert.deepEqual(f.overlay.points, expectedResize(original, handle, destination));
  });
}

for (const [placement, original] of placements) {
  for (const handle of ['t', 'l', 'r', 'b', 'tl', 'tr', 'bl', 'br']) {
    test(`body fallback resizes ${handle} before hover is recorded on ${placement}`, () => {
      const { chart, overlay } = fixture(original);
      overlay.onDeselected({ chart, overlay: snapshot(overlay) });
      const start = target(original, handle);
      // Match the reported top/left press about one pixel inside the body.
      if (handle === 't') start.y += 1;
      if (handle === 'l') start.x += 1;
      const figure = { type: 'rect', key: null };
      overlay.startPressedMove(point(start));
      overlay.onPressedMoveStart({ chart, overlay: snapshot(overlay), figure, ...start });
      for (const destination of [{ x: start.x + 40, y: start.y - 30 }, { x: 800, y: 400 }, start]) {
        overlay.eventPressedOtherMove(point(destination), store);
        overlay.onPressedMoving({ chart, overlay: snapshot(overlay), figure, ...destination });
        assert.deepEqual(overlay.points, expectedResize(original, handle, destination));
      }
      overlay.onRemoved({ chart, overlay: snapshot(overlay) });
    });
  }
}

test('body interior still translates before hover is recorded', () => {
  const original = placements[0][1];
  const f = fixture(original);
  f.overlay.onDeselected({ chart: f.chart, overlay: snapshot(f.overlay) });
  const figure = press(f, { x: 400, y: 200 }, { type: 'rect', key: null });
  move(f, figure, { x: 440, y: 170 });
  assert.deepEqual(f.overlay.points, original.map(p => ({ ...p,
    timestamp: p.timestamp + 200, dataIndex: p.dataIndex + 2, value: p.value + 3 })));
  f.overlay.onRemoved({ chart: f.chart, overlay: snapshot(f.overlay) });
});
