import { getHistoricalRates } from 'dukascopy-node';
import { mkdir, writeFile } from 'node:fs/promises';

const [symbol, from = '2026-03-08', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const sym = symbol?.toUpperCase();
if (!['XAUUSD', 'XAUEUR'].includes(sym)) {
  throw new Error('Usage: node tools/fetch-data.mjs <XAUUSD|XAUEUR> [from] [to]');
}
if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) >= Date.parse(to)) {
  throw new Error('Dates must be valid and from must precede to');
}

const data = await getHistoricalRates({
  instrument: sym.toLowerCase(),
  dates: { from: new Date(from), to: new Date(to) },
  timeframe: 'm1', format: 'json', priceType: 'bid', volumes: true, utcOffset: 0,
  useCache: false, batchSize: 10, pauseBetweenBatchesMs: 500
});

const store = {
  symbol: sym, source: 'dukascopy', priceType: 'bid',
  t: [], o: [], h: [], l: [], c: [], v: []
};
for (const row of data) {
  store.t.push(row.timestamp);
  store.o.push(row.open);
  store.h.push(row.high);
  store.l.push(row.low);
  store.c.push(row.close);
  store.v.push(row.volume);
}
const directory = new URL('../data/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL(`${sym}_m1.json`, directory), JSON.stringify(store), 'utf8');
console.log(`Wrote ${store.t.length} rows to data/${sym}_m1.json`);
