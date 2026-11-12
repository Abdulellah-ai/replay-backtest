import test from 'node:test';
import assert from 'node:assert/strict';
import { TREND_COLOURS, trendColour, snapAxis, parseFibLevels, formatFibLevels } from '../src/ui/drawing-logic.js';
import * as logic from '../src/ui/drawing-logic.js';

const rectCases = [
  ['tl', [[5, 40], [30, 10]]], ['tr', [[10, 40], [5, 10]]],
  ['bl', [[5, 20], [30, 40]]], ['br', [[10, 20], [5, 40]]],
  ['t', [[10, 40], [30, 10]]], ['b', [[10, 20], [30, 40]]],
  ['l', [[5, 20], [30, 10]]], ['r', [[10, 20], [5, 10]]],
];

for (const [handle, expected] of rectCases) {
  for (const inverted of [false, true]) {
    test(`rectangle ${handle} reshapes only its sides, inverted=${inverted}`, () => {
      const points = [{ timestamp: 10, dataIndex: 1, value: 20, tag: 'first' },
        { timestamp: 30, dataIndex: 3, value: 10, tag: 'second' }];
      if (inverted) points.reverse();
      const before = structuredClone(points);
      const result = logic.moveRectHandle(points, handle, { timestamp: 5, dataIndex: 0, value: 40 });
      assert.deepEqual(result.map(p => [p.timestamp, p.value]), inverted ? [...expected].reverse() : expected);
      for (let i = 0; i < 2; i++) {
        assert.equal(result[i].tag, points[i].tag);
        assert.equal(result[i].dataIndex, result[i].timestamp === 5 ? 0 : points[i].dataIndex);
        assert.notEqual(result[i], points[i]);
      }
      assert.deepEqual(points, before, 'geometry must not mutate the input');
    });
  }
}

test('rectangle supports the other native diagonal and index-only time without stale timestamps', () => {
  const points = [{ dataIndex: 3, value: 20 }, { dataIndex: 1, value: 10 }];
  assert.deepEqual(logic.moveRectHandle(points, 'tl', { dataIndex: 0, value: 40 }),
    [{ dataIndex: 3, value: 40 }, { dataIndex: 0, value: 10 }]);
  const stamped = [{ timestamp: 10, dataIndex: 1, value: 20 }, { timestamp: 30, dataIndex: 3, value: 10 }];
  assert.deepEqual(logic.moveRectHandle(stamped, 'l', { dataIndex: -1, value: 99 }),
    [{ dataIndex: -1, value: 20 }, stamped[1]]);
});

test('rectangle permits zero size and all handles on coincident corners without NaN', () => {
  const points = [{ timestamp: 10, value: 20 }, { timestamp: 30, value: 10 }];
  assert.deepEqual(logic.moveRectHandle(points, 'tl', points[1]), [points[1], points[1]]);
  for (const [handle] of rectCases) {
    const result = logic.moveRectHandle([{ dataIndex: 0, value: 0 }, { dataIndex: 0, value: 0 }],
      handle, { dataIndex: 0, value: 0 });
    assert.deepEqual(result, [{ dataIndex: 0, value: 0 }, { dataIndex: 0, value: 0 }]);
  }
});

test('rectangle colours are independent from Trend with white default', () => {
  assert.equal(typeof logic.rectColour, 'function');
  assert.deepEqual(logic.RECT_COLOURS.map(choice => logic.rectColour(choice.id)),
    ['#ffffff', '#26a69a', '#d4af37']);
  assert.equal(logic.rectColour(), '#ffffff');
  assert.throws(() => logic.rectColour('yellow'), /colour/i);
  assert.equal(trendColour('yellow'), '#f5c518');
});

test('drawing labels trim, clear empty input and cap at 40 Unicode characters', () => {
  assert.equal(typeof logic.normalizeLabelText, 'function');
  assert.equal(logic.normalizeLabelText('  CISD  '), 'CISD');
  for (const value of ['', '  \t\n', null, undefined, 42, {}]) {
    assert.equal(logic.normalizeLabelText(value), null);
  }
  assert.equal(logic.normalizeLabelText('x'.repeat(41)), 'x'.repeat(40));
  const emoji = String.fromCodePoint(0x1f600);
  assert.equal(logic.normalizeLabelText(emoji.repeat(41)), emoji.repeat(40));
  assert.equal(logic.normalizeLabelText('a'.repeat(39) + ' b'), 'a'.repeat(39));
});

test('trend colour choices resolve to the three supported colours with white default', () => {
  assert.deepEqual(TREND_COLOURS.map(choice => trendColour(choice.id)), ['#ffffff', '#f5c518', '#2962ff']);
  assert.equal(trendColour(), '#ffffff');
  assert.throws(() => trendColour('red'), /colour/i);
});

test('snapAxis chooses nearest pixel axis with horizontal ties and zero length', () => {
  for (const [current, expected] of [
    [{ x: 50, y: 22 }, 'horizontal'], [{ x: 12, y: 60 }, 'vertical'],
    [{ x: -30, y: -20 }, 'horizontal'], [{ x: 30, y: 40 }, 'horizontal'],
    [{ x: 10, y: 20 }, 'horizontal'],
  ]) assert.equal(snapAxis({ x: 10, y: 20 }, current), expected);
});

test('Fib level text round trips finite unique levels and rejects malformed input', () => {
  assert.deepEqual(parseFibLevels(' 0, 0.5, 1 '), { ok: true, value: [0, 0.5, 1] });
  assert.deepEqual(parseFibLevels('-5, 1e-3, 10'), { ok: true, value: [-5, 0.001, 10] });
  assert.equal(formatFibLevels([0, 0.5, 1]), '0, 0.5, 1');
  for (const text of ['', '0', '0,', ',1', '0,,1', '0, NaN', '0, Infinity',
    '0, 11', '-5.1, 1', '0, 0', '0, nope', '0, 0x10',
    Array.from({ length: 21 }, (_, i) => i / 10).join(',')]) {
    assert.equal(parseFibLevels(text).ok, false, text);
  }
});
