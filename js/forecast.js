/* Inventory forecasts in grams. No DOM, storage, or implicit current date. */
(function (global) {
  'use strict';
  var MP = global.MeowPantry;
  var Utils = MP.Utils;
  var Forecast = MP.Forecast = {};
  var categories = ['dry', 'freeze', 'can'];

  Forecast.RESTOCK_DAYS = 7;

  Forecast.unitGrams = function (item) {
    if (item.category === 'can') return positive(item.unit_net_weight_g);
    if (item.category !== 'dry' && item.category !== 'freeze') return 0;
    var spec = Utils.parsePortionSpec(item.spec);
    if (!spec || (spec[3] && spec[3] !== item.unit)) return 0;
    var unit = spec[2].toLowerCase();
    if (unit === 'kg' || unit === '千克') return positive(spec[1]) * 1000;
    return unit === 'g' || unit === '克' ? positive(spec[1]) : 0;
  };

  function positive(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  Forecast.compute = function (items, history, dailyFeedGrams, today) {
    var result = {};
    categories.forEach(function (key) {
      result[key] = { grams: 0, missing: [], estimated: false, dailyGrams: 0, days: null, source: '', low: false };
    });
    var batches = new Map();
    items.forEach(function (item) {
      batches.set(item.id, item);
      var category = result[item.category];
      if (!category || item.isSample || !positive(item.quantity)) return;
      if (Utils.diffDaysFromToday(item.expDate, today) < 0) return;
      var shared = item.purchasePackaging && item.purchasePackaging.seal === 'shared';
      var openingExpired = item.isOpened &&
        Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, today) < 0;
      if (shared && openingExpired) return;

      var alreadyUsed = 0;
      var estimated = false;
      function accountForOpenPackage(fraction) {
        if (fraction > 0 && fraction < 1) alreadyUsed += 1 - fraction;
        else estimated = true;
      }
      if (item.flavors && item.flavors.length) {
        item.flavors.forEach(function (flavor) {
          if (flavor.quantity <= 0 || !flavor.openedDate) return;
          if (!shared && Utils.openShelfDaysRemaining(flavor.openedDate, item.openDaysLimit, today) < 0) {
            alreadyUsed += 1;
          } else {
            accountForOpenPackage(flavor.openRemainFraction);
          }
        });
        if (item.isOpened && !item.flavors.some(function (flavor) {
          return flavor.quantity > 0 && flavor.openedDate;
        })) estimated = true;
      } else if (openingExpired) {
        alreadyUsed += 1;
      } else if (item.isOpened) {
        accountForOpenPackage(item.openRemainFraction);
      }
      var edible = positive(item.quantity) - alreadyUsed;
      if (edible <= 0) return;
      var weight = Forecast.unitGrams(item);
      if (!weight) { category.missing.push(item.id); return; }
      category.estimated = category.estimated || estimated;
      category.grams += edible * weight;
    });

    var eventsByBatch = new Map();
    history.slice().reverse().forEach(function (entry) {
      if (entry.isSample || !result[entry.category] || !entry.itemId) return;
      var events = eventsByBatch.get(entry.itemId) || [];
      if (entry.action === 'revert') {
        var restored = positive(entry.afterQty - entry.beforeQty);
        for (var i = events.length - 1; i >= 0 && restored > 0; i--) {
          if (entry.revertsHistoryId && events[i].id !== entry.revertsHistoryId) continue;
          var cancelled = Math.min(restored, events[i].quantity);
          events[i].quantity = Utils.round2(events[i].quantity - cancelled);
          restored = Utils.round2(restored - cancelled);
        }
      } else if (entry.action === 'consume') {
        var batch = batches.get(entry.itemId);
        var grams = positive(entry.unitWeightGrams) ||
          (batch && batch.category === entry.category && batch.unit === entry.unit ? Forecast.unitGrams(batch) : 0);
        var date = Utils.normalizeDateStr(entry.date);
        var quantity = positive(entry.beforeQty - entry.afterQty);
        // Keep unweighable events in sequence so returns cancel the correct units.
        if (date && date <= today && quantity) events.push({ id: entry.id, date: date, category: entry.category, grams: grams, quantity: quantity });
      }
      eventsByBatch.set(entry.itemId, events);
    });

    var consumption = { dry: [], freeze: [], can: [] };
    eventsByBatch.forEach(function (events) {
      events.forEach(function (event) {
        if (event.quantity > 0 && event.grams > 0) consumption[event.category].push(event);
      });
    });
    categories.forEach(function (key) {
      var data = result[key];
      var events = consumption[key].sort(function (a, b) { return a.date.localeCompare(b.date); });
      var span = events.length >= 3 ? Utils.diffDaysBetween(events[0].date, events[events.length - 1].date) : 0;
      data.dailyGrams = span >= 3 ? events.reduce(function (sum, event) {
        return sum + event.grams * event.quantity;
      }, 0) / (span + 1) : positive(dailyFeedGrams && dailyFeedGrams[key]);
      data.source = span >= 3 ? 'actual' : data.dailyGrams > 0 ? 'default' : '';
      if (data.dailyGrams > 0 && (data.grams > 0 || !data.missing.length)) {
        data.days = data.grams / data.dailyGrams;
        data.low = data.days < Forecast.RESTOCK_DAYS;
      }
    });
    return result;
  };
})(typeof window !== 'undefined' ? window : globalThis);
