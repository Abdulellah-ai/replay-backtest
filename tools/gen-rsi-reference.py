"""Generate the Task 5 reference from local data with TA-Lib 0.8.3.

Run with the research-work venv Python using -I -X utf8.
"""

import json
import math
from pathlib import Path

import numpy as np
import talib


def main():
    if talib.__version__ != "0.8.3":
        raise RuntimeError("Reference requires TA-Lib 0.8.3")
    root = Path(__file__).resolve().parent.parent
    with (root / "data" / "XAUUSD_m1.json").open(encoding="utf-8") as source:
        closes = json.load(source)["c"][:3000]
    if len(closes) != 3000:
        raise ValueError("Reference requires at least 3000 closes")
    values = talib.RSI(np.asarray(closes, dtype=np.float64), timeperiod=14)
    reference = {
        "closes": closes,
        "rsi14": [None if math.isnan(value) else float(value) for value in values],
    }
    destination = root / "tests" / "fixtures" / "rsi_reference.json"
    with destination.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(reference, output, allow_nan=False, indent=2)
        output.write("\n")
    print(f"Wrote {len(closes)} closes and RSI14 values using TA-Lib {talib.__version__}")


if __name__ == "__main__":
    main()
