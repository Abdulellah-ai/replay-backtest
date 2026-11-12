import { validateSettings } from '../core/settings.js';
import { parseFibLevels, formatFibLevels } from './drawing-logic.js';

export function attachFibDialog(dialog, settings, onSave) {
  const form = dialog.querySelector('form');
  const container = dialog.querySelector('#fib-rows');
  const error = dialog.querySelector('#fib-error');
  let fields = [];

  function addRow(preset) {
    const row = document.createElement('div');
    row.className = 'fib-row';
    const name = document.createElement('input');
    name.value = preset.name;
    name.setAttribute('aria-label', 'Preset name');
    const levels = document.createElement('input');
    levels.value = formatFibLevels(preset.levels);
    levels.setAttribute('aria-label', 'Comma-separated Fib levels');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    const field = { id: preset.id, name, levels };
    remove.addEventListener('click', () => {
      if (fields.length === 1) { error.textContent = 'Keep at least one preset.'; return; }
      fields = fields.filter(item => item !== field);
      row.remove();
      error.textContent = '';
    });
    for (const [text, input] of [['Name', name], ['Levels', levels]]) {
      const label = document.createElement('label');
      label.textContent = text;
      label.append(input);
      row.append(label);
    }
    row.append(remove);
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
      const result = parseFibLevels(field.levels.value);
      if (!result.ok) { error.textContent = `${field.name.value || 'Preset'}: ${result.error}`; return; }
      fibPresets.push({ id: field.id, name: field.name.value.trim(), levels: result.value });
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
