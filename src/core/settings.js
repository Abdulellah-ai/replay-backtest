export const DEFAULT_SETTINGS = Object.freeze({
  zones: Object.freeze([
    { id: 'ASIA', label: 'ASIA', start: '20:00', end: '00:00', enabled: true },
    { id: 'LNDN', label: 'LNDN', start: '02:00', end: '05:00', enabled: true },
    { id: 'NYAM', label: 'NYAM', start: '09:30', end: '11:00', enabled: true },
    { id: 'NYL', label: 'NYL', start: '12:00', end: '13:00', enabled: false },
    { id: 'NYPM', label: 'NYPM', start: '13:30', end: '16:00', enabled: true },
    { id: 'RTH', label: 'RTH', start: '09:30', end: '16:00', enabled: false },
  ].map(Object.freeze)),
  syncCrosshair: false,
  sessionLevels: false,
  gapWarnings: true,
  syncScroll: true,
  syncTimeframe: true,
  fibPresets: Object.freeze([Object.freeze({ id: 'default', name: 'Default',
    levels: Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) })]),
  activeFibPreset: 'default',
});

const STORAGE_KEY = 'replay-backtest-settings';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = value => typeof value === 'string'
  && value.length === 5 && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);

export function validateFibLevels(levels) {
  if (!Array.isArray(levels) || levels.length < 2 || levels.length > 20 ||
      Array.from(levels).some(level => !Number.isFinite(level) || level < -5 || level > 10) ||
      new Set(levels).size !== levels.length) {
    return { ok: false, error: 'Use 2 to 20 unique finite levels between -5 and 10.' };
  }
  return { ok: true, value: levels };
}

export function validateSettings(settings) {
  if (!isObject(settings)) return { ok: false, error: 'Settings must be an object.' };
  if (!Array.isArray(settings.zones)) return { ok: false, error: 'zones must be an array.' };
  if (typeof settings.syncCrosshair !== 'boolean') {
    return { ok: false, error: 'syncCrosshair must be a boolean.' };
  }
  for (const field of ['syncScroll', 'syncTimeframe', 'sessionLevels', 'gapWarnings']) {
    if (typeof settings[field] !== 'boolean') return { ok: false, error: `${field} must be a boolean.` };
  }
  if (!Array.isArray(settings.fibPresets) || settings.fibPresets.length < 1 || settings.fibPresets.length > 8) {
    return { ok: false, error: 'Use 1 to 8 Fib presets.' };
  }
  const presetIds = new Set();
  for (const preset of settings.fibPresets) {
    if (!isObject(preset) || typeof preset.id !== 'string' || !preset.id.trim() ||
        presetIds.has(preset.id) || typeof preset.name !== 'string' || !preset.name.trim()) {
      return { ok: false, error: 'Fib presets need unique non-empty ids and non-empty names.' };
    }
    presetIds.add(preset.id);
    const result = validateFibLevels(preset.levels);
    if (!result.ok) return result;
  }
  if (!presetIds.has(settings.activeFibPreset)) {
    return { ok: false, error: 'Choose an existing active Fib preset.' };
  }

  const ids = new Set();
  for (const zone of settings.zones) {
    if (!isObject(zone)) return { ok: false, error: 'Each zone must be an object.' };
    if (typeof zone.id !== 'string' || zone.id.trim() === '') {
      return { ok: false, error: 'Zone id must be a non-empty string.' };
    }
    if (ids.has(zone.id)) return { ok: false, error: `Duplicate zone id: ${zone.id}.` };
    ids.add(zone.id);
    if (typeof zone.label !== 'string') return { ok: false, error: 'Zone label must be a string.' };
    if (typeof zone.enabled !== 'boolean') return { ok: false, error: 'Zone enabled must be a boolean.' };
    if (!isTime(zone.start) || !isTime(zone.end)) {
      return { ok: false, error: 'Zone start and end must be valid HH:MM times (00:00-23:59).' };
    }
    if (zone.start === zone.end) return { ok: false, error: 'Zone start and end must differ.' };
  }
  return { ok: true, value: settings };
}

export function loadSettings(storage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY));
    // Migrate only absent fields. Explicit invalid values still fail validation.
    if (isObject(stored)) {
      for (const field of ['syncScroll', 'syncTimeframe', 'sessionLevels', 'gapWarnings', 'fibPresets', 'activeFibPreset']) {
        if (!Object.hasOwn(stored, field)) stored[field] = structuredClone(DEFAULT_SETTINGS[field]);
      }
    }
    const result = validateSettings(stored);
    if (result.ok) return result.value;
  } catch {
    // Missing, corrupt, or inaccessible storage uses independent editable defaults.
  }
  return {
    zones: DEFAULT_SETTINGS.zones.map(zone => ({ ...zone })),
    syncCrosshair: DEFAULT_SETTINGS.syncCrosshair,
    sessionLevels: DEFAULT_SETTINGS.sessionLevels,
    gapWarnings: DEFAULT_SETTINGS.gapWarnings,
    syncScroll: DEFAULT_SETTINGS.syncScroll,
    syncTimeframe: DEFAULT_SETTINGS.syncTimeframe,
    fibPresets: DEFAULT_SETTINGS.fibPresets.map(preset => ({ ...preset, levels: [...preset.levels] })),
    activeFibPreset: DEFAULT_SETTINGS.activeFibPreset,
  };
}

export function saveSettings(storage, settings) {
  const result = validateSettings(settings);
  if (!result.ok) return result;
  storage.setItem(STORAGE_KEY, JSON.stringify(result.value));
  return { ok: true };
}
