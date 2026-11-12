import { aggregateAll, buildPartial } from './aggregate.js';

// Return the first index after a sorted prefix satisfying the predicate.
function upperBound(length, includes) {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (includes(mid)) low = mid + 1;
    else high = mid;
  }
  return low;
}

export class Replay {
  #store;
  #dayAnchor;
  #cache = new Map();

  constructor(store, { startIdx, tf, dayAnchor }) {
    this.#store = store;
    this.#dayAnchor = dayAnchor;
    this.cursor = startIdx;
    this.tf = tf;
    this.generation = 0;
  }

  get time() {
    return this.#store.t[this.cursor];
  }

  #bars() {
    if (!this.#cache.has(this.tf)) {
      this.#cache.set(this.tf, aggregateAll(this.#store, this.tf, this.#dayAnchor));
    }
    return this.#cache.get(this.tf);
  }

  stepM1() {
    if (this.cursor >= this.#store.length - 1) return false;
    this.cursor += 1;
    return true;
  }

  stepBar() {
    if (this.cursor >= this.#store.length - 1) return false;
    const bars = this.#bars();
    let index = upperBound(bars.length, (i) => bars[i].firstIdx <= this.cursor) - 1;
    if (index < 0 || bars[index].lastIdx === this.cursor) index += 1;
    this.cursor = bars[index].lastIdx;
    return true;
  }

  seekToTime(ms) {
    this.cursor = upperBound(this.#store.length, (i) => this.#store.t[i] <= ms) - 1;
    this.generation += 1;
    return this.cursor;
  }

  setTimeframe(tf) {
    this.tf = tf;
    this.generation += 1;
  }

  barsAt(limit, beforeTs = Infinity) {
    if (limit <= 0) return [];
    const bars = this.#bars();
    const end = upperBound(bars.length,
      (i) => bars[i].firstIdx <= this.cursor && bars[i].t < beforeTs);
    const visible = bars.slice(Math.max(0, end - limit), end);
    const last = visible.at(-1);
    if (last && last.lastIdx > this.cursor) {
      // buildPartial knows source rows, while t must retain the bucket boundary.
      visible[visible.length - 1] = {
        ...buildPartial(this.#store, last.firstIdx, this.cursor), t: last.t,
      };
    }
    return visible;
  }
}
