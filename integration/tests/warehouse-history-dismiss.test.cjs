const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { deliveryNavigation } = require('../prototypes/warehouse-desk-workflow-20261111/clients.cjs');

test('Warehouse History dismisses outside clicks and Escape while retaining both destinations', () => {
  const source = deliveryNavigation("(function(){view=button.dataset.view;window.warehouseWorkroom?.resetFilter();})();");
  const handlers = {};
  const summary = { focus: () => { focused = true; } };
  const incoming = { addEventListener: (type, handler) => { incoming[type] = handler; } };
  const delivery = {};
  const otherTab = { click: () => { destination = 'Delivery Task'; } };
  const menu = {
    open: true,
    contains: target => [summary, incoming, delivery].includes(target),
    querySelector: () => summary,
  };
  let focused = false;
  let destination = '';
  let dialog = null;
  const elements = {
    '.wh-history-menu': menu,
    '[data-delivery-history]': delivery,
    'nav [data-view="history"]': incoming,
    'nav [data-view="customers"]': otherTab,
  };
  vm.runInNewContext(source.slice(source.lastIndexOf('const historyMenu='), source.lastIndexOf('})();')), {
    saving: false,
    pending: false,
    document: {
      querySelector: selector => selector === 'dialog[open]' ? dialog : elements[selector],
      addEventListener: (type, handler) => { handlers[type] = handler; },
    },
    window: { warehousePackingTab: { isBusy: () => false, openHistory: () => {
      assert.equal(destination, 'Delivery Task');
      destination = 'Delivery History';
    } } },
  });
  handlers.click({ target: summary });
  assert.equal(menu.open, true);
  handlers.click({ target: otherTab });
  assert.equal(menu.open, false);
  menu.open = true;
  handlers.click({ target: {} });
  assert.equal(menu.open, false);
  menu.open = true;
  handlers.keydown({ key: 'Escape', target: delivery });
  assert.equal(menu.open, false);
  assert.equal(focused, true);
  menu.open = true;
  dialog = {};
  handlers.keydown({ key: 'Escape', target: dialog });
  assert.equal(menu.open, true);
  dialog = null;
  incoming.click();
  assert.equal(menu.open, false);
  menu.open = true;
  delivery.onclick();
  assert.equal(destination, 'Delivery History');
  assert.equal(menu.open, false);
});
