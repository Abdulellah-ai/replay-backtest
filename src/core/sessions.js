import { nyParts, nyMinuteOfDay, nyWallToUtc } from './time.js';

const MINUTE_MS = 60000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function minuteOfDay(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function contains(minute, start, end) {
  return end <= start
    ? minute >= start || minute < end
    : minute >= start && minute < end;
}

export function inZone(tsMs, zone) {
  return contains(nyMinuteOfDay(tsMs), minuteOfDay(zone.start), minuteOfDay(zone.end));
}

function scheduledUtc(date, minute) {
  // This UTC value is calendar arithmetic on NY wall fields, not an instant.
  let wall = date + minute * MINUTE_MS;
  for (;;) {
    const fields = new Date(wall);
    try {
      return nyWallToUtc(fields.getUTCFullYear(), fields.getUTCMonth() + 1,
        fields.getUTCDate(), fields.getUTCHours(), fields.getUTCMinutes());
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // A missing wall minute belongs to the DST gap. Seek the first valid one.
      wall += MINUTE_MS;
    }
  }
}

export function computeSessions(store, cursor, fromIdx, zones) {
  if (cursor < fromIdx) return [];
  const boxes = [];
  const now = store.t[cursor];
  for (const zone of zones) {
    if (!zone.enabled) continue;
    const start = minuteOfDay(zone.start);
    const end = minuteOfDay(zone.end);
    const wraps = end <= start;
    const instances = new Map();
    for (let i = fromIdx; i <= cursor; i += 1) {
      const { y, mo, d, h, mi } = nyParts(store.t[i]);
      const minute = h * 60 + mi;
      if (!contains(minute, start, end)) continue;
      // After-midnight rows belong to the preceding NY start date.
      const date = Date.UTC(y, mo - 1, d) - (wraps && minute < start ? DAY_MS : 0);
      let box = instances.get(date);
      if (!box) {
        const endTs = scheduledUtc(date + (wraps ? DAY_MS : 0), end);
        box = {
          zoneId: zone.id,
          startTs: scheduledUtc(date, start),
          endTs,
          firstIdx: i,
          lastIdx: i,
          high: store.h[i],
          low: store.l[i],
          complete: now >= endTs,
        };
        instances.set(date, box);
        boxes.push(box);
      } else {
        box.lastIdx = i;
        box.high = Math.max(box.high, store.h[i]);
        box.low = Math.min(box.low, store.l[i]);
      }
    }
  }
  return boxes;
}
