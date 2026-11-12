import { rsi, sma } from '../core/indicators.js';

export const SESSION_COLORS = Object.freeze({
  ASIA: { fill: 'rgba(55,100,180,0.16)', border: 'rgba(55,100,180,0.7)' },
  LNDN: { fill: 'rgba(165,55,65,0.16)', border: 'rgba(165,55,65,0.7)' },
  NYAM: { fill: 'rgba(35,125,90,0.16)', border: 'rgba(35,125,90,0.7)' },
  NYPM: { fill: 'rgba(115,65,155,0.16)', border: 'rgba(115,65,155,0.7)' },
  grey: { fill: 'rgba(128,128,128,0.16)', border: 'rgba(128,128,128,0.7)' },
});

export function sessionColor(id) {
  return Object.hasOwn(SESSION_COLORS, id) ? SESSION_COLORS[id] : SESSION_COLORS.grey;
}

// At the renderer's 11px font, use a conservative seven pixels per character.
export function labelFits(boxWidthPx, text) {
  return boxWidthPx >= text.length * 7 + 6;
}

export function sessionLevelLines(boxes, times, highs, lows, cursor) {
  const end = Math.min(cursor, times.length - 1, highs.length - 1, lows.length - 1);
  if (end < 0) return [];
  return boxes.flatMap(box => {
    if (!['ASIA', 'LNDN', 'NYAM', 'NYPM'].includes(box.zoneId) ||
        !box.complete || box.lastIdx > end || times[end] < box.endTs) return [];
    return ['high', 'low'].map(kind => {
      const price = box[kind];
      const values = kind === 'high' ? highs : lows;
      let sweep = -1;
      for (let i = lowerBound(times, end + 1, box.endTs); i <= end; i += 1) {
        if (kind === 'high' ? values[i] > price : values[i] < price) { sweep = i; break; }
      }
      return { id: box.zoneId, kind, price, fromTs: box.endTs,
        toTs: times[sweep < 0 ? end : sweep], swept: sweep >= 0 };
    });
  });
}

export function sessionLevelRanges(lines, bars) {
  if (!bars.length) return [];
  return lines.map(line => ({ ...line,
    from: Math.max(-0.5, containingBar(bars, line.fromTs)),
    to: containingBar(bars, line.toTs),
  }));
}

// Search only the revealed prefix. Bucket timestamps can precede the first M1
// row when data is missing, so equality is not required.
function lowerBound(times, end, timestamp) {
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] < timestamp) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Sessions can request a lookback while drawing still begins at the viewport.
export function visibleFromIdx(times, cursor, bars, range, lookbackMs = 0) {
  const index = Math.max(0, Math.floor(range.from));
  if (!bars[index] || range.to <= 0) return cursor + 1;
  return lowerBound(times, cursor + 1, bars[index].timestamp - lookbackMs);
}

function containingBar(bars, timestamp) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (bars[mid].timestamp <= timestamp) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

// Coordinates span only candles containing revealed session rows, including
// their half-bar edges. Scheduled endTs never extends a box into future bars.
export function sessionRanges(boxes, times, cursor, bars) {
  if (!bars.length) return [];
  return boxes.flatMap(box => {
    if (box.firstIdx > cursor) return [];
    const from = containingBar(bars, times[box.firstIdx]);
    const to = containingBar(bars, times[Math.min(cursor, box.lastIdx)]);
    if (from < 0 || to < 0) return [];
    return [{ zoneId: box.zoneId, from: from - 0.5, to: to + 0.5,
      high: box.high, low: box.low }];
  });
}

export function indicatorValues(bars, key, period) {
  const closes = bars.map(bar => bar.close);
  const values = key === 'rsi' ? rsi(closes, period) : sma(closes, period);
  // Missing warmup results must stay absent, rather than render as zero.
  return values.map(value => value === null ? {} : { [key]: value });
}
