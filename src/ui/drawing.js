import { rrStats } from '../core/rr.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { trendColour, rectColour, normalizeLabelText, snapAxis, moveRectHandle, fibLevelColour } from './drawing-logic.js';
import { attachDrawingLabelDialog } from './drawingLabelDialog.js';

const GROUP = 'replay_drawings';
const NAMES = { trend: 'replay_trend', rect: 'replay_rect', fib: 'replay_fib', long: 'replay_rr_long', short: 'replay_rr_short' };
const registered = new WeakSet();
const colours = new WeakMap();
const rectColours = new WeakMap();
const labelDialogs = new WeakMap();
const overlayCharts = new WeakMap();
const drawingCharts = new Set();
const keyDocuments = new WeakSet();
// Library callbacks and public snapshots may use different objects for one ID.
const selectedRects = new Set();
const hoveredRects = new Set();
const rectDrags = new Map();
let magnetEnabled = true;
let shiftDown = false;
// All chart instances receive deletion hotkeys, so selection has one shared owner.
let selected;

export function isMagnetEnabled() { return magnetEnabled; }

export function setMagnet(enabled) {
  magnetEnabled = Boolean(enabled);
  for (const chart of drawingCharts) chart.overrideOverlay({ groupId: GROUP,
    mode: magnetEnabled ? 'weak_magnet' : 'normal', modeSensitivity: 20 });
}

export function setTrendColour(chart, colour) {
  const color = trendColour(colour);
  colours.set(chart.instance, color);
  if (selected?.chart === chart.instance && selected.name === NAMES.trend) {
    chart.instance.overrideOverlay({ id: selected.id, styles: { line: { color } } });
  }
}

function rectangleStyles(color) {
  // Hex alpha 0x26 / 255 = 0.149, with an opaque border.
  return { rect: { style: 'stroke_fill', color: `${color}26`, borderColor: color,
    borderSize: 1, borderStyle: 'solid', borderRadius: 0 } };
}

export function setRectColour(chart, colour) {
  const color = rectColour(colour);
  rectColours.set(chart.instance, color);
  if (selected?.chart === chart.instance && selected.name === NAMES.rect) {
    chart.instance.overrideOverlay({ id: selected.id, styles: rectangleStyles(color) });
  }
}

function editDrawingLabel({ chart, overlay }) {
  if (selected?.chart !== chart || selected.id !== overlay.id) return;
  const dialog = globalThis.document?.querySelector('#drawing-label-dialog');
  if (!dialog || dialog.open) return;
  if (!labelDialogs.has(dialog)) labelDialogs.set(dialog, attachDrawingLabelDialog(dialog));
  labelDialogs.get(dialog).open(overlay.extendData?.text, text => {
    chart.overrideOverlay({ id: overlay.id, extendData: { text } });
  });
}

function drawingLabel(overlay, x, y, color, baseline) {
  const text = normalizeLabelText(overlay.extendData?.text);
  return text ? [{ type: 'text', ignoreEvent: true,
    attrs: { text, x, y, align: 'center', baseline },
    styles: { color, style: 'fill', size: 12, weight: 'normal', family: 'sans-serif',
      backgroundColor: 'transparent', borderSize: 0,
      paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } }] : [];
}

function trendFigures({ coordinates, overlay }) {
  if (coordinates.length !== 2) return [];
  const [first, second] = coordinates;
  return [{ type: 'line', attrs: { coordinates } },
    ...drawingLabel(overlay, (first.x + second.x) / 2, (first.y + second.y) / 2 - 4,
      overlay.styles?.line?.color ?? trendColour(), 'bottom')];
}

function rectFigures({ coordinates, overlay }) {
  if (coordinates.length !== 2) return [];
  const [first, second] = coordinates;
  const top = Math.min(first.y, second.y);
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const bottom = Math.max(first.y, second.y);
  const color = overlay.styles?.rect?.borderColor ?? rectColour();
  const handles = [];
  if (selectedRects.has(overlay.id) || hoveredRects.has(overlay.id)) {
    const nativeTLBR = (first.x <= second.x) === (first.y <= second.y);
    const corners = nativeTLBR ? [['tr', right, top], ['bl', left, bottom]]
      : [['tl', left, top], ['br', right, bottom]];
    for (const [id, x, y] of [...corners,
      ['t', (left + right) / 2, top], ['b', (left + right) / 2, bottom],
      ['l', left, (top + bottom) / 2], ['r', right, (top + bottom) / 2]]) {
      handles.push({ key: `rect_handle_${id}`, type: 'circle', attrs: { x, y, r: 4 },
        styles: { style: 'fill', color } });
    }
  }
  // drawFigures adds children in paint order; Eventful dispatches last-to-first.
  // Handles must follow the body to win overlapping hits and paint above its fill.
  return [{ type: 'rect', attrs: {
    x: left, y: top,
    width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y),
  } }, ...drawingLabel(overlay, (first.x + second.x) / 2, top + 4,
    color, 'top'), ...handles];
}

function rectHandleAtPress({ chart, overlay, figure, x, y }) {
  const keyed = /^rect_handle_(tl|tr|bl|br|t|b|l|r)$/.exec(figure?.key ?? '')?.[1];
  if (keyed) return keyed;
  // A press can arrive before hover/selection callbacks record this ID. Recover
  // body hits from geometry alone; native point figures keep their magnet path.
  if (figure?.type !== 'rect' || ![x, y].every(Number.isFinite)) return;
  const coords = chart.convertToPixel(overlay.points, { paneId: overlay.paneId });
  if (!Array.isArray(coords) || coords.length !== 2 ||
    !coords.every(p => p && [p.x, p.y].every(Number.isFinite))) return;
  const left = Math.min(coords[0].x, coords[1].x);
  const right = Math.max(coords[0].x, coords[1].x);
  const top = Math.min(coords[0].y, coords[1].y);
  const bottom = Math.max(coords[0].y, coords[1].y);
  const handles = [
    ['tl', left, top], ['tr', right, top], ['bl', left, bottom], ['br', right, bottom],
    ['t', (left + right) / 2, top], ['b', (left + right) / 2, bottom],
    ['l', left, (top + bottom) / 2], ['r', right, (top + bottom) / 2],
  ];
  return handles.find(([, hx, hy]) => Math.hypot(x - hx, y - hy) <= 4)?.[0];
}

function startRectDrag(event) {
  rememberChart(event);
  const { overlay } = event;
  rectDrags.delete(overlay.id);
  if (overlay.points.length !== 2) return;
  const handle = rectHandleAtPress(event);
  if (handle) {
    rectDrags.set(overlay.id, { handle, points: overlay.points.map(point => ({ ...point })) });
  }
}

function moveRectDrag({ chart, overlay, x, y }) {
  const drag = rectDrags.get(overlay.id);
  if (!drag || overlay.lock || ![x, y].every(Number.isFinite)) return;
  const converted = chart.convertFromPixel([{ x, y }], { paneId: overlay.paneId });
  const mouse = Array.isArray(converted) ? converted[0] : converted;
  if (!mouse || !Number.isFinite(mouse.value) ||
    ![mouse.timestamp, mouse.dataIndex].some(Number.isFinite)) return;
  // Custom figures are moved as a body BEFORE this documented callback.
  // Replace that translation from the fixed drag-start geometry on every event.
  chart.overrideOverlay({ id: overlay.id, points: moveRectHandle(drag.points, drag.handle, mouse) });
}

function rectEvents() {
  return {
    onPressedMoveStart: startRectDrag,
    onPressedMoving: moveRectDrag,
    onPressedMoveEnd: ({ overlay }) => { rectDrags.delete(overlay.id); },
    onMouseEnter: ({ chart, overlay }) => {
      hoveredRects.add(overlay.id);
      // The library suppresses its hover repaint when a callback is supplied.
      chart.overrideOverlay({ id: overlay.id });
    },
    onMouseLeave: ({ chart, overlay }) => {
      hoveredRects.delete(overlay.id);
      chart.overrideOverlay({ id: overlay.id });
    },
    onSelected: event => { selectedRects.add(event.overlay.id); selectDrawing(event); },
    onDeselected: event => { selectedRects.delete(event.overlay.id); forgetSelection(event); },
    onRemoved: event => {
      selectedRects.delete(event.overlay.id);
      hoveredRects.delete(event.overlay.id);
      rectDrags.delete(event.overlay.id);
      forgetSelection(event);
    },
  };
}

function trackShift() {
  const doc = globalThis.document;
  if (!doc || keyDocuments.has(doc)) return;
  doc.addEventListener('keydown', event => { if (event.key === 'Shift') shiftDown = true; });
  doc.addEventListener('keyup', event => { if (event.key === 'Shift') shiftDown = false; });
  globalThis.window.addEventListener('blur', () => { shiftDown = false; });
  keyDocuments.add(doc);
}

// Capture Shift even when it is already held before the Trend button is clicked.
trackShift();

function rememberChart({ chart, overlay }) { overlayCharts.set(overlay, chart); }

function snapTrend({ points, performPointIndex, performPoint }) {
  if (!shiftDown || points.length !== 2 || ![0, 1].includes(performPointIndex)) return;
  const chart = overlayCharts.get(this);
  const anchor = points[1 - performPointIndex];
  if (!chart || !anchor) return;
  const first = chart.convertToPixel(anchor, { paneId: 'candle_pane' });
  const current = chart.convertToPixel(performPoint, { paneId: 'candle_pane' });
  if (![first.x, first.y, current.x, current.y].every(Number.isFinite)) return;
  if (snapAxis(first, current) === 'horizontal') performPoint.value = anchor.value;
  else {
    // Both fields must agree: klinecharts can use dataIndex when no timestamp exists.
    for (const key of ['timestamp', 'dataIndex']) {
      if (anchor[key] === undefined) delete performPoint[key];
      else performPoint[key] = anchor[key];
    }
  }
}

function fibFigures({ coordinates, overlay }) {
  const points = overlay.points;
  if (coordinates.length < 2 || !points.slice(0, 2).every(point => Number.isFinite(point.value))) return [];
  // Lines span only the two chosen points (TradingView "Don't extend").
  const left = Math.min(coordinates[0].x, coordinates[1].x);
  const right = Math.max(coordinates[0].x, coordinates[1].x);
  const figures = [];
  const { levels, colors } = overlay.extendData;
  levels.forEach((level, index) => {
    const y = coordinates[1].y + (coordinates[0].y - coordinates[1].y) * level;
    const color = fibLevelColour(colors, index);
    figures.push({ type: 'line', attrs: { coordinates: [{ x: left, y }, { x: right, y }] },
      styles: { color } });
    // The label is just the level number the owner typed (1 shows 1, 2 shows 2).
    figures.push({ type: 'text', ignoreEvent: true,
      styles: { color, backgroundColor: 'rgba(19, 23, 34, 0.65)', borderSize: 0 },
      attrs: { x: left, y, text: String(level), baseline: 'bottom' } });
  });
  return figures;
}

function label(text, x, y, color, bounding, baseline = 'top') {
  const margin = Math.min(4, bounding.width / 4);
  const width = Math.min(text.length * 7.3 + 8, bounding.width - margin * 2);
  const height = Math.min(18, bounding.height);
  const align = x + width > bounding.width - margin ? 'right' : 'left';
  const anchor = align === 'right'
    ? Math.max(width + margin, Math.min(x, bounding.width - margin))
    : Math.max(margin, Math.min(x, bounding.width - width - margin));
  const top = y - (baseline === 'bottom' ? height : baseline === 'middle' ? height / 2 : 0);
  return {
    type: 'text',
    attrs: { text, x: anchor, y: Math.max(0, Math.min(top, bounding.height - height)),
      width, height, align, baseline: 'top' },
    styles: { color: '#ffffff', backgroundColor: color, style: 'fill', size: 12,
      family: 'monospace', weight: 'normal', paddingLeft: 4, paddingRight: 4,
      paddingTop: 2, paddingBottom: 2 },
  };
}

function rrFigures(kind, { coordinates, overlay, bounding }) {
  if (coordinates.length < 3 || bounding.width <= 0 || bounding.height <= 0) return [];
  const [entry, stop, target] = coordinates;
  const [e, s, t] = overlay.points;
  const stats = rrStats(kind, e?.value, s?.value, t?.value);
  const validCoordinates = coordinates.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!validCoordinates) {
    return [label(stats.error ?? 'RR points are outside the drawable range',
      bounding.width / 2, bounding.height / 2, '#555555', bounding)];
  }
  const left = Math.min(entry.x, stop.x, target.x);
  // Preserve the spike's visible footprint when all three anchors share a time.
  const right = Math.max(left + 160, entry.x, stop.x, target.x);
  const zone = (point, color) => ({
    type: 'rect',
    attrs: { x: left, y: Math.min(entry.y, point.y), width: right - left,
      height: Math.abs(entry.y - point.y) },
    styles: { style: 'fill', color },
  });
  const result = [
    zone(target, 'rgba(8,153,129,0.25)'),
    zone(stop, 'rgba(242,54,69,0.25)'),
    { type: 'line', attrs: { coordinates: [{ x: left, y: entry.y }, { x: right, y: entry.y }] },
      styles: { color: '#b2b5be', size: 1, style: 'solid' } },
  ];
  if (stats.error) {
    return [...result, label(stats.error, entry.x + 4, entry.y, '#555555', bounding, 'middle')];
  }
  const targetAbove = target.y < entry.y;
  const stopAbove = stop.y < entry.y;
  return [...result,
    label(`Target: ${stats.reward.toFixed(3)} (${stats.rewardPct.toFixed(3)}%) ${t.value.toFixed(3)}`,
      target.x + 4, target.y + (targetAbove ? -4 : 4), '#086b5c', bounding, targetAbove ? 'bottom' : 'top'),
    label(`Stop: ${stats.risk.toFixed(3)} (${stats.riskPct.toFixed(3)}%) ${s.value.toFixed(3)}`,
      stop.x + 4, stop.y + (stopAbove ? -4 : 4), '#a52632', bounding, stopAbove ? 'bottom' : 'top'),
    label(`Risk/reward ratio: ${stats.rr.toFixed(2)}`,
      (left + right) / 2, entry.y, '#555555', bounding, 'middle'),
  ];
}

function forgetSelection({ chart, overlay }) {
  if (selected?.chart === chart && selected.id === overlay.id) selected = undefined;
}

function selectDrawing({ chart, overlay }) {
  selected = { chart, id: overlay.id, name: overlay.name };
}

function register(api) {
  if (registered.has(api)) return;
  const defaults = { totalStep: 3, needDefaultPointFigure: true,
    needDefaultXAxisFigure: true, needDefaultYAxisFigure: true };
  api.registerOverlay({ ...defaults, name: NAMES.trend,
    createPointFigures: trendFigures,
    performEventMoveForDrawing: function (params) {
      if (params.currentStep === 2) snapTrend.call(this, params);
    },
    performEventPressedMove: snapTrend,
  });
  // Native opposite corners retain magnet; six keyed figures use overlay events.
  api.registerOverlay({ ...defaults, name: NAMES.rect, createPointFigures: rectFigures });
  api.registerOverlay({ ...defaults, name: NAMES.fib, createPointFigures: fibFigures });
  for (const kind of ['long', 'short']) {
    api.registerOverlay({
      name: NAMES[kind], totalStep: 4,
      needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
      // Native point dragging updates overlay.points before figures are recreated.
      createPointFigures: params => rrFigures(kind, params),
    });
  }
  const deletion = {
    preventDefault: true,
    check: ({ chart, event }) => selected?.chart === chart &&
      !event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') &&
      !event.target?.closest?.('dialog[open]') &&
      !globalThis.document?.querySelector?.('dialog[open]'),
    action: ({ chart }) => {
      if (selected?.chart !== chart) return;
      const { id } = selected;
      selected = undefined;
      chart.removeOverlay({ id });
    },
  };
  api.registerHotkey({ ...deletion, name: 'replay_delete_drawing', keys: 'Delete' });
  api.registerHotkey({ ...deletion, name: 'replay_delete_drawing_backspace', keys: 'Backspace' });
  registered.add(api);
}

export function startDrawing(chart, kind, options = {}) {
  if (!Object.hasOwn(NAMES, kind)) throw new Error(`Invalid drawing kind: ${kind}`);
  register(globalThis.klinecharts);
  trackShift();
  const { instance } = chart;
  drawingCharts.add(instance);
  if (selected?.chart === instance) selected = undefined;
  const id = instance.createOverlay({
    name: NAMES[kind], paneId: 'candle_pane', groupId: GROUP, lock: false,
    mode: magnetEnabled ? 'weak_magnet' : 'normal', modeSensitivity: 20,
    ...(kind === 'trend' ? { styles: { line: { color: colours.get(instance) ?? trendColour() } } } : {}),
    ...(kind === 'rect' ? { styles: rectangleStyles(rectColours.get(instance) ?? rectColour()) } : {}),
    ...(['trend', 'rect'].includes(kind) ? { extendData: { text: null }, onDoubleClick: editDrawingLabel } : {}),
    ...(kind === 'fib' ? { extendData: { levels: [...(options.levels ?? DEFAULT_SETTINGS.fibPresets[0].levels)], colors: options.colors ? [...options.colors] : undefined } } : {}),
    onDrawStart: rememberChart,
    onPressedMoveStart: rememberChart,
    onSelected: selectDrawing,
    // A chart retains its native local selection when another chart is used.
    // Clicking that same drawing again does not emit another onSelected.
    onClick: selectDrawing,
    onDeselected: forgetSelection,
    onRemoved: forgetSelection,
    ...(kind === 'rect' ? rectEvents() : {}),
  });
  if (id === null) throw new Error(`Could not start ${kind} drawing`);
}

export function clearDrawings(chart) {
  if (selected?.chart === chart.instance) selected = undefined;
  chart.instance.removeOverlay({ groupId: GROUP });
}
