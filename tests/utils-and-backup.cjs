const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sandbox = { console, Date, Map, Set, JSON, Math, isFinite, parseInt, parseFloat };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['constants.js', 'utils.js', 'domain.js', 'storage.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), sandbox);
}

const { Utils, Storage } = sandbox.MeowPantry;

assert.equal(Utils.formatQuantity(1250.7, '克'), '1,251克');
assert.equal(Utils.formatQuantity(2.5, '袋'), '2.5袋');
assert.equal(Utils.formatMoney(128.5, 'CNY'), '128.50元');
assert.equal(Utils.formatMoney(4880.2, 'JPY', '袋'), '4,880円/袋');
assert.equal(Utils.formatMoney(0, 'CNY'), '');
assert.equal(Utils.formatPercent(100), '100.0%');
assert.equal(Utils.formatListDate('2026-1-2'), '2026-01-02');
assert.equal(Utils.formatSentenceDate('2026-01-02'), '1月2日');
assert.equal(Utils.formatCnDateText('2026-01-02'), '2026年1月2日');
for (const [days, label, tone] of [
  [null, '—', 'unknown'], [-1, '1天', 'expired'], [0, '0天', 'urgent'],
  [3.2, '3天', 'urgent'], [4, '4天', 'warning'], [14, '14天', 'warning'], [15, '15天', 'fresh']
]) {
  assert.equal(Utils.formatDays(days).text, label);
  assert.equal(Utils.formatDays(days).tone, tone);
}

assert.equal(Utils.normalizeDateStr('2024-2-29'), '2024-02-29');
assert.equal(Utils.normalizeDateStr('2023-02-29'), '');
assert.equal(Utils.normalizeDateStr('2026-02-31'), '');
assert.equal(Utils.addShelfLife('2024-01-31', 1, 'months'), '2024-02-29');
assert.equal(Utils.addShelfLife('2023-01-31', 1, 'months'), '2023-02-28');
assert.equal(Utils.addShelfLife('2024-02-29', 12, 'months'), '2025-02-28');
assert.equal(Utils.subtractShelfLife('2024-02-29', 1, 'months'), '2024-01-29');
assert.equal(Utils.diffDaysBetween('2024-02-28', '2024-03-01'), 2);
assert.deepEqual(Array.from(Utils.parsePortionSpec('50g/罐')).slice(1), ['50', 'g', '罐']);
assert.equal(Utils.escapeHtml(`<img src=x onerror="alert('x')">`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');

assert.match(Storage.validateAndParseBackup('').error, /为空/);
assert.match(Storage.validateAndParseBackup('{broken').error, /JSON/);
assert.match(Storage.validateAndParseBackup('{}').error, /items/);
const bomBackup = Storage.validateAndParseBackup('\uFEFF  {"version":3,"items":[]}');
assert.equal(bomBackup.ok, true);
assert.equal(bomBackup.version, 3);

const mealBackup = Storage.validateAndParseBackup(JSON.stringify({
  version: 3,
  items: [],
  logs: ['🌙 晚饭', '晚饭', 'dinner', '☀ 午饭', '自定义餐次'].map((mealSlot, i) => ({
    id: 'meal-' + i, date: '2026-11-20', mealSlot
  }))
}));
assert.equal(mealBackup.ok, true);
assert.deepEqual(Array.from(mealBackup.logs, log => log.mealSlot),
  ['dinner', 'dinner', 'dinner', 'lunch', '自定义餐次']);
assert.equal(Utils.formatMealSlot('dinner'), '晚饭');
assert.equal(Utils.formatMealSlot('自定义餐次'), '自定义餐次');

const weightBackup = Storage.validateAndParseBackup(JSON.stringify({
  version: 3,
  items: [
    { id: 'dry-weight', category: 'dry', unit: '袋', spec: '1.8kg' },
    { id: 'freeze-weight', category: 'freeze', unit: '袋', spec: '100g/袋' },
    { id: 'wet-weight', category: 'can', unit: '罐', spec: '85g' },
    { id: 'treat-weight', category: 'treat', unit: '支', spec: '独立包装', unit_net_weight_g: 15 }
  ]
}));
assert.equal(weightBackup.ok, true);
assert.deepEqual(Array.from(weightBackup.items, item => item.unit_net_weight_g), [1800, 100, null, 15]);
assert.equal(Utils.formatItemSpec(weightBackup.items[0]), '1.8kg');
assert.equal(Utils.formatItemSpec(weightBackup.items[3]), '15g · 独立包装');
assert.equal(Utils.formatPer100gPrice(36, 'CNY', 1800), '≈2.00元/100g');

const categoryIcons = ['dry', 'can', 'freeze', 'treat', 'supp', 'med', 'other'];
assert.equal(new Set(categoryIcons.map(key => Utils.getCategoryIcon(key))).size, categoryIcons.length);
for (const unknown of [undefined, '', 'wet-food', '罐头', 'constructor']) {
  assert.equal(Utils.getCategoryIcon(unknown), Utils.getCategoryIcon('other'));
}
assert.match(Utils.getCategoryIcon('dry', 20), /width="20" height="20".*stroke-width="2"/);
assert.match(Utils.getCategoryIcon('can'), /width="28" height="28"/);

console.log('Utility date, escaping, and backup validation pass');
