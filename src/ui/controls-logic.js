import { validateSettings } from '../core/settings.js';

// Credit is measured in M1 rows, not market minutes: missing rows cost no steps.
export function advancePlayback(accumulator, elapsedMs, speed, remainingRows) {
  const credit = accumulator + Math.max(0, elapsedMs) * speed / 1000;
  const rows = Math.min(remainingRows, Math.floor(credit + 1e-9));
  const done = rows >= remainingRows;
  return { rows, accumulator: done ? 0 : Math.max(0, credit - rows), done };
}

export function parseSettingsForm(settings, rows) {
  if (rows.length !== settings.zones.length) {
    return { ok: false, error: 'Every zone must have a form row.' };
  }
  return validateSettings({ ...settings, zones: settings.zones.map((zone, index) => ({
    ...zone, enabled: rows[index].enabled, start: rows[index].start, end: rows[index].end,
  })) });
}

// Short holes (a few missing M1 rows) are normal in tick-built data; only warn
// when at least this many minutes are missing in a row.
export const MIN_WARN_GAP_MINUTES = 10;

export function gapsInVisibleWindow(gaps, window, masterTime) {
  if (!window) return [];
  return gaps.filter(gap => gap.kind === 'unexplained' && gap.minutes >= MIN_WARN_GAP_MINUTES &&
    gap.endTs <= masterTime &&
    gap.startTs <= window.toTs && gap.endTs >= window.fromTs);
}

export function visibleTimeWindow(bars, range, masterTime) {
  const first = Math.max(0, Math.floor(range.from));
  const last = Math.min(bars.length - 1, Math.ceil(range.to) - 1);
  if (!bars[first] || last < first) return null;
  return { fromTs: bars[first].timestamp,
    toTs: Math.min(masterTime, bars[last + 1]?.timestamp - 1 || masterTime) };
}

export function clampDivider(fraction) {
  return Math.max(0.2, Math.min(0.8, fraction));
}

export function nearestRevealedBar(bars, timestamp, masterTime) {
  const time = Math.min(timestamp, masterTime);
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (bars[mid].timestamp <= time) lo = mid + 1;
    else hi = mid;
  }
  return bars[lo - 1] ?? null;
}

export function parseJumpDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

// Match each endpoint to its containing (earlier) target candle. Loaded history
// must contain the full window; different timeframes must never reuse source bar indices.
export function syncScrollTarget(window, timestamps) {
  if (!window || !timestamps.length || !Number.isFinite(window.fromTs) ||
      !Number.isFinite(window.toTs) || window.toTs < window.fromTs ||
      window.fromTs < timestamps[0] || window.toTs > timestamps.at(-1)) return null;
  function indexAt(time) {
    let lo = 0;
    let hi = timestamps.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (timestamps[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
  return { fromIndex: indexAt(window.fromTs), toIndex: indexAt(window.toTs) };
}


export function clampJumpTime(time, first, last) {
  const target = Math.max(first, Math.min(last, time));
  return { time: target, clamped: target !== time };
}

export function selectBarTarget(clickedTimestamp, first, last) {
  if (!Number.isFinite(clickedTimestamp)) return null;
  return clampJumpTime(clickedTimestamp, first, last).time;
}
