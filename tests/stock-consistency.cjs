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
  for (const file of scripts) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  return window;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const json = value => JSON.parse(JSON.stringify(value));
const pass = number => console.log('T' + String(number).padStart(2, '0') + ' pass');

async function run() {
  const w = boot();
  await settle();
  const { Domain: domain, Utils: utils, Storage: storage, UI: ui, state } = w.MeowPantry;
  const today = utils.getTodayStr();
  const yesterday = utils.shiftDaysFromToday(-1);
  const el = id => w.document.getElementById(id);
  const set = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const make = (id, quantity, unit = '杯', extra = {}) => domain.sanitizeItem({
    id, quantity, unit, category: 'can', brand: '测试牌', name: id, expDate: '2099-01-01', ...extra
  });
  const mixed = () => make('mix', 2, '杯', {
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
    state.editMode = true;
    state.statusFilter = 'in_stock';
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
    await settle();
    check(reopened.MeowPantry.state);
    reopened.close();
  }
  function feed(item, amount, options = {}) {
    ui.openFeedModal(item.id, options.date || today);
    if (options.flavor) set('feedFlavorSelect', options.flavor);
    set('feedAmountInput', amount);
    if (options.deduct !== false) el('feedDeductStock').click();
    let preview = el('feedSplitAutoInfo').textContent;
    el('feedForm').requestSubmit();
    return preview;
  }
  function undo(log) {
    state.selectedLogDate = log.date;
    ui.renderDailyView();
    w.document.querySelector('[data-del-log="' + log.id + '"]').click();
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
    assert.match(feed(bag, amount), /更新开封余量/);
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

  item = make('wet', 1, '杯', { spec: '50g/杯' });
  reset(item);
  feed(item, '46g');
  assert.equal(item.quantity, 1);
  assert.ok(Math.abs(item.openRemainFraction * 50 - 4) < 1e-10);
  await settle();
  await persisted(s => assert.ok(Math.abs(s.items[0].openRemainFraction * 50 - 4) < 1e-10));
  pass(10);
  assert.match(feed(item, '4g'), /核销 1杯/);
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
  await settle();
  await persisted(s => { assert.equal(s.items[0].quantity, 1); assert.equal(s.logs.length, 0); });
  pass(15);

  item = mixed();
  reset(item);
  feed(item, '46g', { flavor: 'chicken' });
  assert.ok(Math.abs(item.flavors[0].openRemainFraction * 50 - 4) < 1e-10);
  assert.equal(item.flavors[1].openRemainFraction, 0);
  pass(12);
  assert.match(feed(item, '5g', { flavor: 'chicken' }), /超过/);
  assert.equal(state.logs.length, 1);
  pass(13);
  reset(bag);
  assert.match(feed(bag, '未知'), /无法换算/);
  assert.equal(bag.quantity, 2);
  assert.equal(state.logs.length, 0);
  pass(14);

  const compatible = make('cup', 2);
  const unsupported = make('grams', 100, 'g');
  reset(bag, compatible, unsupported);
  ui.openFeedModal(bag.id, today);
  assert.equal(el('feedDeductStock').checked, false);
  el('feedDeductStock').click();
  set('feedDateInput', yesterday);
  assert.equal(el('feedDeductStock').checked, false);
  pass(17);
  set('feedDateInput', today);
  el('feedDeductStock').click();
  el('feedDeductStock').click();
  set('feedStockSelect', compatible.id);
  assert.equal(el('feedDeductStock').checked, false);
  pass(18);
  el('feedDeductStock').click();
  set('feedStockSelect', unsupported.id);
  assert.equal(el('feedDeductStock').disabled, true);
  assert.equal(el('feedDeductStock').checked, false);
  pass(19);
  feed(compatible, '1杯', { date: yesterday, deduct: false });
  assert.equal(compatible.quantity, 2);
  assert.equal(state.logs[0].deductedUnit, 0);
  assert.equal(state.stockHistory.length, 0);
  await settle();
  await persisted(s => {
    assert.equal(s.items.find(row => row.id === 'cup').quantity, 2);
    assert.equal(s.logs[0].date, yesterday);
    assert.equal(s.stockHistory.length, 0);
  });
  pass(20);

  item = make('box', 2, '盒', { purchasePackaging: { count: 1, outerUnit: '盒', size: 4 } });
  reset(item);
  ui.openEditModal(item.id);
  set('correctedUnit', '杯');
  el('correctUnitBtn').click();
  el('confirmExtraCheckbox').click();
  el('confirmOkBtn').click();
  assert.equal(item.quantity, 2);
  assert.equal(item.unit, '杯');
  pass(21);
  await settle();
  await persisted(s => { assert.equal(s.items[0].unit, '杯'); assert.equal(s.items[0].quantity, 2); });
  pass(22);

  item = make('backup', 1, '杯', { spec: '50g/杯' });
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
  assert.deepEqual(readSummary()[1], ['1', '共 9件', false]);
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
  assert.deepEqual(readSummary()[1], ['1', '共 2件', false]);
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
  state.pantryPageSize = 12;
  const openedCardItem = make('opened-card', 3, '罐', {
    prodDate: utils.shiftDaysFromToday(-20), expDate: utils.shiftDaysFromToday(20),
    isOpened: true, openedDate: utils.shiftDaysFromToday(-3), openDaysLimit: 4,
    openRemainFraction: 0.25, eatenCount: 1
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
  multiCardItem.flavors[1].openedDate = utils.shiftDaysFromToday(-3);
  reset(openedCardItem, unopenedCardItem, defaultLimitItem, longLimitItem, twoDayItem, missingLimitItem, multiCardItem, sharedDetail, salmonFins, partlyUsedCan);
  const card = id => w.document.querySelector('[data-action="item-history"][data-id="' + id + '"]').closest('article');
  const progress = id => card(id).querySelector('.detail-card-open-progress');
  const checkProgress = (id, label, tone, width, limit = 4) => {
    const bar = progress(id);
    assert.equal(bar.querySelector('strong').textContent, label);
    assert.equal(bar.querySelector('.detail-card-open-progress-label > span').textContent, '共 ' + limit + '天');
    assert.ok(bar.classList.contains('detail-card-open-progress--' + tone));
    assert.equal(bar.querySelector('.progress-bar').style.width, width);
  };
  checkProgress(openedCardItem.id, '开封保鲜期剩余 1天', 'urgent', '25%');
  checkProgress(multiCardItem.id, '开封保鲜期剩余 1天', 'urgent', '25%');
  assert.equal(card(multiCardItem.id).querySelectorAll('.detail-card-open-progress').length, 1);
  checkProgress(twoDayItem.id, '开封保鲜期剩余 2天', 'urgent', '100%', 2);
  assert.ok(card(twoDayItem.id).querySelector('.detail-card-open-badge--urgent'));
  assert.ok(card(twoDayItem.id).querySelector('.detail-card-open-stock--urgent'));
  assert.ok(progress(defaultLimitItem.id));
  checkProgress(longLimitItem.id, '开封保鲜期剩余 45天', 'fresh', '100%', 45);
  for (const entry of [unopenedCardItem, missingLimitItem]) assert.equal(progress(entry.id), null);
  assert.ok(card(missingLimitItem.id).querySelector('.detail-card-open-badge'));
  twoDayItem.openedDate = utils.shiftDaysFromToday(-1);
  ui.renderPantryList();
  checkProgress(twoDayItem.id, '开封保鲜期剩余 1天', 'urgent', '50%', 2);
  const activeCard = card(openedCardItem.id);
  const banner = activeCard.querySelector('.detail-card-open-stock');
  const summary = banner.firstElementChild;
  assert.ok(summary.matches('.detail-card-open-summary'));
  assert.equal(summary.querySelector('.detail-card-stock-text').textContent, '未开封 2罐 + 开封余 1/4罐');
  assert.doesNotMatch(summary.textContent, /已用/);
  assert.equal(activeCard.querySelector('.stock-quantity-pill .stock-quantity-used').textContent, '已用 1罐');
  assert.equal(summary.lastElementChild.textContent, '开封日期 ' + openedCardItem.openedDate);
  assert.equal(summary.nextElementSibling, progress(openedCardItem.id));
  assert.deepEqual(Array.from(progress(openedCardItem.id).children, child => child.className),
    ['detail-card-open-progress-label', 'progress-track']);
  for (const opened of [openedCardItem, multiCardItem, sharedDetail]) {
    const actions = card(opened.id).querySelector('.detail-card-actions');
    assert.equal(actions.querySelector('.stock-quantity-pill').firstElementChild.textContent,
      '在库 ' + opened.quantity + opened.unit);
    assert.deepEqual(Array.from(actions.querySelectorAll('button'), button => button.dataset.action), ['item-history', 'log-feed']);
  }
  assert.equal(card(multiCardItem.id).querySelector('.detail-card-open-summary .detail-card-stock-text').textContent, '已开封 2杯');
  assert.equal(card(sharedDetail.id).querySelector('.detail-card-open-summary .detail-card-stock-text').textContent, '在库 3杯 · 共用包装已开封');
  const unopenedCard = card(unopenedCardItem.id);
  assert.equal(unopenedCard.querySelector('.detail-card-open-stock'), null);
  assert.equal(unopenedCard.querySelector('.stock-quantity-pill').firstElementChild.textContent, '在库 2杯');
  assert.equal(unopenedCard.querySelector('.stock-quantity-pill .stock-quantity-used').textContent, '已用 2杯');
  assert.equal(card(multiCardItem.id).querySelector('.stock-quantity-open').textContent, '开封 2杯');
  const checkOpenedStock = (item, expected) => {
    const row = card(item.id).querySelector('.detail-card-open-summary');
    assert.equal(row.querySelector('.detail-card-stock-text').textContent, expected);
    assert.equal(row.querySelector('.detail-card-open-date').textContent, '开封日期 ' + item.openedDate);
  };
  checkOpenedStock(salmonFins, '已开封 1袋');
  checkOpenedStock(partlyUsedCan, '开封余 1/4罐');
  checkOpenedStock(twoDayItem, '未开封 2罐 + 开封余 3/4罐');
  salmonFins.quantity = 3;
  ui.renderPantryList();
  checkOpenedStock(salmonFins, '未开封 2袋 + 已开封 1袋');
  assert.equal(activeCard.querySelector('.detail-card-shelf .detail-card-line').textContent, '保质期剩余 50.0%');
  assert.equal(unopenedCard.querySelector('.detail-card-shelf .detail-card-line').textContent, '保质期剩余 100.0%');
  const shelfBefore = activeCard.querySelector('.detail-card-shelf').outerHTML;
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
  openedCardItem.openedDate = '';
  ui.renderPantryList();
  assert.equal(progress(openedCardItem.id), null);
  assert.ok(card(openedCardItem.id).querySelector('.detail-card-open-summary .detail-card-stock-text'));
  assert.equal(card(openedCardItem.id).querySelector('.detail-card-open-date'), null);
  console.log('Opened card layout and progress pass');

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
    line => line.textContent === '拼多多 · 购入 1盒装，共4杯'));
  assert.match(packagedCard.querySelector('.flavor-stock').textContent, /剩余：草莓鸡 1 · 蓝莓兔 0/);
  assert.equal(packagedCard.querySelector('s.flavor-stock-finished').textContent, '蓝莓兔 0');

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
    assert.equal(archive.querySelector('.archive-total').textContent, '累计 2杯');
    assert.equal(archive.querySelector('.archive-footer .stock-quantity-pill').textContent, '在库 2杯 已用 2杯');
    assert.deepEqual(Array.from(archive.querySelectorAll('.archive-footer button'), button => button.textContent), ['流水', '复购入库']);
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
  assert.ok(el('stockHealthBox').classList.contains('hidden-view'));
  weighted.expDate = utils.shiftDaysFromToday(1);
  legacyWet.isOpened = true;
  legacyWet.openedDate = today;
  ui.renderAll();
  const healthJump = el('stockHealthBox').querySelector('[data-jump-health="expiring_or_opened"]');
  assert.ok(healthJump);
  assert.equal(el('feedingTasks').open, false);
  assert.equal(el('feedingTaskCount').textContent, '2项需要处理');
  assert.ok(el('categoryStatsGrid').querySelector('.forecast-tile--can .forecast-result--urgent'));
  assert.equal(el('priorityFeedList').querySelector('[data-priority-feed]').dataset.priorityFeed, 'legacy-wet');
  assert.ok(el('expiryMonthTimelineList').querySelector('.feeding-month'));
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
  el('stockHealthBox').querySelector('[data-jump-health="expiring_or_opened"]').click();
  assert.equal(state.activeTab, 'pantry');
  assert.equal(state.pantryHealthFilter, 'expiring_or_opened');
  assert.ok(el('pantryList').querySelector('[data-id="weighted"]'));
  assert.ok(el('pantryList').querySelector('[data-id="legacy-wet"]'));
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
  assert.equal(el('priceCurrencyUnit').textContent, '円');
  assert.equal(el('fieldPrice').step, '1');
  ui.syncModalCurrencyUI('CNY');
  assert.equal(el('priceCurrencyUnit').textContent, '元');
  assert.equal(el('fieldPrice').step, '0.01');
  const nearDate = utils.shiftDaysFromToday(1);
  reset(make('near-wet-a', 2, '杯', { name: '同名湿粮', spec: '50g', expDate: nearDate }),
    make('near-wet-b', 1, '杯', { name: '同名湿粮', spec: '50g', expDate: nearDate }),
    make('near-wet-c', 1, '杯', { name: '同名湿粮', spec: '85g', expDate: nearDate }),
    make('near-med', 1, '支', { category: 'med', expDate: nearDate }),
    make('fresh-med', 1, '支', { category: 'med' }));
  const verifyHealthJump = (scope, expectedIds) => {
    el('statsScopeBar').querySelector('[data-stats-scope="' + scope + '"]').click();
    el('stockHealthBox').querySelector('[data-jump-health]').click();
    assert.equal(state.activeTab, 'pantry');
    assert.equal(state.catFilter, scope);
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
      { id: 'chicken', name: '鸡', perPack: 2, quantity: 1, spec: '旧规格' },
      { id: 'fish', name: '鱼', perPack: 2, quantity: 2 }
    ]
  });
  reset(oldBundle);
  state.catFilter = 'all';
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
  set('fieldUnit', '罐');
  set('fieldSubtype', '餐盒');
  assert.equal(el('fieldUnit').value, '罐');
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
  const flavorRows = el('flavorRows').querySelectorAll('.flavor-row');
  for (const [index, name] of ['鸡', '鱼'].entries()) {
    flavorRows[index].querySelector('[data-flavor-name]').value = name;
    flavorRows[index].querySelector('[data-flavor-count]').value = '1';
  }
  ui.syncFlavorForm();
  assert.match(el('flavorSummary').textContent, /还差 2件/);
  el('saveItemBtn').click();
  assert.equal(state.items.length, 1);
  assert.equal(w.document.activeElement, el('flavorSummary'));
  flavorRows[1].querySelector('[data-flavor-count]').value = '3';
  ui.syncFlavorForm();
  assert.equal(el('flavorSummary').dataset.allocation, 'complete');
  assert.equal(el('flavorSummary').textContent, '已分配 4/4件');
  el('fieldPrice').value = '40';
  el('fieldPrice').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(el('modalUnitPriceHint').textContent, /5\.00元\/罐.*元\/100g/);
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
  ui.openRestockModal(byId(oldBundle.id));
  await settle();
  assert.equal(el('palatabilityGroup').querySelector('.active').dataset.pal, '');
  assert.equal(el('productionDatePending').classList.contains('hidden-view'), false);
  ui.closeItemModal();

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
  assert.equal(el('categoryBar').querySelector('[data-cat="can"]').textContent, '🥫 湿粮 3');
  el('statCardExpiring').click();
  assert.equal(el('categoryBar').querySelector('[data-cat="can"]').textContent, '🥫 湿粮 1');
  assert.equal(el('categoryBar').querySelector('[data-cat="dry"]').textContent, '🥣 猫粮 0');
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
    category: 'dry', prodDate: utils.shiftDaysFromToday(-6), isOpened: true,
    openedDate: yesterday, openDaysLimit: 3, palatability: 'love', location: '柜子'
  });
  reset(currentBatch, make('saved-location', 1, '袋', { location: '蓝色铁皮柜' }));
  ui.openEditModal(currentBatch.id);
  await settle();
  assert.equal(el('fieldIsOpened').getAttribute('role'), 'switch');
  assert.equal(el('fieldIsOpened').getAttribute('aria-checked'), 'true');
  assert.equal(el('openedCheckboxTitle').textContent, '已拆封 1件');
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
  assert.match(el('openedDateError').textContent, /早于生产日期/);
  el('saveItemBtn').click();
  assert.equal(byId(currentBatch.id).openedDate, yesterday);
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
  state.logs = [
    log('daily-med', { category: 'med', brand: '大宠爱', name: '外驱', amount: '1 支', nextDueDate: '2027-05-19' }),
    log('daily-food-late', { category: 'dry', name: '午后猫粮', amount: '22g', time: '14:00' }),
    log('daily-food-early', { category: 'dry', name: '上午猫粮', amount: '19g', time: '09:00' }),
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
  assert.equal(el('dailyTotals').querySelector('.daily-total-values').textContent, '41/30克 · 超11克');
  assert.equal(el('dailyTotals').querySelector('.daily-total-track .is-over').style.width, '100%');
  assert.ok(el('openAddModalBtn').classList.contains('ios-btn-secondary'));
  assert.equal(el('dailyWeekTitle').getAttribute('aria-label'), '查看全部历史记录');
  assert.ok(el('dailyWeekTitle').querySelector('svg'));
  assert.match(el('dailyFeedTimeline').textContent, /1\/4罐· 约21克/);
  assert.deepEqual(Array.from(el('dailyFeedTimeline').querySelectorAll('.daily-card-title'), node => node.textContent),
    ['上午猫粮', '午后猫粮', '零食', '测试牌 鸡肉湿粮', '大宠爱 外驱']);
  assert.match(el('dailyFeedTimeline').querySelector('.daily-reminder').textContent, /2027-05-19/);
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
  el('dailyHistoryFilters').querySelector('[data-daily-history-filter="care"]').click();
  assert.equal(el('dailyHistoryList').querySelectorAll('[data-daily-history-date]').length, 2);
  assert.match(el('dailyHistoryList').textContent, /大宠爱 外驱/);
  el('dailyHistoryList').querySelector('[data-daily-history-date="' + yesterday + '"]').click();
  assert.match(el('dailyFeedTimeline').textContent, /这天没有喂食记录/);
  el('dailyFeedTimeline').querySelector('[data-daily-add]').click();
  assert.equal(el('feedDateInput').value, yesterday);
  ui.closeFeedModal();
  state.settings.dailyFeedGrams = { dry: null, freeze: null, can: null };
  ui.renderDailyView();
  assert.match(el('dailyTotals').textContent, /设置每日喂食量，查看每日对比/);
  console.log('Daily week, portions, care and history navigation pass');

  ui.switchTab('pantry');
  assert.ok(el('openAddModalBtn').classList.contains('ios-btn-primary'));
  for (const tab of ['daily', 'stats', 'settings']) {
    ui.switchTab(tab);
    assert.ok(el('openAddModalBtn').classList.contains('ios-btn-secondary'));
    assert.ok(!el('openAddModalBtn').classList.contains('ios-btn-primary'));
  }
  state.settings.unsavedChangesCount = 0;
  state.settings.lastBackupDate = '';
  state.settings.lastJsonExportAt = '';
  ui.renderSettingsView();
  assert.ok(el('backupNoticeDot').classList.contains('hidden-view'));
  assert.equal(el('backupStatusTitle').textContent, '已是最新备份');
  assert.equal(el('backupStatusTime').textContent, '尚未备份过');
  state.settings.unsavedChangesCount = 101;
  ui.renderSettingsView();
  assert.equal(el('backupNoticeDot').textContent, '99+');
  assert.equal(el('backupStatusTitle').textContent, '101 项未备份');
  const originalDownload = storage.triggerFileDownload;
  storage.triggerFileDownload = () => false;
  el('settingsBackupNowBtn').click();
  assert.equal(state.settings.unsavedChangesCount, 101);
  assert.match(el('toastEl').textContent, /未能发起 JSON 导出/);
  storage.triggerFileDownload = () => true;
  el('settingsBackupNowBtn').click();
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


  reset(make('older-snapshot', 1));
  assert.ok(await new Promise(resolve => storage.savePreRestoreSnapshot(resolve)));
  const snapshotKey = w.MeowPantry.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT;
  const newer = JSON.parse(w.localStorage.getItem(snapshotKey));
  newer.savedAtMs += 1000;
  newer.items = [make('newer-snapshot', 2)];
  w.localStorage.setItem(snapshotKey, JSON.stringify(newer));
  assert.ok(await new Promise(resolve => storage.restorePreRestoreSnapshot(resolve)));
  assert.equal(state.items[0].id, 'newer-snapshot');
  w.close();
}

run().catch(error => { console.error(error); process.exit(1); });
