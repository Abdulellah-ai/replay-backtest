import test from 'node:test';
import assert from 'node:assert/strict';
import { isAxisDragYAllowed, attachAxisGuard } from '../src/ui/axis-guard.js';

test('axis drag admits only positive page Y within the container', () => {
  for (const [clientY, pageY, top, bottom, expected] of [
    [150, 150, 100, 400, true],
    [100, 100, 100, 400, true],
    [400, 400, 100, 400, true],
    [0, 0, 0, 400, false],
    [-20, -20, 100, 400, false],
    [99, 99, 100, 400, false],
    [401, 401, 100, 400, false],
    [150, 0, 100, 400, false],
    [150, -1, 100, 400, false],
    [150, 650, 100, 400, true],
    [NaN, 150, 100, 400, false],
    [150, Infinity, 100, 400, false],
  ]) {
    assert.equal(isAxisDragYAllowed(clientY, pageY, top, bottom), expected,
      `clientY=${clientY}, pageY=${pageY}, bounds=${top}..${bottom}`);
  }
});

// Exercise our handlers at the DOM boundary; native capture ordering is a browser check.
function fixture(doc = new EventTarget()) {
  const canvas = {};
  const axis = { contains: target => target === canvas };
  let bounds = { top: 100, bottom: 400 };
  const container = { ownerDocument: doc, getBoundingClientRect: () => bounds };
  const instance = { getDom(pane, position) {
    assert.equal(pane, 'candle_pane');
    assert.equal(position, 'yAxis');
    return axis;
  } };
  const detach = attachAxisGuard(container, instance);
  function send(type, values = {}) {
    const event = new Event(type);
    for (const [key, value] of Object.entries({ button: 0, clientY: 200, pageY: 200, ...values })) {
      Object.defineProperty(event, key, { value });
    }
    let blocked = false;
    event.stopPropagation = () => { blocked = true; };
    doc.dispatchEvent(event);
    return blocked;
  }
  return { doc, canvas, send, detach, resize: value => { bounds = value; } };
}

test('price-axis drag blocks unsafe moves and resumes inside until release', () => {
  const f = fixture();
  assert.equal(f.send('mousemove', { clientY: -20, pageY: -20 }), false);
  f.send('mousedown', { target: f.canvas });
  assert.equal(f.send('mousemove', { clientY: -20, pageY: -20 }), true);
  assert.equal(f.send('pointermove', { clientY: 0, pageY: 0 }), true);
  assert.equal(f.send('mousemove', { clientY: 450, pageY: 450 }), true);
  assert.equal(f.send('mousemove'), false);
  assert.equal(f.send('wheel', { clientY: -20, pageY: -20 }), false);
  f.resize({ top: 250, bottom: 500 });
  assert.equal(f.send('mousemove'), true);
  assert.equal(f.send('mouseup', { clientY: -20, pageY: -20 }), false);
  assert.equal(f.send('mousemove', { clientY: -20, pageY: -20 }), false);
  f.detach();
});

test('main canvas and right-button drags are left alone; unsafe axis starts are blocked', () => {
  const f = fixture();
  f.send('mousedown', { target: {} });
  assert.equal(f.send('mousemove', { clientY: -1, pageY: -1 }), false);
  f.send('mousedown', { target: f.canvas, button: 2 });
  assert.equal(f.send('mousemove', { clientY: -1, pageY: -1 }), false);
  assert.equal(f.send('mousedown', { target: f.canvas, clientY: 0, pageY: 0 }), true);
  assert.equal(f.send('mousemove', { clientY: -1, pageY: -1 }), false);
  f.detach();
});

test('both chart guards work independently and detach removes active protection', () => {
  const usd = fixture();
  const eur = fixture(usd.doc);
  usd.send('mousedown', { target: usd.canvas });
  assert.equal(usd.send('mousemove', { clientY: -1, pageY: -1 }), true);
  usd.send('mouseup');
  eur.send('mousedown', { target: eur.canvas });
  usd.detach();
  assert.equal(eur.send('mousemove', { clientY: -1, pageY: -1 }), true);
  eur.detach();
  eur.detach();
  assert.equal(eur.send('mousemove', { clientY: -1, pageY: -1 }), false);
});

test('secondary button releases do not end the protected left-button axis drag', () => {
  const f = fixture();
  f.send('mousedown', { target: f.canvas });
  for (const button of [1, 2]) {
    f.send('mousedown', { target: f.canvas, button });
    f.send('mouseup', { button });
    assert.equal(f.send('mousemove', { clientY: -1, pageY: -1 }), true);
  }
  f.send('mouseup');
  assert.equal(f.send('mousemove', { clientY: -1, pageY: -1 }), false);
  f.detach();
});
