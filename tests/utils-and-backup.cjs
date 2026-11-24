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

const { Utils, Storage, Domain } = sandbox.MeowPantry;

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
  logs: ['🌙 晚饭', '晚饭', 'dinner', '☀ 午饭', '自定义餐次', '夜宵', 'late_night', 'snack'].map((mealSlot, i) => ({
    id: 'meal-' + i, date: '2026-11-20', mealSlot
  }))
}));
assert.equal(mealBackup.ok, true);
assert.deepEqual(Array.from(mealBackup.logs, log => log.mealSlot),
  ['dinner', 'dinner', 'dinner', 'lunch', '自定义餐次', 'late_night', 'late_night', 'snack']);
assert.equal(Utils.formatMealSlot('dinner'), '晚饭');
assert.deepEqual(Array.from(Utils.mealSlotOptions(), slot => slot.label),
  ['早上', '中午', '晚上', '夜宵', '零食加餐', '用药／护理']);
assert.equal(Utils.formatMealSlotDisplay('late_night'), '夜宵');
for (const [hour, expected] of [[0, 'late_night'], [4, 'late_night'], [5, 'breakfast'], [9, 'breakfast'],
  [10, 'lunch'], [14, 'lunch'], [15, 'dinner'], [20, 'dinner'], [21, 'late_night'], [23, 'late_night']]) {
  sandbox.Date = class extends Date { getHours() { return hour; } };
  assert.equal(Utils.getCurrentMealSlot(), expected);
}
sandbox.Date = Date;
assert.equal(Utils.formatMealSlotDisplay('🌙 晚饭'), '晚上');
assert.equal(Utils.formatMealSlotDisplay('自定义餐次'), '自定义餐次');
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

const supplyProduct = {
  category: 'supplies', brand: '品牌', name: '猫砂', unit: '袋',
  unit_spec_value: 6, unit_spec_unit: '升', spec: '无香'
};
const supplyKey = item => Domain.getProductGroupKey({ ...supplyProduct, ...item });
assert.equal(supplyKey({}), supplyKey({ unit_spec_value: 6000, unit_spec_unit: '毫升', spec: ' 无香 ' }));
assert.notEqual(supplyKey({}), supplyKey({ spec: '绿茶香' }));
assert.notEqual(supplyKey({}), supplyKey({ spec: '' }));
assert.notEqual(supplyKey({}), supplyKey({ unit_spec_value: 5, unit_spec_unit: '升' }));
assert.notEqual(supplyKey({}), supplyKey({ brand: '其他品牌' }));
assert.notEqual(supplyKey({}), supplyKey({ unit: '包' }));
assert.equal(supplyKey({ unit_spec_value: 1.25, unit_spec_unit: '千克' }),
  supplyKey({ unit_spec_value: 1250, unit_spec_unit: '克' }));
assert.equal(supplyKey({ unit_spec_value: null, unit_net_weight_g: 1250 }),
  supplyKey({ unit_spec_value: 1.25, unit_spec_unit: '千克' }));
assert.equal(supplyKey({ unit_spec_value: 0.000001, unit_spec_unit: '升' }),
  supplyKey({ unit_spec_value: 0.001, unit_spec_unit: '毫升' }));
assert.notEqual(supplyKey({ unit_spec_value: 80, unit_spec_unit: '片' }),
  supplyKey({ unit_spec_value: 80, unit_spec_unit: '张' }));
assert.notEqual(supplyKey({ unit_spec_value: 1, unit_spec_unit: '瓶' }),
  supplyKey({ unit_spec_value: 1, unit_spec_unit: '支' }));

const categoryIcons = ['dry', 'can', 'freeze', 'treat', 'supp', 'med', 'other'];
assert.equal(new Set(categoryIcons.map(key => Utils.getCategoryIcon(key))).size, categoryIcons.length);
for (const unknown of [undefined, '', 'wet-food', '罐头', 'constructor']) {
  assert.equal(Utils.getCategoryIcon(unknown), Utils.getCategoryIcon('other'));
}
assert.match(Utils.getCategoryIcon('dry', 20), /width="20" height="20".*stroke-width="2"/);
assert.match(Utils.getCategoryIcon('can'), /width="28" height="28"/);

const photoA = 'data:image/jpeg;base64,photo-a';
const photoB = 'data:image/jpeg;base64,photo-b';
for (const legacyField of ['imageData', 'image']) {
  const legacy = Storage.validateAndParseBackup(JSON.stringify([{ id: 'legacy-photo', [legacyField]: photoA }]));
  assert.equal(legacy.ok, true);
  assert.deepEqual(Array.from(legacy.items[0].images), [photoA]);
  assert.equal(legacy.items[0][legacyField], undefined);
}
const photoBackup = Storage.validateAndParseBackup(JSON.stringify({
  version: 4, items: [{ id: 'gallery', images: [photoB, photoA], imageData: photoA }]
}));
assert.equal(photoBackup.ok, true);
assert.deepEqual(Array.from(photoBackup.items[0].images), [photoB, photoA]);
assert.equal(sandbox.MeowPantry.getItemCoverSrc(photoBackup.items[0]), photoB);
assert.deepEqual(Array.from(Domain.sanitizeItem({ images: [], imageData: photoA }).images), []);
for (const images of [[photoA, null], [42], 'not-an-array', Array(7).fill(photoA)]) {
  const invalid = Storage.validateAndParseBackup(JSON.stringify({ items: [{ id: 'invalid-photos', images }] }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /照片.*最多 6 张/);
}
const sixPhotos = Array.from({ length: 6 }, (_, index) => photoA + index);
const fullGallery = Storage.validateAndParseBackup(JSON.stringify({ items: [{ id: 'six', images: sixPhotos }] }));
assert.equal(fullGallery.ok, true);
assert.deepEqual(Array.from(fullGallery.items[0].images), sixPhotos);
const archivePhoto = { imageData: photoB };
Domain.copySharedMetadataToArchive(fullGallery.items[0], archivePhoto);
assert.deepEqual(Array.from(archivePhoto.images), sixPhotos);
assert.notEqual(archivePhoto.images, fullGallery.items[0].images);
Domain.copySharedMetadataToArchive({ images: [] }, archivePhoto);
assert.deepEqual(Array.from(archivePhoto.images), []);
assert.equal(archivePhoto.imageData, undefined);

let originalWidth = 2560;
let originalHeight = 1600;
let compressedCanvas;
let jpegQuality;
sandbox.FileReader = class {
  readAsDataURL() { this.onload({ target: { result: photoA } }); }
};
sandbox.Image = class {
  set src(value) { this.width = originalWidth; this.height = originalHeight; this.onload(); }
};
sandbox.document = {
  createElement() {
    compressedCanvas = {
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toDataURL(type, quality) { assert.equal(type, 'image/jpeg'); jpegQuality = quality; return photoB; }
    };
    return compressedCanvas;
  }
};
let compressedPhoto;
Utils.compressImageFile({}, result => { compressedPhoto = result; });
assert.deepEqual([compressedCanvas.width, compressedCanvas.height, jpegQuality], [1280, 800, 0.8]);
assert.equal(compressedPhoto.dataUrl, photoB);
originalWidth = 400;
originalHeight = 800;
Utils.compressImageFile({}, () => {});
assert.deepEqual([compressedCanvas.width, compressedCanvas.height], [400, 800], 'Small photos must not be upscaled');
sandbox.document.createElement = () => ({ getContext() { throw new Error('Canvas unavailable'); } });
Utils.compressImageFile({}, result => assert.equal(result, null));

console.log('Utility date, escaping, backup validation and photo migration/compression pass');
