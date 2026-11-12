import test from 'node:test';
import assert from 'node:assert/strict';
import { rrStats } from '../src/core/rr.js';

test('long distances and percentages use entry as the denominator', () => {
  assert.deepEqual(rrStats('long', 4000, 3990, 4030), {
    risk: 10, reward: 30, rr: 3, riskPct: 0.25, rewardPct: 0.75,
  });
});

test('short mirrors long', () => {
  assert.deepEqual(rrStats('short', 4000, 4010, 3970), {
    risk: 10, reward: 30, rr: 3, riskPct: 0.25, rewardPct: 0.75,
  });
});

test('long with SL above entry returns an error', () => {
  assert.equal(typeof rrStats('long', 4000, 4010, 4030).error, 'string');
});

test('short with SL below entry returns an error', () => {
  assert.equal(typeof rrStats('short', 4000, 3990, 3970).error, 'string');
});

test('zero risk returns an error for both kinds', () => {
  for (const kind of ['long', 'short']) {
    assert.equal(typeof rrStats(kind, 4000, 4000, 4030).error, 'string');
  }
});

test('screenshot values retain precision until display formatting', () => {
  const stats = rrStats('long', 4070.59, 4050.726, 4110.928);
  assert.equal(stats.risk.toFixed(3), '19.864');
  assert.equal(stats.reward.toFixed(3), '40.338');
  assert.equal(stats.rr.toFixed(2), '2.03');
  assert.equal(stats.riskPct.toFixed(3), '0.488');
  assert.equal(stats.rewardPct.toFixed(3), '0.991');
});

test('wrong-side or equal TP returns an error for each kind', () => {
  for (const tp of [3990, 4000]) {
    assert.equal(typeof rrStats('long', 4000, 3980, tp).error, 'string');
  }
  for (const tp of [4010, 4000]) {
    assert.equal(typeof rrStats('short', 4000, 4020, tp).error, 'string');
  }
});

test('non-finite and non-number prices return an error', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, '4000']) {
    for (const index of [0, 1, 2]) {
      const prices = [4000, 3990, 4030];
      prices[index] = value;
      assert.equal(typeof rrStats('long', ...prices).error, 'string');
    }
  }
});

test('invalid kind and non-positive entry return an error', () => {
  assert.equal(typeof rrStats('other', 4000, 3990, 4030).error, 'string');
  assert.equal(typeof rrStats('long', 0, -10, 30).error, 'string');
  assert.equal(typeof rrStats('long', -10, -20, 30).error, 'string');
});

test('overflow returns an error instead of infinite display numbers', () => {
  assert.equal(typeof rrStats('long', 1e308, -1e308, 1.5e308).error, 'string');
});
