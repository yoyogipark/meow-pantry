// Run from the repository root with: npm test
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="\.\/(js\/[^?]+)/g), ([, file]) => file);
const db = new IDBFactory();
const boot = (localEntries = []) => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { throw error; });
  const { window } = new JSDOM(html, { url: 'https://test.example', runScripts: 'outside-only', virtualConsole });
  window.addEventListener('unhandledrejection', event => { throw event.reason; });
  Object.defineProperty(window, 'indexedDB', { value: db });
  window.scrollTo = () => {};
  for (const [key, value] of localEntries) window.localStorage.setItem(key, value);
  let markReady;
  window.__appReady = new Promise(resolve => { markReady = resolve; });
  for (const file of scripts) {
    if (file === 'js/app.js') {
      const loadFromStorage = window.MeowPantry.Storage.loadFromStorage;
      window.MeowPantry.Storage.loadFromStorage = done => loadFromStorage(() => {
        done();
        markReady();
      });
    }
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  return window;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const json = value => JSON.parse(JSON.stringify(value));
const pass = number => console.log('T' + String(number).padStart(2, '0') + ' pass');

async function run() {
  const w = boot();
  await w.__appReady;
  const { Domain: domain, Utils: utils, Storage: storage, UI: ui, state } = w.MeowPantry;
  const today = utils.getTodayStr();
  const yesterday = utils.shiftDaysFromToday(-1);
  const el = id => w.document.getElementById(id);
  const set = (id, value) => {
    el(id).value = value;
    if (id === 'feedAmountInput') el(id).dispatchEvent(new w.Event('input', { bubbles: true }));
    el(id).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const make = (id, quantity, unit = '杯', extra = {}) => domain.sanitizeItem({
    id, quantity, unit, category: 'can', brand: '测试牌', name: id, expDate: '2099-01-01', ...extra
  });
  const mixed = () => make('mix', 2, '杯', {
    unit_net_weight_g: 50,
    purchasePackaging: { count: 1, outerUnit: '盒', size: 2 },
    flavors: [
      { id: 'chicken', name: '鸡', perPack: 1, quantity: 1, spec: '50g' },
      { id: 'fish', name: '鱼', perPack: 1, quantity: 1 }
    ]
  });
  function reset(...items) {
    state.items = items;
    state.logs = [];
    state.stockHistory = [];
    state.statusFilter = 'in_stock';
    state.searchQuery = '';
    ui.renderAll();
  }
  const save = () => new Promise(resolve => storage.saveToStorage(false, resolve));
  const backup = () => json(storage.buildBackupObject());
  const restore = (data, merge = true) => new Promise(resolve => {
    const validated = storage.validateAndParseBackup(JSON.stringify(data));
    assert.ok(validated.ok, validated.error);
    storage.applyBackupData(validated, merge, (ok, error) => resolve({ ok, error }));
  });
  const byId = id => state.items.find(item => item.id === id);
  async function persisted(check) {
    const reopened = boot(Object.keys(w.localStorage).map(key => [key, w.localStorage.getItem(key)]));
    await reopened.__appReady;
    check(reopened.MeowPantry.state);
    reopened.close();
  }
  function feed(item, amount, options = {}) {
    ui.openFeedModal(item.id, options.date || today);
    if (options.flavor) set('feedFlavorSelect', options.flavor);
    set('feedAmountInput', amount);
    if (el('feedDeductStock').checked !== (options.deduct !== false)) el('feedDeductStock').click();
    let preview = el('feedSplitAutoInfo').textContent;
    el('feedForm').requestSubmit();
    return preview;
  }
  function undo(log) {
    state.selectedLogDate = log.date;
    ui.renderDailyView();
    w.document.querySelector('[data-del-log="' + log.id + '"]').click();
    assert.ok(el('confirmModalBackdrop').classList.contains('confirm-delete-log'));
    assert.equal(el('confirmTitle').textContent, '删除这条记录？');
    assert.equal(el('confirmOkBtn').textContent, '删除');
    assert.ok(el('deleteLogAmount').textContent);
    assert.equal(el('confirmExtraCheckbox').checked, Boolean(log.itemId && (log.flavorChange || log.deductedUnit || log.deductedFrac)));
    el('confirmOkBtn').click();
  }

  let item = mixed();
  reset(item);
  assert.ok(await save());
  const older = backup();
  feed(item, '1杯', { flavor: 'chicken' });
  await settle();
  await persisted(s => { assert.equal(s.items.find(row => row.id === 'mix').quantity, 1); assert.equal(s.logs.length, 1); });
  pass(1);

  assert.ok((await restore(older)).ok);
  assert.equal(byId('mix').quantity, 1);
  await persisted(s => assert.equal(s.items.find(row => row.id === 'mix').quantity, 1));
  pass(2);

  const after = backup();
  assert.ok((await restore(older)).ok);
  assert.equal(byId('mix').quantity, 1);
  assert.ok((await restore(after)).ok);
  assert.equal(state.logs.length, 1);
  assert.equal(state.stockHistory.length, after.stockHistory.length);
  pass(4);
  pass(5);

  const beforeConflict = backup();
  const conflict = json(after);
  conflict.items.push(make('unrelated', 1));
  conflict.logs[0].flavorChange.revision = 'different';
  const rejected = await restore(conflict);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /取消/);
  assert.deepEqual(json(state.items), beforeConflict.items);
  await persisted(s => assert.ok(!s.items.some(row => row.id === 'unrelated')));
  const idless = await restore([{ name: '旧批次', quantity: 1 }]);
  assert.equal(idless.ok, false);
  assert.match(idless.error, /ID/);
  assert.ok((await restore([{ id: 'legacy', quantity: 1, unit: '袋' }])).ok);
  const originalOpen = storage.openIDB;
  storage.openIDB = callback => callback(null);
  assert.equal((await restore([{ id: 'not-written', quantity: 1 }])).ok, false);
  storage.openIDB = originalOpen;
  assert.equal(byId('not-written'), undefined);
  pass(6);

  undo(state.logs[0]);
  await settle();
  assert.equal(byId('mix').quantity, 2);
  assert.equal(state.logs.length, 0);
  await persisted(s => assert.equal(s.items.find(row => row.id === 'mix').flavors[0].quantity, 1));
  pass(3);

  let bag;
  for (const [number, amount] of [[7, '半袋'], [8, '1/2袋']]) {
    bag = make('bag', 2, '袋', { category: 'treat' });
    reset(bag);
    assert.match(feed(bag, amount), /新开封的这份扣 0\.5 袋/);
    assert.equal(bag.quantity, 2);
    assert.equal(bag.openRemainFraction, 0.5);
    assert.equal(state.logs[0].amount, amount);
    assert.equal(state.stockHistory[0].afterQty, 2);
    await settle();
    await persisted(s => assert.equal(s.items[0].openRemainFraction, 0.5));
    pass(number);
  }
  item = make('can', 1, '罐');
  reset(item);
  feed(item, '1/4罐');
  assert.equal(item.openRemainFraction, 0.75);
  pass(9);

  item = make('wet', 1, '杯', { spec: '规格备注', unit_net_weight_g: 50 });
  reset(item);
  feed(item, '46g');
  assert.equal(item.quantity, 1);
  assert.ok(Math.abs(item.openRemainFraction * 50 - 4) < 1e-10);
  await settle();
  await persisted(s => assert.ok(Math.abs(s.items[0].openRemainFraction * 50 - 4) < 1e-10));
  pass(10);
  assert.match(feed(item, '4g'), /开封余量扣 0\.08 杯.*→ 0 杯/);
  assert.equal(item.quantity, 1);
  assert.match(el('confirmTitle').textContent, /这杯已用完，是否核销/);
  el('confirmOkBtn').click();
  assert.equal(item.quantity, 0);
  pass(11);
  // Reopen through the saved receipt, then undo the earlier partial operation in order.
  await settle();
  await new Promise(resolve => storage.loadFromStorage(resolve));
  item = byId('wet');
  undo(state.logs[0]);
  assert.equal(item.quantity, 1);
  assert.ok(Math.abs(item.openRemainFraction * 50 - 4) < 1e-10);
  pass(16);
  undo(state.logs[0]);
  assert.equal(item.openRemainFraction, 0);
  assert.equal(item.isOpened, false);
  assert.equal(item.openedDate, '');
  await settle();
  await persisted(s => { assert.equal(s.items[0].quantity, 1); assert.equal(s.logs.length, 0); });
  pass(15);

  item = mixed();
  reset(item);
  feed(item, '46g', { flavor: 'chicken' });
  assert.ok(Math.abs(item.flavors[0].openRemainFraction * 50 - 4) < 1e-10);
  assert.equal(item.flavors[1].openRemainFraction, 0);
  pass(12);
  assert.match(feed(item, '5g', { flavor: 'chicken' }), /没有足够的新杯/);
  assert.equal(state.logs.length, 2);
  pass(13);
  reset(bag);
  assert.match(feed(bag, '未知'), /无法换算/);
  assert.equal(bag.quantity, 2);
  assert.equal(state.logs.length, 1);
  pass(14);

  const compatible = make('cup', 2);
  const unsupported = make('grams', 100, 'g');
  reset(bag, compatible, unsupported);
  ui.openFeedModal(bag.id, today);
  assert.equal(el('feedDeductStock').checked, true);
  el('feedDeductStock').click();
  set('feedDateInput', yesterday);
  assert.equal(el('feedDeductStock').checked, false);
  pass(17);
  set('feedDateInput', today);
  el('feedDeductStock').click();
  el('feedDeductStock').click();
  set('feedStockSelect', compatible.id);
  assert.equal(el('feedDeductStock').checked, true);
  pass(18);
  el('feedDeductStock').click();
  set('feedStockSelect', unsupported.id);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.equal(el('feedDeductStock').checked, false);
  pass(19);
  feed(compatible, '1杯', { date: yesterday, deduct: false });
  assert.equal(compatible.quantity, 2);
  assert.equal(state.logs[0].deductedUnit, 0);
  assert.equal(state.stockHistory.length, 1);
  assert.equal(state.stockHistory[0].action, 'open');
  await settle();
  await persisted(s => {
    assert.equal(s.items.find(row => row.id === 'cup').quantity, 2);
    assert.equal(s.logs[0].date, yesterday);
    assert.equal(s.stockHistory.length, 1);
  });
  pass(20);

  const automaticBatch = make('auto-deduction', 2, '杯', { unit_net_weight_g: 100 });
  reset(automaticBatch);
  ui.openFeedModal(automaticBatch.id, today);
  assert.equal(el('feedDeductStock').checked, true);
  set('feedAmountInput', '25g');
  assert.equal(el('feedSplitAutoInfo').textContent, '将从新开封的这份扣 0.25 杯');
  el('feedDeductStock').click();
  assert.equal(el('feedSplitAutoInfo').textContent, '仅记录喂食，库存和开封余量保持原样');
  el('feedAmountInput').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(el('feedDeductStock').checked, false);
  set('feedAmountInput', '1/3杯');
  assert.equal(el('feedDeductStock').checked, true);
  set('feedAmountInput', '');
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedSplitAutoInfo').textContent, '份量无法换算，不会扣减库存');
  set('feedAmountInput', '未知');
  assert.equal(el('feedDeductStock').checked, false);
  set('feedAmountInput', '半杯');
  assert.equal(el('feedDeductStock').checked, true);
  el('feedAutoOpen').click();
  assert.equal(el('feedDeductStock').checked, false);
  set('feedAmountInput', '25g');
  assert.equal(el('feedAutoOpen').checked, true);
  assert.equal(el('feedDeductStock').checked, true);
  set('feedDateInput', yesterday);
  set('feedAmountInput', '半杯');
  assert.equal(el('feedDeductStock').checked, false);
  el('feedDeductStock').click();
  assert.equal(el('feedDeductStock').checked, true);
  set('feedAmountInput', '25g');
  assert.equal(el('feedDeductStock').checked, true);
  set('feedDateInput', today);
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(automaticBatch.openRemainFraction, 0.75);
  assert.match(el('toastEl').textContent, /已记录开封，库存已扣减.*撤销/);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(state.logs.length, 0);
  assert.equal(automaticBatch.quantity, 2);
  assert.equal(automaticBatch.isOpened, false);
  await persisted(s => {
    assert.equal(s.logs.length, 0);
    assert.equal(s.items.find(row => row.id === automaticBatch.id).isOpened, false);
  });

  const openingMix = mixed();
  reset(openingMix);
  ui.openFeedModal(openingMix.id, yesterday);
  assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));
  set('feedFlavorSelect', 'chicken');
  assert.equal(el('feedAutoOpenTitle').textContent, '同时记为 ' + yesterday.slice(5) + ' 开封（鸡）');
  assert.equal(el('feedAutoOpen').checked, true);
  set('feedAmountInput', '半杯');
  el('feedDeductStock').click();
  assert.equal(el('feedSplitAutoInfo').textContent, '将从新开封的这份扣 0.5 杯');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(openingMix.flavors[0].openedDate, yesterday);
  assert.equal(openingMix.flavors[0].openRemainFraction, 0.5);
  assert.match(el('toastEl').textContent, /已记录开封，库存已扣减.*撤销/);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(openingMix.flavors[0].openedDate, '');
  assert.equal(openingMix.flavors[0].openRemainFraction, 0);
  assert.equal(state.logs.length, 0);

  const sharedMix = mixed();
  sharedMix.purchasePackaging.seal = 'shared';
  reset(sharedMix);
  feed(sharedMix, '半杯', { flavor: 'chicken' });
  await settle();
  assert.equal(sharedMix.isOpened, true);
  assert.equal(sharedMix.openedDate, today);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(sharedMix.isOpened, false);
  assert.equal(sharedMix.openedDate, '');
  assert.equal(sharedMix.flavors[0].openRemainFraction, 0);

  const alreadyOpen = make('already-open', 2, '杯', { isOpened: true, openedDate: yesterday, openRemainFraction: 0.4 });
  reset(alreadyOpen);
  ui.openFeedModal(alreadyOpen.id, today);
  assert.ok(!el('feedReopenLink').classList.contains('hidden-view'));
  assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));
  assert.equal(el('feedReopenLink').textContent, '换新杯了？记录开封');
  el('feedReopenLink').click();
  assert.match(el('toastEl').textContent, /请填写超过当前开封余量/);
  set('feedAmountInput', '半杯');
  assert.ok(!el('feedAutoOpenBox').classList.contains('hidden-view'));
  assert.equal(el('feedAutoOpenHelp').textContent, '上一杯还剩 0.4杯，将先用完再开新的');
  assert.equal(el('feedAutoOpen').disabled, false);
  assert.equal(el('feedAutoOpen').checked, true);
  assert.equal(el('feedSplitAutoInfo').textContent, '上一杯剩 0.4杯 将用完，再开新杯扣 0.1杯');
  assert.equal(alreadyOpen.openRemainFraction, 0.4);
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(alreadyOpen.quantity, 1);
  assert.equal(alreadyOpen.openedDate, today);
  assert.ok(Math.abs(alreadyOpen.openRemainFraction - 0.9) < 1e-12);
  assert.ok(domain.validatePortionReceipt(state.logs[0]));
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(alreadyOpen.quantity, 2);
  assert.equal(alreadyOpen.openedDate, yesterday);
  assert.equal(alreadyOpen.openRemainFraction, 0.4);
  const empty = make('empty-opening', 0);
  reset(empty);
  ui.openFeedModal(empty.id, today);
  assert.ok(el('feedReopenLink').classList.contains('hidden-view'));
  assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));

  const whole = make('whole-sealed', 3, '袋');
  reset(whole);
  ui.openFeedModal(whole.id, today);
  set('feedAmountInput', '2袋');
  el('feedAutoOpen').click();
  assert.equal(el('feedDeductStock').checked, true);
  assert.equal(el('feedSplitAutoInfo').textContent, '将从在库扣 2 袋');
  el('feedForm').requestSubmit();
  assert.equal(whole.quantity, 3);
  assert.match(el('confirmTitle').textContent, /2袋/);
  el('confirmOkBtn').click();
  await settle();
  assert.equal(whole.quantity, 1);
  assert.equal(whole.isOpened, false);
  assert.equal(state.logs[0].deductedUnit, 2);
  assert.ok(domain.validatePortionReceipt(state.logs[0]));
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(whole.quantity, 3);
  assert.equal(whole.isOpened, false);
  assert.equal(state.logs.length, 0);

  const wholeMix = make('whole-flavor', 4, '杯', {
    purchasePackaging: { count: 1, outerUnit: '盒', size: 4 },
    flavors: [{ id: 'one', name: '鸡', perPack: 3, quantity: 3 }, { id: 'two', name: '鱼', perPack: 1, quantity: 1 }]
  });
  reset(wholeMix);
  ui.openFeedModal(wholeMix.id, today);
  set('feedFlavorSelect', 'one');
  set('feedAmountInput', '2杯');
  el('feedAutoOpen').click();
  assert.equal(el('feedAutoOpen').checked, false);
  assert.equal(el('feedDeductStock').checked, true);
  assert.equal(el('feedSplitAutoInfo').textContent, '将从【鸡】在库扣 2 杯');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(wholeMix.quantity, 2);
  assert.equal(wholeMix.flavors[0].quantity, 1);
  assert.equal(wholeMix.flavors[0].openedDate, '');
  assert.ok(domain.validateFlavorLog(state.logs[0]));
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(wholeMix.quantity, 4);
  assert.equal(wholeMix.flavors[0].quantity, 3);
  assert.equal(state.logs.length, 0);
  reset(whole);
  ui.openFeedModal(whole.id, today);
  set('feedAmountInput', '4袋');
  el('feedAutoOpen').click();
  assert.match(el('feedSplitAutoInfo').textContent, /未开封库存不足/);
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  el('feedForm').requestSubmit();
  assert.equal(whole.quantity, 3);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].deductedUnit, 0);
  console.log('Unified opening, whole-unit deduction and undo pass');

  for (const unit of ['罐', '盒', '包', '袋', '支', '瓶']) {
    const opened = make('unit-' + unit, 2, unit, { isOpened: true, openedDate: yesterday, openRemainFraction: 0.5 });
    reset(opened);
    ui.openFeedModal(opened.id, today);
    assert.equal(el('feedReopenLink').textContent, '换新' + unit + '了？记录开封');
    assert.ok(!el('feedReopenLink').classList.contains('hidden-view'));
    assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));
  }
  const noLimit = make('no-open-limit', 2, '罐', { openDaysLimit: null });
  const singleDose = make('single-dose', 2, '支', { category: 'med', openDaysLimit: 30 });
  const bottledMed = make('bottled-med', 2, '瓶', { category: 'med', openDaysLimit: 30 });
  for (const candidate of [noLimit, singleDose, bottledMed]) {
    reset(candidate);
    ui.openFeedModal(candidate.id, today);
    assert.equal(el('feedAutoOpenBox').classList.contains('hidden-view'), candidate !== bottledMed);
    if (candidate === bottledMed) assert.equal(el('feedAutoOpenTitle').textContent, '同时记为今天开封');
    assert.ok(el('feedReopenLink').classList.contains('hidden-view'));
  }
  singleDose.isOpened = true;
  singleDose.openedDate = yesterday;
  singleDose.openRemainFraction = 0.5;
  reset(singleDose);
  ui.openFeedModal(singleDose.id, today);
  assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));
  assert.ok(el('feedReopenLink').classList.contains('hidden-view'));

  const weightedRollover = make('weighted-rollover', 2, '罐', {
    unit_net_weight_g: 50, isOpened: true, openedDate: yesterday, openRemainFraction: 0.5
  });
  reset(weightedRollover);
  ui.openFeedModal(weightedRollover.id, today);
  set('feedAmountInput', '50g');
  assert.equal(el('feedAutoOpenHelp').textContent, '上一罐还剩 25g，将先用完再开新的');
  assert.equal(el('feedSplitAutoInfo').textContent, '上一罐剩 25g 将用完，再开新罐扣 25g');
  el('feedDeductStock').click();
  assert.equal(el('feedAutoOpen').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  el('feedAutoOpen').click();
  el('feedDeductStock').click();
  el('feedAutoOpen').click();
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedSplitAutoInfo').textContent, /请先打开开封开关/);
  el('feedAutoOpen').click();
  el('feedDeductStock').click();
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(weightedRollover.quantity, 1);
  assert.equal(weightedRollover.openRemainFraction, 0.5);
  assert.equal(weightedRollover.openedDate, today);
  await persisted(s => {
    assert.equal(s.items.find(row => row.id === weightedRollover.id).openRemainFraction, 0.5);
    assert.equal(s.items.find(row => row.id === weightedRollover.id).quantity, 1);
  });
  weightedRollover.portionRevision = 'changed-after-rollover';
  el('toastEl').querySelector('button').click();
  assert.match(el('toastEl').textContent, /无法安全撤销/);
  assert.equal(weightedRollover.quantity, 1);

  const rolloverMix = make('rollover-mix', 3, '杯', {
    unit_net_weight_g: 50, isOpened: true, openedDate: yesterday,
    purchasePackaging: { count: 1, outerUnit: '盒', size: 3, seal: 'shared' },
    flavors: [
      { id: 'one', name: '鸡', perPack: 2, quantity: 2, openedDate: yesterday, openRemainFraction: 0.5 },
      { id: 'two', name: '鱼', perPack: 1, quantity: 1 }
    ]
  });
  reset(rolloverMix);
  ui.openFeedModal(rolloverMix.id, today);
  set('feedFlavorSelect', 'one');
  set('feedAmountInput', '75g');
  assert.equal(el('feedSplitAutoInfo').textContent, '上一杯剩 25g 将用完，再开新杯扣 50g');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(rolloverMix.quantity, 1);
  assert.equal(rolloverMix.flavors[0].quantity, 0);
  assert.equal(rolloverMix.openedDate, yesterday);
  assert.equal(state.logs[0].deductedFrac, 1.5);
  assert.ok(domain.validateFlavorLog(state.logs[0]));
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  const invalidRolloverBackup = backup();
  invalidRolloverBackup.logs[0].flavorChange.fraction = 1.2;
  assert.equal(storage.validateAndParseBackup(JSON.stringify(invalidRolloverBackup)).ok, false);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(rolloverMix.quantity, 3);
  assert.equal(rolloverMix.flavors[0].quantity, 2);
  assert.equal(rolloverMix.flavors[0].openRemainFraction, 0.5);
  assert.equal(rolloverMix.openedDate, yesterday);

  const separateMix = make('separate-rollover', 3, '杯', {
    unit_net_weight_g: 50, purchasePackaging: { count: 1, outerUnit: '盒', size: 3 },
    flavors: [
      { id: 'one', name: '鸡', perPack: 2, quantity: 2, openedDate: yesterday, openRemainFraction: 0.5 },
      { id: 'two', name: '鱼', perPack: 1, quantity: 1 }
    ]
  });
  reset(separateMix);
  ui.openFeedModal(separateMix.id, today);
  set('feedFlavorSelect', 'one');
  set('feedAmountInput', '50g');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(separateMix.flavors[0].quantity, 1);
  assert.equal(separateMix.flavors[0].openedDate, today);
  assert.equal(separateMix.flavors[0].openRemainFraction, 0.5);
  assert.equal(separateMix.flavors[1].quantity, 1);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(separateMix.flavors[0].quantity, 2);
  assert.equal(separateMix.flavors[0].openedDate, yesterday);
  assert.equal(separateMix.flavors[0].openRemainFraction, 0.5);
  assert.equal(separateMix.flavors[1].quantity, 1);

  const shortage = make('rollover-shortage', 1, '包', {
    isOpened: true, openedDate: yesterday, openRemainFraction: 0.25
  });
  reset(shortage);
  ui.openFeedModal(shortage.id, today);
  set('feedAmountInput', '半包');
  assert.equal(el('feedAutoOpen').disabled, true);
  assert.match(el('feedAutoOpenHelp').textContent, /没有足够的新包.*补充库存/);
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedSplitAutoInfo').textContent, /没有足够的新包/);
  set('feedAmountInput', '1/4包');
  assert.equal(el('feedDeductStock').disabled, false);
  assert.equal(el('feedDeductStock').checked, true);
  assert.ok(el('feedAutoOpenBox').classList.contains('hidden-view'));
  set('feedAmountInput', '无法换算');
  assert.equal(el('feedDeductStock').disabled, true);
  assert.equal(el('feedDeductStock').checked, false);
  console.log('Opening eligibility and rollover plan pass');

  const strip = make('stick-conversion', 1, '盒', {
    category: 'treat', subtype: '猫条／肉泥条', feedUsageUnit: '支', feedUsagePerItem: 6
  });
  reset(strip);
  ui.openFeedModal(strip.id, today);
  assert.deepEqual(Array.from(el('feedPortionChips').querySelectorAll('[data-configured-portion]'), b => b.textContent),
    ['半支', '1支']);
  assert.equal(el('feedAmountInput').value, '1支');
  set('feedAmountInput', '半支');
  assert.equal(el('feedDeductStock').checked, true);
  assert.match(el('feedSplitAutoInfo').textContent, /半支（约0\.083盒）/);
  el('feedForm').requestSubmit();
  await settle();
  assert.ok(Math.abs(strip.openRemainFraction - 11 / 12) < 1e-12);
  assert.equal(state.logs[0].productFeedUsageUnit, '支');
  assert.equal(state.logs[0].productFeedUsagePerItem, 6);
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(strip.quantity, 1);
  assert.equal(strip.isOpened, false);

  const stripUnknown = make('stick-unknown', 1, '盒', { category: 'treat', subtype: '猫条／肉泥条' });
  reset(stripUnknown);
  ui.openFeedModal(stripUnknown.id, today);
  assert.equal(el('feedAmountInput').value, '1支');
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedSplitAutoInfo').textContent, /份量无法换算/);
  el('feedForm').requestSubmit();
  assert.equal(stripUnknown.quantity, 1);
  assert.equal(state.logs[0].deductedFrac, 0);

  const sixSticks = make('six-sticks', 6, '支', {
    category: 'treat', subtype: '猫条／肉泥条',
    purchasePackaging: { count: 1, outerUnit: '盒', size: 6 }
  });
  reset(sixSticks);
  ui.openFeedModal(sixSticks.id, today);
  assert.equal(el('feedAmountInput').value, '1支');
  el('feedForm').requestSubmit();
  el('confirmOkBtn').click();
  await settle();
  assert.equal(sixSticks.quantity, 5);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(sixSticks.quantity, 6);

  reset();
  ui.openAddModal();
  el('modalCatSelector').querySelector('[data-form-cat="treat"]').click();
  set('fieldSubtype', '猫条');
  set('fieldBrand', '测试牌');
  set('fieldName', '无克重猫条');
  set('fieldUnit', '支');
  set('fieldQty', '2');
  set('fieldProdDate', today);
  assert.equal(el('fieldNetWeight').required, false);
  assert.equal(el('fieldNetWeight').value, '');
  el('itemForm').requestSubmit();
  await settle();
  assert.ok(state.items.some(row => row.name === '无克重猫条' && row.quantity === 2));
  assert.equal(state.items.find(row => row.name === '无克重猫条').unit_net_weight_g, null);
  ui.openFeedModal(state.items.find(row => row.name === '无克重猫条').id, today);
  assert.equal(el('feedAmountInput').value, '1支');
  ui.closeFeedModal();

  const powdered = make('powdered', 1, '瓶', { category: 'supp', subtype: '粉剂',
    feedUsageUnit: '勺', feedUsagePerItem: 30 });
  reset(powdered);
  ui.openFeedModal(powdered.id, today);
  assert.equal(el('feedAmountInput').value, '');
  assert.equal(Array.from(el('feedPortionChips').querySelectorAll('[data-package-portion]'))
    .filter(b => !b.classList.contains('hidden-view')).length, 0);
  set('feedAmountInput', '1勺');
  el('feedDeductStock').click();
  assert.equal(el('feedDeductStock').checked, true);
  el('feedForm').requestSubmit();
  await settle();
  assert.ok(Math.abs(powdered.openRemainFraction - 29 / 30) < 1e-12);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(powdered.isOpened, false);

  const flavorHistoryItem = mixed();
  reset(flavorHistoryItem);
  state.logs = [
    domain.sanitizeLog({ id: 'flavor-a', date: today, itemId: flavorHistoryItem.id, category: 'can',
      brand: flavorHistoryItem.brand, name: flavorHistoryItem.name, flavorId: 'chicken', flavorName: '鸡', amount: '半杯' }),
    domain.sanitizeLog({ id: 'flavor-b', date: yesterday, itemId: flavorHistoryItem.id, category: 'can',
      brand: flavorHistoryItem.brand, name: flavorHistoryItem.name, flavorId: 'fish', flavorName: '鱼', amount: '1杯' })
  ];
  ui.openFeedModal(flavorHistoryItem.id, today);
  assert.ok(el('chipLastPortion').classList.contains('hidden-view'));
  set('feedFlavorSelect', 'fish');
  assert.equal(el('chipLastPortion').dataset.portion, '1杯');
  set('feedFlavorSelect', 'chicken');
  assert.equal(el('chipLastPortion').dataset.portion, '半杯');

  const tube = make('single-use-tube', 1, '支', { category: 'med' });
  reset(tube);
  ui.openFeedModal(tube.id, today);
  assert.deepEqual(Array.from(el('feedPortionChips').querySelectorAll('[data-package-portion]'))
    .filter(b => !b.classList.contains('hidden-view')).map(b => b.textContent), ['1支']);

  const wetOther = make('wet-other', 1, '罐', { subtype: '其他' });
  reset(wetOther);
  ui.openEditModal(wetOther.id);
  assert.equal(el('fieldSubtype').value, '其他');
  assert.equal(el('fieldUnit').disabled, false);
  ui.openRestockModal(wetOther);
  assert.equal(el('fieldSubtype').value, '其他');
  ui.closeItemModal();

  const customType = make('custom-kind', 2, '盒', { category: 'med' });
  reset(customType);
  ui.openEditModal(customType.id);
  set('fieldSubtype', '__custom__');
  set('fieldSubtypeCustom', '肉粒');
  set('fieldUsageUnit', '粒');
  set('fieldUsagePerItem', '20');
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(customType.id).subtype, '肉粒');
  assert.equal(byId(customType.id).feedUsageUnit, '粒');
  assert.equal(byId(customType.id).feedUsagePerItem, 20);
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  ui.openEditModal(customType.id);
  assert.equal(el('fieldSubtype').value, '__custom__');
  assert.equal(el('fieldSubtypeCustom').value, '肉粒');
  assert.equal(el('fieldUsagePerItem').value, '20');
  ui.openRestockModal(byId(customType.id));
  assert.equal(el('fieldSubtypeCustom').value, '肉粒');
  assert.equal(el('fieldUsagePerItem').value, '20');
  ui.closeItemModal();
  const invalidUnits = backup();
  invalidUnits.items[0].feedUsagePerItem = -1;
  assert.equal(storage.validateAndParseBackup(JSON.stringify(invalidUnits)).ok, false);
  console.log('Food forms, usage conversion and legacy stock pass');

  reset();
  ui.openAddModal();
  const expectedForms = {
    freeze: ['主食冻干', '零食冻干', '冻干粉末'],
    can: ['罐头', '餐盒', '餐包'],
    treat: ['猫条', '肉干', '饼干', '洁齿', '奶制品', '其他'],
    supp: ['粉剂', '膏剂', '液体', '片剂', '胶囊'],
    med: ['片剂', '胶囊', '膏剂', '滴剂/液体', '自定义…'],
    supplies: ['猫砂', '清洁用品', '一次性用品', '配件耗材']
  };
  assert.ok(el('itemSubtypeWrap').classList.contains('hidden-view'));
  for (const [category, expected] of Object.entries(expectedForms)) {
    el('modalCatSelector').querySelector('[data-form-cat="' + category + '"]').click();
    assert.deepEqual(Array.from(el('fieldSubtype').options).slice(1).map(option => option.textContent), expected);
  }
  ui.closeItemModal();
  const oldDry = make('old-dry-form', 1, '袋', { category: 'dry', subtype: '其他主食', unit_net_weight_g: 1000 });
  reset(oldDry);
  ui.openEditModal(oldDry.id);
  assert.ok(el('itemSubtypeWrap').classList.contains('hidden-view'));
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(oldDry.id).subtype, '其他主食');
  ui.openRestockModal(byId(oldDry.id));
  assert.equal(el('fieldSubtype').value, '其他主食');
  ui.closeItemModal();

  const existingFood = make('self-feed-stock', 2);
  reset(existingFood);
  ui.openFeedModal('', today, false, false, true);
  el('feedStockChoices').querySelector('[data-feed-stock-id="__unstocked__"]').click();
  assert.equal(el('feedItemId').value, '');
  assert.equal(el('feedCategorySelect').value, 'can');
  assert.equal(el('feedBrandInput').required, false);
  assert.ok(el('feedManualBrandField').classList.contains('hidden-view'));
  assert.equal(Array.from(el('feedPortionChips').querySelectorAll('[data-package-portion]'))
    .filter(button => !button.classList.contains('hidden-view')).length, 0);
  set('feedNameInput', '自制鸡肉鲜食');
  set('feedAmountInput', '40g');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(state.items.length, 1);
  assert.equal(existingFood.quantity, 2);
  assert.equal(state.logs[0].itemId, '');
  assert.equal(state.logs[0].unstocked, true);
  assert.equal(state.logs[0].brand, '');
  assert.equal(state.logs[0].name, '自制鸡肉鲜食');
  assert.equal(state.logs[0].deductedFrac, 0);
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  await persisted(s => {
    assert.equal(s.logs[0].unstocked, true);
    assert.equal(s.logs[0].brand, '');
    assert.equal(s.items.length, 1);
  });
  ui.openEditFeedModal(state.logs[0].id);
  assert.equal(el('feedManualTitle').textContent, '自制/无商品');
  assert.equal(el('feedBrandInput').required, false);
  set('feedAmountInput', '50g');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(state.logs[0].amount, '50g');
  assert.equal(state.items.length, 1);
  console.log('Category forms and unstocked feeding pass');

  reset();
  ui.openAddModal();
  const chooseForm = (category, subtype) => {
    el('modalCatSelector').querySelector('[data-form-cat="' + category + '"]').click();
    if (subtype) set('fieldSubtype', subtype);
  };
  for (const [category, subtype] of [['dry', ''], ['can', '餐盒'], ['freeze', '主食冻干'], ['supplies', '猫砂']]) {
    chooseForm(category, subtype);
    assert.ok(el('stockUsageConfig').classList.contains('hidden-view'), category + ':' + subtype);
  }
  for (const [category, subtype, unit] of [
    ['freeze', '零食冻干', '块'], ['supp', '粉剂', '勺']
  ]) {
    chooseForm(category, subtype);
    assert.ok(!el('stockUsageConfig').classList.contains('hidden-view'));
    assert.ok(el('stockUsageConfig').open);
    assert.ok(el('stockUsageSummary').classList.contains('hidden-view'));
    assert.ok(el('stockUsageUnitField').classList.contains('hidden-view'));
    assert.equal(el('fieldUsageUnit').value, unit);
    assert.match(el('stockUsageAmountLabel').textContent, new RegExp(unit));
    assert.equal(el('fieldUsagePerItem').required, false);
  }
  chooseForm('med', '滴剂/液体');
  assert.ok(el('stockUsageConfig').open);
  assert.ok(!el('stockUsageUnitField').classList.contains('hidden-view'));
  assert.deepEqual(Array.from(el('fieldUsageUnit').options).filter(option => !option.hidden).map(option => option.value), ['', '滴', 'ml']);
  set('fieldUsageUnit', '滴');
  set('fieldUsagePerItem', '20');
  set('fieldUsageUnit', 'ml');
  assert.equal(el('fieldUsagePerItem').value, '', '改变投喂单位时必须重新填写换算数');
  chooseForm('supp', '膏剂');
  assert.ok(!el('stockUsageConfig').open);
  assert.ok(!el('stockUsageUnitField').classList.contains('hidden-view'));
  assert.equal(el('stockUsageStatus').textContent, '未设置');
  set('fieldUsageUnit', '勺');
  el('fieldUsagePerItem').value = '12';
  el('fieldUsagePerItem').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(el('stockUsageStatus').textContent, /12 勺/);
  ui.closeItemModal();

  const medicineDrops = make('medicine-drops', 1, '瓶', { category: 'med', subtype: '滴剂/液体' });
  reset(medicineDrops);
  ui.openEditModal(medicineDrops.id);
  set('fieldUsageUnit', '滴');
  set('fieldUsagePerItem', '20');
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(medicineDrops.id).feedUsageUnit, '滴');
  assert.equal(byId(medicineDrops.id).feedUsagePerItem, 20);
  assert.equal(ui.parseFeedPortion('5滴', byId(medicineDrops.id)).fraction, 0.25);
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  ui.openFeedModal(medicineDrops.id, today);
  set('feedAmountInput', '5滴');
  assert.equal(el('feedDeductStock').disabled, false);
  if (!el('feedDeductStock').checked) el('feedDeductStock').click();
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(byId(medicineDrops.id).openRemainFraction, 0.75);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(byId(medicineDrops.id).quantity, 1);
  assert.equal(byId(medicineDrops.id).isOpened, false);

  const freezeTreat = make('freeze-treat', 1, '包', { category: 'freeze', subtype: '零食冻干', unit_net_weight_g: 100 });
  reset(freezeTreat);
  ui.openFeedModal(freezeTreat.id, today);
  assert.equal(el('feedAmountInput').value, '1块');
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedSplitAutoInfo').textContent, /份量无法换算/);
  ui.closeFeedModal();

  const oldHiddenUsage = make('hidden-usage', 1, '罐', { subtype: '罐头', feedUsageUnit: '勺', feedUsagePerItem: 4 });
  reset(oldHiddenUsage);
  ui.openEditModal(oldHiddenUsage.id);
  assert.ok(el('stockUsageConfig').classList.contains('hidden-view'));
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(oldHiddenUsage.id).feedUsageUnit, '勺');
  assert.equal(byId(oldHiddenUsage.id).feedUsagePerItem, 4);

  const oldUsage = make('legacy-usage', 1, '盒', {
    category: 'treat', subtype: '猫条', feedUsageUnit: '粒', feedUsagePerItem: 6
  });
  reset(oldUsage);
  ui.openEditModal(oldUsage.id);
  assert.ok(!el('stockUsageUnitField').classList.contains('hidden-view'));
  assert.match(el('stockUsageHelp').textContent, /沿用原有/);
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(oldUsage.id).feedUsageUnit, '粒');
  assert.equal(byId(oldUsage.id).feedUsagePerItem, 6);
  ui.openEditModal(oldUsage.id);
  set('fieldSubtype', '肉干');
  assert.equal(el('fieldUsagePerItem').value, '');
  set('fieldSubtype', '猫条');
  assert.equal(el('fieldUsageUnit').value, '粒');
  assert.equal(el('fieldUsagePerItem').value, '6');
  ui.closeItemModal();
  console.log('Contextual usage conversion and legacy values pass');

  reset();
  ui.openAddModal();
  const visibleUnits = () => Array.from(el('fieldUnit').options, option => option.value);
  for (const [category, subtype, units, selected] of [
    ['treat', '猫条', ['支'], '支'],
    ['treat', '肉干', ['袋', '包'], '袋'],
    ['treat', '饼干', ['袋', '包'], '袋'],
    ['treat', '洁齿', ['袋', '包'], '袋'],
    ['treat', '奶制品', ['袋', '包'], '袋'],
    ['treat', '其他', ['袋', '包'], '袋'],
    ['freeze', '主食冻干', ['袋', '包'], '袋'],
    ['freeze', '零食冻干', ['袋', '包'], '袋'],
    ['freeze', '冻干粉末', ['袋', '包', '瓶'], '袋'],
    ['supp', '片剂', ['片', '粒', '包'], '片'],
    ['supp', '胶囊', ['粒', '包'], '粒'],
    ['med', '片剂', ['片', '粒', '包'], '片'],
    ['med', '胶囊', ['粒', '包'], '粒']
  ]) {
    chooseForm(category, subtype);
    assert.deepEqual(visibleUnits(), units, category + ':' + subtype);
    assert.equal(el('fieldUnit').value, selected);
    assert.equal(el('fieldUnit').disabled, false);
  }
  chooseForm('treat', '猫条');
  assert.ok(el('stockUsageConfig').classList.contains('hidden-view'));
  const innerPackage = el('stockInnerPackage');
  el('fieldPackagingEnabled').click();
  assert.equal(innerPackage.parentElement.id, 'stockQuantityGrid');
  assert.equal(el('fieldPackSeal').value, 'independent');
  assert.equal(el('packSealIndependentBtn').getAttribute('aria-pressed'), 'true');
  el('stockPackSealMode').querySelector('[data-pack-seal="shared"]').click();
  assert.equal(el('fieldPackSeal').value, 'shared');
  assert.equal(el('stockPackSealMode').querySelector('[data-pack-seal="shared"]').getAttribute('aria-pressed'), 'true');
  assert.equal(el('packSealHelp').textContent, '整盒一起计算保鲜期');
  el('stockPackSealMode').querySelector('[data-pack-seal="independent"]').click();
  assert.equal(el('fieldPackSeal').value, 'independent');
  assert.equal(el('stockPackSealMode').querySelector('[data-pack-seal="independent"]').getAttribute('aria-pressed'), 'true');
  assert.equal(el('packSealHelp').textContent, '每件单独计算保鲜期');
  assert.equal(el('fieldUnit').value, '支');
  set('fieldPackSize', '6');
  el('fieldPackSize').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('fieldQty').value, '6');
  el('fieldPackagingEnabled').click();
  chooseForm('freeze', '冻干粉末');
  assert.ok(!el('stockUsageConfig').classList.contains('hidden-view'));
  assert.equal(el('stockUsageConfig').open, true);
  assert.ok(el('stockUsageConfig').classList.contains('stock-usage-inline'));
  assert.equal(el('fieldUsageUnit').value, '勺');
  assert.ok(el('stockUsageUnitField').classList.contains('hidden-view'));
  assert.equal(el('stockUsageHelp').textContent, '填写后可按勺自动扣库存');
  el('fieldPackagingEnabled').click();
  set('fieldPackOuterUnit', '袋');
  assert.deepEqual(visibleUnits(), ['包', '瓶']);
  assert.equal(el('fieldUnit').value, '包');
  set('fieldPackOuterUnit', '盒');
  assert.ok(!visibleUnits().includes('盒'));
  ui.closeItemModal();

  const legacyStick = make('legacy-box-stick', 1, '盒', {
    category: 'treat', subtype: '猫条', feedUsageUnit: '支', feedUsagePerItem: 6
  });
  reset(legacyStick);
  ui.openEditModal(legacyStick.id);
  assert.equal(el('fieldUnit').value, '盒');
  assert.ok(Array.from(el('fieldUnit').options).some(option => option.value === '盒' && /历史/.test(option.textContent)));
  assert.ok(!el('stockUsageConfig').classList.contains('hidden-view'));
  set('fieldUsagePerItem', '8');
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId(legacyStick.id).unit, '盒');
  assert.equal(byId(legacyStick.id).feedUsagePerItem, 8);
  ui.openRestockModal(byId(legacyStick.id));
  assert.equal(el('fieldUnit').value, '盒');
  assert.equal(el('fieldUsagePerItem').value, '8');
  ui.closeItemModal();
  ui.openEditModal(legacyStick.id);
  set('fieldUnit', '支');
  assert.ok(!el('stockUsageConfig').classList.contains('hidden-view'));
  assert.match(el('stockUsageHelp').textContent, /清空换算数量或改为 1/);
  ui.closeItemModal();

  reset();
  ui.openAddModal();
  chooseForm('freeze', '冻干粉末');
  set('fieldBrand', '测试牌');
  set('fieldName', '冻干粉');
  set('fieldNetWeight', '100');
  set('fieldProdDate', today);
  el('stockUsageConfig').open = true;
  set('fieldUsagePerItem', '20');
  el('itemForm').requestSubmit();
  await settle();
  const freezePowder = state.items.find(row => row.name === '冻干粉');
  assert.ok(freezePowder);
  assert.equal(freezePowder.feedUsageUnit, '勺');
  assert.equal(freezePowder.feedUsagePerItem, 20);
  assert.equal(ui.parseFeedPortion('5勺', freezePowder).fraction, 0.25);
  ui.openFeedModal(freezePowder.id, today);
  set('feedAmountInput', '5勺');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(byId(freezePowder.id).openRemainFraction, 0.75);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(byId(freezePowder.id).isOpened, false);

  const legacySpec = domain.sanitizeItem({
    id: 'legacy-spec', category: 'freeze', subtype: '冻干粉末', unit: '袋',
    brand: '测试牌', name: '旧商品', quantity: 1, spec: '100g', notes: '原备注', expDate: '2099-01-01'
  });
  assert.equal(legacySpec.notes, '原备注；包装补充：100g');
  assert.equal(legacySpec.spec, '100g');
  assert.equal(legacySpec.unit_net_weight_g, 100);
  assert.equal(domain.getProductGroupKey(legacySpec), domain.getProductGroupKey({ ...json(legacySpec), notes: '原备注' }));
  assert.equal(domain.sanitizeItem(legacySpec).notes, legacySpec.notes);
  legacySpec.notes = '用户修改后的备注';
  assert.equal(domain.sanitizeItem(legacySpec).notes, '用户修改后的备注');
  const supplySpec = make('supply-spec', 1, '袋', { category: 'supplies', spec: '无香', notes: '原备注' });
  assert.equal(supplySpec.notes, '原备注');
  reset(legacySpec, supplySpec);
  ui.openEditModal(legacySpec.id);
  assert.ok(el('stockPackagingSupplementField').classList.contains('hidden-view'));
  const effect = name => Array.from(el('stockEffectTags').querySelectorAll('[data-effect-tag]')).find(button => button.textContent === name);
  effect('拌粮').click();
  el('stockEffectTags').querySelector('[data-effect-custom]').click();
  el('fieldEffectCustom').value = '<自定义>';
  el('addEffectCustomBtn').click();
  assert.equal(effect('<自定义>').getAttribute('aria-pressed'), 'true');
  assert.equal(el('stockEffectTags').querySelector('自定义'), null);
  set('fieldSubtype', '零食冻干');
  assert.equal(effect('<自定义>').getAttribute('aria-pressed'), 'true');
  el('itemForm').requestSubmit();
  await settle();
  assert.deepEqual(json(byId(legacySpec.id).effectTags), ['拌粮', '<自定义>']);
  assert.equal(byId(legacySpec.id).notes, '用户修改后的备注');
  assert.equal(byId(legacySpec.id).spec, '100g');
  assert.deepEqual(storage.validateAndParseBackup(JSON.stringify(backup())).ok, true);
  const invalidTags = backup();
  invalidTags.items[0].effectTags = '拌粮';
  assert.match(storage.validateAndParseBackup(JSON.stringify(invalidTags)).error, /功效标签/);
  await persisted(s => assert.deepEqual(json(s.items.find(row => row.id === legacySpec.id).effectTags), ['拌粮', '<自定义>']));
  ui.openRestockModal(byId(legacySpec.id));
  assert.equal(effect('<自定义>').getAttribute('aria-pressed'), 'true');
  assert.equal(el('fieldNotes').value, '用户修改后的备注');
  ui.closeItemModal();
  ui.openEditModal(supplySpec.id);
  assert.ok(!el('stockPackagingSupplementField').classList.contains('hidden-view'));
  assert.ok(el('stockEffectTagsField').classList.contains('hidden-view'));
  assert.equal(el('fieldSpec').value, '无香');
  ui.closeItemModal();
  const effectArchive = make('legacy-spec-archive', 0, '袋', { category: 'freeze', sourceBatchId: legacySpec.id });
  domain.copySharedMetadataToArchive(byId(legacySpec.id), effectArchive);
  assert.deepEqual(json(effectArchive.effectTags), ['拌粮', '<自定义>']);
  effectArchive.effectTags.push('独立数组');
  assert.equal(byId(legacySpec.id).effectTags.length, 2);

  const unmigrated = { ...json(byId(legacySpec.id)), notes: '旧备注' };
  delete unmigrated.legacySpecInNotes;
  reset(unmigrated);
  assert.ok(await save());
  await new Promise(resolve => storage.loadFromStorage(resolve));
  await settle();
  assert.equal(byId(legacySpec.id).notes, '旧备注；包装补充：100g');
  await persisted(s => assert.equal(s.items[0].notes, '旧备注；包装补充：100g'));
  byId(legacySpec.id).notes = '';
  assert.ok(await save());
  await new Promise(resolve => storage.loadFromStorage(resolve));
  assert.equal(byId(legacySpec.id).notes, '');

  reset();
  ui.openAddModal();
  chooseForm('med', '片剂');
  el('fieldPackagingEnabled').click();
  set('fieldPackSize', '6');
  el('fieldPackSize').dispatchEvent(new w.Event('input', { bubbles: true }));
  set('fieldBrand', '测试牌');
  set('fieldName', '药片');
  set('fieldNetWeight', '1');
  set('fieldProdDate', today);
  assert.ok(el('stockUsageConfig').classList.contains('hidden-view'));
  el('itemForm').requestSubmit();
  await settle();
  const tablet = state.items.find(row => row.name === '药片');
  assert.ok(tablet);
  assert.equal(tablet.unit, '片');
  assert.equal(tablet.quantity, 6);
  assert.equal(tablet.purchasePackaging.size, 6);
  assert.ok(storage.validateAndParseBackup(JSON.stringify(backup())).ok);
  ui.openFeedModal(tablet.id, today);
  set('feedAmountInput', '1片');
  if (!el('feedDeductStock').checked) el('feedDeductStock').click();
  el('feedForm').requestSubmit();
  el('confirmOkBtn').click();
  await settle();
  assert.equal(byId(tablet.id).quantity, 5);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(byId(tablet.id).quantity, 6);
  console.log('Shape units, powder and historical packaging pass');

  const noWeight = make('no-weight', 1, '杯');
  reset(noWeight);
  ui.openFeedModal(noWeight.id, today);
  set('feedAmountInput', '25g');
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedSplitAutoInfo').textContent, '份量无法换算，不会扣减库存');
  el('feedPortionChips').querySelector('[data-frac="0.5"]').click();
  assert.equal(el('feedDeductStock').checked, true);
  el('feedDeductStock').click();
  el('feedPortionChips').querySelector('[data-frac="0.5"]').click();
  assert.equal(el('feedDeductStock').checked, false);

  const undoMix = mixed();
  undoMix.flavors[0].openedDate = yesterday;
  undoMix.flavors[0].openRemainFraction = 0.75;
  reset(undoMix);
  ui.openFeedModal(undoMix.id, today);
  set('feedFlavorSelect', 'chicken');
  set('feedAmountInput', '半杯');
  assert.equal(el('feedSplitAutoInfo').textContent, '将从【鸡】开封余量扣 0.5 杯（余 0.75 杯 → 0.25 杯）');
  el('feedForm').requestSubmit();
  await settle();
  assert.equal(undoMix.flavors[0].openRemainFraction, 0.25);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(undoMix.flavors[0].openRemainFraction, 0.75);
  assert.equal(state.logs.length, 0);

  const finishedBatch = make('undo-finished', 1, '杯', { isOpened: true, openedDate: yesterday, openRemainFraction: 0.5 });
  reset(finishedBatch);
  ui.openFeedModal(finishedBatch.id, today);
  set('feedAmountInput', '半杯');
  el('feedForm').requestSubmit();
  el('confirmOkBtn').click();
  await settle();
  assert.equal(finishedBatch.quantity, 0);
  assert.match(el('toastEl').textContent, /已记录，库存已扣减.*撤销/);
  el('toastEl').querySelector('button').click();
  await settle();
  assert.equal(finishedBatch.quantity, 1);
  assert.equal(finishedBatch.openRemainFraction, 0.5);
  assert.equal(state.logs.length, 0);
  await persisted(s => {
    assert.equal(s.logs.length, 0);
    assert.equal(s.items.find(row => row.id === finishedBatch.id).openRemainFraction, 0.5);
  });

  const changedBatch = make('undo-conflict', 1, '杯');
  reset(changedBatch);
  feed(changedBatch, '半杯');
  await settle();
  changedBatch.portionRevision = 'newer-change';
  el('toastEl').querySelector('button').click();
  assert.match(el('toastEl').textContent, /无法安全撤销/);
  assert.equal(state.logs.length, 1);
  assert.equal(changedBatch.openRemainFraction, 0.5);
  const timedBatch = make('undo-timeout', 1, '杯');
  reset(timedBatch);
  feed(timedBatch, '半杯');
  await settle();
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.ok(!el('toastEl').classList.contains('hidden-view'));
  await new Promise(resolve => setTimeout(resolve, 2700));
  assert.ok(el('toastEl').classList.contains('hidden-view'));
  console.log('Automatic deduction, previews and safe undo pass');

  item = make('box', 2, '盒', { category: 'freeze', purchasePackaging: { count: 1, outerUnit: '盒', size: 4 }, unit_net_weight_g: 50, price: 3 });
  const boxArchive = make('empty_box', 0, '盒', { sourceBatchId: 'box' });
  const otherItem = make('other-unit', 1, '罐');
  reset(item, boxArchive, otherItem);
  domain.appendStockHistory({ action: 'consume', itemId: item.id, category: item.category, brand: item.brand,
    name: item.name, unit: '盒', deltaText: '-1盒', beforeQty: 3, afterQty: 2, note: '自由文字盒装备注' });
  domain.appendStockHistory({ action: 'adjust', itemId: otherItem.id, category: otherItem.category, brand: otherItem.brand,
    name: otherItem.name, unit: '罐', deltaText: '-1罐', beforeQty: 2, afterQty: 1 });
  state.logs.push(domain.sanitizeLog({ id: 'box-log', date: today, itemId: item.id, category: item.category,
    brand: item.brand, name: item.name, productUnit: '盒', amount: '半盒', note: '自由文字盒装备注' }));
  ui.openEditModal(item.id);
  assert.equal(el('fieldUnit').disabled, false);
  set('fieldUnit', '杯');
  assert.equal(el('unitChangeHint').textContent, '单位已由 盒 改为 杯：数量 2 不变，请确认每杯净含量。');
  el('itemForm').requestSubmit();
  assert.match(el('confirmMessage').textContent, /历史记录里的单位也会一起更新/);
  el('confirmOkBtn').click();
  await settle();
  await settle();
  assert.equal(byId('box').quantity, 2);
  assert.equal(byId('box').unit, '杯');
  assert.equal(byId('box').price, 3);
  assert.equal(byId('box').unit_net_weight_g, 50);
  assert.equal(byId('empty_box').unit, '杯');
  assert.equal(state.stockHistory.find(row => row.itemId === 'box' && row.action === 'consume').unit, '杯');
  assert.equal(state.stockHistory.find(row => row.itemId === 'box' && row.action === 'consume').deltaText, '-1杯');
  assert.equal(state.stockHistory.find(row => row.itemId === 'box' && row.action === 'consume').note, '自由文字盒装备注');
  assert.equal(state.stockHistory.find(row => row.itemId === 'other-unit').unit, '罐');
  assert.equal(state.logs[0].productUnit, '杯');
  assert.equal(state.logs[0].amount, '半盒');
  assert.equal(state.logs[0].note, '自由文字盒装备注');
  assert.equal(state.stockHistory[0].deltaText, '内包装单位由 盒 更正为 杯');
  pass(21);
  await settle();
  await persisted(s => { assert.equal(s.items[0].unit, '杯'); assert.equal(s.items[0].quantity, 2); });
  assert.ok(await new Promise(resolve => storage.restorePreRestoreSnapshot(resolve)));
  assert.equal(byId('box').unit, '盒');
  assert.equal(byId('empty_box').unit, '盒');
  assert.equal(state.stockHistory.find(row => row.itemId === 'box').unit, '盒');
  assert.equal(state.logs.find(row => row.id === 'box-log').productUnit, '盒');
  assert.ok(!state.stockHistory.some(row => row.deltaText === '内包装单位由 盒 更正为 杯'));
  pass(22);

  assert.equal(domain.stockUnitCorrectionError(make('fractional-unit', 0.5, '杯'), '盒'),
    '当前剩余数量不是整数，无法仅更正计数单位。');
  assert.equal(domain.stockUnitCorrectionError(make('unsupported-unit', 1, '桶'), '杯'), '该单位暂不支持更正。');
  assert.equal(domain.stockUnitCorrectionError(make('same-outer', 1, '杯', {
    purchasePackaging: { count: 1, outerUnit: '盒', size: 1 }
  }), '盒'), '内包装不能与外包装相同。');
  assert.equal(domain.rewriteStockUnitDelta('+2杯', '杯', '盒'), '+2盒');
  assert.equal(domain.rewriteStockUnitDelta('-1杯', '杯', '盒'), '-1盒');
  assert.equal(domain.rewriteStockUnitDelta('+1杯(余1/2杯)', '杯', '盒'), '+1盒(余1/2盒)');
  assert.equal(domain.rewriteStockUnitDelta('余25%杯', '杯', '盒'), '余25%盒');
  assert.equal(domain.rewriteStockUnitDelta('拆封 1杯', '杯', '盒'), '拆封 1盒');
  assert.equal(domain.rewriteStockUnitDelta('恢复整杯', '杯', '盒'), '恢复整盒');
  assert.equal(domain.rewriteStockUnitDelta('恢复整杯未拆', '杯', '盒'), '恢复整盒未拆');
  assert.equal(domain.rewriteStockUnitDelta('罐 → 杯', '杯', '盒'), '罐 → 盒');
  assert.equal(domain.rewriteStockUnitDelta('自由文字：送人1杯', '杯', '盒'), '自由文字：送人1杯');
  const archivedUnit = make('archived-unit', 0, '听', { sourceBatchId: 'parent-unit' });
  reset(archivedUnit);
  ui.openEditModal(archivedUnit.id);
  assert.equal(el('fieldUnit').value, '听');
  assert.ok(Array.from(el('fieldUnit').options).some(option => option.value === '听'));
  assert.equal(el('fieldUnit').disabled, true);
  assert.ok(el('unitChangeHint').classList.contains('hidden-view'));

  const cancelledUnit = make('cancelled-unit', 2, '杯', { unit_net_weight_g: 40 });
  reset(cancelledUnit);
  ui.openEditModal(cancelledUnit.id);
  set('fieldUnit', '盒');
  el('itemForm').requestSubmit();
  el('confirmCancelBtn').click();
  assert.equal(byId(cancelledUnit.id).unit, '杯');
  assert.equal(el('fieldUnit').value, '盒');
  assert.ok(!el('itemModalBackdrop').classList.contains('hidden-view'));
  assert.equal(state.stockHistory.length, 0);
  ui.closeItemModal();

  const unchangedFractional = make('unchanged-fractional', 0.5, '杯', { unit_net_weight_g: 40 });
  reset(unchangedFractional);
  ui.openEditModal(unchangedFractional.id);
  el('itemForm').requestSubmit();
  assert.ok(el('confirmModalBackdrop').classList.contains('hidden-view'));
  assert.equal(byId(unchangedFractional.id).unit, '杯');
  await settle();

  const rollbackItem = make('rollback-unit', 2, '杯', { unit_net_weight_g: 40, price: 5 });
  reset(rollbackItem);
  domain.appendStockHistory({ action: 'create', itemId: rollbackItem.id, category: rollbackItem.category,
    brand: rollbackItem.brand, name: rollbackItem.name, unit: '杯', deltaText: '+2杯', beforeQty: 0, afterQty: 2 });
  state.logs.push(domain.sanitizeLog({ id: 'rollback-log', date: today, itemId: rollbackItem.id,
    category: rollbackItem.category, brand: rollbackItem.brand, name: rollbackItem.name,
    productUnit: '杯', amount: '半杯', note: '保留杯字' }));
  const originalSaveToStorage = storage.saveToStorage;
  storage.saveToStorage = (_silent, done) => done(false);
  ui.openEditModal(rollbackItem.id);
  set('fieldUnit', '盒');
  el('itemForm').requestSubmit();
  el('confirmOkBtn').click();
  await settle();
  await settle();
  assert.equal(byId(rollbackItem.id).unit, '杯');
  assert.equal(state.stockHistory.length, 1);
  assert.equal(state.stockHistory[0].unit, '杯');
  assert.equal(state.logs[0].productUnit, '杯');
  assert.ok(!el('itemModalBackdrop').classList.contains('hidden-view'));
  storage.saveToStorage = originalSaveToStorage;
  ui.closeItemModal();
  const grainItem = make('grain-unit', 2, '粒', { category: 'med' });
  reset(grainItem);
  ui.openFeedModal(grainItem.id, today);
  assert.deepEqual(Array.from(w.document.querySelectorAll('#feedPortionChips [data-package-portion]'), button => button.textContent),
    ['1/4粒', '1/3粒', '半粒', '1粒']);
  ui.closeFeedModal();
  const legacyPortionItem = make('legacy-portion-unit', 2, '听');
  reset(legacyPortionItem);
  ui.openFeedModal(legacyPortionItem.id, today);
  assert.deepEqual(Array.from(w.document.querySelectorAll('#feedPortionChips [data-package-portion]'), button => button.textContent),
    ['1/2', '1/3', '1/4', '1听']);
  ui.closeFeedModal();
  console.log('Stock unit edit validation, legacy option and rollback pass');

  item = make('backup', 1, '杯', { spec: '规格备注', unit_net_weight_g: 50 });
  reset(item);
  feed(item, '46g');
  await settle();
  const partial = backup();
  assert.ok((await restore(partial, false)).ok);
  await persisted(s => {
    assert.equal(s.items[0].openRemainFraction, partial.items[0].openRemainFraction);
    assert.deepEqual(json(s.logs[0].portionChange), partial.logs[0].portionChange);
    assert.equal(s.stockHistory[0].id, partial.stockHistory[0].id);
  });
  pass(23);
  feed(byId('backup'), '4g');
  await settle();
  assert.equal(el('confirmTitle').textContent, '这杯已用完，是否核销？');
  el('confirmOkBtn').click();
  await settle();
  assert.equal(byId('backup').quantity, 0);
  assert.ok((await restore(partial)).ok);
  assert.equal(byId('backup').quantity, 0);
  assert.equal(state.logs.length, 2);
  await persisted(s => {
    assert.equal(s.items[0].quantity, 0);
    assert.ok(s.items[0].finishedDate);
    assert.equal(s.logs.length, 2);
  });
  pass(24);

  const readSummary = () => ['InStock', 'Expiring', 'Expired', 'Empty'].map((key, index) => [
    el('count' + key).textContent,
    el('count' + (index === 0 ? 'Stock' : key) + 'Pieces').textContent,
    el('count' + key).classList.contains('is-zero')
  ]);
  const soon = make('soon', 2, '罐', { expDate: utils.shiftDaysFromToday(20) });
  const later = make('later', 3, '袋', { expDate: utils.shiftDaysFromToday(45) });
  const more = make('more', 4, '杯', { expDate: utils.shiftDaysFromToday(75) });
  const last = make('last', 5, '杯', { expDate: utils.shiftDaysFromToday(105) });
  const countedByOpenDate = make('open-soon', 2, '盒', {
    isOpened: true, openedDate: today, openDaysLimit: 10, openRemainFraction: 0.25
  });
  const overdueTwice = make('overdue', 2, '罐', {
    expDate: yesterday, isOpened: true, openedDate: utils.shiftDaysFromToday(-2), openDaysLimit: 1
  });
  const sharedStock = make('shared-stock', 3, '杯', {
    purchasePackaging: { count: 1, outerUnit: '盒', size: 4, seal: 'shared' }
  });
  const weighingStock = make('weight', 200, 'g', { expDate: yesterday });
  const archive = make('archive', 0, '罐', { name: '同款', consumedCount: 4, lastQuantity: 4 });
  const otherBatch = make('other-batch', 0, '罐', { name: '同款', lastQuantity: 3 });
  const partialArchive = make('shadow', 0, '罐', { sourceBatchId: soon.id, consumedCount: 2 });
  const duplicateArchive = make('duplicate-shadow', 0, '罐', { sourceBatchId: soon.id, consumedCount: 2 });
  reset(soon, later, more, last, countedByOpenDate, overdueTwice, sharedStock, weighingStock,
    archive, otherBatch, partialArchive, duplicateArchive);
  const fixturesBeforeRender = json(state.items);
  for (const [threshold, batches, pieces] of [[30, 2, 3], [60, 3, 6], [90, 4, 10], [120, 5, 15]]) {
    el('warnDaysGroup').querySelector('[data-warn-days="' + threshold + '"]').click();
    assert.equal(state.settings.warnDays, threshold);
    assert.deepEqual(readSummary(), [
      ['8', '共 19件', false], [String(batches), '共 ' + pieces + '件', false],
      ['2', '共 2件', false], ['3', '共 9件', false]
    ]);
  }
  assert.deepEqual(json(state.items), fixturesBeforeRender);
  el('statCardExpiring').click();
  assert.equal(state.statusFilter, 'expiring');
  assert.equal(readSummary()[1][1], '共 15件');
  reset(soon, make('legacy-archive', 0, '罐'));
  assert.deepEqual(readSummary()[2], ['0', '共 0件', true]);
  assert.deepEqual(readSummary()[3], ['1', '件数未明', false]);
  reset(archive, make('conflict', 0, '罐', { sourceBatchId: archive.id, consumedCount: 5 }));
  assert.equal(readSummary()[3][1], '件数未明');
  reset(make('shared-archive', 0, '杯', {
    consumedCount: 3, purchasePackaging: { count: 1, outerUnit: '盒', size: 4, seal: 'shared' }
  }));
  assert.equal(readSummary()[3][1], '件数未明');
  reset(make('weight-archive', 0, 'g', { consumedCount: 150 }));
  assert.deepEqual(readSummary()[3], ['1', '共 0件', false]);
  reset();
  assert.deepEqual(readSummary(), Array.from({ length: 4 }, () => ['0', '共 0件', true]));
  await settle();
  console.log('Summary cards pass');

  assert.equal(el('stockDetailsBtn'), null);
  assert.equal(el('stockQuantityDetails'), null);
  storage.applyLoadedSettings({ stockDetailsExpanded: true, stockQuantityDetailsOpen: true });
  assert.equal(state.settings.stockDetailsExpanded, undefined);
  assert.equal(state.settings.stockQuantityDetailsOpen, undefined);
  const assertDetail = (unit, quantity, labels) => {
    const count = domain.summarizeStockQuantity(state.items).units[unit];
    const status = domain.summarizeStockDetailStatuses(state.items)[unit];
    assert.equal(count.sealed + count.opened, quantity);
    assert.deepEqual([
      count.opened ? '开封 ' + count.opened : '',
      status.expiring ? '临期 ' + status.expiring : '',
      status.expired ? '过期 ' + status.expired : '',
      status.unknown ? '保质期状态待确认 ' + status.unknown : ''
    ].filter(Boolean), labels);
  };
  const assertPieceTotalsMatchDetails = () => {
    const pieces = Object.values(domain.summarizeStockDetailStatuses(state.items));
    for (const [id, status] of [['countExpiringPieces', 'expiring'], ['countExpiredPieces', 'expired']]) {
      assert.equal(el(id).textContent, '共 ' + pieces.reduce((sum, row) => sum + row[status], 0) + '件');
    }
  };

  const screenshotCans = make('three-cans', 3, '罐', {
    isOpened: true, openedDate: today, openDaysLimit: 1, openRemainFraction: 0.25
  });
  const screenshotBag = make('soon-single-bag', 1, '袋', { expDate: today });
  const freshBag = make('fresh-single-bag', 1, '袋');
  reset(screenshotCans, screenshotBag, freshBag);
  assertDetail('罐', 3, ['开封 1', '临期 1']);
  assertDetail('袋', 2, ['临期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 2件', false]);
  assertPieceTotalsMatchDetails();

  const eight = make('eight', 8, '罐');
  const twoBags = make('soon-bags', 2, '袋', { expDate: today });
  reset(eight, twoBags);
  assertDetail('罐', 8, []);
  assertDetail('袋', 2, ['临期 2']);
  Object.assign(eight, { isOpened: true, openedDate: today, openDaysLimit: 11, openRemainFraction: 0.25 });
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1']);
  eight.openDaysLimit = 2;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 3件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = today;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 8']);
  assert.deepEqual(readSummary()[1], ['2', '共 10件', false]);
  assertPieceTotalsMatchDetails();
  eight.openedDate = utils.shiftDaysFromToday(-3);
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 7', '过期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 9件', false]);
  assert.deepEqual(readSummary()[2], ['1', '共 1件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = '2099-01-01';
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '过期 1']);
  assert.deepEqual(readSummary()[2], ['1', '共 1件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = yesterday;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '过期 8']);
  eight.expDate = '2099-01-01';
  eight.openedDate = '';
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '保质期状态待确认 1']);

  const flavors = mixed();
  Object.assign(flavors, { expDate: utils.shiftDaysFromToday(40), openDaysLimit: 3 });
  flavors.flavors[0].openedDate = utils.shiftDaysFromToday(-4);
  flavors.flavors[1].openedDate = today;
  const sharedDetail = make('shared-detail', 3, '杯', {
    purchasePackaging: { count: 1, outerUnit: '盒', size: 4, seal: 'shared' },
    isOpened: true, openedDate: today, openDaysLimit: 2
  });
  const noUnit = make('legacy-no-unit', 1, null);
  reset(flavors, sharedDetail, weighingStock, noUnit);
  assertDetail('杯', 2, ['开封 2', '临期 1', '过期 1']);
  assertDetail('盒', 1, ['开封 1', '临期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 2件', false]);
  assert.deepEqual(readSummary()[2], ['2', '共 1件', false]);
  assertPieceTotalsMatchDetails();
  state.catFilter = 'med';
  state.brandFilter = '不存在的品牌';
  state.searchQuery = '不存在的商品';
  state.pantryPage = 2;
  ui.renderAll();
  console.log('Stock packaging count rules pass');

  state.catFilter = 'all';
  state.brandFilter = 'all';
  state.searchQuery = '';
  state.pantryPage = 1;
  state.pantryDisplayMode = 'card';
  state.pantryPageSize = 20;
  const openedCardItem = make('opened-card', 3, '罐', {
    prodDate: utils.shiftDaysFromToday(-20), expDate: utils.shiftDaysFromToday(20),
    isOpened: true, openedDate: utils.shiftDaysFromToday(-3), openDaysLimit: 4,
    openRemainFraction: 0.25, eatenCount: 1, palatability: 'ok'
  });
  const unopenedCardItem = make('unopened-card', 2, '杯', { prodDate: today, openDaysLimit: 4, eatenCount: 2 });
  const defaultLimitItem = make('default-limit', 1, '罐', { isOpened: true, openedDate: today });
  const longLimitItem = make('long-limit', 1, '罐', { isOpened: true, openedDate: today, openDaysLimit: 45 });
  const twoDayItem = make('two-day-limit', 3, '罐', { isOpened: true, openedDate: today, openDaysLimit: 2, openRemainFraction: 0.75 });
  const missingLimitItem = make('missing-limit', 1, '罐', { isOpened: true, openedDate: today });
  delete missingLimitItem.openDaysLimit;
  const salmonFins = make('salmon-fins', 1, '袋', {
    brand: 'GOURMATE', name: 'King Salmon Fins', isOpened: true, openedDate: today
  });
  const partlyUsedCan = make('partly-used-can', 1, '罐', {
    isOpened: true, openedDate: today, openRemainFraction: 0.25
  });
  const multiCardItem = mixed();
  multiCardItem.openDaysLimit = 4;
  multiCardItem.flavors[0].openedDate = utils.shiftDaysFromToday(-2);
  multiCardItem.flavors[0].openRemainFraction = 0.5;
  multiCardItem.flavors[1].openedDate = utils.shiftDaysFromToday(-3);
  multiCardItem.flavors[1].openRemainFraction = 0.25;
  const sharedMixed = mixed();
  sharedMixed.id = 'shared-mixed-card';
  sharedMixed.purchasePackaging.seal = 'shared';
  sharedMixed.isOpened = true;
  sharedMixed.openedDate = today;
  sharedMixed.openDaysLimit = 4;
  sharedMixed.flavors[0].openedDate = yesterday;
  sharedMixed.flavors[0].openRemainFraction = 0.5;
  sharedMixed.flavors[1].openedDate = today;
  sharedMixed.flavors[1].openRemainFraction = 0.25;
  reset(openedCardItem, unopenedCardItem, defaultLimitItem, longLimitItem, twoDayItem, missingLimitItem, multiCardItem, sharedDetail, salmonFins, partlyUsedCan);
  const card = id => w.document.querySelector('[data-action="item-history"][data-id="' + id + '"]').closest('article');

  const confirmOpenItem = make('confirm-open', 2, '袋', { openDaysLimit: 1 });
  reset(confirmOpenItem);
  domain.appendStockHistory({ action: 'create', date: utils.shiftDaysFromToday(-3), itemId: confirmOpenItem.id,
    category: confirmOpenItem.category, brand: confirmOpenItem.brand, name: confirmOpenItem.name, unit: confirmOpenItem.unit });
  state.pantryDisplayMode = 'card';
  ui.renderPantryList();
  let openCard = card(confirmOpenItem.id);
  assert.equal(openCard.querySelector('[data-action="card-menu"] use').getAttribute('href'), '#ui-more-vertical');
  openCard.querySelector('[data-action="card-menu"]').click();
  assert.deepEqual(Array.from(openCard.querySelectorAll('.card-overflow-menu [role="menuitem"]'), button => button.textContent),
    ['记开封', '编辑', '删除']);
  openCard.querySelector('[data-action="toggle-open"]').click();
  assert.equal(el('confirmTitle').textContent, '确认记录开封？');
  assert.match(el('confirmMessage').textContent, new RegExp(utils.formatCnDateText(today)));
  assert.equal(el('confirmOkBtn').textContent, '确认开封');
  assert.ok(el('confirmModalBackdrop').classList.contains('confirm-open-action'));
  el('confirmModalBackdrop').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(confirmOpenItem.isOpened, false);
  openCard = card(confirmOpenItem.id);
  openCard.querySelector('[data-action="card-menu"]').click();
  openCard.querySelector('[data-action="toggle-open"]').click();
  assert.equal(el('confirmOpenDateInput').value, today);
  assert.ok(el('confirmOpenDateWrap').querySelector('[data-open-date-offset="0"]').classList.contains('active'));
  set('confirmOpenDateInput', utils.shiftDaysFromToday(1));
  assert.match(el('confirmOpenDateWrap').querySelector('[data-open-date-error]').textContent, /不能晚于今天/);
  assert.equal(el('confirmOkBtn').disabled, true);
  el('confirmOkBtn').click();
  assert.equal(confirmOpenItem.isOpened, false);
  assert.ok(!el('confirmModalBackdrop').classList.contains('hidden-view'));
  el('confirmOpenDateWrap').querySelector('[data-open-date-offset="-7"]').click();
  assert.equal(el('confirmOpenDateWrap').querySelector('[data-open-date-error]').textContent, '');
  assert.equal(el('confirmOkBtn').disabled, false);
  el('confirmOpenDateWrap').querySelector('[data-open-date-offset="-3"]').click();
  assert.ok(!el('confirmOpenDateWrap').querySelector('[data-open-date-warning]').classList.contains('hidden-view'));
  el('confirmOpenDateWrap').querySelector('[data-open-date-offset="-1"]').click();
  assert.equal(el('confirmOpenDateWrap').querySelector('[data-open-date-error]').textContent, '');
  assert.match(el('confirmMessage').textContent, new RegExp(utils.formatCnDateText(yesterday)));
  el('confirmOkBtn').click();
  assert.equal(confirmOpenItem.isOpened, true);
  assert.equal(confirmOpenItem.openedDate, yesterday);
  assert.match(el('toastEl').textContent, new RegExp(utils.formatCnDateText(yesterday)));

  const menuFlavorItem = mixed();
  reset(menuFlavorItem);
  state.pantryDisplayMode = 'card';
  ui.renderPantryList();
  const multiCard = card(menuFlavorItem.id);
  multiCard.querySelector('[data-action="card-menu"]').click();
  const multiOpen = multiCard.querySelector('[data-action="toggle-open"]');
  assert.ok(multiOpen);
  multiOpen.click();
  assert.ok(!el('flavorOpenModalBackdrop').classList.contains('hidden-view'));
  assert.deepEqual(Array.from(el('flavorOpenOptions').querySelectorAll('strong'), node => node.textContent), ['鸡', '鱼']);
  assert.equal(el('confirmFlavorOpenBtn').disabled, true);
  el('flavorOpenOptions').querySelector('input[value="chicken"]').click();
  assert.equal(el('confirmFlavorOpenBtn').disabled, false);
  el('flavorOpenDatePicker').querySelector('[data-open-date-offset="-3"]').click();
  el('confirmFlavorOpenBtn').click();
  assert.equal(menuFlavorItem.flavors[0].openedDate, utils.shiftDaysFromToday(-3));
  assert.equal(menuFlavorItem.flavors[1].openedDate, '');
  assert.ok(el('flavorOpenModalBackdrop').classList.contains('hidden-view'));
  console.log('Single and multi-flavor menu opening confirmation pass');
  reset(openedCardItem, unopenedCardItem, defaultLimitItem, longLimitItem, twoDayItem, missingLimitItem, multiCardItem, sharedDetail, sharedMixed, salmonFins, partlyUsedCan);
  state.pantryDisplayMode = 'card';
  ui.renderPantryList();
  const progress = id => card(id).querySelector('.detail-card-open-progress');
  const checkProgress = (id, label, tone, width, limit = 4) => {
    const bar = progress(id);
    assert.equal(bar.querySelector('strong').textContent, label);
    assert.equal(bar.querySelector('.detail-card-open-progress-label > span').textContent, '共 ' + limit + '天');
    assert.ok(bar.classList.contains('detail-card-open-progress--' + tone));
    assert.equal(bar.querySelector('.progress-bar').style.width, width);
  };
  checkProgress(openedCardItem.id, '开封保鲜期剩余 1天', 'urgent', '25%');
  const flavorGroups = card(multiCardItem.id).querySelectorAll('.detail-card-open-flavor');
  assert.equal(flavorGroups.length, 2);
  assert.deepEqual(Array.from(flavorGroups, group => group.querySelector('.detail-card-open-summary').textContent),
    ['鸡 开封余 1/2杯开封日期 ' + multiCardItem.flavors[0].openedDate,
      '鱼 开封余 1/4杯开封日期 ' + multiCardItem.flavors[1].openedDate]);
  assert.deepEqual(Array.from(flavorGroups, group => group.querySelector('.detail-card-open-progress strong').textContent),
    ['开封保鲜期剩余 2天', '开封保鲜期剩余 1天']);
  assert.deepEqual(Array.from(flavorGroups, group => group.querySelector('.progress-bar').style.width), ['50%', '25%']);
  flavorGroups[1].querySelector('[data-open-progress]').click();
  assert.equal(flavorGroups[1].querySelector('.detail-card-shelf-tip').textContent, '开封保鲜期剩余 25.0%');
  assert.equal(card(multiCardItem.id).querySelector('.flavor-stock'), null);
  assert.equal(card(sharedMixed.id).querySelectorAll('.detail-card-open-progress').length, 1);
  assert.equal(card(sharedMixed.id).querySelector('.detail-card-open-flavor'), null);
  assert.equal(card(sharedMixed.id).querySelector('.detail-card-open-date').textContent, '开封日期 ' + today);
  assert.equal(card(sharedMixed.id).querySelector('.detail-card-open-progress strong').textContent, '开封保鲜期剩余 4天');
  assert.equal(card(sharedMixed.id).querySelector('.flavor-stock'), null);
  multiCardItem.flavors[0].name = '<鸡>';
  multiCardItem.flavors[0].openedDate = utils.shiftDaysFromToday(-5);
  ui.renderPantryList();
  const expiredGroup = card(multiCardItem.id).querySelector('.detail-card-open-flavor');
  assert.equal(expiredGroup.querySelector('.detail-card-open-flavor-stock strong').textContent, '<鸡>');
  assert.equal(expiredGroup.querySelector('.detail-card-open-progress strong').textContent, '已超开封保鲜期');
  assert.equal(expiredGroup.querySelector('.progress-bar').style.width, '0%');
  multiCardItem.flavors[0].name = '鸡';
  multiCardItem.flavors[0].openedDate = utils.shiftDaysFromToday(-2);
  multiCardItem.flavors[0].openRemainFraction = 0;
  multiCardItem.flavors[1].quantity = 0;
  multiCardItem.openDaysLimit = null;
  ui.renderPantryList();
  const unknownGroup = card(multiCardItem.id).querySelectorAll('.detail-card-open-flavor');
  assert.equal(unknownGroup.length, 1);
  assert.match(unknownGroup[0].textContent, /鸡 开封余 未记录/);
  assert.equal(unknownGroup[0].querySelector('.detail-card-open-progress'), null);
  multiCardItem.flavors[0].openRemainFraction = 0.5;
  multiCardItem.flavors[1].quantity = 1;
  multiCardItem.openDaysLimit = 4;
  ui.renderPantryList();
  checkProgress(twoDayItem.id, '开封保鲜期剩余 2天', 'urgent', '100%', 2);
  assert.equal(card(twoDayItem.id).querySelector('.detail-card-open-badge'), null);
  assert.ok(card(twoDayItem.id).querySelector('.detail-card-open-stock--urgent'));
  assert.ok(progress(defaultLimitItem.id));
  checkProgress(longLimitItem.id, '开封保鲜期剩余 45天', 'fresh', '100%', 45);
  for (const entry of [unopenedCardItem, missingLimitItem]) assert.equal(progress(entry.id), null);
  assert.ok(card(missingLimitItem.id).querySelector('.detail-card-expiry-days'));
  twoDayItem.openedDate = utils.shiftDaysFromToday(-1);
  ui.renderPantryList();
  checkProgress(twoDayItem.id, '开封保鲜期剩余 1天', 'urgent', '50%', 2);
  const activeCard = card(openedCardItem.id);
  const banner = activeCard.querySelector('.detail-card-open-stock');
  const summary = banner.firstElementChild;
  assert.ok(summary.matches('.detail-card-open-summary'));
  assert.equal(summary.querySelector('.detail-card-stock-text').textContent, '开封余 1/4罐');
  assert.doesNotMatch(summary.textContent, /已用/);
  assert.equal(activeCard.querySelector('.stock-quantity-pill .stock-quantity-open').textContent, '开封 1');
  assert.equal(activeCard.querySelector('.stock-quantity-pill .stock-quantity-used').textContent, '已用 1');
  const detailedPalatability = activeCard.querySelector('.detail-card-tags .detail-card-palatability');
  assert.equal(detailedPalatability.getAttribute('aria-label'), '正常吃');
  assert.equal(detailedPalatability.textContent, '😋');
  const detailedTip = detailedPalatability.nextElementSibling;
  assert.equal(detailedTip.textContent, '😋 正常吃');
  assert.equal(detailedTip.hidden, true);
  detailedPalatability.click();
  assert.equal(detailedPalatability.getAttribute('aria-expanded'), 'true');
  assert.equal(detailedTip.hidden, false);
  detailedPalatability.click();
  assert.equal(detailedPalatability.getAttribute('aria-expanded'), 'false');
  assert.equal(detailedTip.hidden, true);
  detailedPalatability.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(detailedTip.hidden, true);
  assert.equal(activeCard.querySelector('.detail-card-stock-tags .detail-card-palatability'), null);
  assert.deepEqual(Array.from(activeCard.querySelector('.detail-card-identity').children, node => node.className),
    ['detail-card-category', 'detail-card-brand']);
  assert.equal(summary.lastElementChild.textContent, '开封日期 ' + openedCardItem.openedDate);
  assert.equal(summary.nextElementSibling, progress(openedCardItem.id));
  assert.deepEqual(Array.from(progress(openedCardItem.id).children, child => child.className),
    ['detail-card-open-progress-label', 'progress-track', 'detail-card-shelf-tip hidden-view']);
  for (const opened of [openedCardItem, multiCardItem, sharedDetail]) {
    const actions = card(opened.id).querySelector('.detail-card-actions');
    assert.equal(actions.querySelector('.stock-quantity-pill').firstElementChild.textContent,
      '在库 ' + opened.quantity + opened.unit);
    assert.deepEqual(Array.from(actions.querySelectorAll('button'), button => button.dataset.action), ['item-history', 'log-feed']);
  }
  assert.equal(card(multiCardItem.id).querySelector('.detail-card-open-flavor-stock strong').textContent, '鸡');
  assert.equal(card(sharedDetail.id).querySelector('.detail-card-open-summary .detail-card-stock-text').textContent, '共用包装已开封');
  const unopenedCard = card(unopenedCardItem.id);
  assert.equal(unopenedCard.querySelector('.detail-card-open-stock'), null);
  assert.equal(unopenedCard.querySelector('.stock-quantity-pill').firstElementChild.textContent, '在库 2杯');
  assert.equal(unopenedCard.querySelector('.stock-quantity-pill .stock-quantity-used').textContent, '已用 2');
  assert.equal(card(multiCardItem.id).querySelector('.stock-quantity-open').textContent, '开封 2');
  const checkOpenedStock = (item, expected) => {
    const row = card(item.id).querySelector('.detail-card-open-summary');
    assert.equal(row.querySelector('.detail-card-stock-text').textContent, expected);
    assert.equal(row.querySelector('.detail-card-open-date').textContent, '开封日期 ' + item.openedDate);
  };
  checkOpenedStock(salmonFins, '已开封 1袋');
  checkOpenedStock(partlyUsedCan, '开封余 1/4罐');
  checkOpenedStock(twoDayItem, '开封余 3/4罐');
  salmonFins.quantity = 3;
  ui.renderPantryList();
  checkOpenedStock(salmonFins, '已开封 1袋');
  assert.equal(activeCard.querySelector('[data-shelf-progress]').getAttribute('aria-label'), '保质期剩余 50.0%');
  assert.equal(unopenedCard.querySelector('[data-shelf-progress]').getAttribute('aria-label'), '保质期剩余 100.0%');
  assert.ok(card(openedCardItem.id).querySelector('.detail-card-shelf-tip').classList.contains('hidden-view'));
  card(openedCardItem.id).querySelector('[data-shelf-progress]').click();
  assert.equal(card(openedCardItem.id).querySelector('.detail-card-shelf-tip').textContent, '保质期剩余 50.0%');
  const openTrack = progress(openedCardItem.id).querySelector('[data-open-progress]');
  openTrack.click();
  const openTip = progress(openedCardItem.id).querySelector('.detail-card-shelf-tip');
  assert.equal(openTip.textContent, '开封保鲜期剩余 25.0%');
  assert.ok(!openTip.classList.contains('hidden-view'));
  assert.ok(card(openedCardItem.id).querySelector('.detail-card-shelf .detail-card-shelf-tip').classList.contains('hidden-view'));
  ui.renderPantryList();
  const shelfBefore = card(openedCardItem.id).querySelector('.detail-card-shelf').outerHTML;
  for (const [elapsed, label, tone, width] of [
    [0, '开封保鲜期剩余 4天', 'warning', '100%'],
    [1, '开封保鲜期剩余 3天', 'urgent', '75%'],
    [2, '开封保鲜期剩余 2天', 'urgent', '50%'],
    [4, '开封保鲜期剩余 0天', 'urgent', '0%'],
    [5, '已超开封保鲜期', 'expired', '0%']
  ]) {
    openedCardItem.openedDate = utils.shiftDaysFromToday(-elapsed);
    ui.renderPantryList();
    checkProgress(openedCardItem.id, label, tone, width);
    assert.equal(card(openedCardItem.id).querySelector('.detail-card-shelf').outerHTML, shelfBefore);
  }
  state.pantryDisplayMode = 'compact';
  ui.renderPantryList();
  const compactOpened = w.document.querySelector('.compact-stock-card[data-id="' + openedCardItem.id + '"]');
  const compactUnopened = w.document.querySelector('.compact-stock-card[data-id="' + unopenedCardItem.id + '"]');
  assert.equal(compactOpened.querySelector('[data-action="card-menu"] use').getAttribute('href'), '#ui-more-vertical');
  assert.deepEqual(Array.from(compactOpened.children, node => node.className), [
    'card-overflow',
    'compact-brand-row',
    'compact-tip-wrap compact-expiry-wrap',
    'compact-title',
    'btn-feed inventory-primary-action compact-card-action',
    'compact-stock-row'
  ]);
  assert.equal(compactOpened.querySelector('.stock-quantity-pill'), null);
  assert.match(compactOpened.querySelector('.compact-stock-copy').textContent, /在库 3罐·开封 1·已用 1/);
  assert.equal(compactOpened.querySelector('.compact-card-action').textContent, '记喂食');
  assert.ok(compactOpened.querySelector('.compact-card-action').classList.contains('inventory-primary-action'));
  assert.equal(compactOpened.querySelector('.compact-card-action use').getAttribute('href'), '#feed-paw');
  assert.equal(compactOpened.querySelector('.compact-palatability').getAttribute('aria-label'), '正常吃');
  assert.equal(compactOpened.querySelector('.compact-palatability').textContent, '😋');
  assert.equal(compactOpened.querySelector('.compact-expiry-badge').textContent, '开封超期 1天');
  assert.equal(compactUnopened.querySelector('.compact-expiry-wrap .compact-tip').lastElementChild.textContent, '开封后剩余：未开封');
  assert.equal(w.document.querySelector('.compact-stock-card[data-id="' + multiCardItem.id + '"] .compact-expiry-badge').textContent, '开封剩 1天');
  const palButton = compactOpened.querySelector('.compact-palatability');
  palButton.click();
  assert.equal(palButton.getAttribute('aria-expanded'), 'true');
  assert.equal(palButton.nextElementSibling.textContent, '😋 正常吃');
  assert.equal(palButton.nextElementSibling.hidden, false);
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.equal(palButton.nextElementSibling.hidden, true);
  assert.equal(palButton.getAttribute('aria-expanded'), 'false');
  const expiryButton = compactOpened.querySelector('.compact-expiry-badge');
  expiryButton.click();
  assert.equal(expiryButton.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(Array.from(expiryButton.nextElementSibling.children, node => node.textContent),
    ['未开封保质期：剩 20天', '开封后剩余：开封超期 1天']);
  expiryButton.click();
  assert.equal(expiryButton.nextElementSibling.hidden, true);
  expiryButton.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(expiryButton.nextElementSibling.hidden, true);
  expiryButton.click();
  w.document.body.click();
  assert.equal(expiryButton.nextElementSibling.hidden, true);
  compactOpened.querySelector('[data-action="card-menu"]').click();
  assert.deepEqual(Array.from(compactOpened.querySelectorAll('.card-overflow-menu [role="menuitem"]'), button => button.textContent),
    ['编辑', '删除']);
  compactOpened.querySelector('.compact-card-action').click();
  assert.ok(!el('feedModalBackdrop').classList.contains('hidden-view'));
  el('feedModalBackdrop').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  state.pantryDisplayMode = 'card';
  openedCardItem.openedDate = '';
  ui.renderPantryList();
  assert.ok(card(openedCardItem.id).querySelector('.btn-feed').classList.contains('inventory-primary-action'));
  assert.equal(card(openedCardItem.id).querySelector('.btn-feed use').getAttribute('href'), '#feed-paw');
  assert.equal(progress(openedCardItem.id), null);
  assert.ok(card(openedCardItem.id).querySelector('.detail-card-open-summary .detail-card-stock-text'));
  assert.equal(card(openedCardItem.id).querySelector('.detail-card-open-date'), null);
  console.log('Opened card layout and progress pass');

  state.pantryDisplayMode = 'compact';
  for (const [expiry, opening, expected, tone, lock] of [
    [-3, 1, '已过期 3天', 'expired', false],
    [5, -2, '开封超期 2天', 'expired', true],
    [-3, -1, '已过期 3天', 'expired', false],
    [1, 2, '剩 1天', 'urgent', false],
    [2, 1, '开封剩 1天', 'urgent', true],
    [20, 0, '开封剩 0天', 'urgent', true],
    [20, 3, '开封剩 3天', 'urgent', true],
    [20, 4, '开封剩 4天', 'warning', true],
    [20, 14, '开封剩 14天', 'warning', true],
    [20, 15, '开封剩 15天', 'fresh', true],
    [4, 4, '剩 4天', 'warning', false],
    [0, null, '剩 0天', 'urgent', false],
    [3, null, '剩 3天', 'urgent', false],
    [4, null, '剩 4天', 'warning', false],
    [14, null, '剩 14天', 'warning', false],
    [15, null, '剩 15天', 'fresh', false],
    [null, 4, '开封剩 4天', 'warning', true],
    [null, null, '未填写过期日期', 'unknown', false]
  ]) {
    const entry = make('compact-case', 1, '罐', {
      expDate: expiry === null ? '' : utils.shiftDaysFromToday(expiry),
      isOpened: opening !== null,
      openedDate: opening === null ? '' : utils.shiftDaysFromToday(opening - 20),
      openDaysLimit: 20
    });
    reset(entry);
    const button = w.document.querySelector('.compact-expiry-badge');
    assert.equal(button.textContent, expected);
    assert.ok(button.classList.contains('detail-card-status--' + tone));
    assert.equal(Boolean(button.querySelector('svg')), lock);
  }
  const missingDates = make('missing-dates', 1, '罐', { expDate: '', isOpened: true, openedDate: today, openDaysLimit: null });
  reset(missingDates);
  assert.deepEqual(Array.from(w.document.querySelectorAll('.compact-tip--expiry > span'), node => node.textContent),
    ['未开封保质期：未填写过期日期', '开封后剩余：未填写开封保鲜期']);
  const mixedRating = mixed();
  mixedRating.flavors[0].palatability = 'love';
  mixedRating.flavors[1].palatability = 'meh';
  const medicationRating = make('medication-rating', 1, '粒', { category: 'med', palatability: 'ok' });
  reset(mixedRating, medicationRating);
  for (const [id, emoji, label] of [['mix', '😍😣', '鸡：超爱吃；鱼：不爱吃'], ['medication-rating', '🥹', '需哄喂']]) {
    const button = w.document.querySelector('.compact-stock-card[data-id="' + id + '"] .compact-palatability');
    assert.equal(button.textContent, emoji);
    assert.equal(button.getAttribute('aria-label'), label);
  }
  console.log('Compact expiry selection and tips pass');

  const packagedCardItem = make('packaged-card', 1, '杯', {
    price: 3.5,
    batchCode: '拼多多',
    purchasePackaging: { count: 1, outerUnit: '盒', size: 4 },
    flavors: [
      { id: 'chicken', name: '草莓鸡', perPack: 2, quantity: 1 },
      { id: 'rabbit', name: '蓝莓兔', perPack: 2, quantity: 0 }
    ]
  });
  reset(packagedCardItem);
  state.pantryDisplayMode = 'card';
  ui.renderPantryList();
  const packagedCard = card(packagedCardItem.id);
  assert.match(packagedCard.textContent, /3\.50元\/杯 · 14\.00元\/盒（4杯）/);
  assert.ok(Array.from(packagedCard.querySelectorAll('.detail-card-line')).some(
    line => line.textContent === '购入渠道 拼多多 · 购入 1盒装，共4杯'));
  assert.equal(packagedCard.querySelector('.flavor-stock'), null);
  assert.equal(packagedCard.querySelector('.detail-card-open-stock'), null);
  packagedCardItem.category = 'treat';
  ui.renderPantryList();
  const treatPackagedCard = card(packagedCardItem.id);
  assert.deepEqual(Array.from(treatPackagedCard.querySelectorAll('.flavor-stock-name'), node => node.textContent),
    ['草莓鸡 1', '蓝莓兔 0']);
  assert.equal(treatPackagedCard.querySelector('.detail-card-palatability'), null);
  assert.equal(treatPackagedCard.querySelector('s.flavor-stock-finished').textContent, '蓝莓兔 0');

  packagedCardItem.flavors[0].palatability = 'love';
  ui.renderPantryList();
  let ratingCard = card(packagedCardItem.id);
  assert.equal(ratingCard.querySelector('.detail-card-palatability').textContent, '😍');
  assert.equal(ratingCard.querySelector('.flavor-stock-entry:last-child').textContent, '蓝莓兔 0未测');
  packagedCardItem.flavors[1].palatability = 'love';
  ui.renderPantryList();
  ratingCard = card(packagedCardItem.id);
  assert.equal(ratingCard.querySelector('.detail-card-palatability').textContent, '😍😍');
  assert.deepEqual(Array.from(ratingCard.querySelectorAll('.flavor-stock-rating'), node => node.getAttribute('aria-label')),
    ['超爱吃', '超爱吃']);
  packagedCardItem.flavors[1].palatability = 'meh';
  packagedCardItem.flavors.push(
    { id: 'fish', name: '鱼肉', perPack: 1, quantity: 0, palatability: 'ok' },
    { id: 'beef', name: '牛肉', perPack: 1, quantity: 0, palatability: '' }
  );
  ui.renderPantryList();
  ratingCard = card(packagedCardItem.id);
  const flavorStack = ratingCard.querySelector('.detail-card-palatability');
  assert.equal(flavorStack.textContent, '😍😣+1');
  assert.equal(flavorStack.getAttribute('aria-label'), '草莓鸡：超爱吃；蓝莓兔：不爱吃；鱼肉：正常吃；牛肉：未测');
  const flavorTip = flavorStack.nextElementSibling;
  assert.deepEqual(Array.from(flavorTip.children, node => node.textContent),
    ['草莓鸡 😍 超爱吃', '蓝莓兔 😣 不爱吃', '鱼肉 😋 正常吃', '牛肉 未测']);
  ratingCard.querySelector('[data-action="card-menu"]').click();
  assert.equal(ratingCard.querySelector('[data-action="card-menu"]').getAttribute('aria-expanded'), 'true');
  flavorStack.click();
  assert.equal(flavorTip.hidden, false);
  assert.equal(ratingCard.querySelector('[data-action="card-menu"]').getAttribute('aria-expanded'), 'false');
  ratingCard.querySelector('[data-action="card-menu"]').click();
  assert.equal(flavorTip.hidden, true);
  assert.equal(ratingCard.querySelector('[data-action="card-menu"]').getAttribute('aria-expanded'), 'true');
  w.document.body.click();
  assert.deepEqual(Array.from(ratingCard.querySelectorAll('.flavor-stock-entry'), node => node.textContent),
    ['😍草莓鸡 1', '😣蓝莓兔 0', '😋鱼肉 0', '牛肉 0未测']);

  const archived = make('archive-balance', 0, '杯', { name: '同款测试', consumedCount: 2 });
  reset(archived,
    make('live-balance-a', 1, '杯', { name: archived.name, eatenCount: 2 }),
    make('live-balance-b', 1, '杯', { name: archived.name }),
    make('other-unit', 8, '罐', { name: archived.name }));
  state.statusFilter = 'empty';
  for (const mode of ['compact', 'card']) {
    state.pantryDisplayMode = mode;
    ui.renderPantryList();
    const archive = w.document.querySelector('.archive-card');
    assert.match(archive.querySelector(mode === 'card' ? '.redeemed-summary' : 'summary .redeemed-muted').textContent, /核销 2杯/);
    assert.equal(archive.querySelector('.archive-footer .stock-quantity-pill').textContent, '在库 2杯');
    assert.deepEqual(Array.from(archive.querySelectorAll('.archive-footer button'), button => button.getAttribute('aria-label') || button.textContent), ['流水', '复购入库']);
  }

  const keys = w.MeowPantry.STORAGE_KEYS;
  const originalSetItem = w.Storage.prototype.setItem;
  const photo = 'data:image/jpeg;base64,AAAA';
  reset(make('quota-test', 2, '杯', { imageData: photo }));
  w.Storage.prototype.setItem = function (key, value) {
    if (key === keys.LOCAL_STATE && JSON.parse(value).items.some(row => row.imageData)) {
      throw new w.DOMException('Simulated quota', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  };
  try {
    assert.equal(await save(), true);
    const localState = JSON.parse(w.localStorage.getItem(keys.LOCAL_STATE));
    assert.equal(localState.settings.lsSlimMode, true);
    assert.equal(localState.items[0].imageData, undefined);
    await persisted(s => assert.equal(s.items.find(row => row.id === 'quota-test').imageData, photo));

    storage.openIDB = callback => callback(null);
    assert.equal(await save(), false, 'Photo-stripped fallback is not a complete save');
    assert.match(el('storageWriteWarning').textContent, /本地保存未完成/);

    w.Storage.prototype.setItem = originalSetItem;
    assert.equal(await save(), true, 'Full LocalStorage save works without IndexedDB');
    assert.equal(el('storageWriteWarning').textContent, '');
    const savedSnapshot = w.localStorage.getItem(keys.LOCAL_STATE);
    assert.equal((await restore([{ id: 'failed-overwrite', quantity: 1 }], false)).ok, false);
    assert.ok(byId('quota-test'));
    assert.equal(byId('failed-overwrite'), undefined);

    w.Storage.prototype.setItem = function () {
      throw new w.DOMException('Simulated unavailable storage', 'QuotaExceededError');
    };
    assert.equal(await save(), false, 'Both storage engines failed');
    assert.equal(w.localStorage.getItem(keys.LOCAL_STATE), savedSnapshot);
    assert.match(el('storageWriteWarning').textContent, /本地保存未完成/);

    storage.openIDB = originalOpen;
    state.items[0].quantity = 3;
    assert.equal(await save(), true, 'IndexedDB works without LocalStorage');
    await persisted(s => assert.equal(s.items.find(row => row.id === 'quota-test').quantity, 3));
  } finally {
    w.Storage.prototype.setItem = originalSetItem;
    storage.openIDB = originalOpen;
  }
  console.log('Storage failure and photo fallback pass');

  const stale = boot(Object.entries(w.localStorage));
  try {
    await settle();
    byId('quota-test').quantity = 4;
    assert.equal(await save(), true);
    const staleApp = stale.MeowPantry;
    staleApp.state.items.find(row => row.id === 'quota-test').quantity = 9;
    const saveStale = () => new Promise(resolve => staleApp.Storage.saveToStorage(false, resolve));
    assert.equal(await saveStale(), false);
    assert.equal(await saveStale(), false);
    assert.match(stale.document.getElementById('storageWriteWarning').textContent, /其他页面/);
    await persisted(s => assert.equal(s.items.find(row => row.id === 'quota-test').quantity, 4));
  } finally {
    stale.close();
  }

  const orphaned = storage.validateAndParseBackup(JSON.stringify({
    items: [], logs: [{ id: 'orphan', itemId: 'removed-batch', date: today, amount: '1杯', deductedUnit: 1 }]
  }));
  assert.equal(orphaned.ok, true);
  assert.equal(orphaned.missingDeductionTargets, 1);
  assert.equal(orphaned.logs.length, 1);

  const weighted = make('weighted', 3, '杯', { unit_net_weight_g: 85, price: 7, currency: 'CNY' });
  const legacyWet = make('legacy-wet', 2, '罐', { price: 250, currency: 'JPY' });
  reset(weighted, legacyWet);
  assert.equal(legacyWet.unit_net_weight_g, null);
  w.document.querySelector('#categoryStatsGrid [data-forecast-category="can"]').click();
  assert.equal(w.document.activeElement, el('dailyFeedCan'));
  set('dailyFeedCan', '85');
  assert.equal(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-days').getAttribute('aria-label'), '约还能吃 3天');
  assert.match(el('forecastValues').textContent, /21\.00元/);
  assert.match(el('forecastValues').textContent, /500円/);
  assert.ok(el('categoryStatsGrid').querySelector('.forecast-empty'));
  assert.ok(el('feedingTasks').classList.contains('hidden-view'));
  weighted.expDate = utils.shiftDaysFromToday(1);
  legacyWet.isOpened = true;
  legacyWet.openedDate = today;
  state.items.push(make('expired-alert', 2, '杯', { name: '小灶猫饭', expDate: utils.shiftDaysFromToday(-3) }));
  ui.renderAll();
  assert.equal(el('feedingTaskList').querySelectorAll('.feeding-task-row').length, 3);
  assert.match(el('feedingTaskList').querySelector('.feeding-task-row').textContent, /已过期小灶猫饭2杯过期3天/);
  assert.equal(el('feedingTaskList').querySelectorAll('.feeding-task-row')[1].dataset.jumpExpiryItem, 'weighted');
  assert.equal(el('feedingTasks').open, false);
  assert.equal(el('feedingTaskCount').textContent, '3项需要处理');
  assert.ok(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-result--urgent'));
  assert.equal(el('priorityFeedList').querySelector('[data-priority-feed]').dataset.priorityFeed, 'legacy-wet');
  assert.ok(el('expiryMonthTimelineList').querySelector('.feeding-month'));
  state.items = state.items.filter(item => item.id !== 'expired-alert');
  const timelinePeer = make('timeline-peer', 1, '罐', { expDate: weighted.expDate, name: '同月到期商品' });
  state.items.push(timelinePeer);
  ui.renderAll();
  const timeline = el('expiryMonthTimelineList');
  assert.equal(timeline.querySelector('.feeding-timeline-nearest time').textContent, weighted.expDate);
  const month = timeline.querySelector('.feeding-month details');
  assert.equal(month.open, false);
  assert.match(month.querySelector('summary').textContent, /2批/);
  month.querySelector('summary').click();
  assert.equal(month.open, true);
  assert.match(month.querySelector('.feeding-month-products').textContent, /同月到期商品/);
  state.items.pop();
  const beforeTimelineExamples = state.items;
  state.items = [
    make('timeline-medicine', 1, '支', { category: 'med', brand: '大宠爱', name: '外驱', expDate: utils.shiftDaysFromToday(20) }),
    make('timeline-future', 1, '杯', { expDate: utils.shiftDaysFromToday(547) }),
    make('timeline-past', 1, '杯', { expDate: utils.shiftDaysFromToday(-90) })
  ];
  ui.renderAll();
  assert.equal(el('medStockWatchBox'), null);
  assert.equal(timeline.querySelector('.feeding-month.forecast-result--low .feeding-timeline-med-tag').textContent, '药品');
  assert.match(timeline.querySelector('.feeding-month.forecast-result--low .priority-name').textContent, /大宠爱 外驱/);
  assert.match(timeline.querySelector('.feeding-month.forecast-result--enough .forecast-days').textContent, /547天/);
  assert.equal(timeline.querySelector('.feeding-month.forecast-result--urgent'), null);
  const snackTile = el('categoryStatsGrid').querySelector('.forecast-tile--treat');
  assert.equal(snackTile.classList.contains('forecast-wide'), false);
  assert.ok(snackTile.nextElementSibling.classList.contains('forecast-tile--med'));
  state.items.push(make('timeline-supplement', 1, '瓶', { category: 'supp' }),
    make('weighted-snack', 3, '袋', { category: 'treat', unit_net_weight_g: 20, isOpened: true, openRemainFraction: 0.5 }),
    make('unweighed-snack', 2, '袋', { category: 'treat' }));
  ui.renderAll();
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--treat').textContent, /共 50克 · 部分未填克重/);
  assert.ok(!el('categoryStatsGrid').querySelector('.forecast-tile--supp').classList.contains('forecast-wide'));
  assert.ok(el('categoryStatsGrid').querySelector('.forecast-tile--treat').nextElementSibling.classList.contains('forecast-tile--supp'));
  state.items = state.items.filter(item => item.id !== 'weighted-snack');
  ui.renderAll();
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--treat .forecast-rate').textContent, /^未填克重$/);
  state.items = beforeTimelineExamples;
  ui.renderAll();
  el('feedingTaskList').querySelector('[data-jump-expiry-item="weighted"]').click();
  assert.equal(state.activeTab, 'pantry');
  assert.ok(el('pantryList').querySelector('[data-id="weighted"]'));
  assert.equal(el('pantryList').querySelector('[data-id="legacy-wet"]'), null);
  el('settingsWeightAlert').querySelector('button').click();
  await settle();
  assert.equal(el('fieldId').value, 'legacy-wet');
  assert.equal(w.document.activeElement, el('fieldNetWeight'));
  ui.closeItemModal();
  ui.openRestockModal(weighted);
  assert.equal(el('fieldNetWeight').value, '85');
  assert.equal(el('fieldNetWeight').required, true);
  ui.closeItemModal();
  domain.recordConsumedUnits(weighted, 1, today);
  assert.equal(state.stockHistory[0].unitWeightGrams, 85);
  await settle();
  assert.ok(await save());
  const predictionBackup = backup();
  state.settings.dailyFeedGrams.can = null;
  assert.ok((await restore(predictionBackup, false)).ok);
  await persisted(s => {
    assert.equal(s.settings.dailyFeedGrams.can, 85);
    assert.equal(s.items.find(row => row.id === 'weighted').unit_net_weight_g, 85);
    assert.equal(s.stockHistory[0].unitWeightGrams, 85);
  });
  console.log('Feeding forecast UI and backup round trip pass');

  const flavorWarnings = make('flavor-warnings', 3, '杯', {
    name: '双莓椰椰餐盒', openDaysLimit: 5, expDate: utils.shiftDaysFromToday(30),
    purchasePackaging: { count: 1, outerUnit: '盒', size: 3 },
    flavors: [
      { id: 'expired', name: '过期口味', perPack: 1, quantity: 1, openedDate: utils.shiftDaysFromToday(-7) },
      { id: 'blueberry', name: '蓝莓兔', perPack: 1, quantity: 1, openedDate: utils.shiftDaysFromToday(-3) },
      { id: 'fresh', name: '草莓', perPack: 1, quantity: 1 }
    ]
  });
  reset(flavorWarnings,
    make('past-food', 1, '杯', { name: '小灶猫饭', expDate: utils.shiftDaysFromToday(-3) }),
    make('near-one', 1, '杯', { expDate: utils.shiftDaysFromToday(1) }),
    make('near-five', 1, '杯', { expDate: utils.shiftDaysFromToday(5) }));
  const alertRows = Array.from(el('feedingTaskList').querySelectorAll('.feeding-task-row'));
  assert.equal(el('feedingTaskCount').textContent, alertRows.length + '项需要处理');
  assert.deepEqual(alertRows.map(row => row.querySelector('.feeding-task-status').textContent),
    ['已过期', '已过期', '临期', '临期', '临期', '开封将尽']);
  assert.match(alertRows[0].textContent, /小灶猫饭.*过期3天/);
  assert.match(alertRows[1].textContent, /双莓椰椰餐盒 · 过期口味.*过期2天/);
  assert.match(alertRows.at(-1).textContent, /双莓椰椰餐盒 · 蓝莓兔.*开封剩2天/);
  assert.doesNotMatch(el('priorityFeedList').textContent, /小灶猫饭|过期口味/);
  assert.match(el('priorityFeedList').textContent, /双莓椰椰餐盒 · 蓝莓兔/);
  assert.match(el('priorityFeedList').textContent, /双莓椰椰餐盒 · 草莓/);
  assert.doesNotMatch(el('expiryMonthTimelineList').textContent, /小灶猫饭/);
  el('priorityFeedList').querySelector('[data-priority-flavor="blueberry"]').click();
  assert.equal(el('feedFlavorSelect').value, 'blueberry');
  ui.closeFeedModal();

  const monthItems = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + index + 1);
    return make('future-month-' + index, 1, '杯', {
      expDate: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01'
    });
  });
  const undatedLitter = make('no-expiry-litter', 2, '袋', {
    name: '流せる木製猫砂', category: 'supplies', expDate: '', price: 50, currency: 'CNY'
  });
  const datedLitter = make('dated-litter', 1, '袋', {
    name: '流せる木製猫砂', category: 'supplies', expDate: monthItems[0].expDate, price: 25, currency: 'CNY'
  });
  state.catFilter = 'all';
  state.pantryPageSize = 50;
  reset(...monthItems, undatedLitter, datedLitter, make('no-expiry', 1, '杯', { name: '没有填写日期的商品', expDate: '' }));
  assert.equal(timeline.querySelectorAll('.feeding-month').length, 5);
  assert.equal(el('expiryTimelineCountBadge').textContent, '· 6个月份');
  assert.match(timeline.querySelector('[data-toggle-timeline]').textContent, /共 6条/);
  assert.equal(timeline.querySelector('.feeding-timeline-nearest time').textContent, monthItems[0].expDate);
  timeline.querySelector('[data-toggle-timeline]').click();
  assert.equal(timeline.querySelectorAll('.feeding-month').length, 6);
  assert.doesNotMatch(timeline.textContent, /未标注|没有填写日期的商品/);
  const firstMonth = timeline.querySelector('.feeding-month details');
  assert.match(firstMonth.querySelector('summary').textContent, /2批/);
  assert.match(firstMonth.textContent, /流せる木製猫砂/);
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /2批/);
  assert.match(el('forecastValues').textContent, /125\.00元/);
  assert.ok(el('pantryList').querySelector('[data-id="no-expiry-litter"]'));
  timeline.querySelector('[data-toggle-timeline]').click();
  assert.equal(timeline.querySelectorAll('.feeding-month').length, 5);
  reset(undatedLitter);
  assert.equal(el('expiryTimelineCountBadge').textContent, '· 0个月份');
  assert.equal(timeline.querySelectorAll('.feeding-month').length, 0);
  assert.equal(timeline.querySelector('.feeding-timeline-nearest'), null);
  state.pantryPageSize = 5;

  reset(make('cny-value', 1, '杯', { price: 5, currency: 'CNY' }),
    make('jpy-value', 1, '杯', { price: 500, currency: 'JPY' }));
  assert.equal(el('forecastValues').querySelectorAll('.forecast-value-basis').length, 1);
  assert.equal(el('forecastValues').lastElementChild.className, 'forecast-value-basis');
  reset(make('med-tile', 1, '支', { category: 'med' }),
    make('supply-tile', 1, '袋', { category: 'supplies' }));
  const medicationTile = el('categoryStatsGrid').querySelector('.forecast-tile--med');
  const everydayTile = el('categoryStatsGrid').querySelector('.forecast-tile--supplies');
  assert.ok(el('categoryStatsGrid').querySelector('.forecast-tile--can').classList.contains('forecast-wide'));
  assert.ok(!medicationTile.classList.contains('forecast-wide'));
  assert.ok(medicationTile.classList.contains('forecast-tile--pair-start'));
  assert.equal(medicationTile.nextElementSibling, everydayTile);
  assert.equal(everydayTile.querySelector('.supply-summary-badge'), null);
  assert.match(everydayTile.querySelector('.supply-summary-first').textContent, /数据不足/);

  const noRemainder = make('no-remainder', 1, '杯', {
    name: '同名余量商品', unit_net_weight_g: 85, isOpened: true, openedDate: today
  });
  reset(noRemainder);
  let remainderLink = el('categoryStatsGrid').querySelector('[data-forecast-action="remainder"]');
  assert.equal(remainderLink.dataset.batchId, 'no-remainder');
  noRemainder.openRemainFraction = 0.5;
  ui.renderAll();
  assert.equal(el('categoryStatsGrid').querySelector('[data-forecast-action="remainder"]'), null);
  noRemainder.openRemainFraction = 0;
  state.items.unshift(
    make('sample-open', 1, '杯', { isSample: true, isOpened: true, openedDate: today, unit_net_weight_g: 85 }),
    make('unweighted-open', 1, '杯', { isOpened: true, openedDate: today }),
    make('expired-pack-open', 1, '杯', { isOpened: true, openedDate: today, unit_net_weight_g: 85, expDate: yesterday }),
    make('expired-open', 2, '杯', { isOpened: true, openedDate: utils.shiftDaysFromToday(-5), openDaysLimit: 2, unit_net_weight_g: 85 })
  );
  ui.renderAll();
  assert.equal(el('categoryStatsGrid').querySelector('[data-forecast-action="remainder"]').dataset.batchId, 'no-remainder');
  state.items = [noRemainder];
  state.items.unshift(...Array.from({ length: 8 }, (_, index) =>
    make('same-name-' + index, 1, '杯', { name: noRemainder.name, unit_net_weight_g: 85 })));
  state.pantryPageSize = 5;
  ui.renderAll();
  remainderLink = el('categoryStatsGrid').querySelector('[data-forecast-action="remainder"]');
  remainderLink.click();
  assert.equal(state.activeTab, 'pantry');
  assert.ok(el('pantryList').querySelector('[data-action="item-history"][data-id="no-remainder"]'));
  ui.switchTab('stats');
  console.log('Feeding analysis warnings, timeline and remainder links pass');
  reset(make('brand-food', 2, '杯', { brand: '普通品牌' }),
    make('brand-supp', 1, '袋', { brand: '营养品牌', category: 'supp' }));
  const brandScope = key => el('brandScopeBar').querySelector('[data-brand-scope="' + key + '"]').click();
  brandScope('all');
  assert.equal(el('brandStatsList').querySelectorAll('details').length, 2);
  const brandEntry = el('brandStatsList').querySelector('details');
  assert.equal(brandEntry.open, false);
  brandEntry.querySelector('summary').click();
  assert.equal(brandEntry.open, true);
  brandEntry.querySelector('summary').click();
  assert.equal(brandEntry.open, false);
  brandScope('supp');
  assert.equal(el('brandStatsList').querySelectorAll('details').length, 1);
  assert.match(el('brandStatsList').textContent, /营养品牌/);
  reset(make('recent-dry', 2, '袋', { name: '猫粮甲', category: 'dry', price: 64.25, currency: 'CNY' }),
    make('recent-wet', 1, '杯', { name: '湿粮甲', price: 5754, currency: 'JPY' }));
  state.logs = ['recent-wet', 'recent-dry', 'recent-wet'].map((itemId, index) =>
    domain.sanitizeLog({ id: 'recent-' + index, date: today, itemId, category: byId(itemId).category }));
  state.logs.push(domain.sanitizeLog({ id: 'recent-care', date: today, category: 'med', name: '药品记录' }));
  state.logs.push(domain.sanitizeLog({
    id: 'recent-future', date: utils.shiftDaysFromDate(today, 1), itemId: 'recent-dry', category: 'dry'
  }), domain.sanitizeLog({
    id: 'recent-too-old', date: utils.shiftDaysFromDate(today, -30), itemId: 'recent-dry', category: 'dry'
  }));
  ui.renderAll();
  brandScope('all');
  assert.equal(el('recent30CountBadge').textContent, '3顿');
  assert.match(el('recent30PrefBox').querySelector('.feeding-ratio-legend').textContent, /湿粮 2顿 · 66.7%/);
  assert.equal(el('recent30PrefBox').querySelector('.feeding-rank-name').textContent, '湿粮甲');
  assert.equal(el('recent30PrefBox').querySelector('.feeding-rank-brand').textContent, '测试牌');
  assert.match(el('brandStatsList').querySelector('.brand-list-spend').textContent, /5,754円 · 128\.50元/);
  assert.deepEqual(Array.from(el('forecastValues').querySelectorAll('strong'), amount => amount.textContent), ['128.50元', '5,754円']);
  ui.syncModalCurrencyUI('JPY');
  assert.equal(el('priceCurrencyUnit').value, 'JPY');
  assert.equal(el('fieldPrice').step, '1');
  ui.syncModalCurrencyUI('CNY');
  assert.equal(el('priceCurrencyUnit').value, 'CNY');
  assert.equal(el('fieldPrice').step, '0.01');
  const nearDate = utils.shiftDaysFromToday(1);
  reset(make('near-wet-a', 2, '杯', { name: '同名湿粮', spec: '50g', expDate: nearDate }),
    make('near-wet-b', 1, '杯', { name: '同名湿粮', spec: '50g', expDate: nearDate }),
    make('near-wet-c', 1, '杯', { name: '同名湿粮', spec: '85g', expDate: nearDate }),
    make('near-med', 1, '支', { category: 'med', expDate: nearDate }),
    make('fresh-med', 1, '支', { category: 'med' }));
  const verifyHealthJump = (scope, expectedIds) => {
    ui.switchTab('stats');
    el('statsScopeBar').querySelector('[data-stats-scope="' + scope + '"]').click();
    el('feedingTaskList').querySelector('[data-jump-expiry-item]').click();
    assert.equal(state.activeTab, 'pantry');
    assert.equal(state.catFilter, state.items.find(item => item.id === expectedIds[0]).category);
    for (const item of state.items) {
      assert.equal(Boolean(el('pantryList').querySelector('[data-id="' + item.id + '"]')), expectedIds.includes(item.id));
    }
  };
  verifyHealthJump('med', ['near-med']);
  verifyHealthJump('food', ['near-wet-a', 'near-wet-b', 'near-wet-c']);
  for (const id of ['near-wet-a', 'near-wet-b', 'near-wet-c']) {
    const item = byId(id);
    domain.appendFeedingLog({ date: today, itemId: id, category: item.category, brand: item.brand, name: item.name });
  }
  state.items = state.items.filter(item => item.id !== 'near-wet-b');
  ui.renderAll();
  assert.deepEqual(Array.from(el('recent30PrefBox').querySelectorAll('.feeding-rank-name'), node => node.textContent),
    ['同名湿粮 (50g)', '同名湿粮 (85g)']);
  assert.match(el('recent30PrefBox').querySelector('.feeding-rank-name').closest('li').textContent, /2顿/);

  const oldBundle = make('old-bundle', 3, '罐', {
    subtype: '罐头', prodDate: '2026-01-10', unit_net_weight_g: 85.5,
    price: 3.333, location: '蓝色铁皮柜', batchCode: '历史渠道与批号', palatability: 'ok',
    purchasePackaging: { count: 1, size: 4, outerUnit: '组' },
    flavors: [
      { id: 'chicken', name: '鸡', perPack: 2, quantity: 1, spec: '旧规格', openedDate: yesterday },
      { id: 'fish', name: '鱼', perPack: 2, quantity: 2 }
    ]
  });
  reset(oldBundle);
  state.catFilter = 'all';
  ui.openAddModal();
  await settle();
  assert.equal(el('stockFormMore').open, false);
  assert.equal(el('requiredProgressText').textContent, '必填 1/4');
  assert.equal(el('fieldNetWeight').placeholder, '1500');
  assert.deepEqual(Array.from(el('shelfPresetsBar').querySelectorAll('button'), button => button.dataset.presetMonths), ['12', '18', '21', '24']);
  const shelf21 = el('shelfPresetsBar').querySelector('[data-preset-months="21"]');
  shelf21.click();
  assert.equal(el('fieldShelfValue').value, '21');
  assert.equal(el('fieldShelfUnit').value, 'months');
  assert.equal(shelf21.getAttribute('aria-pressed'), 'true');
  assert.equal(el('stockDateEstimateText').textContent, '填保质期后自动推算');
  el('modalCatSelector').querySelector('[data-form-cat="can"]').click();
  assert.deepEqual(Array.from(el('shelfPresetsBar').querySelectorAll('button'), button => button.dataset.presetMonths), ['24', '36']);
  el('stockDateMode').querySelector('[data-stock-date="expiry"]').click();
  set('fieldExpDate', '2029-05-12');
  el('shelfPresetsBar').querySelector('[data-preset-months="36"]').click();
  assert.equal(el('fieldProdDate').value, '2026-05-12');
  assert.equal(el('fieldExpDate').value, '2029-05-12');
  assert.match(el('stockDateEstimateText').textContent, /生产日期：2026-05-12/);
  el('stockDateMode').querySelector('[data-stock-date="production"]').click();
  assert.match(el('stockDateEstimateText').textContent, /过期日期：2029-05-12/);
  ui.openAddModal();
  await settle();
  assert.equal(el('fieldProdDate').value, '');
  assert.equal(el('fieldExpDate').value, '');
  assert.equal(el('palatabilityGroup').querySelector('.active').dataset.pal, '');
  el('saveItemBtn').click();
  assert.equal(w.document.activeElement, el('fieldBrand'));
  el('modalCatSelector').querySelector('[data-form-cat="can"]').click();
  for (const [subtype, unit] of [['餐盒', '杯'], ['罐头', '罐'], ['餐包', '包']]) {
    set('fieldSubtype', subtype);
    assert.equal(el('fieldUnit').value, unit);
  }
  assert.equal(el('fieldNetWeight').placeholder, '40 / 50');
  assert.equal(el('fieldUnit').disabled, false);
  set('fieldSubtype', '餐盒');
  assert.equal(el('fieldUnit').value, '杯');
  set('fieldSubtype', '');
  assert.equal(el('stockLockedUnit').value, '—');
  assert.equal(el('fieldNetWeightLabel').textContent, '每件净含量');
  set('fieldSubtype', '罐头');
  set('fieldBrand', oldBundle.brand);
  set('fieldName', oldBundle.name);
  assert.equal(el('fieldNetWeight').value, '85.5');
  assert.equal(el('fieldProdDate').value, '2026-01-10');
  assert.equal(el('productionDatePending').classList.contains('hidden-view'), false);
  el('fieldProdDate').click();
  assert.equal(el('productionDatePending').classList.contains('hidden-view'), true);
  el('fieldLocation').value = '蓝色铁皮柜上';
  el('fieldLocation').dispatchEvent(new w.Event('input', { bubbles: true }));
  el('locationSuggestion').querySelector('button').click();
  assert.equal(el('fieldLocation').value, '蓝色铁皮柜');
  el('fieldPackagingEnabled').click();
  set('fieldPackCount', '2');
  set('fieldPackSize', '4');
  assert.equal(el('fieldQty').value, '8');
  assert.equal(el('fieldQty').readOnly, true);
  el('fieldPackagingEnabled').click();
  assert.equal(el('fieldQty').value, '1');
  assert.equal(el('fieldQty').readOnly, false);
  el('fieldPackagingEnabled').click();
  el('fieldMixedFlavors').click();
  assert.equal(el('flavorProgress').children.length, 8);
  el('fieldMixedFlavors').click();
  assert.equal(el('flavorRows').children.length, 0);
  el('fieldMixedFlavors').click();
  const chooseFlavor = name => el('flavorSuggestions').querySelector('[data-suggest-flavor="' + name + '"]').click();
  chooseFlavor('鸡');
  chooseFlavor('鱼');
  const flavorRows = el('flavorRows').querySelectorAll('.flavor-row');
  assert.equal(flavorRows[0].querySelector('[data-flavor-count]').value, '0');
  assert.ok(el('flavorSuggestions').querySelector('[data-suggest-flavor="鸡"]').classList.contains('hidden-view'));
  assert.equal(flavorRows[0].querySelector('[data-flavor-name-display]').textContent, '鸡');
  flavorRows[0].querySelector('[data-flavor-name-display]').click();
  assert.equal(w.document.activeElement, flavorRows[0].querySelector('[data-flavor-name]'));
  flavorRows[0].querySelector('[data-flavor-name]').blur();
  for (const row of flavorRows) row.querySelector('[data-flavor-step="1"]').click();
  assert.match(el('flavorSummary').textContent, /已分配 2\/8 罐 · 还差 6 罐/);
  assert.equal(el('saveItemBtn').textContent, '保存记录');
  el('saveItemBtn').click();
  assert.equal(state.items.length, 1);
  assert.equal(w.document.activeElement, el('flavorSummary'));
  const firstFlavorCount = flavorRows[0].querySelector('[data-flavor-count]');
  firstFlavorCount.value = '8';
  firstFlavorCount.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('flavorSummary').textContent, '已超出 1 罐');
  assert.equal(flavorRows[1].querySelector('[data-flavor-step="1"]').disabled, true);
  firstFlavorCount.value = '1';
  firstFlavorCount.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(flavorRows[1].querySelector('[data-flavor-step="1"]').disabled, false);
  assert.equal(el('flavorQuickActions').querySelector('[data-flavor-distribute="last"]'), null);
  el('flavorQuickActions').querySelector('[data-flavor-distribute="even"]').click();
  assert.equal(flavorRows[0].querySelector('[data-flavor-count]').value, '4');
  assert.equal(el('flavorSummary').dataset.allocation, 'complete');
  assert.equal(el('flavorSummary').textContent, '已分配 8/8 罐 ✓');
  set('fieldPackCount', '1');
  const distributeEven = el('flavorQuickActions').querySelector('[data-flavor-distribute="even"]');
  distributeEven.click();
  assert.equal(el('flavorSummary').textContent, '已分配 4/4 罐 ✓');
  el('addFlavorBtn').click();
  const thirdRow = el('flavorRows').lastElementChild;
  thirdRow.querySelector('[data-flavor-name]').value = '牛肉';
  thirdRow.querySelector('[data-flavor-name]').dispatchEvent(new w.Event('input', { bubbles: true }));
  distributeEven.click();
  assert.deepEqual(Array.from(el('flavorRows').querySelectorAll('[data-flavor-count]'), output => output.value), ['1', '1', '2']);
  thirdRow.querySelector('[data-remove-flavor]').click();
  set('fieldPackCount', '2');
  distributeEven.click();
  assert.equal(el('flavorSummary').textContent, '已分配 8/8 罐 ✓');
  el('fieldPrice').value = '40';
  el('fieldPrice').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(el('modalUnitPriceHint').textContent, /单罐约 ¥5\.00/);
  el('saveItemBtn').click();
  await settle();
  assert.equal(state.items[0].quantity, 8);
  assert.equal(state.items[0].price, 5);
  assert.equal(state.items[0].unit_net_weight_g, 85.5);
  ui.openEditModal(oldBundle.id);
  await settle();
  assert.equal(el('fieldQty').value, '3');
  assert.equal(el('fieldBatch').value, '历史渠道与批号');
  assert.equal(el('fieldPackOuterUnit').value, '组');
  assert.equal(el('flavorRows').querySelector('[data-flavor-spec]'), null);
  el('saveItemBtn').click();
  await settle();
  assert.equal(byId(oldBundle.id).flavors[0].spec, '旧规格');
  assert.equal(byId(oldBundle.id).price, 3.333);
  assert.equal(byId(oldBundle.id).quantity, 3);
  ui.openEditModal(oldBundle.id);
  await settle();
  const editRows = el('flavorRows').querySelectorAll('.flavor-row');
  assert.ok(editRows[0].querySelector('[data-flavor-name]').readOnly);
  assert.ok(editRows[0].querySelector('[data-flavor-open-panel]').classList.contains('hidden-view'));
  editRows[0].querySelector('[data-flavor-open]').click();
  assert.equal(editRows[0].querySelector('[data-flavor-open]').getAttribute('aria-expanded'), 'true');
  const openPercent = editRows[0].querySelector('[data-flavor-percent]');
  openPercent.value = '0';
  openPercent.dispatchEvent(new w.Event('input', { bubbles: true }));
  editRows[1].querySelector('[data-flavor-step="-1"]').click();
  assert.equal(byId(oldBundle.id).quantity, 3);
  assert.equal(el('saveItemBtn').textContent, '保存并记录库存调整');
  assert.equal(el('flavorReasonWrap').classList.contains('hidden-view'), false);
  el('adjustFlavorReason').value = '盘点少了';
  el('saveItemBtn').click();
  await settle();
  assert.equal(byId(oldBundle.id).quantity, 1);
  const adjustments = state.stockHistory.filter(row => row.itemId === oldBundle.id && row.action === 'adjust');
  assert.equal(adjustments.length, 2);
  assert.ok(adjustments.every(row => row.note.includes('盘点少了')));
  assert.deepEqual(Array.from(byId(oldBundle.id).flavors, row => row.perPack), [2, 2]);
  const flavorBackup = backup();
  assert.equal((await restore(flavorBackup, false)).ok, true);
  assert.deepEqual(Array.from(byId(oldBundle.id).flavors, row => row.quantity), [0, 1]);
  assert.equal(state.stockHistory.filter(row => row.itemId === oldBundle.id && row.action === 'adjust').length, 2);

  ui.openRestockModal(byId(oldBundle.id));
  await settle();
  assert.equal(el('palatabilityGroup').querySelector('.active').dataset.pal, '');
  assert.equal(el('productionDatePending').classList.contains('hidden-view'), false);
  el('fieldPackagingEnabled').click();
  assert.equal(el('fieldMixedFlavors').checked, false);
  assert.equal(el('flavorRows').children.length, 0);
  set('fieldExpDate', '2099-01-01');
  el('saveItemBtn').click();
  await settle();
  assert.equal(state.items[0].purchasePackaging, undefined);
  assert.equal(state.items[0].flavors, undefined);

  const chipsDry = make('chips-dry', 1, '袋', { category: 'dry', brand: '品牌甲' });
  const chipsNear = make('chips-near', 1, '罐', { category: 'can', brand: '品牌乙', expDate: nearDate });
  const chipsExpired = make('chips-expired', 1, '罐', { category: 'can', brand: '品牌乙', expDate: yesterday });
  const chipsArchive = make('chips-archive', 0, '袋', { category: 'treat', brand: '品牌甲', name: '归档零食', lastQuantity: 1 });
  const chipsArchiveBatch = make('chips-archive-batch', 0, '袋', { category: 'treat', brand: '品牌甲', name: '归档零食', lastQuantity: 1 });
  const chipsMedArchive = make('chips-med-archive', 0, '粒', { category: 'med', brand: '品牌乙', lastQuantity: 1 });
  state.catFilter = 'all';
  state.brandFilter = 'all';
  state.pantryHealthFilter = '';
  reset(chipsDry, chipsNear, chipsExpired, chipsArchive, chipsArchiveBatch, chipsMedArchive);
  const chipBar = el('categoryBar');
  const chip = key => chipBar.querySelector('[data-cat="' + key + '"]');
  const shownChips = () => Array.from(chipBar.querySelectorAll('[data-cat]:not(.hidden-view)'), node => node.dataset.cat);
  assert.deepEqual(shownChips(), ['all', 'dry', 'can']);
  assert.equal(chip('all').textContent.trim(), '全部 3');
  assert.equal(chip('can').textContent.trim(), '湿粮 2');
  set('brandFilterSelect', '品牌甲');
  el('searchInput').value = '不存在的名称';
  el('searchInput').dispatchEvent(new w.Event('input', { bubbles: true }));
  ui.renderAll();
  assert.equal(chip('all').textContent.trim(), '全部 3');
  assert.deepEqual(shownChips(), ['all', 'dry', 'can']);
  set('brandFilterSelect', 'all');
  el('searchInput').value = '';
  el('searchInput').dispatchEvent(new w.Event('input', { bubbles: true }));
  chip('dry').click();
  el('statCardExpiring').click();
  assert.equal(state.catFilter, 'all');
  assert.equal(chip('all').textContent.trim(), '全部 1');
  assert.deepEqual(shownChips(), ['all', 'can']);
  assert.ok(chipBar.classList.contains('is-collapsed'));
  assert.equal(chipBar.getAttribute('aria-hidden'), 'true');
  assert.ok(chipBar.hasAttribute('inert'));
  el('statCardExpired').click();
  assert.equal(chip('all').textContent.trim(), '全部 1');
  assert.deepEqual(shownChips(), ['all', 'can']);
  el('statCardEmpty').click();
  assert.equal(chip('all').textContent.trim(), '全部 2');
  assert.deepEqual(shownChips(), ['all', 'treat', 'med']);
  assert.ok(!chipBar.classList.contains('is-collapsed'));
  set('brandFilterSelect', '品牌甲');
  el('searchInput').value = '不存在的名称';
  el('searchInput').dispatchEvent(new w.Event('input', { bubbles: true }));
  ui.renderAll();
  assert.equal(chip('all').textContent.trim(), '全部 2');
  assert.deepEqual(shownChips(), ['all', 'treat', 'med']);
  set('brandFilterSelect', 'all');
  el('searchInput').value = '';
  el('searchInput').dispatchEvent(new w.Event('input', { bubbles: true }));
  chip('treat').click();
  el('statCardStock').click();
  assert.equal(state.catFilter, 'all');
  assert.deepEqual(shownChips(), ['all', 'dry', 'can']);
  chip('can').click();
  state.items = state.items.filter(entry => entry.category !== 'can');
  ui.renderAll();
  assert.equal(state.catFilter, 'can');
  assert.equal(chip('can').textContent.trim(), '湿粮 0');
  assert.ok(chip('can').classList.contains('active'));
  assert.deepEqual(shownChips(), ['all', 'dry', 'can']);
  assert.ok(!chipBar.classList.contains('is-collapsed'));
  assert.ok(!el('emptyStateBox').classList.contains('hidden-view'));
  chip('dry').click();
  assert.deepEqual(shownChips(), ['all', 'dry']);
  assert.ok(chipBar.classList.contains('is-collapsed'));
  state.items = [];
  state.catFilter = 'all';
  ui.renderAll();
  assert.equal(chip('all').textContent.trim(), '全部 0');
  assert.deepEqual(shownChips(), ['all']);
  assert.ok(!chipBar.classList.contains('is-collapsed'));
  console.log('Pantry category chip visibility and status transitions pass');

  reset(make('filter-fresh', 5, '袋', { category: 'dry', brand: '测试长品牌', name: '鸡肉甲' }),
    make('filter-near', 2, '罐', { brand: '测试长品牌', name: '鸡肉乙', expDate: nearDate }),
    make('filter-expired', 1, '罐', { brand: '另一个品牌', name: '鸡肉丙', expDate: yesterday }),
    make('filter-archive', 0, '罐', { brand: '测试长品牌', name: '鸡肉丁', lastQuantity: 3 }));
  state.catFilter = 'all';
  state.pantryHealthFilter = '';
  state.settings.pantryStatusHintSeen = false;
  ui.renderAll();
  assert.equal(el('pantryStatusHint').classList.contains('hidden-view'), false);
  assert.equal(el('statCardStock').getAttribute('aria-pressed'), 'true');
  assert.equal(el('pantryList').querySelectorAll('.archive-card').length, 0);
  assert.equal(el('brandFilterSelect').options[0].textContent, '全部品牌');
  el('statCardStock').click();
  assert.equal(state.statusFilter, 'all');
  assert.equal(w.document.querySelectorAll('.status-card.selected').length, 0);
  assert.equal(el('pantryList').querySelectorAll('.archive-card').length, 1);
  assert.equal(el('pantryStatusHint').classList.contains('hidden-view'), true);
  assert.equal(el('categoryBar').querySelector('[data-cat="can"]').textContent.trim(), '湿粮 3');
  el('statCardExpiring').click();
  assert.equal(el('categoryBar').querySelector('[data-cat="can"]').textContent.trim(), '湿粮 1');
  assert.equal(el('categoryBar').querySelector('[data-cat="dry"]').textContent.trim(), '猫粮 0');
  el('statCardExpired').click();
  assert.match(el('pantryList').textContent, /鸡肉丙/);
  assert.doesNotMatch(el('pantryList').textContent, /鸡肉甲|鸡肉乙/);
  el('statCardEmpty').click();
  assert.equal(el('pantryList').querySelectorAll('.archive-card').length, 1);
  el('statCardEmpty').click();
  el('categoryBar').querySelector('[data-cat="can"]').click();
  set('brandFilterSelect', '测试长品牌');
  set('sortSelect', 'qty_desc');
  assert.match(el('pantryList').firstElementChild.textContent, /鸡肉乙/);
  el('searchInput').value = '鸡肉乙';
  el('searchInput').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(el('pantryList').textContent, /鸡肉乙/);
  assert.doesNotMatch(el('pantryList').textContent, /鸡肉甲|鸡肉丙|鸡肉丁/);
  el('openStockHistoryBtn').click();
  assert.equal(el('historyModalBackdrop').classList.contains('hidden-view'), false);
  ui.closeStockHistoryModal();
  el('pantryDisplayToggle').querySelector('[data-display-mode="compact"]').click();
  assert.equal(el('pantryDisplayToggle').querySelector('[data-display-mode="compact"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await save());
  const localSettings = json(state.settings);
  assert.equal(localSettings.pantryHistoryHintSeen, true);
  assert.equal(localSettings.pantryStatusHintSeen, true);
  const reopenedPantry = boot();
  await settle();
  assert.equal(reopenedPantry.MeowPantry.state.statusFilter, 'in_stock');
  assert.equal(reopenedPantry.MeowPantry.state.pantryDisplayMode, 'compact');
  assert.equal(reopenedPantry.document.getElementById('pantryHistoryHint').classList.contains('is-visible'), false);
  assert.equal(reopenedPantry.document.getElementById('pantryStatusHint').classList.contains('hidden-view'), true);
  reopenedPantry.close();
  console.log('Pantry header filters, archived results and persisted hints pass');

  const currentBatch = make('edit-opening', 2, '袋', {
    category: 'dry', spec: '1.8kg', prodDate: utils.shiftDaysFromToday(-6), isOpened: true,
    openedDate: yesterday, openDaysLimit: 3, palatability: 'love', location: '柜子'
  });
  reset(currentBatch, make('saved-location', 1, '袋', { location: '蓝色铁皮柜' }));
  ui.openEditModal(currentBatch.id);
  await settle();
  assert.equal(el('modalTitle').textContent, '编辑商品');
  assert.equal(el('fieldSpecLabel').textContent, '包装补充');
  assert.equal(el('fieldNetWeightLabel').textContent, '每袋净含量');
  assert.equal(el('fieldNetWeight').required, true);
  assert.equal(el('fieldNetWeight').value, '1800');
  el('fieldNetWeight').value = '';
  el('saveItemBtn').click();
  assert.equal(w.document.activeElement, el('fieldNetWeight'));
  el('fieldNetWeight').value = '1700';
  el('fieldNetWeight').dispatchEvent(new w.Event('input', { bubbles: true }));
  el('fieldSpec').value = '2kg';
  el('fieldSpec').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('fieldNetWeight').value, '1700');
  assert.equal(el('fieldIsOpened').getAttribute('role'), 'switch');
  assert.equal(el('fieldIsOpened').getAttribute('aria-checked'), 'true');
  assert.equal(el('openedCheckboxTitle').textContent, '已开封 1袋');
  assert.equal(el('openingDaysLeft').textContent, '剩 ' + domain.evaluateItem(currentBatch).openRemaining + '天');
  assert.equal(el('fieldFreshUntil').value, utils.formatCnDateText(utils.openShelfEndDate(yesterday, 3)));
  assert.ok(el('openingDaysLeft').classList.contains('is-urgent'));
  assert.equal(el('palatabilityGroup').querySelector('.active').dataset.pal, 'love');
  assert.equal(el('quickLocationChips').querySelector('[data-pick-location="柜子"]'), null);
  set('fieldOpenedDate', utils.shiftDaysFromToday(1));
  assert.match(el('openedDateError').textContent, /晚于今天/);
  el('saveItemBtn').click();
  assert.equal(w.document.activeElement, el('fieldOpenedDate'));
  set('fieldOpenedDate', utils.shiftDaysFromToday(-7));
  assert.equal(el('openedDateError').textContent, '');
  assert.match(el('openedDateWarning').textContent, /早于生产日期，请确认/);
  set('fieldOpenedDate', yesterday);
  el('fieldOpenLimit').value = '';
  el('fieldOpenLimit').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('fieldFreshUntil').value, '—');
  assert.equal(el('openingDaysLeft').textContent, '');
  el('fieldIsOpened').click();
  assert.equal(el('fieldIsOpened').getAttribute('aria-checked'), 'false');
  assert.ok(el('openedExtraFields').classList.contains('hidden-view'));
  set('fieldLocation', '蓝色铁皮柜上');
  el('saveItemBtn').click();
  assert.match(el('confirmMessage').textContent, /已有相似位置：蓝色铁皮柜/);
  assert.equal(byId(currentBatch.id).location, '柜子');
  el('confirmCancelBtn').click();
  await settle();
  assert.equal(byId(currentBatch.id).location, '蓝色铁皮柜上');
  assert.equal(w.MeowPantry.Forecast.unitGrams(byId(currentBatch.id)), 1700);
  assert.equal(byId(currentBatch.id).openedDate, '');
  assert.equal(byId(currentBatch.id).archivedOpenedDate, '');
  assert.equal(byId(currentBatch.id).openDaysLimit, null);
  ui.openEditModal(currentBatch.id);
  await settle();
  assert.equal(el('fieldOpenLimit').value, '');
  set('fieldLocation', '蓝色铁皮柜里');
  el('saveItemBtn').click();
  el('confirmOkBtn').click();
  await settle();
  assert.equal(byId(currentBatch.id).location, '蓝色铁皮柜');
  ui.openEditModal(currentBatch.id);
  await settle();
  el('cloneBatchFromEditBtn').click();
  await settle();
  assert.equal(el('fieldId').value, '');
  assert.equal(el('fieldIsRestockMode').value, '1');
  assert.ok(el('batchOpeningCard').classList.contains('hidden-view'));
  assert.ok(el('cloneBatchFromEditWrap').classList.contains('hidden-view'));
  assert.ok(byId(currentBatch.id));
  ui.closeItemModal();
  console.log('Edit batch opening state, freshness and location decisions pass');

  const dryPackage = make('dry-status', 2, '袋', {
    category: 'dry', spec: '2kg', isOpened: true, openedDate: yesterday,
    expDate: utils.shiftDaysFromToday(40), openDaysLimit: 3
  });
  const freezePackage = make('freeze-status', 1, '袋', {
    category: 'freeze', spec: '100g', isOpened: true, openedDate: yesterday
  });
  reset(dryPackage, freezePackage, make('sealed-freeze', 1, '袋', { category: 'freeze', spec: '100g' }));
  state.settings.warnDays = 30;
  state.settings.dailyFeedGrams.freeze = 10;
  state.catFilter = 'all';
  state.pantryHealthFilter = '';
  state.statsScopeFilter = 'all';
  ui.renderAll();
  const statusRow = key => el('categoryStatsGrid').querySelector('.forecast-tile--' + key + ' .forecast-package-status');
  assert.equal(statusRow('dry').textContent, '临期 1 · 开封 1');
  assert.equal(statusRow('freeze').textContent, '开封 1');
  assert.equal(statusRow('can'), null);
  assert.equal(statusRow('treat'), null);
  const estimate = el('categoryStatsGrid').querySelector('.forecast-tile--freeze .forecast-estimate-line');
  assert.equal(estimate.textContent, '按每天10克 · 按整件估算');
  assert.match(estimate.title, /开封余量未填写/);
  statusRow('dry').querySelector('[data-package-status="expiring"]').click();
  assert.equal(state.activeTab, 'pantry');
  assert.equal(state.catFilter, 'dry');
  assert.equal(state.statusFilter, 'expiring');
  assert.match(el('pantryList').textContent, /dry-status/);
  statusRow('freeze').querySelector('[data-package-status="opened"]').click();
  assert.equal(state.catFilter, 'freeze');
  assert.equal(state.pantryHealthFilter, 'opened');
  assert.match(el('pantryList').textContent, /freeze-status/);
  assert.doesNotMatch(el('pantryList').textContent, /sealed-freeze/);
  freezePackage.isOpened = false;
  freezePackage.openedDate = '';
  ui.renderAll();
  assert.equal(statusRow('freeze'), null);
  console.log('Analysis package status counts and drill-down pass');

  const dailyWet = make('daily-wet', 2, '罐', { name: '鸡肉湿粮', unit_net_weight_g: 85 });
  reset(dailyWet);
  state.settings.dailyFeedGrams = { dry: 30, freeze: null, can: 20 };
  const log = (id, properties) => domain.sanitizeLog({ id, date: today, ...properties });
  const nextReminderYear = Number(today.slice(0, 4)) + 1;
  state.logs = [
    log('daily-med', { category: 'med', brand: '大宠爱', name: '外驱', amount: '1 支', medicationOutcome: 'smooth', nextDueDate: nextReminderYear + '-05-19' }),
    log('daily-food-late', { category: 'dry', name: '午后猫粮', amount: '22g', mealSlot: 'lunch', time: '14:00' }),
    log('daily-food-early', { category: 'dry', name: '上午猫粮', amount: '19g', mealSlot: 'lunch', time: '09:00' }),
    log('daily-fraction', { itemId: dailyWet.id, category: 'can', mealSlot: '🍪 加餐/零食', amount: '1/4罐' }),
    log('daily-treat', { category: 'treat', name: '零食', mealSlot: '🌙 晚饭', amount: '100g' }),
    log('daily-care-yesterday', { date: yesterday, category: 'supp', name: '营养品', amount: '1支' }),
    log('daily-old', { date: '2025-01-02', category: 'dry', amount: '15克' }),
    ...Array.from({ length: 23 }, (_, index) => log('daily-history-' + index, {
      date: utils.shiftDaysFromDate(today, -index - 2), category: 'dry', amount: '10克'
    }))
  ];
  ui.switchTab('daily');
  ui.renderAll();
  assert.equal(el('dailyWeekDays').children.length, 7);
  assert.equal(el('dailyWeekDays').lastElementChild.dataset.dailyDate, today);
  assert.equal(el('dailyWeekDays').lastElementChild.getAttribute('aria-current'), 'date');
  assert.ok(el('dailyWeekDays').lastElementChild.querySelector('.has-record'));
  assert.ok(el('dailyNextWeek').disabled);
  assert.match(el('dailyDateLabel').textContent, /月.*日 周. · 今天/);
  assert.equal(el('recentSevenDaysList'), null);
  assert.equal(el('dailyModeSwitch'), null);
  assert.deepEqual(Array.from(el('dailyTotals').querySelectorAll('[data-consumed-grams]'), node => node.textContent), ['41', '0克', '21']);
  assert.equal(el('dailyTotals').querySelector('.daily-total-values').textContent, '41/30克· 超11克');
  assert.equal(el('dailyTotals').querySelector('.daily-total-track .is-over').style.width, '100%');
  assert.ok(el('openAddModalBtn').closest('.hidden-view'));
  assert.equal(el('dailyWeekTitle').getAttribute('aria-label'), '查看全部历史记录');
  assert.ok(el('dailyWeekTitle').querySelector('svg'));
  assert.match(el('dailyFeedTimeline').textContent, /1\/4罐约21克/);
  assert.deepEqual(Array.from(el('dailyFeedTimeline').querySelectorAll('.daily-card-title'), node => node.textContent),
    ['上午猫粮', '午后猫粮', '零食', '鸡肉湿粮', '外驱']);
  assert.equal(el('copyPrevDayLogsBtn'), null);
  assert.equal(el('dailyFeedTimeline').querySelector('.daily-record-group'), null);
  assert.match(el('dailyFeedTimeline').querySelector('.daily-reminder').textContent, /下次用药/);
  assert.deepEqual(Array.from(el('dailyFeedTimeline').querySelectorAll('.daily-record-meta'), node => node.textContent),
    ['中午', '中午', '晚上', '零食加餐 · 测试牌', '用药 · 大宠爱✅顺利']);
  el('dailyPrevWeek').click();
  assert.ok(!el('dailyPastWeek').classList.contains('hidden-view'));
  assert.ok(!el('dailyNextWeek').disabled);
  el('goTodayBtn').click();
  assert.equal(state.selectedLogDate, today);
  el('dailyWeekTitle').click();
  assert.ok(!el('dailyHistory').classList.contains('hidden-view'));
  assert.equal(el('dailyHistoryList').querySelectorAll('[data-daily-history-date]').length, 20);
  el('dailyHistoryMore').click();
  assert.equal(el('dailyHistoryList').querySelectorAll('[data-daily-history-date]').length, 26);
  assert.ok(el('dailyHistoryMore').classList.contains('hidden-view'));
  Object.defineProperty(w, 'scrollY', { value: 240, configurable: true });
  const scrolled = [];
  w.scrollTo = (...args) => scrolled.push(args);
  el('dailyHistoryList').querySelector('[data-daily-history-date="2025-01-02"]').click();
  assert.equal(state.selectedLogDate, '2025-01-02');
  assert.match(el('dailyWeekTitle').textContent, /2024年12月–2025年1月/);
  el('jumpToAllDatesBtn').click();
  assert.equal(el('dailyHistoryList').querySelectorAll('[data-daily-history-date]').length, 26);
  assert.deepEqual(scrolled.at(-1), [0, 240]);
  el('dailyHistoryFilters').querySelector('[data-daily-history-filter="medication"]').click();
  assert.equal(el('dailyHistoryList').querySelectorAll('[data-daily-history-date]').length, 1);
  assert.match(el('dailyHistoryList').textContent, /大宠爱 外驱 1支 ✅ 顺利/);
  assert.equal(el('dailyHistoryList').querySelector('.daily-history-counts > :last-child').textContent, '用药 1次');
  el('dailyHistoryFilters').querySelector('[data-daily-history-filter="nursing"]').click();
  assert.equal(el('dailyHistoryList').textContent, '没有护理记录');
  el('dailyHistoryFilters').querySelector('[data-daily-history-filter="all"]').click();
  el('dailyHistoryList').querySelector('[data-daily-history-date="' + yesterday + '"]').click();
  assert.match(el('dailyFeedTimeline').textContent, /营养品/);
  el('openQuickFeedBtn').click();
  assert.equal(el('feedModalTitle').textContent, '新增记录');
  assert.equal(el('feedDateInput').value, yesterday);
  ui.closeFeedModal();
  state.settings.dailyFeedGrams = { dry: null, freeze: null, can: null };
  ui.renderDailyView();
  assert.match(el('dailyTotals').textContent, /设置每日喂食量，查看每日对比/);
  console.log('Daily week, portions, care and history navigation pass');

  const medItem = make('reminder-med', 1, '支', { category: 'med', brand: '大宠爱', name: '外驱' });
  reset(medItem);
  const medLog = (id, properties) => log(id, {
    category: 'med', brand: medItem.brand, name: medItem.name, subtype: '外驱', mealSlot: 'care',
    itemId: medItem.id, amount: '1支', date: yesterday, reminderDays: 30, ...properties
  });
  const oldDue = medLog('older-reminder', { date: utils.shiftDaysFromToday(-8), nextDueDate: yesterday });
  const upcoming = medLog('upcoming-reminder', { nextDueDate: utils.shiftDaysFromToday(7) });
  const other = log('other-reminder', {
    category: 'supp', brand: '营养品牌', name: '补充剂', amount: '1支', nextDueDate: yesterday, reminderDays: 30
  });
  state.logs = [upcoming, oldDue];
  ui.switchTab('daily');
  ui.renderAll();
  assert.equal(el('dailyMedReminders').querySelectorAll('.med-reminder-card').length, 1);
  assert.match(el('dailyMedReminders').textContent, /大宠爱 外驱还有 7 天/);
  assert.ok(el('dailyMedReminders').querySelector('[data-reminder-tone="warning"]'));
  assert.ok(el('pantryOverdueMedReminder').classList.contains('hidden-view'));
  assert.ok(!el('dailyMedReminderDot').classList.contains('hidden-view'));

  state.logs.unshift(other);
  ui.renderAll();
  assert.ok(el('dailyMedReminders').querySelector('details[data-reminder-tone="danger"]'));
  assert.match(el('dailyMedReminders').querySelector('summary').textContent, /2 项用药提醒/);
  assert.match(el('pantryOverdueMedReminder').textContent, /1 项用药已过期/);
  ui.switchTab('pantry');
  el('pantryOverdueMedReminder').click();
  assert.equal(state.activeTab, 'daily');
  el('dailyMedReminders').querySelector('summary').click();
  assert.ok(el('dailyMedReminders').querySelector('details').open);
  el('dailyMedReminders').querySelector('[data-record-reminder="upcoming-reminder"]').click();
  assert.equal(el('feedItemId').value, medItem.id);
  assert.equal(el('feedDateInput').value, today);
  assert.equal(el('feedNextReminderDays').value, '30');
  el('feedForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(state.logs[0].subtype, '外驱');
  assert.equal(state.logs[0].nextDueDate, utils.shiftDaysFromToday(30));
  assert.ok(!el('dailyMedReminders').querySelector('[data-record-reminder="upcoming-reminder"]'));
  assert.match(el('dailyFeedTimeline').textContent, /用药 · 大宠爱➖未记录外驱/);
  assert.match(el('dailyFeedTimeline').textContent, /下次驱虫/);
  el('dailyMedReminders').querySelector('[data-record-reminder="other-reminder"]').click();
  assert.equal(el('feedItemId').value, '');
  assert.equal(el('feedNameInput').value, '补充剂');
  el('feedForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(state.logs[0].category, 'supp');
  assert.equal(state.logs[0].nextDueDate, utils.shiftDaysFromToday(30));
  assert.ok(el('dailyMedReminders').classList.contains('hidden-view'));
  assert.ok(el('dailyMedReminderDot').classList.contains('hidden-view'));
  assert.ok(el('pantryOverdueMedReminder').classList.contains('hidden-view'));
  state.logs = [medLog('latest-without-reminder', { date: today }), oldDue,
    log('legacy-completed', { category: 'med', name: '旧药品', nextDueDate: yesterday, reminderDone: true })];
  ui.renderAll();
  assert.ok(el('dailyMedReminders').classList.contains('hidden-view'));
  const careBatch = make('care-tablet', 1, '片', { category: 'med' });
  const medicineBadge = w.MeowPantry.getPalatabilityBadgeInfo({ category: 'med', palatability: 'love' });
  assert.equal(medicineBadge.label, '顺利');
  assert.equal(medicineBadge.emoji, '✅');
  assert.match(utils.formatPalatabilityBadge({ category: 'med' }, medicineBadge), /✅.*顺利/);
  assert.doesNotMatch(utils.formatPalatabilityBadge({ category: 'med' }, medicineBadge), /😍|顺利无异常/);
  reset(careBatch);
  ui.openFeedModal(careBatch.id, today);
  assert.match(el('feedModalTitle').textContent, /记录用药/);
  assert.equal(el('saveFeedBtn').textContent, '保存用药记录');
  assert.equal(el('feedStockLabel').textContent, '选择药品批次（或手动输入）');
  set('feedStockSelect', '');
  assert.ok(el('feedDeductBox').classList.contains('hidden-view'));
  assert.ok(el('feedDeductStock').disabled);
  assert.equal(el('feedCareDeductHelp').textContent, '选择药品批次后可扣减');
  set('feedStockSelect', careBatch.id);
  assert.ok(el('feedDeductStock').checked);
  assert.equal(el('feedMedicationOutcome').value, '');
  assert.deepEqual(Array.from(el('feedMedicationOutcomeChoices').children, button => button.textContent),
    ['➖未记录', '✅顺利', '🥹需哄喂', '🙅抗拒', '🤮吐了']);
  assert.match(el('feedPortionChips').querySelector('[data-frac="0.5"]').textContent, /半片/);
  set('feedMedicationOutcome', 'coaxed');
  set('feedNextReminderDays', 'custom');
  set('feedCustomReminderDays', '10');
  set('feedAmountInput', '半片');
  el('feedForm').requestSubmit();
  assert.equal(state.logs[0].medicationOutcome, 'coaxed');
  assert.equal(state.logs[0].deductedFrac, 0.5);
  assert.equal(state.logs[0].reminderDays, 10);
  ui.openFeedModal(careBatch.id, today);
  assert.match(el('chipLastPortion').textContent, /上次用量：半片/);
  const halfTablet = el('feedPortionChips').querySelector('[data-frac="0.5"]');
  halfTablet.click();
  assert.equal(halfTablet.getAttribute('aria-pressed'), 'true');
  assert.equal(el('chipLastPortion').getAttribute('aria-pressed'), 'false');
  set('feedAmountInput', '1片');
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedCareDeductHelp').textContent, /没有足够的新片/);
  el('feedForm').requestSubmit();
  assert.equal(state.logs[0].deductedFrac, 0);
  assert.equal(byId(careBatch.id).openRemainFraction, 0.5);

  const supplementBatch = make('care-supplement', 1, '瓶', { category: 'supp' });
  const foodBatch = make('care-food', 2, '袋', { category: 'dry' });
  const archiveDose = make('care-archive', 0, '支', { category: 'med' });
  reset(supplementBatch, foodBatch, archiveDose, careBatch);
  const stockOptions = () => Array.from(el('feedStockSelect').options, option => option.value);
  ui.openFeedModal(foodBatch.id, today);
  assert.equal(el('feedNameLabel').textContent, '商品名');
  assert.deepEqual(stockOptions(), ['', '__unstocked__', foodBatch.id]);
  el('feedMealChoices').querySelector('[data-meal-slot="care"]').click();
  assert.equal(el('feedNameLabel').textContent, '药品名称');
  assert.equal(el('feedItemId').value, '');
  assert.equal(el('feedNameInput').value, '');
  assert.deepEqual(stockOptions(), ['', careBatch.id, supplementBatch.id, archiveDose.id]);
  assert.equal(el('feedStockSelect').options[1].parentElement.label, '药品');
  assert.equal(el('feedStockSelect').options[2].parentElement.label, '营养品');
  assert.match(el('feedStockSelect').options[3].text, /已核销/);
  el('feedStockChoices').querySelector('[data-feed-stock-id="' + supplementBatch.id + '"]').click();
  assert.equal(el('feedItemId').value, supplementBatch.id);
  assert.equal(el('feedCategorySelect').value, 'supp');
  assert.equal(el('feedNameInput').value, supplementBatch.name);
  assert.equal(el('feedBrandInput').value, supplementBatch.brand);
  assert.equal(el('feedDeductStock').checked, false);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.match(el('feedCareDeductHelp').textContent, /份量无法换算/);
  assert.match(el('feedPortionChips').querySelector('[data-frac="0.5"]').textContent, /半瓶/);
  el('feedMealChoices').querySelector('[data-meal-slot="breakfast"]').click();
  assert.equal(el('feedNameLabel').textContent, '商品名');
  assert.equal(el('feedItemId').value, '');
  assert.equal(el('feedBrandInput').value, '');
  assert.equal(el('feedAmountInput').value, '');
  assert.equal(el('feedCategorySelect').value, 'dry');
  assert.deepEqual(stockOptions(), ['', '__unstocked__', foodBatch.id]);
  assert.ok(!el('feedDeductStock').checked);
  ui.closeFeedModal();

  const legacyCare = domain.sanitizeLog({ mealSlot: 'care', date: today, note: '旧备注' });
  assert.equal(legacyCare.careType, 'nursing');
  assert.equal(legacyCare.amount, '');
  assert.equal(legacyCare.note, '旧备注');
  assert.equal(domain.sanitizeLog({ mealSlot: 'care', amount: '半支' }).careType, 'medication');
  reset(careBatch);
  ui.openFeedModal(careBatch.id, today);
  set('feedNoteInput', '状态配合');
  el('feedCareTypeGroup').querySelector('[data-feed-care-type="nursing"]').click();
  assert.equal(el('feedDateInput').value, today);
  assert.equal(el('feedNoteInput').value, '状态配合');
  assert.equal(el('feedNameInput').value, '');
  assert.equal(el('feedNameInput').required, false);
  assert.equal(el('saveFeedBtn').textContent, '保存护理记录');
  const project = name => Array.from(el('feedNursingProjects').querySelectorAll('input[type="checkbox"]'))
    .find(input => input.value === name);
  assert.deepEqual(Array.from(el('feedNursingProjects').querySelectorAll('.care-chip-copy use'), use => use.getAttribute('href')),
    ['#ui-brush', '#ui-scissors', '#ui-ear', '#ui-sparkles', '#ui-bath', '#ui-clipboard-check']);
  assert.equal(project('清理眼屎'), undefined);
  project('梳毛').click();
  project('其他').click();
  set('feedNursingOther', '擦脚');
  set('feedNextReminderDays', '3');
  el('feedForm').requestSubmit();
  const nursing = state.logs[0];
  assert.equal(nursing.careType, 'nursing');
  assert.deepEqual(Array.from(nursing.careProjects), ['梳毛', '擦脚']);
  assert.equal(nursing.nextDueDate, utils.shiftDaysFromToday(3));
  assert.equal(nursing.deductedFrac, 0);
  assert.equal(nursing.note, '状态配合');
  const nursingRows = Array.from(el('dailyFeedTimeline').querySelectorAll('.daily-record--nursing'));
  assert.deepEqual(nursingRows.map(row => row.querySelector('.daily-record-name').textContent), ['梳毛', '擦脚']);
  assert.deepEqual(nursingRows.map(row => row.querySelector('.daily-record-amount').textContent), ['1次', '1次']);
  assert.ok(nursingRows.every(row => !row.querySelector('.daily-record-meta')));
  assert.ok(nursingRows.every(row => row.querySelector('.daily-record-more use').getAttribute('href') === '#ui-more-vertical'));
  nursingRows[0].querySelector('.daily-record-more').click();
  assert.ok(nursingRows[0].querySelector('.daily-record-menu').open);
  assert.deepEqual(Array.from(nursingRows[0].querySelectorAll('.daily-record-menu-items button'), button => button.textContent),
    ['编辑', '删除']);
  assert.deepEqual(nursingRows.map(row => row.querySelector('.daily-nursing-icon use').getAttribute('href')),
    ['#ui-brush', '#ui-clipboard-check']);
  assert.equal(w.MeowPantry.Stats.computeOverviewMetrics(state.items, state.logs).recent30.nursing.length, 1);
  ui.openEditFeedModal(nursing.id);
  assert.ok(project('梳毛').checked);
  assert.equal(el('feedNursingOther').value, '擦脚');
  assert.equal(el('feedNextReminderDays').value, '3');
  ui.closeFeedModal();

  assert.equal(utils.formatRelativeYearDate('2026-12-20', '2026-11-20'), '12月20日');
  assert.equal(utils.formatRelativeYearDate('2027-05-19', '2026-11-20'), '2027年5月19日');


  ui.switchTab('pantry');
  assert.ok(el('openAddModalBtn').classList.contains('ios-btn-primary'));
  const header = w.document.querySelector('.app-header');
  assert.deepEqual(Array.from(header.children, node => node.id), ['headerMascotImg', 'headerProfileName']);
  assert.equal(el('openAddModalBtn').closest('main').id, 'viewPantry');
  for (const tab of ['daily', 'stats', 'settings']) {
    ui.switchTab(tab);
    assert.ok(el('openAddModalBtn').closest('.hidden-view'));
  }
  assert.equal(el('openProfileEditor'), null);
  assert.equal(el('profileForm'), null);
  assert.equal(el('globalEditModeToggle'), null);
  assert.deepEqual(Array.from(el('openAddModalBtn').parentElement.children, node => node.id), ['openAddModalBtn']);
  ui.switchTab('stats');
  el('statsSubTabSwitch').querySelector('[data-stats-subtab="pal"]').click();
  assert.equal(el('statsSubTabSwitch').querySelector('[data-stats-subtab="pal"]').getAttribute('aria-pressed'), 'true');
  el('statsSubTabSwitch').querySelector('[data-stats-subtab="stock"]').click();
  el('statsScopeBar').querySelector('[data-stats-scope="food"]').click();
  assert.equal(el('statsScopeBar').querySelector('[data-stats-scope="food"]').getAttribute('aria-pressed'), 'true');
  const categoryJump = el('categoryStatsGrid').querySelector('.forecast-category');
  assert.ok(categoryJump.querySelector('svg'));
  categoryJump.click();
  assert.equal(state.activeTab, 'pantry');
  assert.equal(state.catFilter, categoryJump.dataset.jumpCat);
  ui.switchTab('settings');
  state.settings.unsavedChangesCount = 0;
  state.settings.lastBackupDate = '';
  state.settings.lastJsonExportAt = '';
  ui.renderSettingsView();
  assert.ok(el('backupNoticeDot').classList.contains('hidden-view'));
  assert.equal(el('backupStatusTitle').textContent, '尚无备份');
  assert.equal(el('backupStatusTime').textContent, '尚未备份过');
  state.settings.unsavedChangesCount = 101;
  ui.renderSettingsView();
  assert.equal(el('backupNoticeDot').textContent, '99+');
  assert.equal(el('backupStatusTitle').textContent, '101 项未备份');
  assert.equal(el('unbackedBannerText').textContent, '101 项改动未备份');
  el('dismissBackupBannerBtn').click();
  ui.renderSettingsView();
  assert.ok(el('unbackedBanner').classList.contains('hidden-view'));
  state.settings.unsavedChangesCount = 102;
  ui.renderSettingsView();
  assert.ok(!el('unbackedBanner').classList.contains('hidden-view'));
  state.settings.unsavedChangesCount = 101;

  const originalDownload = storage.triggerFileDownload;
  storage.triggerFileDownload = () => false;
  el('settingsBackupNowBtn').click();
  assert.equal(state.settings.unsavedChangesCount, 101);
  assert.match(el('toastEl').textContent, /未能发起 JSON 导出/);
  storage.triggerFileDownload = () => true;
  el('quickBackupNowBtn').click();
  assert.equal(state.settings.unsavedChangesCount, 0);
  assert.ok(el('backupNoticeDot').classList.contains('hidden-view'));
  assert.equal(el('backupStatusTitle').textContent, '已是最新备份');
  assert.match(el('backupStatusTime').textContent, /上次 \d+月\d+日 \d{2}:\d{2}/);
  storage.triggerFileDownload = originalDownload;
  console.log('Header button variants and backup status pass');
  const dryInput = el('dailyFeedDry');
  state.settings.dailyFeedGrams.dry = 50;
  ui.renderSettingsView();
  function changeDryGrams(value) {
    dryInput.value = value;
    dryInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  for (const invalid of ['', '-1', '1.5', '2e3']) {
    changeDryGrams(invalid);
    assert.equal(dryInput.value, '50');
    assert.equal(state.settings.dailyFeedGrams.dry, 50);
  }
  changeDryGrams('0');
  await persisted(s => assert.equal(s.settings.dailyFeedGrams.dry, 0));
  ui.switchTab('settings');
  dryInput.focus();
  dryInput.value = '57';
  Object.defineProperty(w.navigator, 'standalone', { value: true, configurable: true });
  let downloadedSettings;
  storage.triggerFileDownload = (_name, content) => {
    downloadedSettings = JSON.parse(content).settings;
    return true;
  };
  el('settingsBackupNowBtn').click();
  storage.triggerFileDownload = originalDownload;
  assert.equal(downloadedSettings.dailyFeedGrams.dry, 57);
  assert.equal(dryInput.value, '57');
  assert.notEqual(w.document.activeElement, dryInput);
  delete w.navigator.standalone;
  assert.equal(dryInput.nextElementSibling.textContent, '57');
  await persisted(s => assert.equal(s.settings.dailyFeedGrams.dry, 57));



  const rated = make('pal-rated', 2, '袋', { category: 'dry', palatability: 'love' });
  const unrated = make('pal-unrated', 1);
  const legacyMix = mixed();
  legacyMix.palatability = 'ok';
  const commonMix = domain.sanitizeItem(legacyMix);
  assert.equal(w.MeowPantry.getPalatabilityBadgeInfo(commonMix).key, 'ok');
  assert.ok(!Object.hasOwn(commonMix, 'palatability'));
  legacyMix.flavors[0].palatability = 'coax';
  const ratedMix = domain.sanitizeItem(legacyMix);
  assert.equal(w.MeowPantry.getPalatabilityBadgeInfo(ratedMix).label, '口味分化');
  assert.deepEqual(Array.from(ratedMix.flavors, flavor => flavor.palatability), ['coax', 'ok']);
  reset(rated, unrated, ratedMix);
  rated.notes = '备注🐱';
  const downloads = [];
  const downloadBeforeIconTest = storage.triggerFileDownload;
  storage.triggerFileDownload = (_name, content) => downloads.push(content);
  storage.exportItemsCsv();
  storage.triggerFileDownload = downloadBeforeIconTest;
  assert.match(downloads[0], /超爱吃/);
  assert.doesNotMatch(downloads[0], /😍/);
  assert.match(downloads[0], /备注🐱/);
  assert.equal(backup().items.find(item => item.id === rated.id).notes, '备注🐱');
  ui.openFeedModal(rated.id, today);
  assert.equal(el('feedFlavorPal').value, 'love');
  set('feedStockSelect', unrated.id);
  assert.equal(el('feedFlavorPal').value, '');
  set('feedStockSelect', ratedMix.id);
  assert.equal(el('feedFlavorPal').value, '');
  set('feedFlavorSelect', 'chicken');
  assert.equal(el('feedFlavorPal').value, 'coax');
  set('feedFlavorSelect', 'fish');
  assert.equal(el('feedFlavorPal').value, 'ok');
  set('feedFlavorPal', 'meh');
  set('feedFlavorSelect', 'chicken');
  assert.equal(el('feedFlavorPal').value, 'meh');
  set('feedStockSelect', rated.id);
  assert.equal(el('feedFlavorPal').value, 'meh');
  el('feedForm').requestSubmit();
  assert.equal(state.logs[0].flavorPalatability, 'meh');
  assert.equal(byId(rated.id).palatability, 'love');
  ui.openFeedModal(ratedMix.id, today);
  set('feedFlavorSelect', 'chicken');
  set('feedFlavorPal', 'meh');
  set('feedAmountInput', '1' + ratedMix.unit);
  el('feedForm').requestSubmit();
  const mixLog = state.logs.find(log => log.itemId === ratedMix.id);
  assert.equal(mixLog.flavorPalatability, 'meh');
  assert.equal(mixLog.deductedUnit, 1);
  assert.ok(!Object.hasOwn(byId(ratedMix.id), 'palatability'));
  assert.equal(byId(ratedMix.id).flavors[0].palatability, 'coax');
  ui.openFeedModal('', today, true);
  assert.equal(el('feedFlavorPal').value, '');
  ui.closeFeedModal();

  ui.openEditModal(ratedMix.id);
  const ratings = w.document.querySelectorAll('#stockFlavorRatings [data-flavor-pal]');
  assert.deepEqual(Array.from(ratings, field => field.value), ['coax', 'ok']);
  const firstRatingPicker = ratings[0].parentElement.querySelector('details');
  firstRatingPicker.querySelector('summary').click();
  assert.equal(firstRatingPicker.open, true);
  firstRatingPicker.querySelector('[data-flavor-rate="ok"]').click();
  assert.equal(firstRatingPicker.open, false);
  assert.equal(firstRatingPicker.querySelector('summary .palatability-emoji').textContent, '😋');
  el('itemForm').requestSubmit();
  assert.equal(w.MeowPantry.getPalatabilityBadgeInfo(byId(ratedMix.id)).key, 'ok');
  ui.openEditModal(ratedMix.id);
  w.document.querySelector('#stockFlavorRatings [data-flavor-pal]').value = '';
  el('itemForm').requestSubmit();
  assert.equal(byId(ratedMix.id).flavors[0].palatability, '');
  assert.equal(w.MeowPantry.getPalatabilityBadgeInfo(byId(ratedMix.id)).label, '口味分化');
  assert.ok(await save());
  await persisted(s => {
    const item = s.items.find(item => item.id === ratedMix.id);
    assert.ok(!Object.hasOwn(item, 'palatability'));
    assert.deepEqual(Array.from(item.flavors, flavor => flavor.palatability), ['', 'ok']);
  });

  const supply = make('cat-litter', 2, '包', {
    category: 'supplies', brand: '喵洁', name: '豆腐猫砂', unit_net_weight_g: null,
    unit_spec_value: 6, unit_spec_unit: '升', openedDate: today, isOpened: true, price: 10, currency: 'CNY', location: '日用品柜', expDate: ''
  });
  assert.equal(supply.unit_spec_value, 6);
  assert.equal(supply.unit_spec_unit, '升');
  assert.equal(utils.formatItemSpec(supply), '6升');
  const supplyLow = make('wipes', 0.5, '包', { category: 'supplies', brand: '喵洁', name: '宠物湿巾', unit_spec_value: 80, unit_spec_unit: '片', price: 20, currency: 'JPY', prodDate: '2026-01-01', shelfLifeValue: 12, expDate: '2027-01-01' });
  const supplyNew = make('ear-cleaner', 1, '瓶', { category: 'supplies', brand: '洁耳', name: '洁耳液', unit_spec_value: 1, unit_spec_unit: '瓶', price: 5, currency: 'CNY' });
  reset(supply, supplyLow, supplyNew, make('daily-food', 1, '袋', { category: 'dry' }), make('supply-pair', 1, '瓶', { category: 'supp' }));
  const addSupplyArrival = (item, date, action = 'create') => domain.appendStockHistory({
    action, date, itemId: item.id, category: 'supplies', brand: item.brand, name: item.name,
    unit: item.unit, beforeQty: 0, afterQty: item.quantity, deltaText: '+' + item.quantity + item.unit
  });
  addSupplyArrival(supply, utils.shiftDaysFromToday(-10));
  addSupplyArrival(supply, today, 'restock');
  addSupplyArrival(supplyLow, utils.shiftDaysFromToday(-10));
  addSupplyArrival(supplyLow, today, 'restock');
  addSupplyArrival(supplyNew, today);
  const addSupplyCycle = (item, opened, finished) => {
    domain.appendStockHistory({ action: 'open', date: opened, itemId: item.id, category: 'supplies', brand: item.brand, name: item.name, unit: item.unit });
    domain.appendStockHistory({ action: 'consume', date: finished, itemId: item.id, category: 'supplies', brand: item.brand, name: item.name, unit: item.unit, beforeQty: 1, afterQty: 0 });
  };
  addSupplyCycle(supply, utils.shiftDaysFromToday(-10), today);
  addSupplyCycle(supplyLow, utils.shiftDaysFromToday(-10), today);
  state.statsScopeFilter = 'all';
  w.MeowPantry.Stats.renderStatsView();
  assert.equal(el('statsScopeBar').querySelector('[data-stats-scope="supplies"]').textContent, '日用品 3');
  assert.equal(el('statsScopeBar').querySelector('[data-stats-scope="all"]').textContent, '全部 5');
  assert.match(el('forecastValues').textContent, /25\.00元/);
  assert.match(el('forecastValues').textContent, /10円/);
  const suppliesTile = el('categoryStatsGrid').querySelector('.forecast-tile--supplies');
  const supplementTile = el('categoryStatsGrid').querySelector('.forecast-tile--supp');
  assert.match(suppliesTile.textContent, /日用品3批3种5天宠物湿巾最先用完/);
  assert.ok(suppliesTile.querySelector('.supply-summary-badge--warning'));
  assert.ok(!suppliesTile.classList.contains('forecast-wide'));
  assert.ok(!supplementTile.classList.contains('forecast-wide'));
  assert.doesNotMatch(el('feedingTaskList').textContent, /快用完/);
  ui.openAddModal();
  const supplyCategoryButton = el('modalCatSelector').querySelector('[data-form-cat="supplies"]');
  Object.defineProperties(el('modalCatSelector'), {
    clientWidth: { configurable: true, value: 250 },
    scrollWidth: { configurable: true, value: 420 }
  });
  Object.defineProperties(supplyCategoryButton, {
    offsetLeft: { configurable: true, value: 300 },
    offsetWidth: { configurable: true, value: 80 }
  });
  supplyCategoryButton.click();
  assert.equal(el('modalCatSelector').scrollLeft, 146);
  assert.equal(el('fieldNetWeightLabel').textContent, '每份规格');
  assert.ok(el('netWeightUnit').classList.contains('hidden-view'));
  assert.ok(!el('fieldNetWeightUnit').classList.contains('hidden-view'));
  assert.equal(el('fieldNetWeightUnit').value, '克');
  assert.equal(el('fieldNetWeight').parentElement, el('fieldNetWeightUnit').parentElement);
  assert.equal(el('stockWeightPresetLabel').textContent, '常用单位');
  assert.deepEqual(Array.from(el('fieldNetWeightUnit').options, option => option.value), ['克', '千克', '毫升', '升', '片', '张']);
  assert.deepEqual(Array.from(el('stockWeightPresetOptions').children, button => button.textContent), ['克', '千克', '毫升', '升', '片', '张']);
  assert.equal(el('fieldQty').type, 'number');
  assert.equal(el('fieldQty').required, true);
  assert.equal(el('fieldQty').value, '1');
  assert.equal(el('fieldUnit').value, '袋');
  assert.ok(['袋', '包', '瓶', '支', '盒'].every(unit => Array.from(el('fieldUnit').options, option => option.value).includes(unit)));
  assert.ok(!el('fieldQty').closest('#stockQuantityGrid > div').classList.contains('hidden-view'));
  assert.equal(el('palatabilityFieldWrap').hidden, true);
  assert.ok(el('stockFlavorRatingSection').classList.contains('hidden-view'));
  assert.ok(el('fieldPackagingEnabled').closest('.purchase-packaging-toggle').classList.contains('hidden-view'));
  assert.equal(el('fieldPackagingEnabled').checked, false);
  assert.equal(el('stockFormDates').parentElement, el('stockFormMore').querySelector('.stock-form-more-body'));
  assert.ok(el('stockDateRequired').classList.contains('hidden-view'));
  assert.ok(el('stockDateHint').classList.contains('hidden-view'));
  assert.ok(!el('stockDateHeading').classList.contains('hidden-view'));
  assert.ok(!el('stockDateMode').classList.contains('hidden-view'));
  assert.ok(!el('stockProductionField').classList.contains('hidden-view'));
  assert.ok(el('stockExpiryField').classList.contains('hidden-view'));
  assert.equal(el('fieldProdDate').value, '');
  assert.equal(el('fieldExpDate').value, '');
  set('fieldProdDate', '2026-05-10');
  set('fieldExpDate', '2026-05-09');
  assert.equal(el('fieldExpDate').value, '');
  set('fieldExpDate', '2026-05-11');
  assert.equal(el('fieldExpDate').value, '2026-05-11');
  set('fieldProdDate', '');
  set('fieldExpDate', '');
  assert.equal(el('fieldShelfValue').value, '');
  assert.equal(el('fieldOpenLimit').value, '');
  assert.ok(!el('shelfPresetsBar').classList.contains('hidden-view'));
  assert.ok(Array.from(el('stockShelfPresetOptions').children).every(button => button.getAttribute('aria-pressed') === 'false'));
  assert.ok(!el('openLimitColWrap').classList.contains('hidden-view'));
  set('fieldProdDate', '2026-05-10');
  el('fieldShelfValue').value = '12';
  el('fieldShelfValue').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('fieldExpDate').value, '2027-05-10');
  assert.match(el('stockDateEstimateText').textContent, /过期日期：2027-05-10/);
  set('fieldProdDate', '');
  set('fieldExpDate', '');
  el('fieldShelfValue').value = '';
  el('fieldShelfValue').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.ok(!el('stockPackagingSupplementField').classList.contains('hidden-view'));
  assert.equal(el('fieldSpecLabel').textContent, '款式补充');
  assert.match(el('fieldSpecHelp').textContent, /款式不同/);
  assert.equal(el('fieldNotes').placeholder, '如：吸水性好、粉尘少、需要搭配垃圾袋');
  assert.ok(el('batchOpeningCard').classList.contains('hidden-view'));
  assert.ok(!el('itemForm').classList.contains('validation-attempted'));
  assert.deepEqual(Array.from(el('quickBrandChips').children, button => button.textContent), ['喵洁', '洁耳']);
  assert.deepEqual(Array.from(el('quickLocationChips').children, button => button.textContent), ['日用品柜']);
  set('fieldBrand', '喵洁');
  el('fieldBrand').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.deepEqual(Array.from(el('quickBrandChips').children, button => button.textContent), ['洁耳']);
  supply.location = '';
  ui.renderQuickLocationChips();
  assert.ok(el('quickLocationChips').parentElement.classList.contains('hidden-view'));
  supply.location = '日用品柜';
  set('fieldBrand', '');
  assert.notEqual(w.MeowPantry.COVERS.supplies, w.MeowPantry.COVERS.dry);
  el('modalCatSelector').querySelector('[data-form-cat="dry"]').click();
  assert.equal(el('stockFormDates').nextElementSibling, el('stockFormMore'));
  assert.ok(!el('stockDateRequired').classList.contains('hidden-view'));
  assert.ok(!el('fieldPackagingEnabled').closest('.purchase-packaging-toggle').classList.contains('hidden-view'));
  el('modalCatSelector').querySelector('[data-form-cat="supplies"]').click();
  el('itemForm').requestSubmit();
  assert.ok(el('itemForm').classList.contains('validation-attempted'));
  assert.ok(el('fieldBrand').classList.contains('is-invalid'));
  set('fieldBrand', '新日用品牌');
  set('fieldName', '宠物牙膏');
  el('fieldNetWeight').value = '1';
  el('fieldNetWeight').dispatchEvent(new w.Event('input', { bubbles: true }));
  el('itemForm').requestSubmit();
  const savedSupply = state.items.find(item => item.brand === '新日用品牌' && item.name === '宠物牙膏');
  assert.ok(savedSupply);
  assert.equal(savedSupply.prodDate, '');
  assert.equal(savedSupply.expDate, '');
  assert.equal(savedSupply.shelfLifeValue, '');
  state.items = state.items.filter(item => item.id !== savedSupply.id);
  ui.openEditModal(supplyNew.id);
  assert.equal(el('fieldNetWeightUnit').value, '瓶');
  assert.match(el('fieldNetWeightUnit').selectedOptions[0].textContent, /旧单位，请选择容量单位/);
  assert.match(el('toastEl').textContent, /请选择容量单位/);
  ui.closeItemModal();
  ui.openEditModal(supply.id);
  assert.ok(!el('batchOpeningCard').classList.contains('hidden-view'));
  assert.equal(el('fieldOpenedDate').value, today);
  assert.equal(el('openingSubtitle').textContent, '记录开始使用日期');
  assert.ok(el('freshUntilCol').classList.contains('hidden-view'));
  el('fieldOpenLimit').value = '8';
  el('fieldOpenLimit').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(el('openingSubtitle').textContent, '单独计算开封保鲜期');
  assert.ok(!el('freshUntilCol').classList.contains('hidden-view'));
  set('fieldOpenedDate', utils.shiftDaysFromToday(-11));
  assert.equal(el('openedDateError').textContent, '');
  assert.equal(el('openedDateWarning').textContent, '');
  ui.closeItemModal();
  state.catFilter = 'all';
  state.pantryDisplayMode = 'card';
  ui.renderAll();
  const supplyCard = w.document.querySelector('[data-id="cat-litter"][data-action="consume-one"]').closest('.detail-card');
  assert.match(supplyCard.textContent, /喵洁豆腐猫砂/);
  assert.equal(supplyCard.querySelector('.btn-feed').dataset.action, 'consume-one');
  assert.equal(supplyCard.querySelector('.btn-feed').textContent, '记用完');
  assert.ok(supplyCard.querySelector('.btn-feed').classList.contains('inventory-primary-action'));
  assert.equal(supplyCard.querySelector('.btn-feed use').getAttribute('href'), '#feed-paw');
  assert.match(supplyCard.textContent, /在库 2包开封 1/);
  assert.ok(supplyCard.querySelector('.detail-card-photo img'));
  assert.match(supplyCard.querySelector('.supply-detail-identity').textContent, /日用品·喵洁/);
  assert.equal(supplyCard.querySelector('.supply-detail-identity b').getAttribute('title'), '喵洁');
  assert.equal(supplyCard.querySelector('.supply-usage-icon'), null);
  assert.equal(supplyCard.querySelector('.detail-card-shelf'), null);
  assert.equal(supplyCard.querySelector('.supply-detail-fresh'), null);
  assert.match(supplyCard.querySelector('.supply-current-cycle').textContent, /当前这包.*开封.*已用 0天.*预计还能用 20 天/s);
  assert.equal(supplyCard.querySelector('.supply-inventory-dates'), null);
  assert.doesNotMatch(el('dailyQuickFeedBox').textContent, /豆腐猫砂/);
  ui.populateFeedStockDropdown();
  assert.ok(!Array.from(el('feedStockSelect').options, option => option.value).includes(supply.id));
  state.catFilter = 'supplies';
  ui.renderAll();
  assert.equal(el('sortSelect').value, 'supply_days_asc');
  assert.deepEqual(Array.from(el('sortSelect').options).filter(option => !option.hidden).map(option => option.textContent), ['最快用完', '最近入库']);
  const usageRows = Array.from(el('pantryList').querySelectorAll('.supply-detail-card'));
  assert.equal(usageRows.length, 3);
  const litterUsage = usageRows.find(row => row.textContent.includes('豆腐猫砂'));
  const wipesUsage = usageRows.find(row => row.textContent.includes('宠物湿巾'));
  const cleanerUsage = usageRows.find(row => row.textContent.includes('洁耳液'));
  assert.match(litterUsage.textContent, /预计还能用 20 天/);
  assert.match(wipesUsage.textContent, /预计还能用 5 天/);
  assert.equal(wipesUsage.querySelectorAll('.detail-card-dates > div').length, 3);
  assert.notEqual(wipesUsage.querySelector('[data-shelf-progress] .progress-bar').style.width, '0%');
  assert.match(cleanerUsage.textContent, /数据不足，暂不估算/);
  assert.equal(cleanerUsage.querySelectorAll('.detail-card-dates > div').length, 1);
  assert.equal(cleanerUsage.querySelector('[data-shelf-progress]'), null);
  assert.equal(cleanerUsage.querySelector('.btn-feed'), null);
  assert.ok(cleanerUsage.querySelector('[data-action="item-history"]'));
  cleanerUsage.querySelector('[data-action="card-menu"]').click();
  assert.equal(cleanerUsage.querySelector('[data-action="toggle-open"]').textContent, '开封');
  assert.match(cleanerUsage.textContent, /在库 1瓶/);
  state.pantryDisplayMode = 'compact';
  ui.renderPantryList();
  const compactSupplyRows = Array.from(el('pantryList').querySelectorAll('.supply-inventory-card--compact'));
  assert.equal(compactSupplyRows.length, 3);
  assert.ok(compactSupplyRows.every(row => row.querySelector('[data-action="card-menu"] use').getAttribute('href') === '#ui-more-vertical'));
  assert.ok(compactSupplyRows.every(row => !row.querySelector('.supply-inventory-dates')));
  assert.match(compactSupplyRows.find(row => row.textContent.includes('豆腐猫砂')).textContent, /喵洁豆腐猫砂在库 2 包.*使用中记用完/);
  assert.equal(compactSupplyRows.find(row => row.textContent.includes('洁耳液')).querySelector('.btn-feed'), null);
  assert.ok(compactSupplyRows.every(row => row.querySelector('[data-action="item-history"]')));
  el('pantryDisplayToggle').querySelector('[data-display-mode="card"]').click();
  assert.ok(el('toastEl').classList.contains('toast-box--bottom'));
  const openedSupplyQty = supply.quantity;
  el('pantryList').querySelector('[data-id="cat-litter"][data-action="consume-one"]').click();
  assert.equal(el('confirmTitle').textContent, '确认库存核销？');
  assert.equal(supply.quantity, openedSupplyQty);
  el('confirmCancelBtn').click();
  assert.equal(supply.quantity, openedSupplyQty);
  let cleanerCard = Array.from(el('pantryList').querySelectorAll('.supply-detail-card')).find(row => row.textContent.includes('洁耳液'));
  cleanerCard.querySelector('[data-action="card-menu"]').click();
  cleanerCard.querySelector('[data-action="toggle-open"]').click();
  assert.equal(el('confirmTitle').textContent, '确认记录开封？');
  assert.match(el('confirmMessage').textContent, /未设置开封保鲜期，不计算保鲜倒计时/);
  set('confirmOpenDateInput', yesterday);
  assert.match(el('confirmMessage').textContent, /未设置开封保鲜期，不计算保鲜倒计时/);
  ui.syncOpenDatePicker(el('confirmOpenDateWrap'), { ...supplyNew, openDaysLimit: 8 });
  assert.match(el('confirmMessage').textContent, /按这个日期计算保鲜倒计时/);
  set('confirmOpenDateInput', today);
  el('confirmOkBtn').click();
  cleanerCard = Array.from(el('pantryList').querySelectorAll('.supply-detail-card')).find(row => row.textContent.includes('洁耳液'));
  assert.match(cleanerCard.querySelector('.supply-current-cycle').textContent, /数据不足，暂不估算/);
  assert.equal(cleanerCard.querySelector('.supply-current-cycle .progress-track'), null);
  assert.ok(el('toastEl').classList.contains('toast-box--bottom'));
  domain.recordConsumedUnits(supply, 1, utils.shiftDaysFromToday(5));
  const supplyMetrics = w.MeowPantry.Stats.computeOverviewMetrics(state.items, state.logs);
  assert.equal(supplyMetrics.catStats.supplies.eatenByUnit.包, 1);
  assert.ok(supplyMetrics.catStats.supplies.durationByUnit.包.days > 0);

  const knownSupply = make('autofill-supply', 1, '包', {
    category: 'supplies', brand: '规格测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升'
  });
  state.catFilter = 'supplies';
  reset(knownSupply);
  ui.openAddModal();
  set('fieldUnit', '包');
  set('fieldBrand', '规格测试');
  set('fieldName', '猫砂');
  assert.equal(el('fieldNetWeight').value, '6');
  assert.equal(el('fieldNetWeightUnit').value, '升');
  assert.equal(el('stockWeightPresetOptions').querySelector('[data-spec-unit="升"]').getAttribute('aria-pressed'), 'true');
  set('fieldNetWeightUnit', '千克');
  assert.equal(el('fieldNetWeight').value, '');
  assert.equal(el('fieldNetWeightUnit').value, '千克');
  set('fieldNetWeightUnit', '升');
  assert.equal(el('fieldNetWeight').value, '6');
  el('fieldNetWeight').value = '7';
  el('fieldNetWeight').dispatchEvent(new w.Event('input', { bubbles: true }));
  set('fieldNetWeightUnit', '千克');
  assert.equal(el('fieldNetWeight').value, '7');
  assert.equal(el('fieldNetWeightUnit').value, '千克');
  ui.closeItemModal();
  state.items.push(make('autofill-other-size', 1, '包', {
    category: 'supplies', brand: '规格测试', name: '猫砂', unit_spec_value: 8, unit_spec_unit: '升'
  }));
  ui.openAddModal();
  set('fieldUnit', '包');
  set('fieldBrand', '规格测试');
  set('fieldName', '猫砂');
  assert.equal(el('fieldNetWeight').value, '', '不同规格的同名商品不应自动选择其中一种');
  assert.equal(el('fieldNetWeight').required, true);
  el('fieldNetWeight').value = '10';
  el('fieldNetWeight').dispatchEvent(new w.Event('input', { bubbles: true }));
  set('fieldNetWeightUnit', '升');
  el('itemForm').requestSubmit();
  const savedDifferentSupply = state.items.find(entry => entry.name === '猫砂' && entry.unit_spec_value === 10);
  assert.ok(savedDifferentSupply);
  assert.equal(savedDifferentSupply.unit_spec_unit, '升');

  const batchA = make('supply-batch-a', 1, '包', {
    category: 'supplies', brand: '同品牌', name: '同款猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    expDate: yesterday, location: '旧柜', batchCode: 'CODE-A', notes: '特殊备注', price: 10
  });
  const batchB = make('supply-batch-b', 2, '包', {
    category: 'supplies', brand: '同品牌', name: '同款猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    expDate: utils.shiftDaysFromToday(200), location: '新柜', batchCode: 'CODE-B', price: 20,
    isOpened: true, openedDate: utils.shiftDaysFromToday(-2)
  });
  state.catFilter = 'supplies';
  state.pantryDisplayMode = 'card';
  reset(batchA, batchB);
  state.statusFilter = 'expired';
  ui.renderAll();
  let batchRows = Array.from(el('pantryList').querySelectorAll('.supply-detail-card'));
  assert.deepEqual(batchRows.map(row => row.dataset.id), ['supply-batch-a']);
  assert.match(batchRows[0].textContent, /旧柜.*CODE-A.*在库 1包/);
  assert.doesNotMatch(batchRows[0].textContent, /新柜|在库 3包/);
  assert.match(el('filterResultCountText').textContent, /1批商品/);
  state.statusFilter = 'in_stock';
  for (const query of ['CODE-A', '特殊备注', '6升']) {
    state.searchQuery = query;
    ui.renderAll();
    batchRows = Array.from(el('pantryList').querySelectorAll('.supply-detail-card'));
    assert.equal(batchRows.length, query === '6升' ? 2 : 1);
    assert.ok(batchRows.some(row => row.dataset.id === batchA.id));
  }
  state.searchQuery = '';
  state.pantryHealthFilter = 'opened';
  ui.renderAll();
  assert.deepEqual(Array.from(el('pantryList').querySelectorAll('.supply-detail-card'), row => row.dataset.id), [batchB.id]);
  state.pantryHealthFilter = '';
  state.catFilter = 'all';
  ui.renderAll();
  batchRows = Array.from(el('pantryList').querySelectorAll('.supply-detail-card'));
  assert.deepEqual(batchRows.map(row => row.dataset.id).sort(), [batchA.id, batchB.id]);
  for (const row of batchRows) {
    assert.ok(Array.from(row.querySelectorAll('[data-id]')).every(button => button.dataset.id === row.dataset.id));
  }
  batchRows.find(row => row.dataset.id === batchA.id).querySelector('[data-action="item-history"]').click();
  assert.equal(state.historyItemFilter, batchA.id);
  ui.closeStockHistoryModal();
  state.pantryDisplayMode = 'compact';
  ui.renderPantryList();
  const compactBatches = Array.from(el('pantryList').querySelectorAll('.supply-inventory-card--compact'));
  assert.deepEqual(compactBatches.map(row => row.dataset.id).sort(), [batchA.id, batchB.id]);
  assert.match(compactBatches.find(row => row.dataset.id === batchB.id).textContent, /CODE-B.*新柜/);
  let supplyCsv = '';
  storage.triggerFileDownload = (_name, content) => { supplyCsv = content; return true; };
  storage.exportItemsCsv();
  storage.triggerFileDownload = originalDownload;
  assert.match(supplyCsv, /"同款猫砂","6升","1"/);

  const bulkArchive = make('supply-bulk-archive', 0, '包', {
    category: 'supplies', brand: '同品牌', name: '同款猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    consumedCount: 3, lastQuantity: 3, archivedOpenedDate: utils.shiftDaysFromToday(-20), finishedDate: today
  });
  state.catFilter = 'supplies';
  state.pantryDisplayMode = 'card';
  reset(batchB, bulkArchive);
  state.statusFilter = 'empty';
  ui.renderAll();
  assert.doesNotMatch(el('pantryList').textContent, /均每包/);
  state.statusFilter = 'all';
  ui.renderAll();
  assert.ok(el('pantryList').querySelector('.archive-card'));
  assert.doesNotMatch(el('pantryList').textContent, /均每包/);

  const previousPageSize = state.pantryPageSize;
  const manySupplyBatches = Array.from({ length: 6 }, (_, index) => make('pagination-' + index, 1, '包', {
    category: 'supplies', brand: '同品牌', name: '同款猫砂', unit_spec_value: 6, unit_spec_unit: '升'
  }));
  reset(...manySupplyBatches);
  state.pantryPageSize = 5;
  state.pantryPage = 2;
  ui.renderAll();
  assert.equal(el('pantryList').querySelectorAll('.supply-detail-card').length, 1);
  assert.match(el('filterResultCountText').textContent, /6批商品/);
  assert.equal(el('pantryPaginationBar').querySelector('.list-pagination-count').textContent, '2 / 2');
  state.pantryPageSize = previousPageSize;
  state.pantryPage = 1;

  const historyEvent = (action, date, order, extra = {}) => ({
    id: 'supply-event-' + order, itemId: batchA.id, category: 'supplies', action, date,
    timestamp: '2026-01-' + String(order).padStart(2, '0') + ' 12:00:00', ...extra
  });
  const open20 = utils.shiftDaysFromToday(-20);
  const open3 = utils.shiftDaysFromToday(-3);
  const usedOne = { beforeQty: 2, afterQty: 1 };
  const supplyEstimate = history => domain.getSupplyUsageEstimates([batchA, batchB], history)[0];
  const correctedHistory = [
    historyEvent('open', open20, 1),
    historyEvent('adjust', today, 2, { deltaText: '开封状态变更', note: '已开封 ' + open20 + ' → 已开封 ' + open3 }),
    historyEvent('consume', today, 3, usedOne)
  ];
  assert.equal(supplyEstimate(correctedHistory).averageCycleDays, 3);
  const reopenedHistory = [
    historyEvent('open', open20, 1),
    historyEvent('unopen', today, 2),
    historyEvent('open', today, 3, { deltaText: '开封状态变更', openingDate: open3 }),
    historyEvent('consume', today, 4, usedOne)
  ];
  assert.equal(supplyEstimate(reopenedHistory).averageCycleDays, 3);
  assert.equal(supplyEstimate([
    historyEvent('create', open20, 1),
    historyEvent('consume', today, 2, usedOne)
  ]).averageCycleDays, null);
  assert.equal(supplyEstimate([
    historyEvent('open', open20, 1),
    historyEvent('consume', today, 2, { beforeQty: 4, afterQty: 1 })
  ]).averageCycleDays, null);
  assert.equal(supplyEstimate([
    historyEvent('create', open20, 1, { note: '新录入库存批次 · 入库时已开封 ' + open3 }),
    historyEvent('consume', today, 2, usedOne)
  ]).averageCycleDays, 3);
  assert.equal(supplyEstimate(correctedHistory.concat([
    historyEvent('adjust', today, 4, { deltaText: '历史批次日期变更' })
  ])).averageCycleDays, null);
  assert.equal(supplyEstimate(correctedHistory.concat([
    historyEvent('revert', today, 4, { revertsHistoryId: 'supply-event-3' })
  ])).averageCycleDays, null);
  const structuredHistory = [
    historyEvent('open', open20, 1),
    historyEvent('adjust', today, 2, { supplyEvent: 'opening_changed', openingDate: open3, deltaText: '新文案' }),
    historyEvent('consume', today, 3, usedOne)
  ];
  assert.equal(supplyEstimate(structuredHistory).averageCycleDays, 3);
  assert.equal(supplyEstimate(structuredHistory.concat([
    historyEvent('adjust', today, 4, { supplyEvent: 'history_dates_changed', deltaText: '新文案' })
  ])).averageCycleDays, null);
  assert.equal(supplyEstimate([
    historyEvent('open', today, 1, { supplyEvent: 'opening_changed', note: '→ 已开封 ' + open3 }),
    historyEvent('consume', today, 2, usedOne)
  ]).averageCycleDays, null);
  const sameSecond = structuredHistory.map(event => ({ ...event, timestamp: '2026-01-01 12:00:00' })).reverse();
  assert.equal(supplyEstimate(sameSecond).averageCycleDays, 3);

  batchA.isOpened = true;
  batchA.openedDate = open3;
  const concurrent = supplyEstimate(correctedHistory);
  assert.equal(concurrent.openedCount, 2);
  assert.equal(concurrent.remainingDays, null);
  assert.equal(domain.getSupplyBatchEstimate(batchA, concurrent).remainingDays, 0);
  assert.equal(domain.getSupplyBatchEstimate(batchB, concurrent).remainingDays, 4);
  reset(batchA, batchB);
  state.stockHistory = correctedHistory;
  state.statsScopeFilter = 'supplies';
  ui.renderAll();
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /多批次同时开封，暂不估算/);

  batchA.openedDate = open20;
  batchB.isOpened = false;
  batchB.openedDate = '';
  reset(batchA, batchB);
  state.catFilter = 'supplies';
  state.pantryDisplayMode = 'card';
  domain.appendStockHistory({ action: 'open', itemId: batchA.id, category: 'supplies', date: open20 });
  ui.openEditModal(batchA.id);
  set('fieldOpenedDate', open3);
  el('itemForm').requestSubmit();
  assert.equal(byId(batchA.id).openedDate, open3);
  assert.equal(state.stockHistory[0].openingDate, open3);
  assert.equal(state.stockHistory[0].supplyEvent, 'opening_changed');
  ui.renderAll();
  el('pantryList').querySelector('[data-action="consume-one"][data-id="supply-batch-a"]').click();
  el('confirmOkBtn').click();
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, 3);
  assert.ok(await save());
  await persisted(s => {
    assert.equal(s.stockHistory.find(entry => entry.deltaText === '开封状态变更').openingDate, open3);
    assert.equal(s.stockHistory.find(entry => entry.deltaText === '开封状态变更').supplyEvent, 'opening_changed');
    assert.equal(domain.getSupplyUsageEstimates(s.items, s.stockHistory)[0].averageCycleDays, 3);
  });
  const parsedOpeningBackup = storage.validateAndParseBackup(JSON.stringify(backup()));
  assert.ok(parsedOpeningBackup.ok);
  assert.equal(parsedOpeningBackup.stockHistory.find(entry => entry.deltaText === '开封状态变更').openingDate, open3);
  assert.equal(parsedOpeningBackup.stockHistory.find(entry => entry.deltaText === '开封状态变更').supplyEvent, 'opening_changed');
  ui.openEditModal(batchA.id);
  set('fieldOpenedDate', utils.shiftDaysFromToday(-4));
  el('itemForm').requestSubmit();
  assert.equal(state.stockHistory[0].deltaText, '历史批次日期变更');
  assert.equal(state.stockHistory[0].supplyEvent, 'history_dates_changed');
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, null);
  const editedHistoryBackup = backup();
  editedHistoryBackup.stockHistory[0].deltaText = '历史日期已编辑';
  assert.ok((await restore(editedHistoryBackup, false)).ok);
  assert.equal(state.stockHistory[0].supplyEvent, 'history_dates_changed');
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, null);

  reset(batchB);
  state.catFilter = 'supplies';
  state.statsScopeFilter = 'supplies';
  state.pantryDisplayMode = 'card';
  domain.appendStockHistory({ action: 'open', itemId: batchB.id, category: 'supplies', date: open3,
    timestamp: '2026-01-01 12:00:00' });
  domain.appendStockHistory({ action: 'consume', itemId: batchB.id, category: 'supplies', date: today,
    timestamp: '2026-01-02 12:00:00', beforeQty: 2, afterQty: 1 });
  for (let i = 0; i < w.MeowPantry.MAX_STOCK_HISTORY - 2; i++) {
    domain.appendStockHistory({ action: 'adjust', itemId: 'other', category: 'dry' });
  }
  assert.equal(state.stockHistory.length, 500);
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, 3);
  ui.renderAll();
  assert.doesNotMatch(el('pantryList').querySelector('.supply-detail-card').textContent, /历史可能不完整/);
  assert.doesNotMatch(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /历史可能不完整/);
  ui.openStockHistoryModal(batchB.id);
  assert.match(el('historyRetentionNotice').textContent, /全部库存流水最多保留 500 条，历史可能不完整，日用品估算仅供参考/);
  ui.closeStockHistoryModal();
  domain.appendStockHistory({ action: 'adjust', itemId: 'other', category: 'dry' });
  assert.equal(state.stockHistory.length, 500);
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, null);
  ui.renderAll();
  assert.match(el('pantryList').querySelector('.supply-detail-card').textContent, /数据不足，暂不估算/);
  const truncatedBackup = backup();
  assert.ok((await restore(truncatedBackup, false)).ok);
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].averageCycleDays, null);
  ui.renderAll();
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /数据不足/);
  ui.openStockHistoryModal(batchB.id);
  assert.match(el('historyRetentionNotice').textContent, /历史可能不完整/);
  state.historySearchQuery = '不存在的记录';
  ui.renderStockHistoryModal();
  assert.match(el('stockHistoryList').textContent, /暂无匹配/);
  assert.match(el('historyRetentionNotice').textContent, /最多保留 500 条/);
  ui.closeStockHistoryModal();
  console.log('Supply batch filters, operations, CSV and usage estimates pass');

  const groupedLiters = make('grouped-liters', 1, '包', {
    category: 'supplies', brand: '分组测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升', spec: '无香'
  });
  const groupedMilliliters = make('grouped-milliliters', 2, '包', {
    category: 'supplies', brand: '分组测试', name: '猫砂', unit_spec_value: 6000, unit_spec_unit: '毫升', spec: '无香'
  });
  const groupedScented = make('grouped-scented', 1, '包', {
    category: 'supplies', brand: '分组测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升', spec: '绿茶香'
  });
  const groupedUnspecified = make('grouped-unspecified', 1, '包', {
    category: 'supplies', brand: '分组测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升'
  });
  state.catFilter = 'supplies';
  state.statsScopeFilter = 'supplies';
  reset(groupedLiters, groupedMilliliters, groupedScented, groupedUnspecified);
  state.stockHistory = [
    { id: 'grouped-consume', itemId: groupedMilliliters.id, category: 'supplies', action: 'consume',
      date: utils.shiftDaysFromToday(-2), timestamp: '2026-01-02 12:00:00', beforeQty: 3, afterQty: 2 },
    { id: 'grouped-open', itemId: groupedMilliliters.id, category: 'supplies', action: 'open',
      date: utils.shiftDaysFromToday(-12), timestamp: '2026-01-01 12:00:00' },
    { id: 'scented-open', itemId: groupedScented.id, category: 'supplies', action: 'open',
      date: yesterday, timestamp: '2026-01-01 12:00:00' }
  ];
  const groupedEstimates = domain.getSupplyUsageEstimates(state.items, state.stockHistory);
  assert.equal(groupedEstimates.length, 3);
  assert.equal(groupedEstimates.find(entry => entry.key === domain.getProductGroupKey(groupedLiters)).remainingDays, 30);
  assert.equal(groupedEstimates.find(entry => entry.key === domain.getProductGroupKey(groupedScented)).remainingDays, null);
  ui.renderAll();
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /3种30天/);
  assert.match(el('pantryList').querySelector('.supply-detail-card[data-id="grouped-liters"]').textContent, /6升.*无香/);
  assert.match(el('pantryList').querySelector('.supply-detail-card[data-id="grouped-milliliters"]').textContent, /6,000毫升.*无香/);
  ui.openAddModal();
  set('fieldUnit', '包');
  set('fieldBrand', '分组测试');
  set('fieldName', '猫砂');
  set('fieldSpec', '无香');
  assert.equal(el('fieldNetWeight').value, '6');
  assert.equal(el('fieldNetWeightUnit').value, '升');
  set('fieldNetWeightUnit', '毫升');
  assert.equal(el('fieldNetWeight').value, '6000');
  ui.closeItemModal();
  ui.openStockHistoryModal(groupedLiters.id, true);
  assert.match(el('historyCountBadge').textContent, /2条记录/);
  ui.closeStockHistoryModal();
  const groupingBackup = backup();
  assert.ok((await restore(groupingBackup, false)).ok);
  assert.equal(byId(groupedLiters.id).unit_spec_unit, '升');
  assert.equal(byId(groupedMilliliters.id).unit_spec_value, 6000);
  assert.equal(byId(groupedMilliliters.id).unit_spec_unit, '毫升');
  assert.equal(byId(groupedScented.id).spec, '绿茶香');
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory).length, 3);
  ui.openEditModal(groupedLiters.id);
  assert.equal(el('fieldSpecLabel').textContent, '款式补充');
  assert.equal(el('fieldSpec').value, '无香');
  set('fieldSpec', '绿茶香');
  el('itemForm').requestSubmit();
  assert.equal(byId(groupedLiters.id).spec, '绿茶香');
  assert.equal(domain.getProductGroupKey(byId(groupedLiters.id)), domain.getProductGroupKey(byId(groupedScented.id)));
  const groupedArchives = [groupedLiters, groupedMilliliters, groupedScented].map(entry => make('archive-' + entry.id, 0, '包', {
    ...entry, id: 'archive-' + entry.id, quantity: 0, sourceBatchId: entry.id, consumedCount: 1, lastQuantity: 1, finishedDate: today
  }));
  reset(...groupedArchives);
  state.statusFilter = 'empty';
  ui.renderAll();
  assert.equal(el('pantryList').querySelectorAll('.archive-card').length, 2);
  console.log('Supply equivalent units, variants and backup grouping pass');
  state.statsScopeFilter = 'all';
  state.catFilter = 'all';
  state.pantryDisplayMode = 'card';

  const sampleItem = make('sample-integration', 2, '罐', { isSample: true, unit_net_weight_g: 100 });
  const realItem = make('real-integration', 1, '罐', { unit_net_weight_g: 100 });
  state.statsScopeFilter = 'all';
  state.catFilter = 'all';
  reset(sampleItem, realItem);
  feed(sampleItem, '半罐');
  assert.equal(state.logs[0].isSample, true);
  assert.ok(state.stockHistory.every(entry => entry.isSample));
  state.logs.push(domain.sanitizeLog({ id: 'legacy-sample-log', itemId: sampleItem.id, date: today, amount: '1罐' }));
  state.stockHistory.push(domain.sanitizeStockHistoryEntry({ id: 'legacy-sample-history', itemId: sampleItem.id, action: 'open' }));
  el('clearSamplesBtn').click();
  assert.deepEqual(Array.from(state.items, entry => entry.id), [realItem.id]);
  assert.equal(state.logs.length, 0);
  assert.equal(state.stockHistory.length, 0);
  await settle();
  await persisted(s => { assert.equal(s.items.length, 1); assert.equal(s.logs.length, 0); });

  const sampleSupply = make('sample-supply', 5, '包', {
    category: 'supplies', brand: '日用品测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    isSample: true, isOpened: true, openedDate: utils.shiftDaysFromToday(-3)
  });
  const realSupply = make('real-supply', 2, '包', {
    category: 'supplies', brand: '日用品测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    isOpened: true, openedDate: utils.shiftDaysFromToday(-2)
  });
  const sampleSupplyArchive = make('sample-supply-archive', 0, '包', {
    category: 'supplies', brand: '日用品测试', name: '猫砂', unit_spec_value: 6, unit_spec_unit: '升',
    sourceBatchId: sampleSupply.id
  });
  const supplyHistory = (id, itemId, action, date, order, extra = {}) => domain.sanitizeStockHistoryEntry({
    id, itemId, action, category: 'supplies', date,
    timestamp: '2026-01-' + String(order).padStart(2, '0') + ' 12:00:00',
    beforeQty: 3, afterQty: action === 'consume' ? 2 : 3, ...extra
  });
  const legacySampleHistory = [
    supplyHistory('sample-create', sampleSupply.id, 'create', yesterday, 1),
    supplyHistory('sample-open', sampleSupply.id, 'open', utils.shiftDaysFromToday(-30), 1),
    supplyHistory('sample-consume', sampleSupply.id, 'consume', today, 2),
    supplyHistory('sample-shadow-open', sampleSupplyArchive.id, 'open', utils.shiftDaysFromToday(-20), 1),
    supplyHistory('sample-shadow-consume', sampleSupplyArchive.id, 'consume', today, 2)
  ];
  const realSupplyHistory = [
    supplyHistory('real-open', realSupply.id, 'open', utils.shiftDaysFromToday(-10), 1),
    supplyHistory('real-consume', realSupply.id, 'consume', utils.shiftDaysFromToday(-2), 2),
    supplyHistory('flagged-open', realSupply.id, 'open', utils.shiftDaysFromToday(-30), 3, { isSample: true }),
    supplyHistory('flagged-consume', realSupply.id, 'consume', today, 4, { isSample: true })
  ];
  const orphanHistory = supplyHistory('unrelated-orphan', 'missing-item', 'consume', today, 5);
  state.catFilter = 'supplies';
  state.statsScopeFilter = 'supplies';
  reset(sampleSupply);
  state.stockHistory = legacySampleHistory.slice(0, 3);
  ui.renderAll();
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].remainingDays, null);
  assert.match(el('pantryList').querySelector('.supply-detail-card[data-id="sample-supply"]').textContent, /示例库存未计入预测/);
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /示例库存未计入预测/);
  assert.doesNotMatch(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /最先用完/);

  reset(sampleSupply, sampleSupplyArchive, realSupply);
  state.stockHistory = [...legacySampleHistory, ...realSupplyHistory, orphanHistory];
  const legacySupplyBackup = backup();
  legacySupplyBackup.version = 2;
  for (const entry of legacySupplyBackup.stockHistory) {
    if (entry.itemId === sampleSupply.id || entry.itemId === sampleSupplyArchive.id) delete entry.isSample;
  }
  delete legacySupplyBackup.items.find(entry => entry.id === sampleSupplyArchive.id).isSample;
  const legacyArray = storage.validateAndParseBackup(JSON.stringify([sampleSupply, realSupply]));
  assert.ok(legacyArray.ok);
  assert.equal(domain.getSupplyUsageEstimates(legacyArray.items, legacyArray.stockHistory)[0].quantity, 2);
  assert.equal(domain.getSupplyUsageEstimates(legacyArray.items, legacyArray.stockHistory)[0].remainingDays, null);
  assert.ok((await restore(legacySupplyBackup, false)).ok);
  const supplyAfterRestore = domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0];
  assert.equal(supplyAfterRestore.quantity, 2);
  assert.equal(supplyAfterRestore.openedCount, 1);
  assert.equal(supplyAfterRestore.item.id, realSupply.id);
  assert.equal(supplyAfterRestore.averageCycleDays, 8);
  assert.equal(supplyAfterRestore.remainingDays, 14);
  assert.equal(domain.getSupplyBatchEstimate(byId(sampleSupply.id), supplyAfterRestore).latestArrivalDate, yesterday);
  ui.renderAll();
  const restoredSampleCard = el('pantryList').querySelector('.supply-detail-card[data-id="sample-supply"]');
  const restoredRealCard = el('pantryList').querySelector('.supply-detail-card[data-id="real-supply"]');
  assert.match(restoredSampleCard.textContent, /示例库存未计入预测/);
  assert.match(restoredRealCard.textContent, /预计还能用 14 天/);
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--supplies').textContent, /14天.*示例库存未计入预测/);
  await persisted(s => {
    assert.equal(domain.getSupplyUsageEstimates(s.items, s.stockHistory)[0].remainingDays, 14);
    assert.ok(s.stockHistory.some(entry => entry.id === orphanHistory.id));
  });
  el('clearSamplesBtn').click();
  assert.deepEqual(Array.from(state.items, entry => entry.id), [realSupply.id]);
  assert.ok(state.stockHistory.some(entry => entry.id === orphanHistory.id));
  assert.ok(state.stockHistory.some(entry => entry.id === 'real-consume'));
  assert.ok(!state.stockHistory.some(entry => entry.itemId === sampleSupply.id || entry.itemId === sampleSupplyArchive.id || entry.isSample));
  assert.equal(domain.getSupplyUsageEstimates(state.items, state.stockHistory)[0].remainingDays, 14);
  await settle();
  await persisted(s => {
    assert.deepEqual(Array.from(s.items, entry => entry.id), [realSupply.id]);
    assert.ok(s.stockHistory.some(entry => entry.id === orphanHistory.id));
  });
  state.catFilter = 'all';
  state.statsScopeFilter = 'all';
  console.log('Sample supplies excluded from forecasts and legacy backup cleanup pass');

  reset(realItem);
  state.settings.unsavedChangesCount = 3;
  state.settings.lastBackupDate = '2020-01-01';
  assert.ok(await save());
  const countBeforeMerge = state.settings.unsavedChangesCount;
  const mergeData = backup();
  mergeData.items.push(make('new-import', 1));
  assert.ok((await restore(mergeData)).ok);
  assert.equal(state.settings.unsavedChangesCount, countBeforeMerge + 1);
  assert.equal(state.settings.lastBackupDate, '2020-01-01');
  await persisted(s => assert.equal(s.settings.unsavedChangesCount, countBeforeMerge + 1));
  assert.ok((await restore(backup())).ok);
  assert.equal(state.settings.unsavedChangesCount, countBeforeMerge + 1);

  const firstProduct = make('same-product-1', 1, '袋', { category: 'dry', name: '同款' });
  const secondProduct = make('same-product-2', 1, '袋', { category: 'dry', name: '同款' });
  reset(firstProduct, secondProduct, make('other-brand-supply', 1, '袋', { category: 'supplies', brand: '日用品品牌' }));
  assert.match(el('pantryStockSummary').textContent, /口粮 1款 · 1个品牌/);

  const staleOpen = make('stale-open', 1, '罐', {
    expDate: utils.shiftDaysFromToday(200), isOpened: true,
    openedDate: utils.shiftDaysFromToday(-10), openDaysLimit: 3
  });
  reset(staleOpen);
  assert.match(el('feedingTaskList').textContent, /已过期.*过期7天/);
  el('feedingTaskList').querySelector('[data-discard-item="stale-open"]').click();
  assert.match(el('confirmMessage').textContent, /丢弃.*不记录喂食/);
  el('confirmCancelBtn').click();
  assert.equal(staleOpen.quantity, 1);

  state.statsScopeFilter = 'med';
  ui.renderAll();
  assert.ok(el('priorityFeedList').parentElement.classList.contains('hidden-view'));
  state.statsScopeFilter = 'food';
  ui.renderAll();
  assert.ok(!el('priorityFeedList').parentElement.classList.contains('hidden-view'));
  state.statsScopeFilter = 'supp';
  ui.renderAll();
  assert.doesNotMatch(el('priorityFeedList').textContent, /stale-open/);
  state.statsScopeFilter = 'all';

  const sampleForecast = make('sample-forecast', 2, '罐', { isSample: true, unit_net_weight_g: 100 });
  reset(sampleForecast);
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--can').textContent, /示例库存未计入预测/);
  assert.equal(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-days'), null);
  assert.equal(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-quantity').textContent, '—');

  const openedMix = mixed();
  openedMix.flavors[0].openedDate = today;
  openedMix.flavors[0].openRemainFraction = 0.5;
  reset(openedMix);
  let exportedCsv = '';
  storage.triggerFileDownload = (_name, content) => { exportedCsv = content; return true; };
  storage.exportItemsCsv();
  storage.triggerFileDownload = originalDownload;
  assert.match(exportedCsv, /已开封/);
  assert.match(exportedCsv, new RegExp('鸡：' + today));
  assert.match(exportedCsv, /鸡：余1\/2杯/);

  const wholeOpened = make('whole-open-rollback', 1, '罐');
  reset(wholeOpened);
  feed(wholeOpened, '1罐');
  el('confirmOkBtn').click();
  assert.equal(wholeOpened.quantity, 0);
  undo(state.logs[0]);
  assert.equal(wholeOpened.quantity, 1);
  assert.equal(wholeOpened.isOpened, false);
  await settle();
  await persisted(s => { assert.equal(s.items[0].quantity, 1); assert.equal(s.items[0].isOpened, false); });

  reset(make('older-snapshot', 1));
  assert.ok(await new Promise(resolve => storage.savePreRestoreSnapshot(resolve)));
  const snapshotKey = w.MeowPantry.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT;
  const newer = JSON.parse(w.localStorage.getItem(snapshotKey));
  newer.savedAtMs += 1000;
  newer.items = [make('newer-snapshot', 2)];
  w.localStorage.setItem(snapshotKey, JSON.stringify(newer));
  assert.ok(await new Promise(resolve => storage.restorePreRestoreSnapshot(resolve)));
  assert.equal(state.items[0].id, 'newer-snapshot');

  const analysisBatch = make('analysis-batch-a', 3, '杯', {
    name: '混合餐', unit_net_weight_g: 50, expDate: utils.shiftDaysFromToday(40),
    openDaysLimit: 3, batchCode: '批号A', purchasePackaging: { count: 1, outerUnit: '盒', size: 3 },
    flavors: [
      { id: 'chicken', name: '草莓鸡', perPack: 2, quantity: 2, palatability: 'love',
        openedDate: utils.shiftDaysFromToday(-4), openRemainFraction: 0.5 },
      { id: 'rabbit', name: '蓝莓兔', perPack: 1, quantity: 1, palatability: 'meh' }
    ]
  });
  const analysisBatchB = make('analysis-batch-b', 3, '杯', {
    name: '混合餐', unit_net_weight_g: 50, expDate: utils.shiftDaysFromToday(100),
    batchCode: '批号B', purchasePackaging: { count: 1, outerUnit: '盒', size: 3 },
    flavors: [
      { id: 'chicken', name: '草莓鸡', perPack: 2, quantity: 2, palatability: 'meh' },
      { id: 'rabbit', name: '蓝莓兔', perPack: 1, quantity: 1, palatability: 'ok' }
    ]
  });
  state.catFilter = 'all';
  state.brandFilter = 'all';
  state.pantryHealthFilter = '';
  state.pantryDisplayMode = 'card';
  state.statsScopeFilter = 'all';
  state.statsTierTab = 'all';
  state.settings.warnDays = 60;
  reset(analysisBatch, analysisBatchB);
  assert.deepEqual(readSummary()[1], ['1', '共 2件', false]);
  assert.deepEqual(readSummary()[2], ['1', '共 1件', false]);
  el('statCardExpiring').click();
  assert.ok(el('pantryList').querySelector('[data-id="analysis-batch-a"]'));
  state.statusFilter = 'in_stock';
  state.searchQuery = '草莓鸡';
  ui.renderPantryList();
  assert.ok(el('pantryList').querySelector('[data-id="analysis-batch-a"]'));
  state.searchQuery = '';
  ui.renderAll();
  const expiredRow = Array.from(el('feedingTaskList').children).find(row =>
    row.textContent.includes('草莓鸡') && row.textContent.includes('已过期'));
  assert.match(expiredRow.textContent, /已过期.*草莓鸡.*1杯/);
  const safeRow = Array.from(el('priorityFeedList').children).find(row => row.textContent.includes('草莓鸡'));
  assert.match(safeRow.textContent, /未拆封.*先处理过期开封件.*余 1杯/);
  assert.ok(safeRow.querySelector('[data-discard-item="analysis-batch-a"]'));
  assert.doesNotMatch(safeRow.textContent, /记喂食/);
  const quickButtons = Array.from(el('dailyQuickFeedBox').querySelectorAll('[data-quick-feed-item]'));
  assert.equal(quickButtons.length, 2);
  assert.match(quickButtons.find(button => button.dataset.quickFeedItem === analysisBatch.id).textContent, /批次.*含过期开封件/);
  assert.notEqual(quickButtons[0].textContent, quickButtons[1].textContent);
  quickButtons.find(button => button.dataset.quickFeedItem === analysisBatch.id).click();
  assert.match(el('feedFlavorSelect').options[1].textContent, /开封已过期，请先处理/);
  assert.doesNotMatch(el('feedFlavorSelect').options[2].textContent, /过期/);
  ui.closeFeedModal();

  const records = w.MeowPantry.Stats.ratingRecords(state.items);
  assert.equal(records.length, 4);
  assert.equal(el('tierTotalEvaluatedBadge').textContent, '已评 4条');
  state.statsTierTab = 'meh';
  w.MeowPantry.Stats.renderStatsView();
  assert.equal(el('palTierCardsList').children.length, 2);
  assert.match(el('palTierCardsList').textContent, /草莓鸡/);
  assert.match(el('palTierCardsList').textContent, /蓝莓兔/);
  assert.match(el('palTierCardsList').textContent, /批号A/);
  assert.match(el('palTierCardsList').textContent, /批号B/);
  assert.equal(el('palTierCardsList').querySelectorAll('.palatability-label').length, 2);
  const shadowRating = make('analysis-shadow', 0, '杯', {
    name: '混合餐', unit_net_weight_g: 50, sourceBatchId: analysisBatch.id,
    palatability: 'love'
  });
  assert.equal(w.MeowPantry.Stats.ratingRecords([analysisBatch, analysisBatchB, shadowRating]).length, 4);

  state.pantryDisplayMode = 'compact';
  ui.renderPantryList();
  const compactMixed = el('pantryList').querySelector('[data-id="analysis-batch-a"] .compact-palatability');
  assert.equal(compactMixed.textContent, '😍😣');
  compactMixed.click();
  assert.match(compactMixed.nextElementSibling.textContent, /草莓鸡 😍 超爱吃/);
  assert.match(compactMixed.nextElementSibling.textContent, /蓝莓兔 😣 不爱吃/);
  storage.triggerFileDownload = (_name, content) => { exportedCsv = content; return true; };
  storage.exportItemsCsv();
  storage.triggerFileDownload = originalDownload;
  assert.match(exportedCsv, /"50g"/);
  assert.match(exportedCsv, /草莓鸡：超爱吃；蓝莓兔：不爱吃/);
  assert.match(exportedCsv, /草莓鸡：2杯；蓝莓兔：1杯/);

  const staleTimeline = make('timeline-stale', 1, '罐', {
    name: '过期开封', expDate: utils.shiftDaysFromToday(20),
    isOpened: true, openedDate: utils.shiftDaysFromToday(-5), openDaysLimit: 2
  });
  const freshTimeline = make('timeline-fresh', 1, '罐', {
    name: '有效库存', expDate: utils.shiftDaysFromToday(40), unit_net_weight_g: 100
  });
  reset(staleTimeline, freshTimeline);
  assert.match(el('expiryMonthTimelineList').querySelector('.feeding-timeline-nearest').textContent, /有效库存/);
  assert.doesNotMatch(el('expiryMonthTimelineList').textContent, /过期开封/);
  const missingWeight = make('missing-weight', 1, '罐', { unit_net_weight_g: null });
  reset(missingWeight);
  assert.equal(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-quantity').textContent, '待补填');
  reset(missingWeight, freshTimeline);
  assert.match(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-quantity').textContent, /100克（已换算）/);
  state.brandScopeFilter = 'supplies';
  reset(supply, freshTimeline);
  assert.match(el('brandStatsList').textContent, /喵洁/);
  assert.doesNotMatch(el('brandStatsList').textContent, /测试牌/);
  console.log('Cross-page inventory and rating consistency pass');

  state.statsScopeFilter = 'all';
  state.brandScopeFilter = 'all';
  const expiredFlavor = make('discard-mixed', 4, '杯', {
    unit_net_weight_g: 50, openDaysLimit: 2,
    purchasePackaging: { count: 1, outerUnit: '盒', size: 4 },
    flavors: [
      { id: 'old', name: '旧口味', perPack: 3, quantity: 3, openedDate: utils.shiftDaysFromToday(-5), openRemainFraction: 0.5 },
      { id: 'fresh', name: '新口味', perPack: 1, quantity: 1, openedDate: today, openRemainFraction: 0.5 }
    ]
  });
  reset(expiredFlavor);
  assert.match(el('dailyQuickFeedBox').textContent, /快捷投喂/);
  const forecastBeforeDiscard = w.MeowPantry.Forecast.compute(state.items, state.stockHistory, state.settings.dailyFeedGrams, today).can;
  el('priorityFeedList').querySelector('[data-discard-item="discard-mixed"]').click();
  assert.match(el('confirmMessage').textContent, /旧口味.*已开封/);
  assert.equal(el('confirmDiscardQuantity').readOnly, true);
  el('confirmOkBtn').click();
  await settle();
  assert.equal(expiredFlavor.quantity, 3);
  assert.equal(expiredFlavor.flavors[0].quantity, 2);
  assert.equal(expiredFlavor.flavors[0].openedDate, '');
  assert.equal(expiredFlavor.flavors[1].openedDate, today);
  assert.equal(expiredFlavor.flavors[1].openRemainFraction, 0.5);
  assert.equal(expiredFlavor.discardedCount, 1);
  assert.equal(state.logs.length, 0);
  assert.equal(state.stockHistory[0].action, 'discard');
  assert.equal(state.stockHistory[0].note, '过期丢弃 · 口味：旧口味 · 已开封');
  const forecastAfterDiscard = w.MeowPantry.Forecast.compute(state.items, state.stockHistory, state.settings.dailyFeedGrams, today).can;
  assert.equal(forecastAfterDiscard.dailyGrams, forecastBeforeDiscard.dailyGrams);
  assert.equal(forecastAfterDiscard.grams, forecastBeforeDiscard.grams);
  assert.equal(byId('empty_discard-mixed').discardedCount, 1);
  await persisted(s => {
    assert.equal(s.items.find(row => row.id === 'discard-mixed').discardedCount, 1);
    assert.equal(s.stockHistory[0].action, 'discard');
    assert.equal(s.logs.length, 0);
  });
  const discardedBackup = backup();
  assert.equal(discardedBackup.items.find(row => row.id === 'discard-mixed').discardedCount, 1);
  assert.equal(discardedBackup.stockHistory[0].action, 'discard');
  assert.ok((await restore(discardedBackup)).ok);

  const expiredSealed = make('discard-sealed', 5, '罐', {
    expDate: yesterday, isOpened: true, openedDate: today, openRemainFraction: 0.5
  });
  reset(expiredSealed);
  const sealedButton = el('feedingTaskList').querySelector('[data-discard-item="discard-sealed"][data-discard-opened="false"]');
  assert.ok(sealedButton);
  sealedButton.click();
  el('confirmDiscardQuantity').value = '3';
  el('confirmOkBtn').click();
  await settle();
  assert.equal(expiredSealed.quantity, 2);
  assert.equal(expiredSealed.isOpened, true);
  assert.equal(expiredSealed.openedDate, today);
  assert.equal(expiredSealed.openRemainFraction, 0.5);
  assert.equal(state.logs.length, 0);
  assert.equal(state.stockHistory[0].action, 'discard');
  assert.match(el('pantryList').textContent, /核销/);
  ui.openEditModal(expiredSealed.id);
  set('fieldNotes', '保留丢弃记录');
  el('itemForm').requestSubmit();
  await settle();
  assert.equal(byId('discard-sealed').discardedCount, 3);
  assert.equal(byId('empty_discard-sealed').discardedCount, 3);

  const sharedDiscard = make('discard-shared', 3, '杯', {
    isOpened: true, openedDate: utils.shiftDaysFromToday(-5), openDaysLimit: 2,
    purchasePackaging: { count: 1, outerUnit: '盒', size: 3, seal: 'shared' },
    flavors: [
      { id: 'shared-a', name: '甲', perPack: 2, quantity: 2 },
      { id: 'shared-b', name: '乙', perPack: 1, quantity: 1 }
    ]
  });
  reset(sharedDiscard);
  assert.equal(el('feedingTaskList').querySelectorAll('[data-discard-item="discard-shared"]').length, 1);
  el('feedingTaskList').querySelector('[data-discard-item="discard-shared"]').click();
  assert.match(el('confirmMessage').textContent, /整盒丢弃.*甲 2杯、乙 1杯/);
  assert.equal(el('confirmDiscardQuantity').readOnly, true);
  el('confirmOkBtn').click();
  await settle();
  assert.equal(sharedDiscard.quantity, 0);
  assert.deepEqual(Array.from(sharedDiscard.flavors, flavor => flavor.quantity), [0, 0]);
  assert.equal(state.logs.length, 0);
  assert.equal(state.stockHistory[0].action, 'discard');
  assert.equal(w.MeowPantry.Stats.computeOverviewMetrics(state.items, state.logs).catStats.can.durationByUnit['杯'], undefined);

  const unopenedDiscard = make('discard-unopened', 1, '罐', { expDate: yesterday });
  reset(unopenedDiscard);
  assert.equal(domain.discardExpiredStock(unopenedDiscard, '', false, 1, today).quantity, 1);
  assert.equal(unopenedDiscard.openedDate, '');
  assert.equal(unopenedDiscard.archivedOpenedDate, '');

  const changedDiscard = make('discard-changed', 2, '罐', { expDate: yesterday });
  reset(changedDiscard);
  el('feedingTaskList').querySelector('[data-discard-item="discard-changed"]').click();
  changedDiscard.quantity = 1;
  el('confirmOkBtn').click();
  assert.equal(changedDiscard.quantity, 1);
  assert.equal(state.stockHistory.length, 0);
  assert.match(el('toastEl').textContent, /库存已变化/);
  assert.ok(domain.discardExpiredStock(changedDiscard, '', false, 1, utils.shiftDaysFromToday(-10)).error);

  const imported = make('restore-imported', 1);
  reset(imported);
  const importContent = JSON.stringify(backup());
  const existing = make('restore-existing', 1);
  reset(existing);
  assert.ok(await save());
  async function chooseBackup() {
    const input = el('importJsonInput');
    Object.defineProperty(input, 'files', { configurable: true, value: [new w.File([importContent], 'backup.json', { type: 'application/json' })] });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settle();
    assert.ok(!el('confirmRestoreModeWrap').classList.contains('hidden-view'));
  }
  await chooseBackup();
  el('confirmCancelBtn').click();
  assert.ok(byId('restore-existing'));
  assert.equal(byId('restore-imported'), undefined);
  await chooseBackup();
  assert.ok(w.document.querySelector('[name="confirmRestoreMode"][value="merge"]').checked);
  el('confirmOkBtn').click();
  await settle();
  assert.ok(byId('restore-existing'));
  assert.ok(byId('restore-imported'));
  reset(existing);
  assert.ok(await save());
  await chooseBackup();
  w.document.querySelector('[name="confirmRestoreMode"][value="replace"]').checked = true;
  el('confirmOkBtn').click();
  await settle();
  assert.equal(byId('restore-existing'), undefined);
  assert.ok(byId('restore-imported'));
  assert.ok(await new Promise(resolve => storage.restorePreRestoreSnapshot(resolve)));
  assert.ok(byId('restore-existing'));
  console.log('Expired discard and explicit backup restore pass');
  console.log('Stock consistency suite complete');
  w.close();
}

run().catch(error => { console.error(error); process.exit(1); });
