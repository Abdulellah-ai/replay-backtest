import { toCandle, toPeriod, loadReplayPage } from './chart-logic.js';
import { attachAxisGuard } from './axis-guard.js';

const WINDOW_SIZE = 1500;

// TradingView-like candle colours (teal up, red down), same colour for body, border and wick.
export const CANDLE_UP = '#089981';
export const CANDLE_DOWN = '#f23645';

export function createChart(el, replay, options = {}) {
  const api = globalThis.klinecharts;
  const instance = api.init(el);
  if (!instance) throw new Error('Could not initialize klinecharts');
  instance.setStyles('dark');
  instance.setStyles({ candle: { bar: {
    upColor: CANDLE_UP, upBorderColor: CANDLE_UP, upWickColor: CANDLE_UP,
    downColor: CANDLE_DOWN, downBorderColor: CANDLE_DOWN, downWickColor: CANDLE_DOWN,
  } } });
  const detachAxisGuard = attachAxisGuard(el, instance);

  let destroyed = false;
  let revision = 0;
  let generation = replay.generation;
  let timeframe = replay.tf;
  let lastCursor = replay.cursor;
  const pendingLoads = new Set();
  let updateBar;
  // Only older-page requests wait. A hook can hold a request until a test releases it.
  const loadHook = options.loadHook ?? (() => new Promise((resolve) => {
    setTimeout(resolve, options.loadDelayMs ?? 0);
  }));

  function deliver(callback, bars) {
    const first = bars[0];
    const hasOlder = first !== undefined && replay.barsAt(1, first.t).length > 0;
    // In v10, forward means older history; backward means newer history.
    callback(bars.map(toCandle), { forward: hasOlder, backward: false });
  }

  instance.setDataLoader({
    async getBars({ type, timestamp, callback }) {
      if (destroyed) return;
      if (type === 'init') {
        deliver(callback, replay.barsAt(WINDOW_SIZE));
        return;
      }
      if (type !== 'forward' || timestamp === null) {
        callback([], { forward: false, backward: false });
        return;
      }
      const startedRevision = revision;
      const startedGeneration = replay.generation;
      const request = {};
      pendingLoads.add(request);
      const isCurrent = () => !destroyed && revision === startedRevision &&
        replay.generation === startedGeneration;
      try {
        const bars = await loadReplayPage(replay, {
          limit: WINDOW_SIZE, beforeTs: timestamp, loadHook, isCurrent,
        });
        if (bars !== null && isCurrent()) deliver(callback, bars);
      } catch (error) {
        // Release a current failed request, but never call a stale loader callback.
        if (isCurrent()) {
          callback([], { forward: false, backward: false });
          console.error('Could not load replay history', error);
        }
      } finally {
        pendingLoads.delete(request);
      }
    },
    subscribeBar({ callback }) {
      updateBar = callback;
    },
    unsubscribeBar() {
      updateBar = undefined;
    },
  });
  instance.setSymbol({ ticker: options.store?.symbol ?? 'Replay', pricePrecision: 2, volumePrecision: 2 });

  function refresh() {
    if (destroyed) return;
    revision += 1;
    generation = replay.generation;
    timeframe = replay.tf;
    lastCursor = replay.cursor;
    pendingLoads.clear();
    updateBar = undefined;
    // A fresh Period object also resets the data after a seek in the same timeframe.
    instance.setPeriod(toPeriod(replay.tf));
  }

  function push({ continuous = false } = {}) {
    if (destroyed) return;
    if (generation !== replay.generation) {
      // Master-clock forward seeks can stream without resetting the viewport.
      // A pending older page must reset: its stale callback is never delivered.
      if (!continuous || replay.tf !== timeframe || replay.cursor < lastCursor || pendingLoads.size) {
        refresh();
        return;
      }
      generation = replay.generation;
    }
    const lastTimestamp = instance.getDataList().at(-1)?.timestamp;
    if (!updateBar || lastTimestamp === undefined) {
      refresh();
      return;
    }
    // One master stepBar or animation frame may reveal many bars on this pane.
    const bars = replay.barsAt(Math.max(1, replay.cursor - lastCursor + 1));
    for (const bar of bars) {
      if (bar.t >= lastTimestamp) updateBar(toCandle(bar));
    }
    lastCursor = replay.cursor;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    revision += 1;
    updateBar = undefined;
    detachAxisGuard();
    api.dispose(instance);
  }

  refresh();
  // Replay intentionally keeps its source private; UI consumers receive the
  // same store explicitly without changing core replay or duplicating M1 data.
  return { refresh, push, destroy, instance, sourceStore: options.store };
}
