const assert = require('node:assert/strict');
require('../js/utils.js');
require('../js/forecast.js');

const { Forecast } = globalThis.MeowPantry;
const today = '2026-11-19';
const dry = { id: 'dry', category: 'dry', unit: '袋', quantity: 1, spec: '1.8kg' };
const freeze = { id: 'freeze', category: 'freeze', unit: '袋', quantity: 2, spec: '100g' };
const wet = { id: 'wet', category: 'can', unit: '杯', quantity: 2, unit_net_weight_g: 50 };
const defaults = { dry: 60, freeze: 20, can: 25 };

assert.equal(Forecast.compute([], [], {}, today).dry.days, null);
const fallback = Forecast.compute([dry, freeze, wet], [], defaults, today);
assert.equal(fallback.dry.days, 30);
assert.equal(fallback.freeze.days, 10);
assert.equal(fallback.can.days, 4);
assert.equal(fallback.can.low, true);
assert.equal(fallback.can.source, 'default');

const history = ['2026-11-19', '2026-11-17', '2026-11-16'].map(date => ({
  date, category: 'can', unit: '杯', itemId: wet.id,
  action: 'consume', beforeQty: 2, afterQty: 1, unitWeightGrams: 100
}));
const measured = Forecast.compute([wet], history, defaults, today).can;
assert.equal(measured.dailyGrams, 75);
assert.equal(measured.source, 'actual');
assert.equal(Forecast.compute([wet], history.slice(0, 2), defaults, today).can.source, 'default');
assert.equal(Forecast.compute([wet], history.map(row => ({ ...row, date: today })), defaults, today).can.source, 'default');
const undo = { ...history[0], action: 'revert', beforeQty: 1, afterQty: 2 };
assert.equal(Forecast.compute([wet], [undo, ...history], defaults, today).can.source, 'default');

const missing = { ...wet, id: 'missing', unit: '罐', quantity: 7, unit_net_weight_g: null, spec: '85g' };
const incomplete = Forecast.compute([wet, missing], [], defaults, today).can;
assert.equal(incomplete.grams, 100);
assert.deepEqual(incomplete.missing, ['missing']);
assert.equal(Forecast.compute([missing], [], defaults, today).can.days, null);
assert.equal(Forecast.compute([wet], [], { can: 0 }, today).can.days, null);
assert.equal(Forecast.unitGrams({ ...dry, spec: '100ml' }), 0);
console.log('Feeding forecast calculations pass');
