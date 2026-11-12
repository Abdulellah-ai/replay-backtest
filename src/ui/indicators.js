import { createSessionCache, historicalSessions } from './session-cache.js';
import { createLevelIndex } from './session-level-index.js';
import { indicatorValues, visibleFromIdx, sessionRanges, sessionColor,
  labelFits, sessionLevelLines, sessionLevelRanges } from './indicators-logic.js';

const RSI = 'REPLAY_RSI_14';
const MA = 'REPLAY_MA_50';
const ZONES = 'REPLAY_KILL_ZONES';
const MAIN = 'candle_pane';
const RSI_PANE = 'replay_rsi_pane';
const SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const registered = new WeakSet();

function drawRsi({ ctx, chart, indicator, bounding, yAxis }) {
  const y30 = yAxis.convertToPixel(30);
  const y70 = yAxis.convertToPixel(70);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bounding.width, bounding.height);
  ctx.clip();
  ctx.fillStyle = 'rgba(126,87,194,0.12)';
  ctx.fillRect(0, y70, bounding.width, y30 - y70);

  // Clip the area between the RSI polyline and 70 to the region above 70.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bounding.width, Math.max(0, y70));
  ctx.clip();
  ctx.fillStyle = 'rgba(8,153,129,0.25)';
  const range = chart.getVisibleRange();
  const first = Math.max(0, Math.floor(range.from) - 1);
  const last = Math.min(indicator.result.length - 1, Math.ceil(range.to));
  let startX;
  let lastX;
  const finish = () => {
    if (startX === undefined) return;
    ctx.lineTo(lastX, y70);
    ctx.lineTo(startX, y70);
    ctx.closePath();
    ctx.fill();
    startX = undefined;
  };
  for (let i = first; i <= last; i += 1) {
    const value = indicator.result[i]?.rsi;
    if (!Number.isFinite(value)) { finish(); continue; }
    const { x, y } = chart.convertToPixel({ dataIndex: i, value },
      { paneId: indicator.paneId, yAxisId: indicator.yAxisId });
    if (startX === undefined) {
      ctx.beginPath();
      ctx.moveTo(x, y70);
      startX = x;
    }
    ctx.lineTo(x, y);
    lastX = x;
  }
  finish();
  ctx.restore();

  ctx.strokeStyle = 'rgba(150,150,150,0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const value of [30, 50, 70]) {
    const y = yAxis.convertToPixel(value);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(bounding.width, y);
    ctx.stroke();
  }
  ctx.restore();
  return false; // Keep the library's line and native last-value mark.
}

function drawZones({ ctx, chart, indicator, bounding }) {
  const ranges = indicator.extendData.getRanges();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bounding.width, bounding.height);
  ctx.clip();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  const labels = [];
  for (const box of ranges) {
    const [a, b] = chart.convertToPixel([
      { dataIndex: box.from, value: box.high },
      { dataIndex: box.to, value: box.low },
    ], { paneId: indicator.paneId, yAxisId: indicator.yAxisId });
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    if (b.x < 0 || a.x > bounding.width) continue;
    const color = sessionColor(box.zoneId);
    ctx.fillStyle = color.fill;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = color.border;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, a.y);
    ctx.moveTo(a.x, b.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const left = Math.max(0, a.x);
    const width = Math.min(bounding.width, b.x) - left;
    const labelFrom = left + 3;
    const labelTo = labelFrom + box.zoneId.length * 7;
    if (labelFits(width, box.zoneId) &&
        !labels.some(([from, to]) => labelFrom < to && labelTo > from)) {
      ctx.fillStyle = '#d1d4dc';
      ctx.fillText(box.zoneId, labelFrom, Math.max(0, a.y) + 3);
      labels.push([labelFrom, labelTo]);
    }
  }
  for (const line of indicator.extendData.getLevelLines?.() ?? []) {
    const [a, b] = chart.convertToPixel([
      { dataIndex: line.from, value: line.price },
      { dataIndex: line.to, value: line.price },
    ], { paneId: indicator.paneId, yAxisId: indicator.yAxisId });
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || b.x < 0 || a.x > bounding.width) continue;
    ctx.strokeStyle = sessionColor(line.id).border;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
  return false;
}

function register(api) {
  if (registered.has(api)) return;
  api.registerIndicator({
    name: RSI, shortName: 'RSI', calcParams: [14], precision: 2,
    minValue: 0, maxValue: 100,
    figures: [{ key: 'rsi', title: 'RSI: ', type: 'line' }],
    styles: { lines: [{ color: '#7e57c2', size: 1.5 }] },
    calc: (bars, indicator) => indicatorValues(bars, 'rsi', indicator.calcParams[0]),
    shouldUpdate: () => true,
    draw: drawRsi,
  });
  api.registerIndicator({
    name: MA, shortName: 'MA50', calcParams: [50], series: 'price',
    figures: [{ key: 'ma', title: 'MA50: ', type: 'line' }],
    styles: { lines: [{ color: '#e5a32e', size: 1.5 }] },
    calc: (bars, indicator) => indicatorValues(bars, 'ma', indicator.calcParams[0]),
    shouldUpdate: () => true,
  });
  api.registerIndicator({
    name: ZONES, shortName: 'Kill zones', figures: [],
    calc: () => [],
    shouldUpdate: () => ({ calc: false, draw: true }),
    draw: drawZones,
  });
  registered.add(api);
}

export function attachIndicators(chart, replay, settings) {
  const { instance, sourceStore: store } = chart;
  if (!store) throw new Error('Indicators require createChart options.store');
  register(globalThis.klinecharts);
  let destroyed = false;
  let maEnabled = false;
  let zonesEnabled = true;
  let rsiEnabled = true;
  let cachedKey;
  let cachedRanges = [];
  const sessions = createSessionCache(store);
  const completedSessions = new Set();
  const activeLevels = new Set();
  let sweptLevels = createLevelIndex(store.t[0], store.t.at(-1));
  let levelOrder = new WeakMap();
  let nextLevelOrder = 0;
  let levelCursor = -1;
  let levelZones;

  function getLevelLines() {
    if (destroyed || !settings.sessionLevels) return [];
    const zonesKey = JSON.stringify(settings.zones);
    if (replay.cursor < levelCursor || zonesKey !== levelZones) {
      completedSessions.clear();
      activeLevels.clear();
      sweptLevels = createLevelIndex(store.t[0], store.t.at(-1));
      levelOrder = new WeakMap();
      nextLevelOrder = 0;
      levelCursor = -1;
    }
    if (replay.cursor !== levelCursor) {
      // Only newly revealed rows can sweep an existing unswept level.
      for (const line of activeLevels) {
        for (let i = levelCursor + 1; i <= replay.cursor; i += 1) {
          line.toTs = store.t[i];
          if (line.kind === 'high' ? store.h[i] > line.price : store.l[i] < line.price) {
            line.swept = true;
            activeLevels.delete(line);
            sweptLevels.add(line);
            break;
          }
        }
      }
      // Initial enable discovers old unswept levels once. Later updates need
      // only recent sessions (48h also covers configurable zones across DST).
      const from = levelCursor < 0 ? 0 : visibleFromIdx(store.t, replay.cursor,
        [{ timestamp: store.t[levelCursor] }], { from: 0, to: 1 }, 2 * SESSION_LOOKBACK_MS);
      const boxes = levelCursor < 0 ? historicalSessions(store, replay.cursor, settings.zones)
        : sessions.get(replay.cursor, from, settings.zones);
      for (const box of boxes) {
        const key = JSON.stringify([box.zoneId, box.startTs]);
        if (completedSessions.has(key)) continue;
        const lines = sessionLevelLines([box], store.t, store.h, store.l, replay.cursor);
        if (lines.length) completedSessions.add(key);
        for (const line of lines) {
          levelOrder.set(line, nextLevelOrder++);
          if (line.swept) sweptLevels.add(line);
          else activeLevels.add(line);
        }
      }
      levelCursor = replay.cursor;
      levelZones = zonesKey;
    }
    const bars = instance.getDataList();
    const range = instance.getVisibleRange();
    const firstIdx = Math.max(0, Math.floor(range.from));
    const lastIdx = Math.min(bars.length - 1, Math.ceil(range.to) - 1);
    const first = bars[firstIdx];
    const last = bars[lastIdx];
    if (!first || !last || firstIdx > lastIdx) return [];
    // Query whole buckets: a scheduled end may fall inside the final visible
    // aggregate candle, later than that candle's opening timestamp.
    const fromTs = first.timestamp;
    const next = bars[lastIdx + 1];
    const toTs = next ? next.timestamp - 1 : Infinity;
    const lines = sweptLevels.query(fromTs, toTs);
    for (const line of activeLevels) {
      if (line.toTs >= fromTs && line.fromTs <= toTs) lines.push(line);
    }
    lines.sort((a, b) => levelOrder.get(a) - levelOrder.get(b));
    return sessionLevelRanges(lines, bars);
  }

  function getRanges() {
    if (destroyed) return [];
    const bars = instance.getDataList();
    const range = instance.getVisibleRange();
    const fromIdx = visibleFromIdx(store.t, replay.cursor, bars, range);
    const sessionFrom = visibleFromIdx(store.t, replay.cursor, bars, range, SESSION_LOOKBACK_MS);
    const key = [fromIdx, sessionFrom, replay.cursor, replay.generation, bars.length,
      bars[0]?.timestamp, bars.at(-1)?.timestamp].join(':');
    if (key !== cachedKey) {
      const boxes = sessions.get(replay.cursor, sessionFrom, settings.zones);
      // Keep the visible box boundary, but retain H/L from its entire session.
      const visibleBoxes = boxes.filter(box => box.lastIdx >= fromIdx)
        .map(box => ({ ...box, firstIdx: Math.max(box.firstIdx, fromIdx) }));
      cachedRanges = sessionRanges(visibleBoxes, store.t, replay.cursor, bars);
      cachedKey = key;
    }
    return cachedRanges;
  }

  function createRsi() {
    const rsiId = instance.createIndicator({ name: RSI, paneId: RSI_PANE, calcParams: [14] }, false);
    if (rsiId === null) throw new Error('Could not create RSI pane');
    instance.setPaneOptions({ id: RSI_PANE, height: 140, minHeight: 80 });
  }
  function createZones() {
    instance.createIndicator({ name: ZONES, paneId: MAIN, extendData: { getRanges, getLevelLines },
      zLevel: -1 }, true);
  }
  createRsi();
  // Native axis label rendering reads the chart-wide indicator mark styles.
  instance.setStyles({ indicator: { lastValueMark: { show: true, text: { show: true } } } });
  createZones();

  function setMa50(enabled) {
    if (destroyed || maEnabled === enabled) return;
    maEnabled = enabled;
    if (enabled) instance.createIndicator({ name: MA, paneId: MAIN, calcParams: [50] }, true);
    else instance.removeIndicator({ name: MA, paneId: MAIN });
  }

  function setZones(enabled) {
    if (destroyed || zonesEnabled === enabled) return;
    zonesEnabled = enabled;
    if (enabled) createZones();
    else instance.removeIndicator({ name: ZONES, paneId: MAIN });
  }

  function setRsi(enabled) {
    if (destroyed || rsiEnabled === enabled) return;
    rsiEnabled = enabled;
    if (enabled) createRsi();
    else instance.removeIndicator({ name: RSI, paneId: RSI_PANE });
  }

  function update() {
    if (destroyed) return;
    cachedKey = undefined;
    getRanges();
    if (rsiEnabled) instance.overrideIndicator({ name: RSI, calcParams: [14] });
    if (maEnabled) instance.overrideIndicator({ name: MA, calcParams: [50] });
    if (zonesEnabled) instance.overrideIndicator({ name: ZONES, extendData: { getRanges, getLevelLines } });
  }

  // Includes scroll/zoom and changes caused by asynchronously prepended pages.
  const onRange = () => {
    if (!destroyed && zonesEnabled) instance.overrideIndicator({ name: ZONES, extendData: { getRanges, getLevelLines } });
  };
  instance.subscribeAction('onVisibleRangeChange', onRange);
  setMa50(true);
  update();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    instance.unsubscribeAction('onVisibleRangeChange', onRange);
    for (const name of [RSI, MA, ZONES]) instance.removeIndicator({ name });
    cachedRanges = [];
    completedSessions.clear();
    activeLevels.clear();
    sweptLevels = createLevelIndex(store.t[0], store.t.at(-1));
  }
  return { update, setMa50, setZones, setRsi, destroy };
}
