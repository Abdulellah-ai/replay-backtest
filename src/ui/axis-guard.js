export function isAxisDragYAllowed(clientY, pageY, top, bottom) {
  return Number.isFinite(clientY) && Number.isFinite(pageY) &&
    pageY > 0 && clientY >= top && clientY <= bottom;
}

export function attachAxisGuard(container, instance) {
  const doc = container.ownerDocument;
  // Non-DOM callers cannot initiate a native axis drag.
  if (!doc) return () => {};
  let dragging = false;

  function allowed(event) {
    const { top, bottom } = container.getBoundingClientRect();
    return isAxisDragYAllowed(event.clientY, event.pageY, top, bottom);
  }

  function start(event) {
    if (event.button !== 0) return;
    dragging = false;
    const axis = instance.getDom('candle_pane', 'yAxis');
    if (!axis?.contains(event.target)) return;
    // The initial pageY is also the scaling denominator; keep it positive.
    if (!allowed(event)) {
      event.stopPropagation();
      return;
    }
    dragging = true;
  }

  function move(event) {
    // Capture runs before the vendor's documentElement bubbling drag handler.
    if (dragging && !allowed(event)) event.stopPropagation();
  }

  function end(event) {
    if (event.button === 0) dragging = false;
  }

  const handlers = { mousedown: start, mousemove: move, pointermove: move, mouseup: end };
  for (const [type, handler] of Object.entries(handlers)) {
    doc.addEventListener(type, handler, true);
  }
  return () => {
    dragging = false;
    for (const [type, handler] of Object.entries(handlers)) {
      doc.removeEventListener(type, handler, true);
    }
  };
}
