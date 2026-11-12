import test from 'node:test';
import assert from 'node:assert/strict';
import { nyParts, nyMinuteOfDay, nyWallToUtc } from '../src/core/time.js';

test('2026-03-07T22:00Z is 17:00 NY (EST)', () => {
  assert.deepEqual(nyParts(Date.parse('2026-03-07T22:00Z')),
    { y: 2026, mo: 3, d: 7, h: 17, mi: 0 });
});

test('2026-03-08T21:00Z is 17:00 NY (EDT)', () => {
  assert.deepEqual(nyParts(Date.parse('2026-03-08T21:00Z')),
    { y: 2026, mo: 3, d: 8, h: 17, mi: 0 });
});

test('2026-10-31T21:00Z is 17:00 NY (EDT)', () => {
  assert.deepEqual(nyParts(Date.parse('2026-10-31T21:00Z')),
    { y: 2026, mo: 10, d: 31, h: 17, mi: 0 });
});

test('2026-11-01T22:00Z is 17:00 NY (EST)', () => {
  assert.deepEqual(nyParts(Date.parse('2026-11-01T22:00Z')),
    { y: 2026, mo: 11, d: 1, h: 17, mi: 0 });
});

test('nyWallToUtc round-trips 17:00 on 2026-03-07 and 2026-03-08', () => {
  const before = nyWallToUtc(2026, 3, 7, 17, 0);
  const after = nyWallToUtc(2026, 3, 8, 17, 0);
  assert.equal(before, Date.parse('2026-03-07T22:00Z'));
  assert.equal(after, Date.parse('2026-03-08T21:00Z'));
  assert.deepEqual(nyParts(before), { y: 2026, mo: 3, d: 7, h: 17, mi: 0 });
  assert.deepEqual(nyParts(after), { y: 2026, mo: 3, d: 8, h: 17, mi: 0 });
});

test('nyMinuteOfDay at 2026-07-01T06:30Z is 150', () => {
  assert.equal(nyMinuteOfDay(Date.parse('2026-07-01T06:30Z')), 150);
});
