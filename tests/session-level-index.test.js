import test from 'node:test';
import assert from 'node:assert/strict';

test('level interval index returns inclusive overlaps without visiting unrelated history', async () => {
  const { createLevelIndex } = await import('../src/ui/session-level-index.js');
  const index = createLevelIndex(0, 100000);
  let reads = 0;
  const lines = [];
  for (let i = 0; i < 1000; i += 1) {
    const from = i * 100;
    const line = { get fromTs() { reads += 1; return from; },
      get toTs() { reads += 1; return from + 10; } };
    lines.push(line);
    index.add(line);
  }
  const spanning = { fromTs: 5, toTs: 99990 };
  index.add(spanning);
  for (const [from, to, expected] of [
    [50010, 50010, [lines[500], spanning]],
    [50011, 50099, [spanning]],
    [50099, 50100, [lines[501], spanning]],
    [100001, Infinity, []],
  ]) {
    reads = 0;
    assert.deepEqual(new Set(index.query(from, to)), new Set(expected));
    assert.ok(reads < 80, `query visited unrelated intervals: ${reads} endpoint reads`);
  }
  assert.equal(index.query(0, 100000).length, 1001);
});
