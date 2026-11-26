const assert = require('node:assert/strict');
require('../js/utils.js');
require('../js/forecast.js');

const { Forecast } = globalThis.MeowPantry;
const today = '2026-11-19';
const dry = { id: 'dry', category: 'dry', unit: '袋', quantity: 1, spec: '旧规格', unit_net_weight_g: 1800 };
const freeze = { id: 'freeze', category: 'freeze', unit: '袋', quantity: 2, spec: '旧规格', unit_net_weight_g: 100 };
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
const discarded = { ...history[0], action: 'discard', beforeQty: 4, afterQty: 0 };
assert.equal(Forecast.compute([wet], [discarded, ...history], defaults, today).can.dailyGrams, measured.dailyGrams);
assert.equal(Forecast.compute([wet], [discarded, ...history.slice(0, 2)], defaults, today).can.source, 'default');
assert.equal(Forecast.compute([wet], history.slice(0, 2), defaults, today).can.source, 'default');
assert.equal(Forecast.compute([wet], history.map(row => ({ ...row, date: today })), defaults, today).can.source, 'default');
const undo = { ...history[0], action: 'revert', beforeQty: 1, afterQty: 2 };
assert.equal(Forecast.compute([wet], [undo, ...history], defaults, today).can.source, 'default');

const openedWet = { ...wet, isOpened: true, openRemainFraction: 0.25 };
assert.equal(Forecast.compute([openedWet], [], defaults, today).can.grams, 62.5);
assert.equal(Forecast.compute([{ ...openedWet, openRemainFraction: 0 }], [], defaults, today).can.estimated, true);
const mixedWet = { ...wet, flavors: [{ quantity: 1, openedDate: today, openRemainFraction: 0.5 }, { quantity: 1 }] };
assert.equal(Forecast.compute([mixedWet], [], defaults, today).can.grams, 75);

const staleWet = { ...openedWet, openedDate: '2026-11-15', openDaysLimit: 2 };
assert.equal(Forecast.compute([staleWet], [], defaults, today).can.grams, 50);
assert.equal(Forecast.compute([{ ...staleWet, openedDate: '2026-11-17' }], [], defaults, today).can.grams, 62.5);
assert.equal(Forecast.compute([{ ...mixedWet, openDaysLimit: 2,
  flavors: [{ ...mixedWet.flavors[0], openedDate: staleWet.openedDate }, mixedWet.flavors[1]]
}], [], defaults, today).can.grams, 50);
const staleShared = { ...staleWet, purchasePackaging: { seal: 'shared' }, flavors: mixedWet.flavors };
const noEdible = Forecast.compute([staleShared, { ...wet, expDate: '2026-11-18' }], [], defaults, today).can;
assert.equal(noEdible.days, 0);
assert.equal(noEdible.low, true);
assert.equal(Forecast.compute([{ ...wet, expDate: today }], [], defaults, today).can.grams, 100);

const weightedHistory = [...history, { ...history[2], date: '2026-11-15' }]
  .map((row, index) => ({ ...row, id: 'consume-' + index, unitWeightGrams: 100 * (index + 1) }));
const linkedUndo = { ...undo, revertsHistoryId: 'consume-2' };
assert.equal(Forecast.compute([wet], [linkedUndo, ...weightedHistory], defaults, today).can.dailyGrams, 140);

const missing = { ...wet, id: 'missing', unit: '罐', quantity: 7, unit_net_weight_g: null, spec: '85g' };
const incomplete = Forecast.compute([wet, missing], [], defaults, today).can;
assert.equal(incomplete.grams, 100);
assert.deepEqual(incomplete.missing, ['missing']);
assert.equal(Forecast.compute([missing], [], defaults, today).can.days, null);
assert.equal(Forecast.compute([wet], [], { can: 0 }, today).can.days, null);
assert.equal(Forecast.unitGrams({ ...dry, unit_net_weight_g: null, spec: '1.8kg' }), 0);
const sampleWet = { ...wet, id: 'sample', isSample: true };
const sampleOnly = Forecast.compute([sampleWet], [], defaults, today).can;
assert.equal(sampleOnly.days, null);
assert.equal(sampleOnly.low, false);
assert.equal(sampleOnly.samples, 1);
const sampleAndReal = Forecast.compute([sampleWet, wet], [], defaults, today).can;
assert.equal(sampleAndReal.days, 4);
assert.equal(sampleAndReal.samples, 1);
const riskBatch = { ...dry, quantity: 1, unit_net_weight_g: 1900, expDate: '2026-12-03' };
const risk = Forecast.expiryRisk(riskBatch, 50, today);
assert.deepEqual(risk, {
  daysRemaining: 14, deadline: 'expiry', dailyGrams: 50, remainingGrams: 1900, neededDays: 38,
  leftoverGrams: 1200, atRisk: true, estimated: false
});
const openedRiskBatch = { ...riskBatch, isOpened: true, openedDate: '2026-11-01', openDaysLimit: 24, openRemainFraction: 0.5 };
const openDaysLeft = globalThis.MeowPantry.Utils.openShelfDaysRemaining('2026-11-01', 24, today);
assert.ok(openDaysLeft > 0 && openDaysLeft < 14);
const openedRisk = Forecast.expiryRisk(openedRiskBatch, 50, today);
assert.equal(openedRisk.deadline, 'opened');
assert.equal(openedRisk.daysRemaining, openDaysLeft);
assert.equal(openedRisk.leftoverGrams, 950 - 50 * openDaysLeft);
const mixedRisk = Forecast.expiryRisk({ ...openedRiskBatch, quantity: 3 }, 50, today);
assert.equal(mixedRisk.leftoverGrams, (950 - 50 * openDaysLeft) + (3800 - 50 * (14 - openDaysLeft)));
const openedEnough = Forecast.expiryRisk({ ...openedRiskBatch, openRemainFraction: 0.1 }, 50, today);
assert.equal(openedEnough.atRisk, false);
assert.equal(openedEnough.deadline, 'expiry');
const staggeredFlavors = Forecast.expiryRisk({
  ...dry, quantity: 2, unit_net_weight_g: 1000, openDaysLimit: 45, expDate: '2027-06-01', isOpened: true,
  flavors: [
    { id: 'old', quantity: 1, openedDate: '2026-10-15', openRemainFraction: 0.1 },
    { id: 'new', quantity: 1, openedDate: today, openRemainFraction: 0.9 }
  ]
}, 60, today);
assert.equal(staggeredFlavors.atRisk, false);
assert.equal(staggeredFlavors.deadline, 'expiry');
const sharedOpenDays = globalThis.MeowPantry.Utils.openShelfDaysRemaining('2026-11-17', 5, today);
const sharedFlavorBox = Forecast.expiryRisk({
  ...freeze, quantity: 6, unit_net_weight_g: 100, openDaysLimit: 5, expDate: '2027-06-01',
  isOpened: true, openedDate: '2026-11-17', purchasePackaging: { count: 1, outerUnit: '盒', size: 6, seal: 'shared' },
  flavors: [{ id: 'a', quantity: 3 }, { id: 'b', quantity: 3 }]
}, 20, today);
assert.equal(sharedFlavorBox.deadline, 'opened');
assert.equal(sharedFlavorBox.daysRemaining, sharedOpenDays);
assert.equal(sharedFlavorBox.leftoverGrams, 600 - 20 * sharedOpenDays);
assert.equal(Forecast.expiryRisk({ ...riskBatch, unit_net_weight_g: 700 }, 50, today).atRisk, false);
assert.equal(Forecast.expiryRisk({ ...riskBatch, expDate: today }, 50, today).leftoverGrams, 1900);
assert.equal(Forecast.expiryRisk({ ...riskBatch, expDate: '2026-11-18' }, 50, today), null);
assert.equal(Forecast.expiryRisk(riskBatch, 0, today), null);
assert.equal(Forecast.expiryRisk({ ...riskBatch, unit_net_weight_g: null }, 50, today), null);
assert.equal(Forecast.expiryRisk({ ...riskBatch, expDate: '' }, 50, today), null);
assert.equal(Forecast.expiryRisk({ ...riskBatch, category: 'supp' }, 50, today), null);
assert.equal(Forecast.expiryRisk({ ...riskBatch, isSample: true }, 50, today), null);
assert.equal(Forecast.expiryRisk({ ...riskBatch, isOpened: true, openRemainFraction: 0.5 }, 50, today).remainingGrams, 950);
assert.equal(Forecast.expiryRisk({ ...riskBatch, isOpened: true, openRemainFraction: 0 }, 50, today).estimated, true);
assert.equal(Forecast.expiryRisk({ ...staleWet, expDate: '2026-12-03' }, 50, today).remainingGrams, 50);
console.log('Feeding forecast calculations pass');
