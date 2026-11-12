import { validateFibLevels } from '../core/settings.js';

export const TREND_COLOURS = Object.freeze([
  Object.freeze({ id: 'white', name: 'White', value: '#ffffff' }),
  Object.freeze({ id: 'yellow', name: 'Yellow', value: '#f5c518' }),
  Object.freeze({ id: 'blue', name: 'Blue', value: '#2962ff' }),
]);

export function trendColour(id = 'white') {
  const choice = TREND_COLOURS.find(colour => colour.id === id);
  if (!choice) throw new Error(`Invalid trend colour: ${id}`);
  return choice.value;
}

export const RECT_COLOURS = Object.freeze([
  Object.freeze({ id: 'white', name: 'White', value: '#ffffff' }),
  Object.freeze({ id: 'green', name: 'Green', value: '#26a69a' }),
  Object.freeze({ id: 'gold', name: 'Gold', value: '#d4af37' }),
]);

export function rectColour(id = 'white') {
  const choice = RECT_COLOURS.find(colour => colour.id === id);
  if (!choice) throw new Error(`Invalid rectangle colour: ${id}`);
  return choice.value;
}

export function normalizeLabelText(value) {
  if (typeof value !== 'string') return null;
  return Array.from(value.trim()).slice(0, 40).join('').trim() || null;
}

// Handle names refer to price (top = higher value) and chronological time.
// Preserve point order/metadata; a corner's time and price can belong to
// different stored points. Call with the drag-start points to allow crossing.
export function moveRectHandle(points, handle, mouse) {
  const result = points.map(point => ({ ...point }));
  const timeKey = points.every(point => Number.isFinite(point.timestamp)) ? 'timestamp' : 'dataIndex';
  const left = points[0][timeKey] <= points[1][timeKey] ? 0 : 1;
  const top = points[0].value >= points[1].value ? 0 : 1;
  const timeIndex = handle.includes('l') ? left : handle.includes('r') ? 1 - left : null;
  const priceIndex = handle.includes('t') ? top : handle.includes('b') ? 1 - top : null;
  if (timeIndex !== null) {
    for (const key of ['timestamp', 'dataIndex']) {
      if (mouse[key] === undefined) delete result[timeIndex][key];
      else result[timeIndex][key] = mouse[key];
    }
  }
  if (priceIndex !== null) result[priceIndex].value = mouse.value;
  return result;
}

export function snapAxis(first, current) {
  return Math.abs(current.x - first.x) >= Math.abs(current.y - first.y) ? 'horizontal' : 'vertical';
}

export function parseFibLevels(text) {
  const tokens = text.split(',').map(token => token.trim());
  if (tokens.some(token => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token))) {
    return { ok: false, error: 'Enter comma-separated numbers, for example 0, 0.5, 1.' };
  }
  const levels = tokens.map(Number);
  const result = validateFibLevels(levels);
  return result.ok ? { ok: true, value: levels } : result;
}

export function formatFibLevels(levels) {
  return levels.join(', ');
}
