const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://test.example', runScripts: 'outside-only' });
const { window } = dom;

for (const file of ['covers.js', 'constants.js', 'utils.js', 'domain.js', 'stats.js', 'modal.js', 'ui.js']) {
  window.eval(fs.readFileSync(path.join(root, 'js', file), 'utf8'));
}

const { UI } = window.MeowPantry;
const trigger = window.document.getElementById('openAddModalBtn');
const backdrop = window.document.getElementById('confirmModalBackdrop');
const first = window.document.getElementById('confirmCancelBtn');
const last = window.document.getElementById('confirmOkBtn');
const settle = () => new Promise(resolve => window.setTimeout(resolve, 0));

async function run() {
  UI.initModalAccessibility();
  trigger.focus();
  UI.showModal('confirmModalBackdrop', 'confirmCancelBtn');
  await settle();
  assert.equal(window.document.activeElement, first, 'Opening a modal should move focus inside it');
  assert.ok(window.document.body.classList.contains('modal-open'), 'Opening a modal should lock background scrolling');

  last.focus();
  last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(window.document.activeElement, first, 'Tab should wrap from the last to the first modal control');

  backdrop.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle();
  assert.ok(backdrop.classList.contains('hidden-view'), 'Escape should close the active modal');
  assert.ok(!window.document.body.classList.contains('modal-open'), 'Closing the last modal should unlock background scrolling');
  assert.equal(window.document.activeElement, trigger, 'Closing a modal should restore focus to its trigger');

  let confirmation = null;
  UI.openConfirm('核销库存？', '请选择核销数量', '确认', (...args) => { confirmation = args; }, {
    label: '同时补记饮食',
    defaultChecked: true,
    redemption: { quantity: 3, unit: '罐' }
  });
  await settle();
  assert.equal(window.document.getElementById('confirmTitle').textContent, '核销库存？');
  assert.equal(window.document.getElementById('confirmStockQuantity').options.length, 2);
  window.document.getElementById('confirmStockQuantity').value = '3';
  UI.syncRedemptionPortion();
  window.document.getElementById('confirmMealQuantity').value = '2';
  UI.consumePendingConfirm();
  assert.deepEqual(confirmation, [true, 3, 2], 'Confirmation should return the selected stock and meal quantities');
  assert.ok(backdrop.classList.contains('hidden-view'));

  let restoreChoice = null;
  UI.openConfirm('恢复备份', '选择方式', '确认', choice => { restoreChoice = choice; }, { restoreMode: true });
  await settle();
  assert.equal(window.document.activeElement, first);
  assert.ok(window.document.querySelector('[name="confirmRestoreMode"][value="merge"]').checked);
  window.document.querySelector('[name="confirmRestoreMode"][value="replace"]').checked = true;
  UI.consumePendingConfirm();
  assert.equal(restoreChoice, false);
  UI.openConfirm('恢复备份', '选择方式', '确认', choice => { restoreChoice = choice; }, { restoreMode: true });
  assert.ok(window.document.querySelector('[name="confirmRestoreMode"][value="merge"]').checked);
  UI.closeConfirm();
  assert.equal(restoreChoice, false, 'Cancel must not run the restore callback');

  let discarded = null;
  UI.openConfirm('丢弃', '选择数量', '确认', (_checked, quantity) => { discarded = quantity; }, {
    discard: { quantity: 5, unit: '罐', whole: true }
  });
  const discardInput = window.document.getElementById('confirmDiscardQuantity');
  discardInput.value = '2.5';
  UI.consumePendingConfirm();
  assert.equal(discarded, null);
  assert.ok(!backdrop.classList.contains('hidden-view'));
  discardInput.value = '3';
  UI.consumePendingConfirm();
  assert.equal(discarded, 3);
  console.log('Modal accessibility pass');
  dom.window.close();
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
