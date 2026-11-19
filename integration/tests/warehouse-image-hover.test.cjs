const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Warehouse hover does not intercept image clicks and clears when a photo or its dialog is left', () => {
  const events = new Map();
  const element = () => ({
    style: {},
    setAttribute() {},
    removeAttribute(name) { delete this[name]; },
    append(child) { this.child = child; },
    showPopover() { this.open = true; },
    hidePopover() { this.open = false; },
    matches() { return this.open; },
    getBoundingClientRect() { return { width: 200, height: 200 }; },
  });
  const body = element();
  const document = { body, createElement: element, addEventListener: (name, fn) => events.set(name, fn) };
  const window = { addEventListener: document.addEventListener };
  let onRefresh;
  let watching = false;
  class MutationObserver {
    constructor(callback) { onRefresh = callback; }
    observe() { watching = true; }
    disconnect() { watching = false; }
  }
  const script = fs.readFileSync(path.join(__dirname, '../../warehouse-room/image-hover.js'), 'utf8');
  vm.runInNewContext(script, { document, window, MutationObserver, innerWidth: 400, innerHeight: 420 });
  const preview = body.child;
  const photo = {
    isConnected: true,
    complete: true, naturalWidth: 60, currentSrc: 'https://test.invalid/photo.jpg',
    closest(selector) {
      for (const expected of ['img.receipt-thumb', '.receipt-preview-button img', '.dd-photo-strip button img', '#whPhotoDraft img']) {
        assert.ok(selector.includes(expected));
      }
      return this;
    },
  };
  const move = options => events.get('pointermove')({ target: photo, pointerType: 'mouse', clientX: 380, clientY: 390, ...options });
  move({ pointerType: 'touch' });
  assert.ok(!preview.open);
  move();
  assert.equal(preview.open, true);
  assert.equal(preview.child.src, photo.currentSrc);
  assert.equal(preview.style.left, '166px');
  assert.equal(preview.style.top, '176px');
  assert.ok(!events.has('click'));
  const refresh = () => { if (watching) onRefresh(); };
  refresh();
  assert.ok(preview.open, 'unrelated updates keep the current preview');
  photo.isConnected = false;
  refresh();
  assert.ok(!preview.open, 'a replaced thumbnail cannot leave its old preview visible');
  assert.ok(!watching);
  photo.isConnected = true;
  move();
  events.get('close')();
  assert.ok(!preview.open);
  move();
  events.get('pointerout')({ target: photo });
  assert.ok(!preview.open);
  move();
  events.get('scroll')();
  assert.ok(!preview.open);
  photo.naturalWidth = 0;
  move();
  assert.ok(!preview.open);
});
