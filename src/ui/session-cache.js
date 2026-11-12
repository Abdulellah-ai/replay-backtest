import { computeSessions } from '../core/sessions.js';
import { nyParts } from '../core/time.js';

const CHUNK_SIZE = 32;

// Discover historical sessions without formatting every M1 once per zone.
// Modern NY offsets and DST transitions fall on UTC hour boundaries. Within
// each UTC hour only the row's minute changes. Coalesce consecutive rows with
// identical session instances and NY date, preserving extrema and source indices.
// Core computeSessions still determines each session's calendar and schedule.
export function historicalSessions(store, cursor, zones, compute = computeSessions) {
  if (cursor < 0) return [];
  const enabled = zones.filter(zone => zone.enabled).map(zone => ({
    start: Number(zone.start.slice(0, 2)) * 60 + Number(zone.start.slice(3)),
    end: Number(zone.end.slice(0, 2)) * 60 + Number(zone.end.slice(3)),
  }));
  if (!enabled.length) return [];
  const compressed = { t: [], h: [], l: [] };
  const indices = [];
  let hour;
  let parts;
  let date;
  let key;
  let run;
  function flush() {
    if (!run) return;
    for (const index of run.first === run.last ? [run.first] : [run.first, run.last]) {
      compressed.t.push(store.t[index]);
      compressed.h.push(run.high);
      compressed.l.push(run.low);
      indices.push(index);
    }
  }
  for (let i = 0; i <= cursor; i += 1) {
    const timestamp = store.t[i];
    const nextHour = Math.floor(timestamp / 3600000);
    if (nextHour !== hour) {
      hour = nextHour;
      parts = nyParts(timestamp);
      date = `${parts.y}:${parts.mo}:${parts.d}`;
    }
    const minute = parts.h * 60 + Math.floor(timestamp / 60000) % 60;
    const membership = enabled.map(({ start, end }) => {
      if (end <= start) {
        // Early and late rows on one NY date belong to different sessions,
        // even when a data gap skips every out-of-zone row between them.
        if (minute < end) return 'previous';
        return minute >= start ? 'current' : 'none';
      }
      return minute >= start && minute < end ? 'current' : 'none';
    }).join(':');
    const nextKey = `${date}:${membership}`;
    if (nextKey !== key) {
      flush();
      key = nextKey;
      run = { first: i, last: i, high: store.h[i], low: store.l[i] };
    } else {
      run.last = i;
      run.high = Math.max(run.high, store.h[i]);
      run.low = Math.min(run.low, store.l[i]);
    }
  }
  flush();
  return compute(compressed, compressed.t.length - 1, 0, zones).map(box => ({ ...box,
    firstIdx: indices[box.firstIdx], lastIdx: indices[box.lastIdx],
  }));
}

function mergeBoxes(groups, now, zoneOrder) {
  const merged = new Map();
  for (const boxes of groups) {
    for (const box of boxes) {
      const key = JSON.stringify([box.zoneId, box.startTs]);
      const prior = merged.get(key);
      if (prior) {
        prior.firstIdx = Math.min(prior.firstIdx, box.firstIdx);
        prior.lastIdx = Math.max(prior.lastIdx, box.lastIdx);
        prior.high = Math.max(prior.high, box.high);
        prior.low = Math.min(prior.low, box.low);
      } else merged.set(key, { ...box });
    }
  }
  return [...merged.values()].map(box => ({ ...box, complete: now >= box.endTs }))
    .sort((a, b) => zoneOrder.get(a.zoneId) - zoneOrder.get(b.zoneId) || a.startTs - b.startTs);
}

// Cache fixed M1 chunks rather than rescanning the whole visible history on
// every tick. Only the first partial chunk and newly revealed rows need work.
// Core computeSessions remains the authority for NY membership and scheduling.
export function createSessionCache(store, compute = computeSessions) {
  const chunks = new Map();
  let boundary;
  let settingsKey;
  let zoneOrder;

  function get(cursor, fromIdx, zones) {
    if (cursor < fromIdx) return [];
    const key = JSON.stringify(zones);
    if (key !== settingsKey) {
      chunks.clear();
      boundary = undefined;
      settingsKey = key;
      zoneOrder = new Map(zones.map((zone, index) => [zone.id, index]));
    }
    const groups = [];
    for (let start = fromIdx; start <= cursor;) {
      const end = Math.min(cursor, (Math.floor(start / CHUNK_SIZE) + 1) * CHUNK_SIZE - 1);
      const partialStart = start % CHUNK_SIZE !== 0;
      let entry = partialStart ? boundary : chunks.get(start);
      if (!entry || entry.start !== start || entry.cursor > end) {
        entry = { start, cursor: end, boxes: compute(store, end, start, zones) };
      } else if (entry.cursor < end) {
        entry.boxes = mergeBoxes([entry.boxes, compute(store, end, entry.cursor + 1, zones)],
          store.t[end], zoneOrder);
        entry.cursor = end;
      }
      if (partialStart) boundary = entry;
      else chunks.set(start, entry);
      groups.push(entry.boxes);
      start = end + 1;
    }
    return mergeBoxes(groups, store.t[cursor], zoneOrder);
  }
  return { get };
}
