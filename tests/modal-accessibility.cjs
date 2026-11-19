const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://test.example', runScripts: 'outside-only' });
const { window } = dom;

for (const file of ['covers.js', 'constants.js', 'utils.js', 'domain.js', 'stats.js', 'ui.js']) {
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
  console.log('Modal accessibility pass');
  dom.window.close();
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
