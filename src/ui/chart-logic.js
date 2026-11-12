export function toCandle({ t, o, h, l, c, v }) {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
}

export function toPeriod(tf) {
  switch (tf) {
    case '1m': return { type: 'minute', span: 1 };
    case '5m': return { type: 'minute', span: 5 };
    case '15m': return { type: 'minute', span: 15 };
    case '1h': return { type: 'hour', span: 1 };
    case '4h': return { type: 'hour', span: 4 };
    case '1D': return { type: 'day', span: 1 };
    default: throw new Error(`Unsupported timeframe: ${tf}`);
  }
}

// Snapshot before waiting; null means the caller must not invoke its callback.
export async function loadReplayPage(replay, {
  limit = 1500, beforeTs, loadHook, isCurrent = () => true,
} = {}) {
  const generation = replay.generation;
  const bars = replay.barsAt(limit, beforeTs);
  if (loadHook) await loadHook();
  if (replay.generation !== generation || !isCurrent()) return null;
  return bars;
}
