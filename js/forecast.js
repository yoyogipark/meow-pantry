/* Inventory forecasts in grams. No DOM, storage, or implicit current date. */
(function (global) {
  'use strict';
  var MP = global.MeowPantry;
  var Utils = MP.Utils;
  var Forecast = MP.Forecast = {};
  var categories = ['dry', 'freeze', 'can'];

  Forecast.RESTOCK_DAYS = 7;

  Forecast.unitGrams = function (item) {
    return positive(item.unit_net_weight_g);
  };

  function positive(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  Forecast.batchStock = function (item, today) {
    if (!item || item.isSample || !categories.includes(item.category) || !positive(item.quantity) ||
        Utils.diffDaysFromToday(item.expDate, today) < 0) return null;
    var shared = item.purchasePackaging && item.purchasePackaging.seal === 'shared';
    var openingExpired = item.isOpened &&
      Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, today) < 0;
    if (shared && openingExpired) return null;
    var alreadyUsed = 0;
    var estimated = false;
    var openedPackages = [];
    function accountForOpenPackage(fraction, openedDate) {
      if (fraction > 0 && fraction < 1) alreadyUsed += 1 - fraction;
      else estimated = true;
      openedPackages.push({
        units: fraction > 0 && fraction < 1 ? fraction : 1,
        days: Utils.openShelfDaysRemaining(openedDate, item.openDaysLimit, today)
      });
    }
    if (item.flavors && item.flavors.length) {
      item.flavors.forEach(function (flavor) {
        if (flavor.quantity <= 0 || !flavor.openedDate) return;
        if (!shared && Utils.openShelfDaysRemaining(flavor.openedDate, item.openDaysLimit, today) < 0) {
          alreadyUsed += 1;
        } else {
          accountForOpenPackage(flavor.openRemainFraction, flavor.openedDate);
        }
      });
      if (item.isOpened && !item.flavors.some(function (flavor) {
        return flavor.quantity > 0 && flavor.openedDate;
      })) estimated = true;
    } else if (openingExpired) {
      alreadyUsed += 1;
    } else if (item.isOpened) {
      accountForOpenPackage(item.openRemainFraction, item.openedDate);
    }
    var edible = positive(item.quantity) - alreadyUsed;
    if (edible <= 0) return null;
    var weight = Forecast.unitGrams(item);
    if (shared && item.isOpened) {
      // A shared seal starts one freshness window for every remaining unit, recorded on the batch.
      var sharedDays = Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, today);
      openedPackages = sharedDays === null ? [] : [{ units: edible, days: sharedDays }];
    }
    var remainingUnits = edible;
    return {
      grams: weight ? edible * weight : null, estimated: estimated,
      openedPackages: weight ? openedPackages.filter(function (entry) { return entry.days !== null; })
        .map(function (entry) {
          var units = Math.min(entry.units, remainingUnits);
          remainingUnits -= units;
          return { grams: units * weight, days: entry.days };
        }).filter(function (entry) { return entry.grams > 0; }) : []
    };
  };

  Forecast.expiryRisk = function (item, dailyGrams, today) {
    var stock = Forecast.batchStock(item, today);
    var days = item && Utils.diffDaysFromToday(item.expDate, today);
    var rate = positive(dailyGrams);
    if (!stock || !stock.grams || !rate || days === null || days < 0) return null;
    // Opened packages are eaten first, earliest freshness deadline first, and each must be
    // finished within its own window; sealed stock then has until the printed expiry date.
    var elapsed = 0;
    var leftoverGrams = 0;
    var openedGrams = 0;
    var bindingDays = null;
    stock.openedPackages.slice().sort(function (a, b) { return a.days - b.days; }).forEach(function (entry) {
      var deadline = Math.min(days, Math.max(0, entry.days));
      var waste = Math.max(0, entry.grams - rate * Math.max(0, deadline - elapsed));
      openedGrams += entry.grams;
      if (waste > 0) {
        leftoverGrams += waste;
        if (bindingDays === null && deadline < days) bindingDays = deadline;
        elapsed = Math.max(elapsed, deadline);
      } else {
        elapsed += entry.grams / rate;
      }
    });
    leftoverGrams += Math.max(0, stock.grams - openedGrams - rate * Math.max(0, days - elapsed));
    return {
      daysRemaining: bindingDays === null ? days : bindingDays, deadline: bindingDays === null ? 'expiry' : 'opened',
      dailyGrams: rate, remainingGrams: stock.grams,
      neededDays: stock.grams / rate, leftoverGrams: leftoverGrams,
      atRisk: leftoverGrams > 0, estimated: stock.estimated
    };
  };

  Forecast.compute = function (items, history, dailyFeedGrams, today) {
    var result = {};
    categories.forEach(function (key) {
      result[key] = { grams: 0, missing: [], estimated: false, dailyGrams: 0, days: null, source: '', low: false, samples: 0, realStock: 0 };
    });
    var batches = new Map();
    items.forEach(function (item) {
      batches.set(item.id, item);
      var category = result[item.category];
      if (!category || !positive(item.quantity)) return;
      if (item.isSample) { category.samples++; return; }
      category.realStock++;
      var stock = Forecast.batchStock(item, today);
      if (!stock) return;
      if (stock.grams === null) { category.missing.push(item.id); return; }
      category.estimated = category.estimated || stock.estimated;
      category.grams += stock.grams;
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
      if (data.dailyGrams > 0 && (!data.samples || data.realStock) && (data.grams > 0 || !data.missing.length)) {
        data.days = data.grams / data.dailyGrams;
        data.low = data.days < Forecast.RESTOCK_DAYS;
      }
    });
    return result;
  };
})(typeof window !== 'undefined' ? window : globalThis);
