// Event boundary fixture, not a browser or dialog implementation.
export function dialogFixture() {
  const nodes = new Map();
  function node() {
    const listeners = new Map();
    return { value: '',
      addEventListener: (type, callback) => listeners.set(type, callback),
      emit(type) { listeners.get(type)?.({ preventDefault() {} }); },
      focus() {}, select() {},
    };
  }
  const dialog = {
    open: false,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
    showModal() { this.open = true; },
    close() { this.open = false; },
    addEventListener() {},
  };
  return { dialog, input: dialog.querySelector('input'),
    submit: () => dialog.querySelector('form').emit('submit'),
    cancel: () => dialog.querySelector('#drawing-label-cancel').emit('click'),
    clear: () => dialog.querySelector('#drawing-label-clear').emit('click') };
}
