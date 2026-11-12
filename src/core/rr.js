export function rrStats(kind, entry, sl, tp) {
  if (kind !== 'long' && kind !== 'short') return { error: 'Invalid RR kind' };
  if (![entry, sl, tp].every(Number.isFinite)) return { error: 'Prices must be finite numbers' };
  if (entry <= 0) return { error: 'Entry must be positive' };

  const direction = kind === 'long' ? 1 : -1;
  const risk = (entry - sl) * direction;
  const reward = (tp - entry) * direction;
  if (risk <= 0) return { error: 'Stop must be on the risk side of entry (nonzero risk)' };
  if (reward <= 0) return { error: 'Target must be on the reward side of entry' };

  const rr = reward / risk;
  const riskPct = risk / entry * 100;
  const rewardPct = reward / entry * 100;
  if (![risk, reward, rr, riskPct, rewardPct].every(Number.isFinite)) {
    return { error: 'RR calculation is out of range' };
  }
  return { risk, reward, rr, riskPct, rewardPct };
}
