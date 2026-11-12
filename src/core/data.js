const MINUTE_MS = 60000;
const COLUMNS = ['t', 'o', 'h', 'l', 'c', 'v'];

export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataError';
  }
}

export function parseStore(json) {
  if (!json || typeof json.symbol !== 'string') {
    throw new DataError('Store must include a symbol');
  }
  if (!COLUMNS.every((key) => Array.isArray(json[key]))) {
    throw new DataError('Store must include arrays t, o, h, l, c, v');
  }
  const length = json.t.length;
  if (!COLUMNS.every((key) => json[key].length === length)) {
    throw new DataError('Column lengths must match');
  }
  for (let i = 0; i < length; i++) {
    for (const key of COLUMNS) {
      if (!Number.isFinite(json[key][i])) {
        throw new DataError(`Non-finite number in ${key} at row ${i}`);
      }
    }
    if (json.t[i] % MINUTE_MS !== 0) {
      throw new DataError(`Timestamp must align to a UTC minute at row ${i}`);
    }
    if (i > 0 && json.t[i] <= json.t[i - 1]) {
      throw new DataError(`Timestamps must be strictly increasing at row ${i}`);
    }
    if (json.h[i] < Math.max(json.o[i], json.c[i]) ||
        json.l[i] > Math.min(json.o[i], json.c[i])) {
      throw new DataError(`Inconsistent OHLC at row ${i}`);
    }
  }
  const store = { symbol: json.symbol, length };
  for (const key of COLUMNS) store[key] = new Float64Array(json[key]);
  return store;
}

export function findGaps(store) {
  const gaps = [];
  for (let i = 0; i < store.length - 1; i++) {
    const startTs = store.t[i];
    const endTs = store.t[i + 1];
    if (endTs - startTs <= MINUTE_MS) continue;
    // Count absent M1 rows, excluding the two existing boundary rows.
    const minutes = (endTs - startTs) / MINUTE_MS - 1;
    const start = new Date(startTs);
    const expected = minutes >= 55 && start.getUTCMinutes() === 59 &&
      (start.getUTCHours() === 20 || start.getUTCHours() === 21);
    gaps.push({ fromIdx: i, startTs, endTs, minutes, kind: expected ? 'expected' : 'unexplained' });
  }
  return gaps;
}
