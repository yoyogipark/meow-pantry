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
    state.dailyViewMode = 'day';
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
      ['8', '共 19 件', false], [String(batches), '共 ' + pieces + ' 件', false],
      ['2', '共 2 件', false], ['3', '共 9 件', false]
    ]);
  }
  assert.deepEqual(json(state.items), fixturesBeforeRender);
  el('statCardExpiring').click();
  assert.equal(state.statusFilter, 'expiring');
  assert.equal(readSummary()[1][1], '共 15 件');
  reset(soon, make('legacy-archive', 0, '罐'));
  assert.deepEqual(readSummary()[2], ['0', '共 0 件', true]);
  assert.deepEqual(readSummary()[3], ['1', '件数未明', false]);
  reset(archive, make('conflict', 0, '罐', { sourceBatchId: archive.id, consumedCount: 5 }));
  assert.equal(readSummary()[3][1], '件数未明');
  reset(make('shared-archive', 0, '杯', {
    consumedCount: 3, purchasePackaging: { count: 1, outerUnit: '盒', size: 4, seal: 'shared' }
  }));
  assert.equal(readSummary()[3][1], '件数未明');
  reset(make('weight-archive', 0, 'g', { consumedCount: 150 }));
  assert.deepEqual(readSummary()[3], ['1', '共 0 件', false]);
  reset();
  assert.deepEqual(readSummary(), Array.from({ length: 4 }, () => ['0', '共 0 件', true]));
  await settle();
  console.log('Summary cards pass');

  const details = el('stockQuantityDetails');
  const detailCard = unit => details.querySelector('[data-stock-unit="' + unit + '"]');
  const assertDetail = (unit, quantity, labels) => {
    const card = detailCard(unit);
    assert.equal(card.querySelector('.stock-detail-amount').textContent, quantity + ' ' + unit);
    assert.deepEqual(Array.from(card.querySelectorAll('.stock-detail-statuses > *'), node => node.textContent), labels);
  };
  const assertPieceTotalsMatchDetails = () => {
    for (const [id, status] of [['countExpiringPieces', 'expiring'], ['countExpiredPieces', 'expired']]) {
      const tags = details.querySelectorAll('.stock-detail-status--' + status);
      const total = Array.from(tags).reduce((sum, tag) => sum + Number(tag.textContent.split(' ')[1]), 0);
      assert.equal(el(id).textContent, '共 ' + total + ' 件');
    }
  };
  assert.equal(el('stockDetailsBtn').getAttribute('aria-controls'), 'stockQuantityDetails');
  assert.equal(el('stockDetailsBtn').getAttribute('aria-expanded'), 'false');
  assert.ok(details.classList.contains('hidden-view'));
  assert.equal(details.querySelector('.stock-detail-heading > span').textContent, '共 0 件');
  assert.match(details.textContent, /目前没有在库数量/);
  el('stockDetailsBtn').click();
  assert.equal(el('stockDetailsBtn').getAttribute('aria-expanded'), 'true');
  assert.ok(!details.classList.contains('hidden-view'));

  const screenshotCans = make('three-cans', 3, '罐', {
    isOpened: true, openedDate: today, openDaysLimit: 1, openRemainFraction: 0.25
  });
  const screenshotBag = make('soon-single-bag', 1, '袋', { expDate: today });
  const freshBag = make('fresh-single-bag', 1, '袋');
  reset(screenshotCans, screenshotBag, freshBag);
  assertDetail('罐', 3, ['开封 1', '临期 1']);
  assertDetail('袋', 2, ['临期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 2 件', false]);
  assertPieceTotalsMatchDetails();

  const eight = make('eight', 8, '罐');
  const twoBags = make('soon-bags', 2, '袋', { expDate: today });
  reset(eight, twoBags);
  assertDetail('罐', 8, []);
  assert.equal(detailCard('罐').querySelector('.stock-detail-statuses'), null);
  assertDetail('袋', 2, ['临期 2']);
  assert.match(details.querySelector('.stock-detail-caption').textContent, /件数含已开封包装 · 临期按实际包装计数/);
  Object.assign(eight, { isOpened: true, openedDate: today, openDaysLimit: 11, openRemainFraction: 0.25 });
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1']);
  assert.ok(detailCard('罐').classList.contains('stock-detail-card--opened'));
  eight.openDaysLimit = 2;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 1']);
  assert.deepEqual(readSummary()[1], ['2', '共 3 件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = today;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 8']);
  assert.deepEqual(readSummary()[1], ['2', '共 10 件', false]);
  assertPieceTotalsMatchDetails();
  eight.openedDate = utils.shiftDaysFromToday(-3);
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '临期 7', '过期 1']);
  assert.deepEqual(readSummary()[1], ['1', '共 9 件', false]);
  assert.deepEqual(readSummary()[2], ['1', '共 1 件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = '2099-01-01';
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '过期 1']);
  assert.deepEqual(readSummary()[2], ['1', '共 1 件', false]);
  assertPieceTotalsMatchDetails();
  eight.expDate = yesterday;
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '过期 8']);
  eight.expDate = '2099-01-01';
  eight.openedDate = '';
  ui.renderStatusCounts();
  assertDetail('罐', 8, ['开封 1', '效期待确认 1']);

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
  assert.deepEqual(readSummary()[1], ['1', '共 2 件', false]);
  assert.deepEqual(readSummary()[2], ['2', '共 1 件', false]);
  assertPieceTotalsMatchDetails();
  assert.match(details.querySelector('.stock-detail-other').textContent, /3 杯 · 200 g（不计入总件数）/);
  assert.equal(details.querySelector('.stock-detail-heading > span').textContent, el('countStockPieces').textContent);
  const currentDetails = details.innerHTML;
  state.catFilter = 'med';
  state.brandFilter = '不存在的品牌';
  state.searchQuery = '不存在的商品';
  state.pantryPage = 2;
  ui.renderAll();
  assert.equal(details.innerHTML, currentDetails);
  el('stockDetailsBtn').click();
  assert.equal(el('stockDetailsBtn').getAttribute('aria-expanded'), 'false');
  assert.ok(details.classList.contains('hidden-view'));
  console.log('Stock detail cards pass');

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
    assert.equal(bar.querySelector('.detail-card-open-progress-label > span').textContent, '共 ' + limit + ' 天');
    assert.ok(bar.classList.contains('detail-card-open-progress--' + tone));
    assert.equal(bar.querySelector('.progress-bar').style.width, width);
  };
  checkProgress(openedCardItem.id, '开封保鲜剩 1 天', 'urgent', '25%');
  checkProgress(multiCardItem.id, '开封保鲜剩 1 天', 'urgent', '25%');
  assert.equal(card(multiCardItem.id).querySelectorAll('.detail-card-open-progress').length, 1);
  checkProgress(twoDayItem.id, '开封保鲜剩 2 天', 'urgent', '100%', 2);
  assert.ok(card(twoDayItem.id).querySelector('.detail-card-open-badge--urgent'));
  assert.ok(card(twoDayItem.id).querySelector('.detail-card-open-stock--urgent'));
  assert.ok(progress(defaultLimitItem.id));
  checkProgress(longLimitItem.id, '开封保鲜剩 45 天', 'fresh', '100%', 45);
  for (const entry of [unopenedCardItem, missingLimitItem]) assert.equal(progress(entry.id), null);
  assert.ok(card(missingLimitItem.id).querySelector('.detail-card-open-badge'));
  twoDayItem.openedDate = utils.shiftDaysFromToday(-1);
  ui.renderPantryList();
  checkProgress(twoDayItem.id, '开封保鲜剩 1 天', 'urgent', '50%', 2);
  const activeCard = card(openedCardItem.id);
  const banner = activeCard.querySelector('.detail-card-open-stock');
  const summary = banner.firstElementChild;
  assert.ok(summary.matches('.detail-card-open-summary'));
  assert.equal(summary.querySelector('.detail-card-stock-text').textContent, '未开封 2 罐 + 开封余 1/4 罐');
  assert.equal(summary.querySelector('.detail-card-used').textContent, '已用 1 罐');
  assert.equal(summary.lastElementChild.textContent, '开封 ' + openedCardItem.openedDate);
  assert.equal(summary.nextElementSibling, progress(openedCardItem.id));
  assert.deepEqual(Array.from(progress(openedCardItem.id).children, child => child.className),
    ['detail-card-open-progress-label', 'progress-track']);
  for (const opened of [openedCardItem, multiCardItem, sharedDetail]) {
    const actions = card(opened.id).querySelector('.detail-card-actions');
    assert.equal(actions.children.length, 1);
    assert.deepEqual(Array.from(actions.querySelectorAll('button'), button => button.dataset.action), ['item-history', 'log-feed']);
  }
  assert.equal(card(multiCardItem.id).querySelector('.detail-card-open-summary .detail-card-stock-text').textContent, '已开封 2 杯');
  assert.equal(card(sharedDetail.id).querySelector('.detail-card-open-summary .detail-card-stock-text').textContent, '在库 3 杯 · 共用包装已开封');
  const unopenedCard = card(unopenedCardItem.id);
  assert.equal(unopenedCard.querySelector('.detail-card-open-stock'), null);
  assert.equal(unopenedCard.querySelector('.detail-card-unopened-stock .detail-card-stock-text').textContent, '在库 2 杯');
  assert.equal(unopenedCard.querySelector('.detail-card-unopened-stock .detail-card-used').textContent, '已用 2 杯');
  const checkOpenedStock = (item, expected) => {
    const row = card(item.id).querySelector('.detail-card-open-summary');
    assert.equal(row.querySelector('.detail-card-stock-text').textContent, expected);
    assert.equal(row.querySelector('.detail-card-open-date').textContent, '开封 ' + item.openedDate);
  };
  checkOpenedStock(salmonFins, '已开封 1 袋');
  checkOpenedStock(partlyUsedCan, '开封余 1/4 罐');
  checkOpenedStock(twoDayItem, '未开封 2 罐 + 开封余 3/4 罐');
  salmonFins.quantity = 3;
  ui.renderPantryList();
  checkOpenedStock(salmonFins, '未开封 2 袋 + 已开封 1 袋');
  assert.equal(activeCard.querySelector('.detail-card-shelf .detail-card-line').textContent, '有效期剩余 50%');
  assert.equal(unopenedCard.querySelector('.detail-card-shelf .detail-card-line').textContent, '有效期剩余 100%');
  const shelfBefore = activeCard.querySelector('.detail-card-shelf').outerHTML;
  for (const [elapsed, label, tone, width] of [
    [0, '开封保鲜剩 4 天', 'warning', '100%'],
    [1, '开封保鲜剩 3 天', 'warning', '75%'],
    [2, '开封保鲜剩 2 天', 'urgent', '50%'],
    [4, '开封保鲜剩 0 天', 'urgent', '0%'],
    [5, '已超保鲜期', 'expired', '0%']
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

  const keys = w.MeowPantry.STORAGE_KEYS;
  const originalSetItem = w.Storage.prototype.setItem;
  const photo = 'data:image/jpeg;base64,AAAA';
  reset(make('quota-test', 2, '杯', { imageData: photo }));
  w.Storage.prototype.setItem = function (key, value) {
    if (key === keys.ITEMS && JSON.parse(value).some(row => row.imageData)) {
      throw new w.DOMException('Simulated quota', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  };
  try {
    assert.equal(await save(), true);
    assert.equal(JSON.parse(w.localStorage.getItem(keys.SETTINGS)).lsSlimMode, true);
    assert.equal(JSON.parse(w.localStorage.getItem(keys.ITEMS))[0].imageData, undefined);
    await persisted(s => assert.equal(s.items.find(row => row.id === 'quota-test').imageData, photo));

    storage.openIDB = callback => callback(null);
    assert.equal(await save(), false, 'Photo-stripped fallback is not a complete save');
    assert.match(el('storageWriteWarning').textContent, /本地保存未完成/);

    w.Storage.prototype.setItem = originalSetItem;
    assert.equal(await save(), true, 'Full LocalStorage save works without IndexedDB');
    assert.equal(el('storageWriteWarning').textContent, '');

    w.Storage.prototype.setItem = function () {
      throw new w.DOMException('Simulated unavailable storage', 'QuotaExceededError');
    };
    assert.equal(await save(), false, 'Both storage engines failed');
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
  w.close();
}

run().catch(error => { console.error(error); process.exit(1); });
