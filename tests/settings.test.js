import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, loadSettings, saveSettings } from '../src/core/settings.js';

const ownerSettings = {
  zones: [
    { id: 'ASIA', label: 'ASIA', start: '20:00', end: '00:00', enabled: true },
    { id: 'LNDN', label: 'LNDN', start: '02:00', end: '05:00', enabled: true },
    { id: 'NYAM', label: 'NYAM', start: '09:30', end: '11:00', enabled: true },
    { id: 'NYL', label: 'NYL', start: '12:00', end: '13:00', enabled: false },
    { id: 'NYPM', label: 'NYPM', start: '13:30', end: '16:00', enabled: true },
    { id: 'RTH', label: 'RTH', start: '09:30', end: '16:00', enabled: false },
  ],
  syncCrosshair: false,
  sessionLevels: false,
  gapWarnings: true,
  syncScroll: true,
  syncTimeframe: true,
  fibPresets: [{ id: 'default', name: 'Default', levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] }],
  activeFibPreset: 'default',
};

const fresh = () => structuredClone(ownerSettings);

test('session levels persist booleans and migrate only absent stored values', () => {
  assert.equal(DEFAULT_SETTINGS.sessionLevels, false);
  const legacy = fresh();
  delete legacy.sessionLevels;
  legacy.syncCrosshair = true;
  rejects(legacy);
  const storage = fakeStorage(JSON.stringify(legacy));
  assert.deepEqual(loadSettings(storage), { ...legacy, sessionLevels: false });
  assert.equal(storage.writes.length, 0);
  for (const sessionLevels of [true, false]) {
    const settings = { ...fresh(), sessionLevels };
    assert.equal(saveSettings(storage, settings).ok, true);
    assert.deepEqual(loadSettings(storage), settings);
  }
  for (const sessionLevels of [undefined, null, 0, 1, 'true', [], {}]) {
    rejects({ ...fresh(), sessionLevels });
    if (sessionLevels !== undefined) assert.deepEqual(loadSettings(fakeStorage(
      JSON.stringify({ ...legacy, sessionLevels }))), ownerSettings);
  }
});

function fakeStorage(initial = null) {
  const values = new Map();
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : initial; },
    setItem(key, value) { values.set(key, value); writes.push({ key, value }); },
  };
}

function rejects(value) {
  const result = validateSettings(value);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
}

test('defaults equal the owner table', () => {
  assert.deepEqual(DEFAULT_SETTINGS, ownerSettings);
  assert.deepEqual(validateSettings(fresh()), { ok: true, value: ownerSettings });
});

test('rejects start == end', () => {
  const settings = fresh();
  settings.zones[0].end = settings.zones[0].start;
  rejects(settings);
});

test('rejects 25:99', () => {
  for (const field of ['start', 'end']) {
    for (const time of ['25:99', '24:00', '12:60', '2:00', '02:0', '', '02:00\n']) {
      const settings = fresh();
      settings.zones[0][field] = time;
      rejects(settings);
    }
  }
});

test('rejects empty id and duplicate ids', () => {
  for (const id of ['', '   ', 'LNDN']) {
    const settings = fresh();
    settings.zones[0].id = id;
    rejects(settings);
  }
});

test('accepts end earlier than start (wraps midnight)', () => {
  const settings = fresh();
  settings.zones[0].end = '01:00';
  assert.deepEqual(validateSettings(settings), { ok: true, value: settings });
});

test('loadSettings falls back on corrupt JSON', () => {
  assert.deepEqual(loadSettings(fakeStorage('{bad json')), ownerSettings);
});

test('saveSettings keeps previous value when invalid', () => {
  const storage = fakeStorage();
  assert.equal(saveSettings(storage, fresh()).ok, true);
  const previous = storage.writes[0];
  const invalid = fresh();
  invalid.zones[0].end = invalid.zones[0].start;
  const result = saveSettings(storage, invalid);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.getItem(previous.key), previous.value);
  assert.deepEqual(loadSettings(storage), ownerSettings);
});

test('rejects non-objects and wrong field types', () => {
  for (const value of [null, undefined, true, 7, 'settings', [], {}, { zones: [] }]) {
    rejects(value);
  }
  for (const [field, value] of [['zones', null], ['zones', {}], ['syncCrosshair', 'false'], ['syncCrosshair', 0]]) {
    const settings = fresh();
    settings[field] = value;
    rejects(settings);
  }
  for (const value of [null, [], 'zone', 1]) {
    const settings = fresh();
    settings.zones[0] = value;
    rejects(settings);
  }
  for (const [field, value] of [['id', 1], ['label', null], ['start', 2000], ['end', false], ['enabled', 'true']]) {
    const settings = fresh();
    settings.zones[0][field] = value;
    rejects(settings);
  }
  for (const field of ['id', 'label', 'start', 'end', 'enabled']) {
    const settings = fresh();
    delete settings.zones[0][field];
    rejects(settings);
  }
});

test('loadSettings falls back on missing or invalid settings without writing', () => {
  for (const initial of [null, 'null', '{}', '[]', JSON.stringify({ ...fresh(), syncCrosshair: 'yes' })]) {
    const storage = fakeStorage(initial);
    assert.deepEqual(loadSettings(storage), ownerSettings);
    assert.equal(storage.writes.length, 0);
  }
});

test('saveSettings and loadSettings round-trip custom settings', () => {
  const settings = fresh();
  settings.zones[2].end = '10:30';
  settings.syncCrosshair = true;
  const storage = fakeStorage();
  assert.deepEqual(saveSettings(storage, settings), { ok: true });
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.writes[0].value), settings);
  assert.deepEqual(loadSettings(storage), settings);
});

test('fallback settings can be edited without changing defaults', () => {
  const settings = loadSettings(fakeStorage());
  settings.zones[0].start = '21:00';
  settings.syncCrosshair = true;
  settings.fibPresets[0].levels[0] = -1;
  assert.deepEqual(DEFAULT_SETTINGS, ownerSettings);
  assert.deepEqual(loadSettings(fakeStorage()), ownerSettings);
});

test('Fib presets reject invalid structure, identity, names, active id and levels', () => {
  for (const fibPresets of [undefined, null, [], {}, Array(9).fill(ownerSettings.fibPresets[0]),
    [null], [{ id: '', name: 'x', levels: [0, 1] }],
    [{ id: 'default', name: '  ', levels: [0, 1] }],
    [ownerSettings.fibPresets[0], ownerSettings.fibPresets[0]]]) {
    rejects({ ...fresh(), fibPresets });
  }
  for (const levels of [undefined, null, '0,1', [0], Array.from({ length: 21 }, (_, i) => i / 10),
    [0, 0], [-0, 0], [0, , 1], [0, NaN], [0, Infinity], [0, '1'], [-5.01, 1], [0, 10.01]]) {
    const settings = fresh();
    settings.fibPresets[0].levels = levels;
    rejects(settings);
    assert.deepEqual(loadSettings(fakeStorage(JSON.stringify(settings))), ownerSettings);
  }
  for (const activeFibPreset of [undefined, null, '', 'missing', 1]) rejects({ ...fresh(), activeFibPreset });
});

test('custom Fib presets persist with inclusive level bounds and independent defaults', () => {
  const settings = fresh();
  settings.fibPresets.push({ id: 'extension', name: 'Extension', levels: [-5, 0, 10] });
  settings.activeFibPreset = 'extension';
  const storage = fakeStorage();
  assert.equal(saveSettings(storage, settings).ok, true);
  assert.deepEqual(loadSettings(storage), settings);
  assert.equal(validateSettings({ ...settings, fibPresets: Array.from({ length: 8 }, (_, i) =>
    ({ id: String(i), name: 'Preset', levels: [0, 1] })), activeFibPreset: '0' }).ok, true);
});

test('sync settings round-trip false values and strictly reject non-booleans', () => {
  const settings = { ...fresh(), syncScroll: false, syncTimeframe: false };
  const storage = fakeStorage();
  assert.equal(saveSettings(storage, settings).ok, true);
  assert.deepEqual(loadSettings(storage), settings);
  for (const field of ['syncScroll', 'syncTimeframe']) {
    for (const value of [undefined, null, 0, 'true']) rejects({ ...fresh(), [field]: value });
  }
});

test('load migrates missing sync flags without losing older settings or weakening validation', () => {
  const legacy = fresh();
  delete legacy.syncScroll;
  delete legacy.syncTimeframe;
  legacy.syncCrosshair = true;
  legacy.zones[0].start = '21:00';
  rejects(legacy);
  const storage = fakeStorage(JSON.stringify(legacy));
  assert.deepEqual(loadSettings(storage), { ...legacy, syncScroll: true, syncTimeframe: true });
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(loadSettings(fakeStorage(JSON.stringify({ ...legacy, syncScroll: null }))), ownerSettings);
});

test('load migrates all four absent fields while preserving legacy kill zones and crosshair', () => {
  const legacy = fresh();
  for (const field of ['syncScroll', 'syncTimeframe', 'fibPresets', 'activeFibPreset']) delete legacy[field];
  legacy.zones[0].start = '21:00';
  legacy.zones[2].enabled = false;
  legacy.syncCrosshair = true;
  const storage = fakeStorage(JSON.stringify(legacy));
  const loaded = loadSettings(storage);
  assert.deepEqual(loaded, { ...fresh(), zones: legacy.zones, syncCrosshair: true });
  assert.equal(storage.writes.length, 0);
  loaded.fibPresets[0].levels[0] = -1;
  assert.deepEqual(DEFAULT_SETTINGS, ownerSettings);
  assert.equal(loadSettings(storage).fibPresets[0].levels[0], 0);
});

test('load rejects explicit invalid Fib fields even when other new fields are absent', () => {
  for (const invalid of [{ fibPresets: null }, { fibPresets: [] }, { fibPresets: {} },
    { activeFibPreset: null }, { activeFibPreset: 'missing' }]) {
    const legacy = { zones: fresh().zones, syncCrosshair: true, ...invalid };
    legacy.zones[0].start = '21:00';
    assert.deepEqual(loadSettings(fakeStorage(JSON.stringify(legacy))), ownerSettings);
  }
});

test('gap warnings default on, persist booleans, migrate when absent and reject non-booleans', () => {
  assert.equal(DEFAULT_SETTINGS.gapWarnings, true);
  const legacy = fresh();
  delete legacy.gapWarnings;
  legacy.syncCrosshair = true;
  rejects(legacy);
  const storage = fakeStorage(JSON.stringify(legacy));
  assert.deepEqual(loadSettings(storage), { ...legacy, gapWarnings: true });
  for (const gapWarnings of [true, false]) {
    const settings = { ...fresh(), gapWarnings };
    assert.equal(saveSettings(storage, settings).ok, true);
    assert.deepEqual(loadSettings(storage), settings);
  }
  assert.deepEqual(loadSettings(fakeStorage(JSON.stringify({ ...fresh(), gapWarnings: 'no' }))), ownerSettings);
});
