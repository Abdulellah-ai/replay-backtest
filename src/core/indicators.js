export function rsi(closes, period = 14) {
  const values = Array(closes.length).fill(null);
  if (closes.length <= period) return values;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const currentRsi = () => (avgLoss === 0
    ? (avgGain === 0 ? 50 : 100)
    : 100 * (avgGain / (avgGain + avgLoss)));
  values[period] = currentRsi();

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = ((period - 1) * avgGain + Math.max(change, 0)) / period;
    avgLoss = ((period - 1) * avgLoss + Math.max(-change, 0)) / period;
    values[i] = currentRsi();
  }
  return values;
}

export function sma(closes, period) {
  const values = Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) values[i] = sum / period;
  }
  return values;
}
