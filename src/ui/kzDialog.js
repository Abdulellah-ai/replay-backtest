import { parseSettingsForm } from './controls-logic.js';

export function attachKzDialog(dialog, settings, onSave) {
  const form = dialog.querySelector('form');
  const container = dialog.querySelector('#kz-rows');
  const error = dialog.querySelector('#kz-error');
  let fields = [];

  function open() {
    container.replaceChildren();
    error.textContent = '';
    fields = settings.zones.map(zone => {
      const row = document.createElement('div');
      row.className = 'zone-row';
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = zone.enabled;
      const label = document.createElement('label');
      label.append(enabled, document.createTextNode(zone.label));
      row.append(label);
      const times = {};
      for (const name of ['start', 'end']) {
        const input = document.createElement('input');
        input.type = 'time';
        input.step = '60';
        input.value = zone[name];
        input.setAttribute('aria-label', `${zone.label} ${name}`);
        input.name = `${zone.id}-${name}`;
        const timeLabel = document.createElement('label');
        timeLabel.append(document.createTextNode(name === 'start' ? 'Start' : 'End'), input);
        row.append(timeLabel);
        times[name] = input;
      }
      container.append(row);
      return { enabled, ...times };
    });
    dialog.showModal();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const result = parseSettingsForm(settings, fields.map(row => ({
      enabled: row.enabled.checked, start: row.start.value, end: row.end.value,
    })));
    if (!result.ok) {
      error.textContent = result.error;
      return;
    }
    onSave(result.value);
    dialog.close();
  });
  dialog.querySelector('#kz-cancel').addEventListener('click', () => dialog.close());
  return { open };
}
