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

console.log('Utility date, escaping, and backup validation pass');
