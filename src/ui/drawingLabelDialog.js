import { normalizeLabelText } from './drawing-logic.js';

export function attachDrawingLabelDialog(dialog) {
  const input = dialog.querySelector('input');
  let save;

  function finish(text) {
    save(text);
    dialog.close();
  }

  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    finish(normalizeLabelText(input.value));
  });
  dialog.querySelector('#drawing-label-clear').addEventListener('click', () => finish(null));
  dialog.querySelector('#drawing-label-cancel').addEventListener('click', () => dialog.close());

  return {
    open(text, onSave) {
      save = onSave;
      input.value = normalizeLabelText(text) ?? '';
      dialog.showModal();
      input.focus();
      input.select();
    },
  };
}
