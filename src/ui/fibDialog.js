import { validateSettings } from '../core/settings.js';
import { FIB_DEFAULT_COLOUR, fibLevelColour } from './drawing-logic.js';

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function attachFibDialog(dialog, settings, onSave) {
  const form = dialog.querySelector('form');
  const container = dialog.querySelector('#fib-rows');
  const error = dialog.querySelector('#fib-error');
  let fields = [];

  function addLevelRow(field, value, colour) {
    const row = document.createElement('div');
    row.className = 'fib-level';
    const number = document.createElement('input');
    number.value = String(value);
    number.setAttribute('aria-label', 'Level');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = colour;
    picker.setAttribute('aria-label', 'Level colour');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'x';
    remove.setAttribute('aria-label', 'Delete level');
    const level = { number, picker };
    remove.addEventListener('click', () => {
      if (field.levels.length <= 2) { error.textContent = 'Keep at least 2 levels.'; return; }
      field.levels = field.levels.filter(item => item !== level);
      row.remove();
      error.textContent = '';
    });
    row.append(number, picker, remove);
    field.levelBox.append(row);
    field.levels.push(level);
  }

  function addRow(preset) {
    const row = document.createElement('fieldset');
    row.className = 'fib-row';
    const name = document.createElement('input');
    name.value = preset.name;
    name.setAttribute('aria-label', 'Preset name');
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    nameLabel.append(name);
    const removePreset = document.createElement('button');
    removePreset.type = 'button';
    removePreset.textContent = 'Delete preset';
    const levelBox = document.createElement('div');
    levelBox.className = 'fib-levels-box';
    const addLevel = document.createElement('button');
    addLevel.type = 'button';
    addLevel.textContent = 'Add level';
    const field = { id: preset.id, name, levels: [], levelBox };
    preset.levels.forEach((value, index) =>
      addLevelRow(field, value, fibLevelColour(preset.colors, index)));
    addLevel.addEventListener('click', () => {
      if (field.levels.length >= 20) { error.textContent = 'Use at most 20 levels.'; return; }
      addLevelRow(field, '', FIB_DEFAULT_COLOUR);
      field.levels.at(-1).number.focus();
      error.textContent = '';
    });
    removePreset.addEventListener('click', () => {
      if (fields.length === 1) { error.textContent = 'Keep at least one preset.'; return; }
      fields = fields.filter(item => item !== field);
      row.remove();
      error.textContent = '';
    });
    row.append(nameLabel, levelBox, addLevel, removePreset);
    container.append(row);
    fields.push(field);
  }

  function open() {
    container.replaceChildren();
    error.textContent = '';
    fields = [];
    settings.fibPresets.forEach(addRow);
    dialog.showModal();
  }

  dialog.querySelector('#fib-add').addEventListener('click', () => {
    if (fields.length >= 8) { error.textContent = 'Use at most 8 presets.'; return; }
    let number = 1;
    while (fields.some(field => field.id === `preset-${number}`)) number += 1;
    addRow({ id: `preset-${number}`, name: 'New preset', levels: [0, 0.5, 1] });
    error.textContent = '';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fibPresets = [];
    for (const field of fields) {
      const levels = [];
      const colors = [];
      for (const level of field.levels) {
        const text = level.number.value.trim();
        if (!NUMBER.test(text)) {
          error.textContent = `${field.name.value || 'Preset'}: every level must be a number, for example 0.5.`;
          return;
        }
        levels.push(Number(text));
        colors.push(level.picker.value);
      }
      fibPresets.push({ id: field.id, name: field.name.value.trim(), levels, colors });
    }
    const activeFibPreset = fibPresets.some(preset => preset.id === settings.activeFibPreset)
      ? settings.activeFibPreset : fibPresets[0]?.id;
    const result = validateSettings({ ...settings, fibPresets, activeFibPreset });
    if (!result.ok) { error.textContent = result.error; return; }
    onSave(result.value);
    dialog.close();
  });
  dialog.querySelector('#fib-cancel').addEventListener('click', () => dialog.close());
  return { open };
}
