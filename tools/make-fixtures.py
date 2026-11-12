"""Slice one week (2026-06-01..2026-06-05 UTC) of XAUUSD M1 and provider-native M5/H4/D1
into tests/fixtures/. Source: research-work/samples (untracked, in the main checkout).

Usage: python tools/make-fixtures.py <samples_dir>
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

samples = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
out.mkdir(parents=True, exist_ok=True)

START = int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp() * 1000)
END = int(datetime(2026, 6, 6, tzinfo=timezone.utc).timestamp() * 1000)


def pick(rows):
    return [r for r in rows if START <= r["timestamp"] < END]


m1 = pick(json.load(open(samples / "xauusd_m1_8mo.json", encoding="utf-8")))
cols = {"symbol": "XAUUSD", "source": "dukascopy", "priceType": "bid",
        "t": [r["timestamp"] for r in m1], "o": [r["open"] for r in m1],
        "h": [r["high"] for r in m1], "l": [r["low"] for r in m1],
        "c": [r["close"] for r in m1], "v": [r["volume"] for r in m1]}
json.dump(cols, open(out / "xauusd_m1_week.json", "w", encoding="utf-8"))
print("m1 rows", len(m1))

for tf in ("m5", "h4", "d1"):
    rows = pick(json.load(open(samples / f"xauusd_{tf}_native.json", encoding="utf-8")))
    json.dump(rows, open(out / f"xauusd_{tf}_native.json", "w", encoding="utf-8"))
    print(tf, "rows", len(rows))
