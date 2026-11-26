/* Meow Pantry Feeding Analytics Engine (Food vs Supplement vs Medicine Separation + Drill-Down Filters) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats = {};
  var timelineExpanded = false;

  function displayEntries(item) {
    return Domain.stockExpiryEntries(item);
  }

  function displayName(entry) {
    return entry.item.name + (entry.flavor && entry.item.flavors.length > 1 ? ' · ' + entry.flavor.name : '');
  }

  function missingWetRemainder(items, today) {
    return items.find(function (item) {
      if (item.category !== 'can' || item.isSample || !(Number(item.quantity) > 0) ||
          !MP.Forecast.unitGrams(item) || Utils.diffDaysFromToday(item.expDate, today) < 0) return false;
      var shared = Domain.hasSharedSeal(item);
      if (shared && item.isOpened && Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, today) < 0) return false;
      function missingFraction(fraction) { return !(fraction > 0 && fraction < 1); }
      if (!item.flavors || !item.flavors.length) {
        return item.isOpened && Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, today) >= 0 &&
          missingFraction(item.openRemainFraction);
      }
      var openedFlavors = item.flavors.filter(function (flavor) { return flavor.quantity > 0 && flavor.openedDate; });
      if (item.isOpened && !openedFlavors.length) return true;
      return openedFlavors.some(function (flavor) {
        return (shared || Utils.openShelfDaysRemaining(flavor.openedDate, item.openDaysLimit, today) >= 0) &&
          missingFraction(flavor.openRemainFraction);
      });
    });
  }

  Stats.toggleTimeline = function () {
    timelineExpanded = !timelineExpanded;
    Stats.renderStatsView();
  };

  Stats.syncScopeScroll = function (showSelected) {
    var bar = document.getElementById('statsScopeBar');
    if (!bar || !bar.clientWidth) return;
    var selected = bar.querySelector('[aria-pressed="true"]');
    if (showSelected && selected) {
      var left = selected.offsetLeft - bar.offsetLeft;
      if (left < bar.scrollLeft) bar.scrollLeft = left;
      else if (left + selected.offsetWidth > bar.scrollLeft + bar.clientWidth - 20) {
        bar.scrollLeft = left + selected.offsetWidth - bar.clientWidth + 20;
      }
    }
    bar.parentElement.classList.toggle('has-more', bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 1);
  };

  function addUnitQuantity(totals, unit, quantity) {
    if (quantity > 0) totals[unit] = Utils.round2((totals[unit] || 0) + quantity);
  }

  function formatUnitQuantities(totals) {
    return Object.keys(totals).map(function (unit) {
      return Utils.formatQuantity(totals[unit], unit);
    }).join(' · ');
  }

  Stats.aggregateUniqueProducts = function (items) {
    var map = {};
    var list = [];
    (items || MP.state.items).forEach(function (it) {
      var key = Domain.getProductGroupKey(it);
      var palatability = MP.getItemPalatability(it);
      if (palatability === 'mixed') palatability = '';
      var q = Number(it.quantity) || 0;
      var eaten = q <= 0 ? (Number(it.consumedCount) || Number(it.lastQuantity) || 0) : 0;
      if (!map[key]) {
        map[key] = {
          key: key,
          rep: it,
          category: it.category || 'dry',
          group: MP.getCategoryGroup(it.category),
          brand: (it.brand || '未命名品牌').trim(),
          name: (it.name || '未命名').trim(),
          spec: Utils.formatItemSpec(it),
          unit: it.unit || '件',
          palatability: palatability,
          inStockQty: 0,
          eatenQty: 0,
          discardedCount: 0,
          batchCount: 0,
          totalDays: 0,
          daysUnits: 0
        };
        list.push(map[key]);
      }
      var entry = map[key];
      if (!it.sourceBatchId) {
        entry.batchCount += 1;
      }
      entry.inStockQty = Utils.round2(entry.inStockQty + q);
      entry.eatenQty = Utils.round2(entry.eatenQty + eaten);
      if (!it.sourceBatchId) entry.discardedCount += Number(it.discardedCount) || 0;
      if (palatability) entry.palatability = palatability;
      if (MP.getItemImages(it).length && !MP.getItemImages(entry.rep).length) entry.rep = it;
      if (q <= 0) {
        var cDays = it.discardedCount ? null : Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
        if (cDays !== null && eaten > 0) {
          entry.totalDays += cDays;
          entry.daysUnits += eaten;
        }
      }
    });
    return list;
  };

  Stats.ratingRecords = function (items) {
    var batches = new Map();
    var activeIds = new Set(items.filter(function (item) { return !item.sourceBatchId; }).map(function (item) { return item.id; }));
    items.forEach(function (item) {
      if (MP.getCategoryGroup(item.category) === 'supplies') return;
      if (item.sourceBatchId && activeIds.has(item.sourceBatchId)) return;
      var key = Domain.getProductGroupKey(item);
      var group = batches.get(key) || [];
      group.push(item);
      batches.set(key, group);
    });
    var records = [];
    batches.forEach(function (group) {
      group.forEach(function (item, index) {
        var flavors = item.flavors && item.flavors.length ? item.flavors : [null];
        flavors.forEach(function (flavor) {
          var rating = flavor ? flavor.palatability : item.palatability;
          var badge = MP.getPalatabilityBadgeInfo({ category: item.category, palatability: rating });
          if (!badge) return;
          records.push({
            rep: item, flavor: flavor, palatability: rating, badge: badge,
            group: MP.getCategoryGroup(item.category), category: item.category,
            brand: (item.brand || '未命名品牌').trim(), name: (item.name || '未命名').trim(),
            spec: Utils.formatItemSpec(item), unit: item.unit || '件',
            inStockQty: flavor ? Number(flavor.quantity) || 0 : Number(item.quantity) || 0,
            eatenQty: Number(item.quantity) > 0 ? Number(item.eatenCount) || 0 : Number(item.consumedCount) || Number(item.lastQuantity) || 0,
            batchLabel: group.length > 1 ? '批次 ' + (index + 1) + (item.batchCode ? ' · 购入渠道 ' + item.batchCode : item.expDate ? ' · 到期 ' + item.expDate : '') : ''
          });
        });
      });
    });
    return records;
  };

  // Pure calculation helper (testable in Node without DOM) for verifying Food vs Supp vs Med separation!
  Stats.computeOverviewMetrics = function (items, logs) {
    var groupTotals = {
      food: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      supp: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      med:  { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      supplies: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 }
    };
    var catStats = {};
    Object.keys(MP.CATEGORIES).forEach(function (k) {
      catStats[k] = {
        group: MP.CATEGORIES[k].group,
        skus: 0,
        stockByUnit: Object.create(null),
        eatenByUnit: Object.create(null),
        durationByUnit: Object.create(null)
      };
    });

    items.forEach(function (it) {
      var q = Number(it.quantity) || 0;
      var ck = catStats[it.category] ? it.category : 'dry';
      var grp = MP.getCategoryGroup(ck);
      var category = catStats[ck];
      var unit = it.unit || '件';
      if (q > 0) {
        groupTotals[grp].batches += 1;
        if (it.price) {
          if (it.currency === 'JPY') groupTotals[grp].jpy += q * Number(it.price);
          else groupTotals[grp].cny += q * Number(it.price);
        }
        category.skus += 1;
        addUnitQuantity(category.stockByUnit, unit, q);
      } else if (it.manualFeedArchive !== true) {
        var used = Number(it.consumedCount) || Number(it.lastQuantity) || 1;
        groupTotals[grp].eatenBatches += 1;
        addUnitQuantity(category.eatenByUnit, unit, used);
        var cd = it.discardedCount ? null : Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
        if (cd !== null) {
          var duration = category.durationByUnit[unit] || (category.durationByUnit[unit] = { days: 0, quantity: 0 });
          duration.days += cd;
          duration.quantity += used;
        }
      }
    });

    var today = Utils.getTodayStr();
    var cutoffStr = Utils.shiftDaysFromDate(today, -29);
    var recentLogs = (logs || []).filter(function (lg) {
      return lg.date >= cutoffStr && lg.date <= today;
    });
    var nursingLogs = recentLogs.filter(function (log) { return Domain.getCareType(log) === 'nursing'; });
    var foodLogs = recentLogs.filter(function (log) {
      return MP.getCategoryGroup(log.category) === 'food' && !Domain.getCareType(log);
    });
    var suppLogs = recentLogs.filter(function (log) {
      return MP.getCategoryGroup(log.category) === 'supp' && Domain.getCareType(log) !== 'nursing';
    });
    var medLogs = recentLogs.filter(function (log) {
      return MP.getCategoryGroup(log.category) !== 'supp' && Domain.getCareType(log) === 'medication';
    });

    return {
      groupTotals: groupTotals,
      catStats: catStats,
      recent30: {
        all: recentLogs,
        food: foodLogs,
        supp: suppLogs,
        med: medLogs,
        nursing: nursingLogs
      }
    };
  };

  Stats.missingWeightNotice = function (ids, compact) {
    if (!ids.length) return '';
    return '<span>' + (compact ? '' : '有 ') + Utils.formatQuantity(ids.length, '批') + '湿粮未填净含量，未计入预测</span>' +
      '<button type="button" data-forecast-action="weight" data-batch-id="' + Utils.escapeHtml(ids[0]) + '">去补填</button>';
  };

  function forecastTone(days) {
    var tone = Utils.formatDays(days).tone;
    return { expired: 'urgent', urgent: 'urgent', warning: 'low', fresh: 'enough', unknown: 'unknown' }[tone];
  }

  function packageStatusActions(category, items) {
    var units = Domain.summarizeStockQuantity(items).units;
    var statuses = Domain.summarizeStockDetailStatuses(items);
    var opened = Object.values(units).reduce(function (sum, row) { return sum + row.opened; }, 0);
    var expiring = Object.values(statuses).reduce(function (sum, row) { return sum + row.expiring; }, 0);
    var actions = [];
    if (expiring) actions.push('<button type="button" data-jump-cat="' + category + '" data-package-status="expiring">临期 ' +
      Utils.formatNumber(expiring) + '</button>');
    if (opened) actions.push('<button type="button" data-jump-cat="' + category + '" data-package-status="opened">开封 ' +
      Utils.formatNumber(opened) + '</button>');
    return actions.length ? '<div class="forecast-package-status">' + actions.join(' · ') + '</div>' : '';
  }

  function treatWeightSummary(items) {
    var grams = 0;
    var known = 0;
    var missing = 0;
    items.forEach(function (item) {
      if (item.category !== 'treat' || !(item.quantity > 0)) return;
      var weight = MP.Forecast.unitGrams(item);
      if (!weight) { missing++; return; }
      var opened = item.flavors?.length ? item.flavors.filter(function (flavor) {
        return flavor.quantity > 0 && flavor.openedDate;
      }) : item.isOpened ? [item] : [];
      var used = opened.reduce(function (sum, entry) {
        var fraction = entry.openRemainFraction;
        return sum + (fraction > 0 && fraction < 1 ? 1 - fraction : 0);
      }, 0);
      grams += Math.max(0, item.quantity - used) * weight;
      known++;
    });
    if (!known) return missing ? '未填克重' : '';
    return '共 ' + Utils.formatQuantity(Math.round(grams), '克') + (missing ? ' · 部分未填克重' : '');
  }

  Stats.renderStatsView = function () {
    var st = MP.state;
    var subTab = st.statsSubTab || 'stock';
    var subBtns = document.querySelectorAll('#statsSubTabSwitch [data-stats-subtab]');
    for (var sIdx = 0; sIdx < subBtns.length; sIdx++) {
      var sk = subBtns[sIdx].getAttribute('data-stats-subtab');
      var active = (sk === subTab);
      subBtns[sIdx].classList.toggle('active', active);
      subBtns[sIdx].setAttribute('aria-pressed', String(active));
    }
    var svStock = document.getElementById('statsSubViewStock');
    var svPal = document.getElementById('statsSubViewPal');
    var svBrand = document.getElementById('statsSubViewBrand');
    if (svStock) svStock.classList.toggle('hidden-view', subTab !== 'stock');
    if (svPal) svPal.classList.toggle('hidden-view', subTab !== 'pal');
    if (svBrand) svBrand.classList.toggle('hidden-view', subTab !== 'brand');

    var metrics = Stats.computeOverviewMetrics(st.items, st.logs);
    var gt = metrics.groupTotals;
    var catStats = metrics.catStats;

    // Scope switcher inside Stock Overview ('all' | 'food' | 'supp' | 'med')
    var scope = st.statsScopeFilter || 'all';
    var scopeBtns = document.querySelectorAll('#statsScopeBar [data-stats-scope]');
    for (var scIdx = 0; scIdx < scopeBtns.length; scIdx++) {
      var scKey = scopeBtns[scIdx].getAttribute('data-stats-scope');
      scopeBtns[scIdx].classList.toggle('active', scKey === scope);
    }

    var scopedCny = scope === 'all' ? (gt.food.cny + gt.supp.cny + gt.med.cny + gt.supplies.cny) : gt[scope].cny;
    var scopedJpy = scope === 'all' ? (gt.food.jpy + gt.supp.jpy + gt.med.jpy + gt.supplies.jpy) : gt[scope].jpy;
    var valueAmounts = [];
    if (scopedCny > 0) valueAmounts.push('<strong>' + Utils.formatMoney(scopedCny, 'CNY') + '</strong>');
    if (scopedJpy > 0) valueAmounts.push('<strong>' + Utils.formatMoney(scopedJpy, 'JPY') + '</strong>');
    document.getElementById('forecastValues').innerHTML = '<span class="forecast-value-label">在库价值</span>' +
      (valueAmounts.length ? valueAmounts.join('<i aria-hidden="true"></i>') : '<strong class="is-empty">暂无金额</strong>');

    var scopeLabels = { all: '全部', food: '食品', supp: '营养', med: '药品', supplies: '日用' };
    Array.prototype.forEach.call(scopeBtns, function (button) {
      var key = button.dataset.statsScope;
      var count = key === 'all' ? gt.food.batches + gt.supp.batches + gt.med.batches + gt.supplies.batches : gt[key].batches;
      button.innerHTML = '<span>' + scopeLabels[key] + '</span> <span>' + Utils.formatNumber(count) + '</span>';
      button.setAttribute('aria-pressed', String(key === scope));
    });
    var today = Utils.getTodayStr();
    var forecasts = MP.Forecast.compute(st.items, st.stockHistory, st.settings.dailyFeedGrams, today);
    var supplyEstimates = Domain.getSupplyUsageEstimates(st.items, st.stockHistory);
    var supplyFastest = supplyEstimates.filter(function (entry) {
      return entry.remainingDays !== null && Number(entry.averageCycleDays) > 0;
    })
      .sort(function (a, b) { return a.remainingDays - b.remainingDays; })[0] || null;
    var showFood = scope === 'all' || scope === 'food';
    var urgent = Object.keys(forecasts).filter(function (key) { return forecasts[key].low; })
      .sort(function (a, b) { return forecasts[a].days - forecasts[b].days; })[0];

    var keys = showFood ? ['can', 'dry', 'freeze', 'treat'] : [];
    ['supp', 'med', 'supplies'].forEach(function (key) {
      if ((scope === 'all' || scope === key) && catStats[key].skus) keys.push(key);
    });
    var catGridHtml = keys.map(function (key) {
      var category = MP.CATEGORIES[key];
      var stock = catStats[key];
      var data = forecasts[key];
      var stockLabel = formatUnitQuantities(stock.stockByUnit) || '无库存';
      var average = Object.keys(stock.durationByUnit).map(function (unit) {
        var duration = stock.durationByUnit[unit];
        return '每' + Utils.escapeHtml(unit) + '约 ' + Utils.formatDays(Math.max(1, Math.round(duration.days / duration.quantity))).text;
      }).join(' · ');
      var showsPackageStatus = key === 'dry' || key === 'freeze';
      var packageStatus = showsPackageStatus ? packageStatusActions(key, st.items.filter(function (item) {
        return item.category === key;
      })) : '';
      var tone = forecastTone(data && data.days);
      var meter = '';
      var prediction = '';
      var remaining = '';
      var rate = '';
      if (key === 'supplies') {
        var supplyLow = supplyFastest && supplyFastest.remainingDays <= 7;
        var supplyBadge = supplyFastest
          ? '<span class="supply-summary-badge supply-summary-badge--' + (supplyLow ? 'warning' : 'ok') + '">' +
            Utils.formatNumber(supplyFastest.remainingDays) + '天</span>'
          : '';
        return '<article class="ios-card metric-card forecast-tile forecast-tile--supplies">' +
          '<button type="button" class="forecast-category" data-jump-cat="supplies"><strong>日用品</strong>' +
          '<span class="forecast-headline"><strong class="forecast-quantity">' + Utils.formatQuantity(supplyEstimates.length, '种') + '</strong>' + supplyBadge + '</span></button>' +
          '<div class="forecast-foot"><span class="batch-count">' + Utils.formatQuantity(stock.skus, '批') + '</span></div>' +
          '<div class="forecast-notices"><p class="supply-summary-first">' + (supplyFastest
            ? Utils.escapeHtml(supplyFastest.item.name) + '最先用完' + (supplyEstimates.some(function (entry) { return entry.quantity > 0 && entry.remainingDays === null; }) ? '（仅限可估算商品）' : '')
            : supplyEstimates.some(function (entry) { return entry.openedCount > 1; }) ? '多批次同时开封，暂不估算' : '数据不足，暂不估算') + '</p>' +
          (supplyEstimates.some(function (entry) { return entry.sampleCount > 0; }) ? '<div class="forecast-result">示例库存未计入预测</div>' : '') + '</div></article>';
      }
      if (data) {
        var coverage = data.days === null ? 0 : Math.min(100, data.days / 30 * 100);
        meter = '<div class="forecast-meter forecast-meter--' + tone + '" aria-hidden="true"><span style="width:' + coverage + '%"></span></div>';
        if (data.days !== null) {
          var daysLabel = Utils.formatDays(data.days).text;
          remaining = '<span class="forecast-days forecast-result--' + tone + '" aria-label="约还能吃 ' + daysLabel + '">' + daysLabel + '</span>';
          rate = '<span class="forecast-rate" title="' + (data.source === 'actual' ? '核销平均' : '设置值') +
            '">每天 ' + Utils.formatQuantity(data.dailyGrams, '克') + '</span>';
        } else if (!data.dailyGrams) {
          prediction += '<button type="button" class="forecast-link" data-forecast-action="settings" data-forecast-category="' + key +
            '">设置每日量，查看天数</button>';
        } else {
          if (!data.samples || data.realStock) prediction += '<div class="forecast-result">暂无可换算库存</div>';
        }
        if (data.samples) prediction += '<div class="forecast-result">示例库存未计入预测</div>';
        if (data.missing.length) {
          prediction += key === 'can' ? '<div class="forecast-missing">' + Stats.missingWeightNotice(data.missing) + '</div>'
            : '<div class="forecast-result">有 ' + Utils.formatQuantity(data.missing.length, '批') + '规格无法折算，未计入预测</div>';
        }
        if (data.estimated && showsPackageStatus) {
          var estimateHint = '有开封余量未填写，预测按整件估算';
          var estimateLine = data.days !== null ? '按每天' + Utils.formatQuantity(data.dailyGrams, '克') + ' · ' : '';
          rate = '<button type="button" class="forecast-rate forecast-estimate-line" data-forecast-action="estimate" title="' + estimateHint +
            '" aria-description="' + estimateHint + '">' + estimateLine + '按整件估算</button>';
        } else if (data.estimated && key === 'can') {
          var missingRemainder = missingWetRemainder(st.items, Utils.getTodayStr());
          if (missingRemainder) {
            prediction += '<button type="button" class="forecast-remainder-link" data-forecast-action="remainder" data-batch-id="' +
              Utils.escapeHtml(missingRemainder.id) + '">有开封余量未填写，按整件估算 <span aria-hidden="true">→</span></button>';
          }
        } else if (data.estimated) {
          prediction += '<details class="forecast-estimate"><summary>有开封余量未填写，按整件估算</summary><p>这一批未填写开封后的剩余量，预测暂按整件计算。</p></details>';
        }
      } else if (key === 'treat') {
        var weightSummary = treatWeightSummary(st.items);
        if (weightSummary) remaining = '<span class="forecast-rate">' + weightSummary + '</span>';
      }

      var hasDays = Boolean(data && data.days !== null);
      var quantityHtml = '<strong class="forecast-quantity">' +
        (key === 'can' ? (data.samples && !data.realStock ? '—' : data.missing.length && !data.grams ? '待补填' : Utils.formatQuantity(data.grams, '克') + (data.missing.length ? '（已换算）' : '')) : Utils.escapeHtml(stockLabel)) + '</strong>';
      var footParts = ['<span class="batch-count">' + Utils.formatQuantity(stock.skus, '批') + '</span>'];
      if (hasDays) footParts.push(quantityHtml);
      if (!hasDays && remaining) footParts.push(remaining);
      if (rate) footParts.push(rate);
      else if (average) footParts.push('<span>' + average + '</span>');

      return '<article class="ios-card metric-card forecast-tile forecast-tile--' + key +
        (key === 'med' && keys.includes('supplies') ? ' forecast-tile--pair-start' : '') + (showsPackageStatus ? ' forecast-tile--with-package-status' : '') +
        (tone === 'urgent' ? ' forecast-tile--urgent' : '') + '">' +
        '<button type="button" class="forecast-category" data-jump-cat="' + key + '"><strong>' +
          category.label + '</strong><span class="forecast-headline">' + (hasDays ? remaining : quantityHtml) + '</span></button>' +
        meter + '<div class="forecast-foot">' + footParts.join('<span class="forecast-sep" aria-hidden="true">·</span>') + '</div>' +
        packageStatus + (prediction ? '<div class="forecast-notices">' + prediction + '</div>' : '') + '</article>';
    }).join('');
    if ((scope === 'all' || scope === 'supp' || scope === 'med') && !gt.supp.batches && !gt.med.batches) {
      catGridHtml += '<div class="empty-state forecast-empty forecast-wide">营养品和药品暂无库存</div>';
    } else if (!catGridHtml) {
      catGridHtml = '<div class="empty-state forecast-empty forecast-wide">当前分类暂无库存</div>';
    }
    document.getElementById('categoryStatsGrid').innerHTML = catGridHtml;

    // Attention, priority and timeline sections cover all stock; the scope chips only filter the inventory card.
    var activeItems = st.items.filter(function (item) { return item.quantity > 0; });
    var warningDays = Number(st.settings.warnDays) || 60;
    var expiredTasks = activeItems.flatMap(function (item) {
      var entries = displayEntries(item);
      if (Domain.hasSharedSeal(item) && entries.length &&
          entries.every(function (entry) { return entry.evaluation.status === 'expired'; })) {
        return [{ item: item, flavor: null, opened: Boolean(item.isOpened), quantity: item.quantity,
          evaluation: Domain.evaluateItem(item), shared: true }];
      }
      return entries;
    }).map(function (entry) {
      var evaluation = entry.evaluation;
      var expWarning = evaluation.expDays !== null && evaluation.expDays <= warningDays ? evaluation.expDays : null;
      var openWarning = evaluation.openRemaining !== null && evaluation.openRemaining <= Math.min(10, warningDays)
        ? evaluation.openRemaining : null;
      var opening = openWarning !== null && (expWarning === null || openWarning < expWarning);
      entry.days = opening ? openWarning : expWarning;
      entry.kind = entry.days < 0 ? 'expired' : opening ? 'opening' : 'expiring';
      return entry;
    }).filter(function (entry) {
      return entry.evaluation.status === 'expired';
    }).sort(function (a, b) {
      var order = { expired: 0, expiring: 1, opening: 2 };
      return order[a.kind] - order[b.kind] || a.days - b.days;
    });
    document.getElementById('feedingExpiredTasks').classList.toggle('hidden-view', !expiredTasks.length);
    document.getElementById('feedingExpiredCount').textContent = Utils.formatQuantity(expiredTasks.length, '批') + '已过期';
    var expiredTotals = Object.create(null);
    expiredTasks.forEach(function (entry) { addUnitQuantity(expiredTotals, entry.item.unit || '件', Number(entry.quantity) || 0); });
    document.getElementById('feedingExpiredSummary').textContent = expiredTasks.length
      ? [expiredTasks[0].item.brand, expiredTasks[0].item.name].filter(Boolean).join(' ') +
        (expiredTasks.length > 1 ? ' 等' : '') + ' · 共 ' + formatUnitQuantities(expiredTotals)
      : '';
    document.getElementById('feedingExpiredList').innerHTML = expiredTasks.map(function (entry) {
      var name = [entry.item.brand, displayName(entry)].filter(Boolean).join(' ') +
        (entry.shared ? ' · 共用密封整盒' : '');
      var action = 'data-discard-item="' + Utils.escapeHtml(entry.item.id) + '" data-discard-opened="' + String(entry.opened) + '"' +
        (entry.flavor ? ' data-discard-flavor="' + Utils.escapeHtml(entry.flavor.id) + '"' : '');
      return '<button type="button" class="feeding-task-row" ' + action + '>' +
        '<span class="feeding-task-status feeding-task-status--expired">已过期</span>' +
        '<strong title="' + Utils.escapeHtml(name) + '">' + Utils.escapeHtml(name) + '</strong>' +
        '<span class="feeding-task-quantity">' + Utils.escapeHtml(Utils.formatQuantity(entry.quantity, entry.item.unit || '件')) + '</span>' +
        '<span class="feeding-task-days">过期' + Utils.formatNumber(Math.abs(entry.days)) + '天</span>' +
        '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 18 6-6-6-6"/></svg></button>';
    }).join('');

    function blockedByExpiredOpen(entry, entries) {
      return !entry.opened && entries.some(function (other) {
        return other.flavor === entry.flavor && other.opened && other.evaluation.status === 'expired';
      });
    }
    var risks = new Map();
    var warningTasks = activeItems.map(function (item) {
      var forecast = forecasts[item.category];
      var stock = MP.Forecast.batchStock(item, today);
      if (!forecast || !forecast.dailyGrams || !stock || !stock.grams) return null;
      var entries = displayEntries(item);
      var available = entries.filter(function (entry) { return entry.evaluation.status !== 'expired'; });
      var risk = MP.Forecast.expiryRisk(item, forecast.dailyGrams, today);
      if (risk && risk.atRisk) risks.set(item.id, risk);
      var near = available.filter(function (entry) { return entry.evaluation.status === 'expiring'; })
        .sort(function (a, b) { return a.evaluation.effectiveDays - b.evaluation.effectiveDays; })[0];
      if ((!risk || !risk.atRisk) && !near) return null;
      var feedable = available.filter(function (entry) { return !blockedByExpiredOpen(entry, entries); })
        .sort(function (a, b) { return Number(b.opened) - Number(a.opened); })[0];
      return { item: item, risk: risk && risk.atRisk ? risk : null, near: near, feedable: feedable, stock: stock, rate: forecast.dailyGrams };
    }).filter(Boolean).sort(function (a, b) {
      return Number(Boolean(b.risk)) - Number(Boolean(a.risk)) ||
        (b.risk ? b.risk.leftoverGrams - a.risk.leftoverGrams : 0) ||
        (a.risk ? a.risk.daysRemaining - b.risk.daysRemaining : a.near.evaluation.effectiveDays - b.near.evaluation.effectiveDays);
    });
    var activeFoodAndSupp = st.items.filter(function (it) {
      var group = MP.getCategoryGroup(it.category);
      return (Number(it.quantity) || 0) > 0 && (group === 'food' || group === 'supp');
    }).flatMap(function (item) {
      var entries = displayEntries(item);
      return entries.filter(function (entry) {
        return entry.evaluation.status !== 'expired' && !blockedByExpiredOpen(entry, entries);
      });
    });
    activeFoodAndSupp.sort(function (a, b) {
      var riskA = risks.get(a.item.id);
      var riskB = risks.get(b.item.id);
      return Number(Boolean(riskB)) - Number(Boolean(riskA)) ||
        (riskA && riskB ? riskB.leftoverGrams - riskA.leftoverGrams || riskA.daysRemaining - riskB.daysRemaining : 0) ||
        Number(b.opened) - Number(a.opened) ||
        (a.evaluation.expDays ?? Infinity) - (b.evaluation.expDays ?? Infinity);
    });
    var priorityItems = new Set(activeFoodAndSupp.slice(0, 3).map(function (entry) { return entry.item.id; }));
    document.getElementById('feedingTasks').classList.toggle('hidden-view', !warningTasks.length);
    var attentionCount = warningTasks.length + expiredTasks.length;
    document.getElementById('feedingAttention').classList.toggle('hidden-view', !attentionCount);
    document.getElementById('feedingAttentionCount').textContent = Utils.formatNumber(attentionCount);
    function fact(value, label, tone) {
      return '<div class="feeding-risk-fact' + (tone ? ' feeding-risk-fact--' + tone : '') + '"><strong>' + value +
        '</strong><span>' + label + '</span></div>';
    }
    document.getElementById('feedingTaskList').innerHTML = warningTasks.map(function (task) {
      var item = task.item;
      var risk = task.risk;
      var days = risk ? risk.daysRemaining : task.near.evaluation.effectiveDays;
      var isOpening = risk ? risk.deadline === 'opened' : task.near.evaluation.openRemaining !== null &&
        task.near.evaluation.openRemaining <= (task.near.evaluation.expDays ?? Infinity);
      var neededDays = Math.ceil(task.stock.grams / task.rate);
      var rateLabel = Utils.formatNumber(task.rate, 2) + ' 克';
      var facts = fact(Utils.formatNumber(days) + ' 天', isOpening ? '开封保鲜剩余' : '距到期') +
        fact(Utils.formatNumber(neededDays) + ' 天', '按每天 ' + rateLabel + '吃完') +
        (risk ? fact('≈' + Utils.formatNumber(risk.leftoverGrams, 0) + ' 克', '预计浪费', 'danger')
          : fact(Utils.formatNumber(task.stock.grams, 0) + ' 克', '当前余量'));
      return '<div class="feeding-warning-row feeding-warning-row--' + (risk ? 'risk' : 'expiring') + '">' +
        '<div class="feeding-warning-heading"><span class="feeding-warning-name">' +
          (item.brand ? '<span>' + Utils.escapeHtml(item.brand) + '</span> ' : '') + '<strong>' + Utils.escapeHtml(item.name) + '</strong></span>' +
          '<span class="feeding-task-status feeding-task-status--' + (risk ? 'risk' : 'expiring') + '">' +
        (risk ? '吃不完风险' : '临期') + '</span></div>' +
        '<div class="feeding-risk-facts">' + facts + '</div>' +
        (task.stock.estimated ? '<p class="feeding-warning-note">开封余量未填写，按整件估算</p>' : '') +
        (!task.feedable ? '<p>请先处理已过期开封件。</p>' : '') +
        (task.feedable && !priorityItems.has(item.id) ? '<div class="feeding-warning-action"><button type="button" class="btn-feed btn-feed--compact" data-priority-feed="' + Utils.escapeHtml(item.id) + '"' +
          (task.feedable.flavor ? ' data-priority-flavor="' + Utils.escapeHtml(task.feedable.flavor.id) + '"' : '') +
          '><span class="btn-feed__content">' + MP.UI.feedButtonContent() + '</span></button></div>' : '') + '</div>';
    }).join('');

    // 1C. Priority Feeding Queue (FEFO for food and supplements only.)
    document.getElementById('priorityFeedList').innerHTML = activeFoodAndSupp.slice(0, 3).map(function (entry, index) {
      var item = entry.item;
      var ev = entry.evaluation;
      var opened = entry.opened;
      var atRisk = risks.has(item.id);
      var name = displayName(entry);
      var reason = opened
        ? '已开封 · ' + (ev.openRemaining === null ? '未填写开封保鲜期' : Utils.formatDays(ev.openRemaining).text + '内吃完')
        : '未拆封 · ' + (ev.expDays === null ? '未填写过期日期' : '剩 ' + Utils.formatDays(ev.expDays).text);
      return '<div class="priority-row' + (opened ? ' priority-row--opened' : '') + (atRisk ? ' priority-row--risk' : '') + '">' +
        '<span class="priority-index">' + Utils.formatNumber(index + 1) + '</span>' +
        '<div class="priority-copy"><div class="priority-name"><span>' + Utils.escapeHtml(item.brand) +
          '</span> <strong>' + Utils.escapeHtml(name) + '</strong></div>' +
          '<div class="priority-reason">' + reason +
          (atRisk ? ' · <span class="priority-risk">吃不完风险</span>' : '') + '</div></div>' +
        '<button type="button" class="btn-feed btn-feed--compact" aria-label="记喂食：' + Utils.escapeHtml(name) +
          '" data-priority-feed="' + Utils.escapeHtml(item.id) + '"' +
          (entry.flavor ? ' data-priority-flavor="' + Utils.escapeHtml(entry.flavor.id) + '"' : '') +
          '><span class="btn-feed__content">' + MP.UI.feedButtonContent() + '</span></button>' +
        '</div>';
    }).join('') || '<div class="priority-empty">暂无在库食品或营养品</div>';

    // 1D. Future Expiry Month Timeline (all stock)
    var scopedActive = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && Utils.diffDaysFromToday(it.expDate) !== null &&
        displayEntries(it).some(function (entry) { return entry.evaluation.status !== 'expired'; });
    });
    var nearest = null;
    var nearestDays = Infinity;
    scopedActive.forEach(function (item) {
      var remaining = Utils.diffDaysFromToday(item.expDate);
      if (remaining !== null && remaining >= 0 && remaining < nearestDays) {
        nearest = item;
        nearestDays = remaining;
      }
    });
    var monthBuckets = {};
    scopedActive.forEach(function (it) {
      var ym = it.expDate.slice(0, 7);
      if (!monthBuckets[ym]) {
        monthBuckets[ym] = { ym: ym, items: [], minDays: Infinity };
      }
      monthBuckets[ym].items.push(it);
      var dLeft = Utils.diffDaysFromToday(it.expDate);
      if (dLeft !== null && dLeft < monthBuckets[ym].minDays) {
        monthBuckets[ym].minDays = dLeft;
      }
    });
    var sortedMonths = Object.keys(monthBuckets).sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
    document.getElementById('expiryTimelineCountBadge').textContent = (nearest
      ? '最近 ' + Utils.formatRelativeYearDate(nearest.expDate, today) + ' · ' : '') + Utils.formatQuantity(sortedMonths.length, '个月份');
    function timelineTone(days) {
      if (days !== null && days < 0) return 'urgent';
      if (days !== null && days <= 30) return 'low';
      return days === null ? 'neutral' : 'enough';
    }
    function timelineProduct(item) {
      var medTag = MP.getCategoryGroup(item.category) === 'med'
        ? '<span class="feeding-timeline-med-tag">药品</span>' : '';
      return '<span class="feeding-timeline-product"><span class="priority-name"><span>' +
        Utils.escapeHtml(item.brand) + '</span> <strong>' + Utils.escapeHtml(item.name) +
        '</strong></span>' + medTag + '</span>';
    }
    var visibleMonths = timelineExpanded ? sortedMonths : sortedMonths.slice(0, 5);
    var monthsHtml = visibleMonths.map(function (ym) {
      var bucket = monthBuckets[ym];
      bucket.items.sort(function (a, b) { return (a.expDate || '9999').localeCompare(b.expDate || '9999'); });
      var tone = timelineTone(bucket.minDays);
      var ymTitle = Utils.formatMonthLabel(ym);
      var days = Utils.formatDays(bucket.minDays).text;
      var multiple = bucket.items.length > 1;
      var heading = '<span class="feeding-month-name">' + Utils.escapeHtml(ymTitle) + '</span><span>' + Utils.formatQuantity(bucket.items.length, '批') +
        '</span><span class="forecast-days">' + days + '</span><span class="feeding-month-chevron" aria-hidden="true"></span>' +
        timelineProduct(bucket.items[0]);
      return '<li class="feeding-month forecast-result--' + tone + '">' +
        '<span class="forecast-dot" aria-hidden="true"></span>' +
        (multiple ? '<details><summary>' + heading + '</summary><ul class="feeding-month-products">' +
          bucket.items.slice(1).map(function (item) {
            return '<li>' + timelineProduct(item) + '<time>' + Utils.escapeHtml(Utils.formatListDate(item.expDate, '未填写过期日期')) + '</time></li>';
          }).join('') + '</ul></details>' : '<div class="feeding-month-summary">' + heading + '</div>') +
        '</li>';
    }).join('');
    document.getElementById('expiryMonthTimelineList').innerHTML = monthsHtml
      ? '<ol class="feeding-month-track">' + monthsHtml + '</ol>' +
        (sortedMonths.length > 5 ? '<button type="button" class="feeding-timeline-toggle" data-toggle-timeline aria-expanded="' +
          String(timelineExpanded) + '">' + (timelineExpanded ? '收起' : '展开全部（共 ' + Utils.formatQuantity(sortedMonths.length, '条') + '）') + '</button>' : '')
      : '<div class="priority-empty">暂无标注过期日期的未过期批次</div>';

    // ==================== SUB-VIEW 2: PALATABILITY & TOLERANCE ARCHIVE (Food vs Supp vs Med Separated!) ====================
    var ratingRecords = Stats.ratingRecords(st.items);
    var palGroups = ['food', 'supp', 'med'];
    var palGroup = palGroups.includes(st.statsPalGroup) ? st.statsPalGroup : 'food';
    var foodTiers = ['love', 'ok', 'coax', 'meh'];
    if (st.statsTierTab !== 'all' && !foodTiers.includes(st.statsTierTab)) st.statsTierTab = 'all';
    var groupCounts = { food: 0, supp: 0, med: 0 };
    var tierCounts = { love: 0, ok: 0, coax: 0, meh: 0 };
    ratingRecords.forEach(function (prod) {
      var group = palGroups.includes(prod.group) ? prod.group : 'food';
      groupCounts[group] += 1;
      if (group === palGroup && Object.hasOwn(tierCounts, prod.palatability)) tierCounts[prod.palatability] += 1;
    });
    var evaluatedTotal = ratingRecords.length;
    document.getElementById('tierTotalEvaluatedBadge').textContent = '已评 ' + Utils.formatQuantity(evaluatedTotal, '条');
    document.getElementById('tierEvaluatedBreakdown').textContent = '食品 ' + Utils.formatNumber(groupCounts.food) +
      ' · 营养品 ' + Utils.formatNumber(groupCounts.supp) + ' · 药品 ' + Utils.formatNumber(groupCounts.med);

    Array.prototype.forEach.call(document.querySelectorAll('#palGroupSwitch [data-pal-group]'), function (button) {
      var key = button.getAttribute('data-pal-group');
      button.classList.toggle('active', key === palGroup);
      button.classList.toggle('is-empty', !groupCounts[key]);
      button.setAttribute('aria-pressed', String(key === palGroup));
      button.querySelector('[data-pal-group-count]').textContent = Utils.formatNumber(groupCounts[key]);
    });

    // Supplements and medication reuse the four stored rating keys with their own wording.
    var groupCategory = Object.keys(MP.CATEGORIES).find(function (key) { return MP.CATEGORIES[key].group === palGroup; }) || 'dry';
    var tierInfo = {};
    foodTiers.forEach(function (key) {
      var badge = MP.getPalatabilityBadgeInfo({ category: groupCategory, palatability: key });
      tierInfo[key] = { label: badge.label, emoji: badge.emoji || MP.getPalatabilityEmoji(key) };
    });
    var groupLabels = { food: '食品', supp: '营养品', med: '药品' };
    var distribution = document.getElementById('palTierDistribution');
    var ratedTiers = foodTiers.filter(function (key) { return tierCounts[key] > 0; });
    distribution.innerHTML = ratedTiers.map(function (key) {
      return '<span data-tier-segment="' + key + '" style="flex-grow:' + tierCounts[key] + '"></span>';
    }).join('');
    distribution.classList.toggle('hidden-view', !ratedTiers.length);
    distribution.setAttribute('aria-label', groupLabels[palGroup] + '评价分布：' + ratedTiers.map(function (key) {
      return tierInfo[key].label + ' ' + Utils.formatQuantity(tierCounts[key], '条');
    }).join('，'));
    Array.prototype.forEach.call(document.querySelectorAll('#palTierTabBar [data-tier-tab]'), function (button) {
      var key = button.getAttribute('data-tier-tab');
      button.querySelector('[data-tier-emoji]').textContent = tierInfo[key].emoji;
      button.querySelector('[data-tier-label]').textContent = tierInfo[key].label;
      button.querySelector('[data-tier-count]').textContent = tierCounts[key];
      button.classList.toggle('pal-unrated', tierCounts[key] === 0);
      button.classList.toggle('active', key === st.statsTierTab);
      button.setAttribute('aria-pressed', String(key === st.statsTierTab));
    });

    var groupRecords = ratingRecords.filter(function (prod) {
      return (palGroups.includes(prod.group) ? prod.group : 'food') === palGroup;
    });
    var tierMatched = st.statsTierTab === 'all' ? groupRecords : groupRecords.filter(function (prod) {
      return prod.palatability === st.statsTierTab;
    });

    var filterLabel = st.statsTierTab === 'all' ? '' : tierInfo[st.statsTierTab].label;
    document.querySelector('#statsSubViewPal .pal-filter-summary').classList.toggle('hidden-view', st.statsTierTab === 'all');
    document.getElementById('palFilterSummary').textContent = filterLabel
      ? '当前筛选：' + filterLabel + ' · ' + Utils.formatQuantity(tierMatched.length, '条') : '';
    document.getElementById('clearPalFilterBtn').classList.toggle('hidden-view', st.statsTierTab === 'all');

    var tierListEl = document.getElementById('palTierCardsList');
    var tierPagerEl = document.getElementById('tierPaginationBar');
    if (tierMatched.length === 0) {
      if (tierPagerEl) tierPagerEl.classList.add('hidden-view');
      var emptyIcon = filterLabel ? '<span class="palatability-emoji" aria-hidden="true">' + Utils.escapeHtml(tierInfo[st.statsTierTab].emoji) + '</span>'
        : (palGroup === 'food' ? Utils.getPalatabilityIcon('ok') : Utils.getCategoryIcon(palGroup, 20));
      var emptyMessage = filterLabel ? '还没有「' + filterLabel + '」的记录' : '还没有' + groupLabels[palGroup] + '评价记录';
      tierListEl.innerHTML = '<div class="pal-record-empty">' + emptyIcon + '<span>' +
        Utils.escapeHtml(emptyMessage) + '</span></div>';
    } else {
      var tPageSize = Number(st.tierPageSize) || 20;
      var tTotalPages = Math.max(1, Math.ceil(tierMatched.length / tPageSize));
      if (st.tierPage > tTotalPages) st.tierPage = tTotalPages;
      if (st.tierPage < 1) st.tierPage = 1;
      var pagedTierItems = tierMatched.slice((st.tierPage - 1) * tPageSize, st.tierPage * tPageSize);

      if (tierMatched.length > tPageSize) {
        tierPagerEl.classList.remove('hidden-view');
        document.getElementById('tierPageInfoText').textContent =
          '第 ' + Utils.formatNumber(st.tierPage) + ' / ' + Utils.formatQuantity(tTotalPages, '页') + ' (共 ' + Utils.formatQuantity(tierMatched.length, '条') + ')';
        var tpPrev = document.getElementById('prevTierPageBtn');
        var tpNext = document.getElementById('nextTierPageBtn');
        tpPrev.disabled = (st.tierPage <= 1);
        tpPrev.style.opacity = st.tierPage <= 1 ? '0.45' : '1';
        tpNext.disabled = (st.tierPage >= tTotalPages);
        tpNext.style.opacity = st.tierPage >= tTotalPages ? '0.45' : '1';
      } else {
        tierPagerEl.classList.add('hidden-view');
      }

      tierListEl.innerHTML = pagedTierItems.map(function (prod) {
        var palBadge = prod.badge;
        var stockText = prod.inStockQty > 0
          ? '<span class="pal-record-stock">在库 ' + Utils.escapeHtml(Utils.formatQuantity(prod.inStockQty, prod.unit)) + '</span>'
          : '<span>' + (prod.rep.discardedCount ? '已核销/断货' : '已用完/断货') + '</span>';
        var title = prod.name + (prod.flavor ? ' · ' + prod.flavor.name : '');
        return '<div class="pal-record-row">' +
            '<span class="pal-record-thumb"><img class="pal-record-cover" src="' + MP.getItemCoverSrc(prod.rep) + '" alt="">' +
              '<span class="palatability-label" role="img" aria-label="' + Utils.escapeHtml(palBadge.label) + '" title="' + Utils.escapeHtml(palBadge.label) + '">' +
              Utils.escapeHtml(palBadge.emoji || MP.getPalatabilityEmoji(palBadge.key)) + '</span></span>' +
            '<div class="pal-record-main">' +
              '<div class="pal-record-title" title="' + Utils.escapeHtml(title + (prod.spec ? ' (' + prod.spec + ')' : '')) + '">' + Utils.escapeHtml(title) + '</div>' +
              '<div class="pal-record-meta"><span>' + Utils.escapeHtml(prod.brand) + '</span>' + stockText +
                (prod.batchLabel ? '<span>' + Utils.escapeHtml(prod.batchLabel) + '</span>' : '') + '</div>' +
            '</div>' +
            '<button type="button" class="pal-record-restock" data-tier-restock="' + Utils.escapeHtml(prod.rep.id) + '">复购</button>' +
          '</div>';
      }).join('');
    }

    // ==================== SUB-VIEW 3A: 30-DAY FEEDING PREFERENCES (Food Strictly Separated from Supp & Med!) ====================
    var r30 = metrics.recent30;
    document.getElementById('recent30CountBadge').textContent =
      Utils.formatQuantity(r30.food.length, '顿');

    var prefBox = document.getElementById('recent30PrefBox');
    var foodHtml;
    if (r30.all.length === 0) {
      foodHtml = '<div style="font-size:12.5px;color:var(--text-muted);padding:8px 0;">近期暂无喂食记录，去底部「每日记录」记几笔就能看到主子的饮食分析啦</div>';
    } else {
      if (r30.food.length === 0) {
        foodHtml = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">近 30 天暂无普通食品记录</div>';
      } else {
        var foods = new Map();
        var counts = { dry: 0, can: 0, other: 0 };
        r30.food.forEach(function (log) {
          counts[Object.hasOwn(counts, log.category) ? log.category : 'other'] += 1;
          var product = Domain.resolveLogProduct(log, true);
          var key = Domain.getProductGroupKey(product);
          if (product === log && log.itemId) key = JSON.stringify([key, log.itemId]);
          var row = foods.get(key);
          if (!row) {
            row = { brand: product.brand, name: product.name, spec: Utils.formatItemSpec(product), category: product.category, count: 0 };
            foods.set(key, row);
          }
          row.count += 1;
        });
        var total = r30.food.length;
        var ratioKeys = ['dry', 'can', 'other'];
        var legend = ratioKeys.map(function (key) {
          var label = key === 'other' ? '其他' : MP.CATEGORIES[key].label;
          var percent = (counts[key] / total * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
          return '<span class="feeding-ratio-' + key + '">' + label + ' ' +
            Utils.formatQuantity(counts[key], '顿') + ' · ' + percent + '%</span>';
        }).join('');
        var segments = ratioKeys.map(function (key) {
          return counts[key] ? '<span class="feeding-ratio-' + key + '" style="flex-grow:' + counts[key] + '"></span>' : '';
        }).join('');
        var rankedFoods = Array.from(foods.values()).sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
        var rows = rankedFoods.map(function (food, index) {
          var title = Utils.escapeHtml(food.name + (food.spec ? ' (' + food.spec + ')' : ''));
          return '<li><span class="feeding-rank">' + Utils.formatNumber(index + 1) + '</span>' +
            '<span class="feeding-rank-thumb" aria-hidden="true">' + Utils.getCategoryIcon(food.category) + '</span>' +
            '<span class="feeding-rank-product">' +
            (food.brand ? '<span class="feeding-rank-brand">' + Utils.escapeHtml(food.brand) + '</span>' : '') +
            '<span class="feeding-rank-name" title="' + title + '">' + title + '</span></span>' +
            '<span class="feeding-rank-count">' + Utils.formatQuantity(food.count, '顿') +
            '<span class="feeding-rank-meter" aria-hidden="true"><span style="width:' +
            food.count / rankedFoods[0].count * 100 + '%"></span></span></span></li>';
        }).join('');
        foodHtml = '<div class="feeding-ratio-bar" aria-hidden="true">' + segments + '</div>' +
          '<div class="feeding-ratio-legend">' + legend + '</div>' +
          '<h3 class="feeding-rank-title">喂食频次 TOP 3</h3><ol class="feeding-rank-list">' + rows + '</ol>';
      }
    }

    function renderCareSummary(logs, label, icon) {
      var counts = new Map();
      logs.forEach(function (log) {
        var product = Domain.resolveLogProduct(log);
        var name = [product.brand, product.name].filter(Boolean).join(' · ');
        counts.set(name, (counts.get(name) || 0) + 1);
      });
      var tags = Array.from(counts, function (entry) {
        return '<span>' + Utils.escapeHtml(entry[0]) + ' ×' + Utils.formatNumber(entry[1]) + '</span>';
      }).join('');
      return '<div class="feeding-care-row' + (logs.length ? '' : ' is-empty') + '">' +
        '<div class="feeding-care-heading"><span class="feeding-care-label">' + icon + label + '</span>' +
        '<span class="feeding-care-count">' + Utils.formatQuantity(logs.length, '次') + '</span></div>' +
        (tags ? '<div class="feeding-care-tags">' + tags + '</div>' : '') + '</div>';
    }

    prefBox.innerHTML = foodHtml;
    document.getElementById('recent30CareBox').innerHTML =
      renderCareSummary(r30.supp, '营养品', Utils.getCategoryIcon('supp', 20)) +
      renderCareSummary(r30.med, '用药', Utils.uiIcon('stethoscope', 20)) +
      renderCareSummary(r30.nursing, '护理', Utils.uiIcon('clipboard-copy', 20));

    // ==================== SUB-VIEW 3B: BRAND DEEP ARCHIVE (Filterable by Food / Supp / Med) ====================
    var bScope = st.brandScopeFilter || 'all';
    var primaryCurrency = st.brandCurrency || (st.settings.defaultCurrency === 'JPY' ? 'JPY' : 'CNY');
    var currencyItems = st.items.filter(function (item) {
      return item.manualFeedArchive !== true && (item.currency === 'JPY' ? 'JPY' : 'CNY') === primaryCurrency;
    });
    var currencyProducts = Stats.aggregateUniqueProducts(currencyItems);
    var scopeBrands = { all: new Set(), food: new Set(), supp: new Set(), med: new Set(), supplies: new Set() };
    currencyProducts.forEach(function (product) {
      scopeBrands.all.add(product.brand);
      scopeBrands[product.group].add(product.brand);
    });
    var bScopeBtns = document.querySelectorAll('#brandScopeBar [data-brand-scope]');
    for (var bsIdx = 0; bsIdx < bScopeBtns.length; bsIdx++) {
      var scopeKey = bScopeBtns[bsIdx].getAttribute('data-brand-scope');
      var selected = scopeKey === bScope;
      bScopeBtns[bsIdx].classList.toggle('active', selected);
      bScopeBtns[bsIdx].classList.toggle('is-empty', scopeBrands[scopeKey].size === 0);
      bScopeBtns[bsIdx].setAttribute('aria-pressed', String(selected));
      bScopeBtns[bsIdx].querySelector('[data-brand-count]').textContent = Utils.formatNumber(scopeBrands[scopeKey].size);
    }

    var brandGroups = Object.create(null);
    currencyProducts.forEach(function (prod) {
      if (bScope !== 'all' && prod.group !== bScope) return;
      var b = prod.brand;
      if (!brandGroups[b]) {
        brandGroups[b] = { products: [], activeSkus: 0, foodEatenUnits: Object.create(null), careUsedUnits: Object.create(null), spendCny: 0, spendJpy: 0 };
      }
      brandGroups[b].products.push(prod);
      if (prod.inStockQty > 0) brandGroups[b].activeSkus += 1;
      if (prod.group === 'food') {
        addUnitQuantity(brandGroups[b].foodEatenUnits, prod.unit, prod.eatenQty);
      } else {
        addUnitQuantity(brandGroups[b].careUsedUnits, prod.unit, prod.eatenQty);
      }
    });

    var allSpend = { CNY: 0, JPY: 0 };
    currencyItems.forEach(function (it) {
      if (it.sourceBatchId) return;
      var b = (it.brand || '未命名品牌').trim();
      var price = Number(it.price) || 0;
      if (price <= 0) return;
      var totalUnitsInBatch = (Number(it.quantity) || 0) + (Number(it.eatenCount) || (Number(it.quantity) <= 0 ? (Number(it.consumedCount) || Number(it.lastQuantity) || 1) : 0));
      var currency = it.currency === 'JPY' ? 'JPY' : 'CNY';
      var amount = price * totalUnitsInBatch;
      allSpend[currency] += amount;
      if (bScope !== 'all' && MP.getCategoryGroup(it.category) !== bScope) return;
      if (!brandGroups[b]) return;
      brandGroups[b][currency === 'JPY' ? 'spendJpy' : 'spendCny'] += amount;
    });

    var primaryKey = primaryCurrency === 'JPY' ? 'spendJpy' : 'spendCny';
    var sortingStock = st.brandSort === 'stock';
    var brandNames = Object.keys(brandGroups).sort(function (a, b) {
      var first = brandGroups[a], second = brandGroups[b];
      return (sortingStock ? second.activeSkus - first.activeSkus : second[primaryKey] - first[primaryKey]) ||
        (sortingStock ? second[primaryKey] - first[primaryKey] : second.activeSkus - first.activeSkus) ||
        a.localeCompare(b, 'zh-CN');
    });

    document.querySelectorAll('#brandCurrencyBar [data-brand-currency]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-brand-currency') === primaryCurrency));
    });
    document.getElementById('brandSortLabel').textContent = sortingStock ? '按在库款数排序' : '按累计购入排序';
    document.querySelector('#brandSortBtn span').textContent = sortingStock ? '在库款数' : '累计购入';
    document.getElementById('brandSortBtn').setAttribute('aria-label', sortingStock
      ? '当前按在库款数排序，点击切换至累计购入' : '当前按累计购入排序，点击切换至在库款数');
    document.getElementById('brandCurrencyNote').textContent =
      '占比按全部品牌' + (primaryCurrency === 'JPY' ? '日元' : '人民币') + '累计购入计算，不含其他币种';
    document.getElementById('brandTotalCountBadge').textContent = '共 ' + Utils.formatQuantity(brandNames.length, '个品牌');
    var brandEl = document.getElementById('brandStatsList');
    var showAllBtn = document.getElementById('brandShowAllBtn');
    showAllBtn.classList.toggle('hidden-view', brandNames.length <= 6);
    showAllBtn.setAttribute('aria-expanded', String(Boolean(st.brandShowAll)));
    showAllBtn.textContent = st.brandShowAll ? '收起' : '显示全部 ' + Utils.formatQuantity(brandNames.length, '个品牌');
    var visibleBrands = st.brandShowAll ? brandNames : brandNames.slice(0, 6);
    function brandTone(brand) {
      var hash = 0;
      Array.from(brand).forEach(function (char) { hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0; });
      return hash % 6;
    }
    function brandAmount(amount, currency) {
      return (currency === 'JPY' ? 'JP¥' : '¥') +
        amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, '');
    }
    if (brandNames.length === 0) {
      brandEl.innerHTML = '<div class="brand-list-empty">' +
        (scopeBrands.all.size ? '这个分类还没有品牌' : '这个币种还没有品牌') + '</div>';
    } else {
      brandEl.innerHTML = visibleBrands.map(function (brand) {
        var group = brandGroups[brand];
        var rows = group.products.map(function (product) {
          var inStock = product.inStockQty > 0;
          var low = inStock && product.inStockQty <= 1;
          return '<li class="brand-product-row">' +
            Utils.getCategoryIcon(product.category, 20) +
            '<span class="brand-product-name" title="' + Utils.escapeHtml(product.name) + '">' + Utils.escapeHtml(product.name) + '</span>' +
            '<span class="brand-product-stock' + (low ? ' is-low' : inStock ? ' has-stock' : '') + '">' +
              (inStock ? '余 ' + Utils.escapeHtml(Utils.formatQuantity(product.inStockQty, product.unit)) : product.discardedCount ? '已核销' : '已用完') +
            '</span></li>';
        }).join('');
        var amount = group[primaryKey];
        var percent = allSpend[primaryCurrency] > 0 ? amount / allSpend[primaryCurrency] * 100 : 0;
        var primaryText = amount > 0 ? brandAmount(amount, primaryCurrency) : '暂无金额';
        var percentLabel = percent > 0 && percent < 0.01 ? '小于 0.01' : Utils.formatNumber(percent, 2);
        var open = st.brandOpen === brand;
        var initial = Array.from(brand)[0].toUpperCase();
        return '<div class="brand-list-entry"><button type="button" class="brand-list-summary" data-brand-toggle="' +
          Utils.escapeHtml(brand) + '" aria-expanded="' + String(open) + '">' +
          '<span class="brand-avatar" data-tone="' + brandTone(brand) + '" aria-hidden="true">' + Utils.escapeHtml(initial) + '</span>' +
          '<span class="brand-list-info"><span class="brand-list-name">' + Utils.escapeHtml(brand) + '</span>' +
          '<span class="brand-list-stock">在库 ' + Utils.formatQuantity(group.activeSkus, '款') + '</span></span>' +
          '<span class="brand-list-value"><span class="brand-list-spend" title="' + Utils.escapeHtml(primaryText) + '">' +
          Utils.escapeHtml(primaryText) + '</span><span class="brand-spend-track" role="img" aria-label="占全部品牌' +
          (primaryCurrency === 'JPY' ? '日元' : '人民币') + '累计购入 ' + percentLabel + '%">' +
          (amount > 0 ? '<span style="width:' + percent + '%"></span>' : '') +
          '</span></span><span class="brand-list-arrow" aria-hidden="true"></span></button>' +
          '<div class="brand-products-wrap" aria-hidden="' + String(!open) + '"' + (open ? '' : ' inert') +
          '><div><ul class="brand-products">' + rows + '</ul></div></div></div>';
      }).join('');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
