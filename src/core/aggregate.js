import { nyParts, nyWallToUtc } from './time.js';

const UTC_INTERVALS = {
  '1m': 60000,
  '5m': 5 * 60000,
  '15m': 15 * 60000,
  '1h': 60 * 60000,
  '4h': 4 * 60 * 60000,
  '1D': 24 * 60 * 60000,
};

export function bucketStart(tsMs, tf, dayAnchor = 'NY17') {
  if (tf === '1D' && dayAnchor === 'NY17') {
    const { y, mo, d, h } = nyParts(tsMs);
    // Move by a local calendar day, since DST days can be 23 or 25 hours.
    return nyWallToUtc(y, mo, d - (h < 17 ? 1 : 0), 17, 0);
  }
  const interval = UTC_INTERVALS[tf];
  return Math.floor(tsMs / interval) * interval;
}

function bucketEnd(start, tf, dayAnchor) {
  if (tf === '1D' && dayAnchor === 'NY17') {
    const { y, mo, d } = nyParts(start);
    return nyWallToUtc(y, mo, d + 1, 17, 0);
  }
  return start + UTC_INTERVALS[tf];
}

export function aggregateAll(store, tf, dayAnchor = 'NY17') {
  const bars = [];
  let firstIdx = 0;
  while (firstIdx < store.length) {
    const start = bucketStart(store.t[firstIdx], tf, dayAnchor);
    const end = bucketEnd(start, tf, dayAnchor);
    let nextIdx = firstIdx + 1;
    // Rows are strictly increasing, so a bucket is the run of rows below its end.
    while (nextIdx < store.length && store.t[nextIdx] < end) {
      nextIdx += 1;
    }
    // Include the last candidate; the replay consumer decides what is complete.
    bars.push({ ...buildPartial(store, firstIdx, nextIdx - 1), t: start });
    firstIdx = nextIdx;
  }
  return bars;
}

export function buildPartial(store, firstIdx, cursor) {
  let high = store.h[firstIdx];
  let low = store.l[firstIdx];
  let volume = 0;
  for (let i = firstIdx; i <= cursor; i += 1) {
    high = Math.max(high, store.h[i]);
    low = Math.min(low, store.l[i]);
    volume += store.v[i];
  }
  // Without a timeframe argument, t is the first existing source timestamp.
  return {
    t: store.t[firstIdx],
    o: store.o[firstIdx],
    h: high,
    l: low,
    c: store.c[cursor],
    v: volume,
    firstIdx,
    lastIdx: cursor,
  };
}
