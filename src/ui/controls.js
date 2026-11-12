import { advancePlayback, clampDivider, gapsInVisibleWindow, visibleTimeWindow,
  nearestRevealedBar, parseJumpDate, syncScrollTarget } from './controls-logic.js';
import { isMagnetEnabled, setMagnet, setTrendColour, setRectColour } from './drawing.js';
import { attachFibDialog } from './fibDialog.js';

export function attachControls({ usd, eur, master, settings, save }) {
  const panes = [usd, eur];
  const fibDialog = attachFibDialog(document.querySelector('#fib-dialog'), settings, save);
  const playButton = document.querySelector('#play');
  const speedInput = document.querySelector('#speed');
  const dateInput = document.querySelector('#jump-date');
  const syncInput = document.querySelector('#sync-crosshair');
  const scrollInput = document.querySelector('#sync-scroll');
  const timeframeInput = document.querySelector('#sync-timeframe');
  const levelsInput = document.querySelector('#session-levels');
  const gapInput = document.querySelector('#gap-warnings');
  const status = document.querySelector('#status');
  let playing = false;
  let frameId;
  let lastTime = 0;
  let accumulator = 0;
  let mirroring = false;
  let syncingScroll = false;
  let syncingTimeframe = false;
  let updatingCharts = false;
  // USD wins until the first manual timeframe change; mirrored changes do not
  // replace this choice when sync is later re-enabled.
  let lastTimeframePane = usd;
  const mirrored = new Set();

  // Crosshair coordinates are optional. An empty position resets legend data
  // to the latest candle as well as clearing the mirrored coordinates.
  function clearMirrors() {
    for (const pane of mirrored) {
      pane.chart.instance.executeAction('onCrosshairChange', {});
      pane.chart.instance.setStyles({ crosshair: { show: false } });
    }
    mirrored.clear();
  }

  function updateGap(pane) {
    const instance = pane.chart.instance;
    const window = visibleTimeWindow(instance.getDataList(), instance.getVisibleRange(), master.time);
    const gaps = settings.gapWarnings === false ? [] :
      gapsInVisibleWindow(pane.gaps, window, Math.min(master.time, pane.replay.time));
    const banner = pane.root.querySelector('.gap-banner');
    banner.hidden = gaps.length === 0;
    banner.textContent = gaps.map(gap => `${pane.store.symbol}: unexplained gap ` +
      `${new Date(gap.startTs).toISOString()} to ${new Date(gap.endTs).toISOString()} ` +
      `(UTC; ${gap.minutes} missing minutes)`).join(' | ');
  }

  function updateTime() {
    const text = `${new Date(master.time).toISOString()} (UTC)`;
    document.querySelector('#master-time').textContent = `Master: ${text}`;
    for (const pane of panes) pane.root.querySelector('.pane-time').textContent = text;
    dateInput.value = text.slice(0, 10);
  }

  function render() {
    updatingCharts = true;
    try {
      clearMirrors();
      usd.chart.push();
      eur.chart.push({ continuous: true });
      for (const pane of panes) {
        pane.indicators.update();
        updateGap(pane);
      }
      updateTime();
    } finally { updatingCharts = false; }
  }

  function advance(kind) {
    if (!master[kind]()) return false;
    eur.replay.seekToTime(master.time);
    return true;
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frameId);
    accumulator = 0;
    playButton.textContent = 'Play';
  }

  function tick(now) {
    if (!playing) return;
    const next = advancePlayback(accumulator, now - lastTime, Number(speedInput.value),
      usd.store.length - 1 - master.cursor);
    lastTime = now;
    accumulator = next.accumulator;
    for (let row = 0; row < next.rows; row += 1) advance('stepM1');
    if (next.rows) render();
    if (next.done) { pause(); return; }
    frameId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing || master.cursor >= usd.store.length - 1) return;
    playing = true;
    lastTime = performance.now();
    playButton.textContent = 'Pause';
    frameId = requestAnimationFrame(tick);
  }

  function step(kind) {
    pause();
    if (advance(kind)) render();
  }

  function jumpToTime(time) {
    pause();
    if (!Number.isFinite(time) || time < usd.store.t[0] || time > usd.store.t.at(-1)) {
      status.textContent = 'Choose a UTC date within the XAUUSD data range.';
      return false;
    }
    master.seekToTime(time);
    eur.replay.seekToTime(master.time);
    updatingCharts = true;
    try {
      clearMirrors();
      for (const pane of panes) {
        pane.chart.refresh();
        pane.indicators.update();
        updateGap(pane);
      }
      updateTime();
    } finally { updatingCharts = false; }
    status.textContent = '';
    return true;
  }

  function settingsChanged() {
    syncInput.checked = settings.syncCrosshair;
    scrollInput.checked = settings.syncScroll;
    timeframeInput.checked = settings.syncTimeframe;
    levelsInput.checked = settings.sessionLevels;
    gapInput.checked = settings.gapWarnings;
    for (const pane of panes) updateGap(pane);
    if (!settings.syncCrosshair) clearMirrors();
    for (const pane of panes) {
      const select = pane.root.querySelector('.fib-preset');
      select.replaceChildren(...settings.fibPresets.map(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        return option;
      }));
      select.value = settings.activeFibPreset;
    }
  }

  playButton.addEventListener('click', () => playing ? pause() : play());
  document.querySelector('#step-m1').addEventListener('click', () => step('stepM1'));
  document.querySelector('#step-bar').addEventListener('click', () => step('stepBar'));
  document.querySelector('#jump').addEventListener('click', () => {
    const time = parseJumpDate(dateInput.value);
    if (time === null) { status.textContent = 'Enter a valid UTC date.'; return; }
    jumpToTime(time);
  });
  dateInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') document.querySelector('#jump').click();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  syncInput.addEventListener('change', () => save({ ...settings, syncCrosshair: syncInput.checked }));
  scrollInput.addEventListener('change', () => save({ ...settings, syncScroll: scrollInput.checked }));
  levelsInput.addEventListener('change', () => save({ ...settings, sessionLevels: levelsInput.checked }));
  gapInput.addEventListener('change', () => save({ ...settings, gapWarnings: gapInput.checked }));
  timeframeInput.addEventListener('change', () => {
    save({ ...settings, syncTimeframe: timeframeInput.checked });
    if (settings.syncTimeframe) {
      const other = panes.find(pane => pane !== lastTimeframePane);
      const value = lastTimeframePane.root.querySelector('.timeframe').value;
      if (other.root.querySelector('.timeframe').value !== value) changeTimeframe(other, value);
    }
  });

  function changeTimeframe(pane, value) {
    const previousUpdating = updatingCharts;
    const previousSyncing = syncingTimeframe;
    updatingCharts = true;
    syncingTimeframe = true;
    try {
      clearMirrors();
      pane.root.querySelector('.timeframe').value = value;
      pane.replay.setTimeframe(value);
      pane.chart.refresh();
      pane.indicators.update();
      updateGap(pane);
    } finally {
      updatingCharts = previousUpdating;
      syncingTimeframe = previousSyncing;
    }
  }

  function syncScroll(source, target) {
    if (!settings.syncScroll || syncingScroll || updatingCharts) return;
    const bars = source.getDataList();
    const range = source.getVisibleRange();
    const first = bars[Math.max(0, Math.floor(range.from))];
    const last = bars[Math.min(bars.length - 1, Math.ceil(range.to) - 1)];
    if (!first || !last) return;
    const mapped = syncScrollTarget({ fromTs: first.timestamp, toTs: last.timestamp },
      target.getDataList().map(bar => bar.timestamp));
    if (!mapped) return;
    const width = target.getSize('candle_pane', 'main')?.width;
    if (!(width > 0)) return;
    syncingScroll = true;
    try {
      // Default two-candle edge constraints shift narrow windows away from
      // the oldest/latest candle. Public setters round fractions upward.
      target.setLeftMinVisibleBarCount(0);
      target.setRightMinVisibleBarCount(0);
      // v10 includes one edge candle in from/to. Fit endpoint distance and
      // offset by half a bar so to is exclusive at the desired last candle.
      const space = width / Math.max(0.5, mapped.toIndex - mapped.fromIndex);
      const limits = target.getLayoutOptions().barSpaceLimit;
      // setBarSpace rejects values outside these limits rather than clamping.
      // Different timeframes can require subpixel or very wide candles.
      if (space < limits.min || space > limits.max) {
        target.setLayoutOptions({ barSpaceLimit: {
          min: Math.min(limits.min, space), max: Math.max(limits.max, space),
        } });
      }
      target.setBarSpace(space);
      target.scrollToDataIndex(mapped.toIndex - 0.5, 0);
    } finally { syncingScroll = false; }
  }

  for (const [index, pane] of panes.entries()) {
    const other = panes[1 - index];
    const instance = pane.chart.instance;
    pane.root.querySelector('.timeframe').addEventListener('change', event => {
      if (syncingTimeframe) return;
      lastTimeframePane = pane;
      syncingTimeframe = true;
      try {
        changeTimeframe(pane, event.target.value);
        if (settings.syncTimeframe) changeTimeframe(other, event.target.value);
      } finally { syncingTimeframe = false; }
    });
    pane.root.querySelector('.ma50').addEventListener('change', event => pane.indicators.setMa50(event.target.checked));
    pane.root.querySelector('.zones-toggle').addEventListener('change', event => pane.indicators.setZones(event.target.checked));
    pane.root.querySelector('.rsi-toggle').addEventListener('change', event => pane.indicators.setRsi(event.target.checked));
    const magnet = pane.root.querySelector('.magnet');
    magnet.setAttribute('aria-pressed', String(isMagnetEnabled()));
    magnet.addEventListener('click', () => {
      setMagnet(!isMagnetEnabled());
      for (const item of panes) item.root.querySelector('.magnet')
        .setAttribute('aria-pressed', String(isMagnetEnabled()));
    });
    for (const swatch of pane.root.querySelectorAll('[data-trend-colour]')) {
      swatch.addEventListener('click', () => {
        setTrendColour(pane.chart, swatch.dataset.trendColour);
        for (const button of pane.root.querySelectorAll('[data-trend-colour]')) {
          button.setAttribute('aria-pressed', String(button === swatch));
        }
      });
    }
    for (const swatch of pane.root.querySelectorAll('[data-rect-colour]')) {
      swatch.addEventListener('click', () => {
        setRectColour(pane.chart, swatch.dataset.rectColour);
        for (const button of pane.root.querySelectorAll('[data-rect-colour]')) {
          button.setAttribute('aria-pressed', String(button === swatch));
        }
      });
    }
    pane.root.querySelector('.fib-preset').addEventListener('change', event => {
      save({ ...settings, activeFibPreset: event.target.value });
    });
    pane.root.querySelector('.fib-levels').addEventListener('click', () => { pause(); fibDialog.open(); });
    for (const button of pane.root.querySelectorAll('[data-draw]')) {
      button.addEventListener('click', () => {
        const kind = button.dataset.draw;
        if (kind === 'clear') pane.drawing.clearDrawings();
        else {
          const preset = settings.fibPresets.find(item => item.id === settings.activeFibPreset);
          pane.drawing.startDrawing(kind, { levels: preset.levels, colors: preset.colors });
        }
      });
    }
    const surface = pane.root.querySelector('.chart');
    surface.addEventListener('pointerenter', () => {
      mirrored.delete(pane);
      instance.setStyles({ crosshair: { show: true } });
    });
    surface.addEventListener('pointerleave', clearMirrors);
    instance.subscribeAction('onVisibleRangeChange', () => updateGap(pane));
    // Data delivery (including async history and replay pushes) changes the
    // visible range too. Only explicit scroll/zoom actions initiate syncing.
    for (const action of ['onScroll', 'onZoom']) {
      instance.subscribeAction(action, () => syncScroll(instance, other.chart.instance));
    }
    instance.subscribeAction('onCrosshairChange', event => {
      if (mirroring || !settings.syncCrosshair) return;
      if (!Number.isFinite(event?.x) || !event.paneId) { clearMirrors(); return; }
      const [point] = instance.convertFromPixel([{ x: event.x }], { paneId: event.paneId });
      if (!Number.isFinite(point?.timestamp)) { clearMirrors(); return; }
      const target = other.chart.instance;
      const bar = nearestRevealedBar(target.getDataList(), point.timestamp, master.time);
      if (!bar) { clearMirrors(); return; }
      const pixel = target.convertToPixel({ timestamp: bar.timestamp, value: bar.close }, { paneId: 'candle_pane' });
      if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) { clearMirrors(); return; }
      mirroring = true;
      try {
        target.setStyles({ crosshair: { show: true } });
        target.executeAction('onCrosshairChange', { x: pixel.x, y: pixel.y, paneId: 'candle_pane' });
        mirrored.add(other);
      } finally { mirroring = false; }
    });
  }

  const container = document.querySelector('#panes');
  const divider = document.querySelector('#divider');
  let pointerId = null;
  let split = 0.5;
  function resize() { for (const pane of panes) pane.chart.instance.resize(); }
  function setSplit(value) {
    split = clampDivider(value);
    container.style.setProperty('--split', `${split * 100}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    resize();
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    divider.setPointerCapture(pointerId);
    document.body.classList.add('resizing');
    event.preventDefault();
  });
  divider.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId) return;
    const rect = container.getBoundingClientRect();
    if (rect.width > 0) setSplit((event.clientX - rect.left) / rect.width);
  });
  function endDrag() { pointerId = null; document.body.classList.remove('resizing'); }
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('lostpointercapture', endDrag);
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setSplit(split + (event.key === 'ArrowLeft' ? -0.02 : 0.02));
  });
  window.addEventListener('resize', resize);
  settingsChanged();
  updateTime();
  for (const pane of panes) updateGap(pane);
  resize();
  return { play, pause, stepM1: () => step('stepM1'), stepBar: () => step('stepBar'),
    jumpToTime, settingsChanged, get playing() { return playing; } };
}
