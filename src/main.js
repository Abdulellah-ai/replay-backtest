import { parseStore, findGaps } from './core/data.js';
import { Replay } from './core/replay.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { createChart } from './ui/chart.js';
import { attachIndicators } from './ui/indicators.js';
import { startDrawing, clearDrawings } from './ui/drawing.js';
import { attachControls } from './ui/controls.js';
import { attachKzDialog } from './ui/kzDialog.js';

async function loadStore(symbol) {
  const response = await fetch(`data/${symbol}_m1.json`);
  if (!response.ok) throw new Error(`Could not load ${symbol} data: ${response.status}`);
  const store = parseStore(await response.json());
  if (!store.length) throw new Error(`No ${symbol} rows available`);
  return store;
}

async function main() {
  let settings;
  try { settings = loadSettings(localStorage); }
  catch { settings = loadSettings(null); }
  const [usdStore, eurStore] = await Promise.all([loadStore('XAUUSD'), loadStore('XAUEUR')]);
  const startIdx = usdStore.t.findIndex(time => time >= Date.parse('2026-06-01T00:00:00Z'));
  if (startIdx < 0) throw new Error('No XAUUSD rows at or after June 1, 2026');
  const master = new Replay(usdStore, { startIdx, tf: '1h', dayAnchor: 'NY17' });
  const eurReplay = new Replay(eurStore, { startIdx: 0, tf: '1h', dayAnchor: 'NY17' });
  eurReplay.seekToTime(master.time);

  function makePane(root, store, replay) {
    root.querySelector('.pane-controls').append(document.querySelector('#pane-tools').content.cloneNode(true));
    root.querySelector('.drawing-toolbar').append(document.querySelector('#drawing-tools').content.cloneNode(true));
    const chart = createChart(root.querySelector('.chart'), replay, { store });
    chart.instance.setTimezone('UTC');
    const indicators = attachIndicators(chart, replay, settings);
    const drawing = { startDrawing: (kind, options) => startDrawing(chart, kind, options), clearDrawings: () => clearDrawings(chart) };
    return { root, store, replay, chart, indicators, drawing, gaps: findGaps(store) };
  }

  const usd = makePane(document.querySelector('#usd-pane'), usdStore, master);
  const eur = makePane(document.querySelector('#eur-pane'), eurStore, eurReplay);
  const status = document.querySelector('#status');
  const controls = attachControls({ usd, eur, master, settings, save: applySettings });

  function applySettings(candidate) {
    let warning = '';
    try {
      const saved = saveSettings(localStorage, candidate);
      if (!saved.ok) { status.textContent = saved.error; return; }
    } catch {
      warning = 'Settings applied for this session. Browser storage is unavailable.';
    }
    Object.assign(settings, candidate);
    usd.indicators.update();
    eur.indicators.update();
    controls.settingsChanged();
    status.textContent = warning;
  }

  const kzDialog = attachKzDialog(document.querySelector('#kz-dialog'), settings, applySettings);
  document.querySelector('#kill-zones').addEventListener('click', () => {
    controls.pause();
    kzDialog.open();
  });
  for (const input of document.querySelectorAll('#controls button, #controls input, #controls select')) {
    input.disabled = false;
  }
  // Keep the former single-pane handles as inexpensive aliases for manager probes.
  window.__app = { usd, eur, master, settings, controls, kzDialog,
    store: usd.store, replay: master, chart: usd.chart, indicators: usd.indicators,
    drawing: { startDrawing, clearDrawings } };
}

main().catch(error => {
  document.querySelector('#master-time').textContent = 'Could not start replay';
  document.querySelector('#status').textContent = error.message;
  console.error(error);
});
