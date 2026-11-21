/* Meow Pantry Feeding Analytics Engine (Food vs Supplement vs Medicine Separation + Drill-Down Filters) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats = {};

  function addUnitQuantity(totals, unit, quantity) {
    if (quantity > 0) totals[unit] = Utils.round2((totals[unit] || 0) + quantity);
  }

  function formatUnitQuantities(totals) {
    return Object.keys(totals).map(function (unit) {
      return Utils.formatQuantity(totals[unit], unit);
    }).join(' · ');
  }

  Stats.aggregateUniqueProducts = function () {
    var map = {};
    var list = [];
    MP.state.items.forEach(function (it) {
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
      if (palatability) entry.palatability = palatability;
      if (it.imageData && !entry.rep.imageData) entry.rep = it;
      if (q <= 0) {
        var cDays = Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
        if (cDays !== null && eaten > 0) {
          entry.totalDays += cDays;
          entry.daysUnits += eaten;
        }
      }
    });
    return list;
  };

  // Pure calculation helper (testable in Node without DOM) for verifying Food vs Supp vs Med separation!
  Stats.computeOverviewMetrics = function (items, logs) {
    var groupTotals = {
      food: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      supp: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      med:  { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 }
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
        var cd = Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
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

  function formatGroupValueStr(cny, jpy) {
    var parts = [];
    if (jpy > 0) parts.push(Utils.formatMoney(jpy, 'JPY'));
    if (cny > 0) parts.push(Utils.formatMoney(cny, 'CNY'));
    return parts.length ? parts.join(' · ') : '暂无金额';
  }

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

    var scopedCny = scope === 'all' ? (gt.food.cny + gt.supp.cny + gt.med.cny) : gt[scope].cny;
    var scopedJpy = scope === 'all' ? (gt.food.jpy + gt.supp.jpy + gt.med.jpy) : gt[scope].jpy;
    document.getElementById('forecastValues').innerHTML =
      (scopedCny > 0 ? '<div>在库价值 · 人民币<p><strong>' + Utils.formatMoney(scopedCny, 'CNY') + '</strong></p><small class="forecast-value-basis">按购买币种分别统计</small></div>' : '') +
      (scopedJpy > 0 ? '<div>在库价值 · 日元<p><strong>' + Utils.formatMoney(scopedJpy, 'JPY') + '</strong></p><small class="forecast-value-basis">按购买币种分别统计</small></div>' : '') +
      (!scopedCny && !scopedJpy ? '<div>在库价值<p><strong>暂无金额</strong></p></div>' : '');

    var scopeLabels = { all: '全部', food: '普通食品', supp: '营养品', med: '药品' };
    Array.prototype.forEach.call(scopeBtns, function (button) {
      var key = button.dataset.statsScope;
      var count = key === 'all' ? gt.food.batches + gt.supp.batches + gt.med.batches : gt[key].batches;
      button.innerHTML = '<span>' + scopeLabels[key] + '</span> <span>' + Utils.formatNumber(count) + '</span>';
      button.setAttribute('aria-pressed', String(key === scope));
    });
    var forecasts = MP.Forecast.compute(st.items, st.stockHistory, st.settings.dailyFeedGrams, Utils.getTodayStr());
    var showFood = scope === 'all' || scope === 'food';
    var alert = document.getElementById('forecastAlert');
    var urgent = Object.keys(forecasts).filter(function (key) { return forecasts[key].low; })
      .sort(function (a, b) { return forecasts[a].days - forecasts[b].days; })[0];
    alert.innerHTML = !showFood ? '' : urgent
      ? '<span>' + MP.CATEGORIES[urgent].label + '约还能吃 ' + Utils.formatDays(forecasts[urgent].days).text +
        '，建议补货</span><button type="button" data-forecast-action="restock" data-forecast-category="' + urgent + '">去补货 ›</button>'
      : '';
    alert.classList.toggle('hidden-view', !alert.innerHTML);

    var keys = showFood ? ['can', 'dry', 'freeze', 'treat'] : [];
    ['med', 'supp'].forEach(function (key) {
      if ((scope === 'all' || scope === key) && catStats[key].skus) keys.push(key);
    });
    var catGridHtml = keys.map(function (key) {
      var category = MP.CATEGORIES[key];
      var stock = catStats[key];
      var data = forecasts[key];
      var stockLabel = formatUnitQuantities(stock.stockByUnit) || '无库存';
      var history = formatUnitQuantities(stock.eatenByUnit);
      var average = Object.keys(stock.durationByUnit).map(function (unit) {
        var duration = stock.durationByUnit[unit];
        return '每' + Utils.escapeHtml(unit) + '约 ' + Utils.formatDays(Math.max(1, Math.round(duration.days / duration.quantity))).text;
      }).join(' · ');
      var showsPackageStatus = key === 'dry' || key === 'freeze';
      var packageStatus = showsPackageStatus ? packageStatusActions(key, st.items.filter(function (item) {
        return item.category === key;
      })) : '';
      var fullWidth = key === 'can' || (key === 'supp' && (!showFood || keys.includes('med')));
      var tone = forecastTone(data && data.days);
      var meter = '';
      var prediction = '';
      var remaining = '';
      var rate = '';
      if (data) {
        var coverage = data.days === null ? 0 : Math.min(100, data.days / 30 * 100);
        meter = '<div class="forecast-meter forecast-meter--' + tone + '" aria-hidden="true"><span style="width:' + coverage + '%"></span></div>';
        if (data.days !== null) {
          var daysLabel = Utils.formatDays(data.days).text;
          remaining = '<span class="forecast-days forecast-result--' + tone + '" aria-label="约还能吃 ' + daysLabel + '">' + daysLabel + '</span>';
          rate = '<span class="forecast-rate" title="' + (data.source === 'actual' ? '核销平均' : '设置值') +
            '">按每天 ' + Utils.formatQuantity(data.dailyGrams, '克') + '</span>';
        } else if (!data.dailyGrams) {
          prediction += '<button type="button" class="forecast-link" data-forecast-action="settings" data-forecast-category="' + key +
            '">设置每日量，查看天数</button>';
        } else {
          prediction += '<div class="forecast-result">暂无可换算库存</div>';
        }
        if (data.missing.length) {
          prediction += key === 'can' ? '<div class="forecast-missing">' + Stats.missingWeightNotice(data.missing) + '</div>'
            : '<div class="forecast-result">有 ' + Utils.formatQuantity(data.missing.length, '批') + '规格无法折算，未计入预测</div>';
        }
        if (data.estimated && showsPackageStatus) {
          var estimateHint = '有开封余量未填写，预测按整件估算';
          var estimateLine = data.days !== null ? '按每天' + Utils.formatQuantity(data.dailyGrams, '克') + ' · ' : '';
          rate = '<button type="button" class="forecast-rate forecast-estimate-line" data-forecast-action="estimate" title="' + estimateHint +
            '" aria-description="' + estimateHint + '">' + estimateLine + '按整件估算</button>';
        } else if (data.estimated) {
          prediction += '<details class="forecast-estimate"><summary>有开封余量未填写，按整件估算</summary><p>这一批未填写开封后的剩余量，预测暂按整件计算。</p></details>';
        }
      } else if (key === 'treat') {
        var weightSummary = treatWeightSummary(st.items);
        if (weightSummary) remaining = '<span class="forecast-rate">' + weightSummary + '</span>';
      }

      return '<article class="ios-card metric-card forecast-tile' + (fullWidth ? ' forecast-wide' : '') + ' forecast-tile--' + key + (showsPackageStatus ? ' forecast-tile--with-package-status' : '') +
        (tone === 'urgent' ? ' forecast-tile--urgent' : '') + '">' +
        '<button type="button" class="forecast-category" data-jump-cat="' + key + '"><strong>' +
          category.label + '</strong><span class="forecast-category-meta"><span class="batch-count">' + Utils.formatQuantity(stock.skus, '批') +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>' +
          (key === 'can' ? remaining : '') + '</span></button>' +
        '<div class="forecast-balance"><div><strong class="forecast-quantity">' +
          (key === 'can' ? Utils.formatQuantity(data.grams, '克') : Utils.escapeHtml(stockLabel)) + '</strong>' +
          (key === 'can' ? '<small class="forecast-units">' + Utils.escapeHtml(stockLabel) + '</small>' : '') + '</div>' +
          (key === 'can' ? rate : remaining ? '<div class="forecast-remaining">' + remaining + '</div>' : '') + '</div>' +
        meter + (key === 'can' ? '' : rate) +
        prediction +
        (history && key !== 'treat' ? '<div class="forecast-history"><span>累计核销 ' + Utils.escapeHtml(history) +
          '</span>' + (average ? '<span>' + average + '</span>' : '') + '</div>' : '') + packageStatus + '</article>';
    }).join('');
    if ((scope === 'all' || scope === 'supp' || scope === 'med') && !gt.supp.batches && !gt.med.batches) {
      catGridHtml += '<div class="empty-state forecast-empty forecast-wide">营养品和药品暂无库存</div>';
    } else if (!catGridHtml) {
      catGridHtml = '<div class="empty-state forecast-empty forecast-wide">当前分类暂无库存</div>';
    }
    document.getElementById('categoryStatsGrid').innerHTML = catGridHtml;

    var scopedItems = st.items.filter(function (item) {
      return item.quantity > 0 && (scope === 'all' || MP.getCategoryGroup(item.category) === scope);
    });
    var openedBatches = scopedItems.filter(Domain.isStockOpened).length;
    var expiringBatches = scopedItems.filter(function (item) { return Domain.evaluateItem(item).status === 'expiring'; }).length;
    var detailStatuses = Domain.summarizeStockDetailStatuses(scopedItems);
    var quantities = Domain.summarizeStockQuantity(scopedItems);
    var expiring = Object.values(detailStatuses).reduce(function (sum, row) { return sum + row.expiring; }, 0);
    var opened = Object.values(quantities.units).reduce(function (sum, row) { return sum + row.opened; }, 0);
    var expiringUnits = Object.keys(detailStatuses).filter(function (unit) { return detailStatuses[unit].expiring > 0; })
      .map(function (unit) { return Utils.formatQuantity(detailStatuses[unit].expiring, unit); }).join(' · ');
    var openedUnits = Object.keys(quantities.units).filter(function (unit) { return quantities.units[unit].opened > 0; })
      .map(function (unit) { return Utils.formatQuantity(quantities.units[unit].opened, unit); }).join(' · ');
    var healthEl = document.getElementById('stockHealthBox');
    var healthVisible = Boolean(expiringBatches || openedBatches);
    var healthFilter = expiringBatches && openedBatches ? 'expiring_or_opened' : expiringBatches ? 'expiring' : 'opened';
    healthEl.classList.toggle('hidden-view', !healthVisible);
    var expiringLabel = expiringBatches && !expiring ? Utils.formatQuantity(expiringBatches, '批') : expiringUnits;
    var openedLabel = openedBatches && !opened ? Utils.formatQuantity(openedBatches, '批') : openedUnits;
    healthEl.innerHTML = healthVisible ? '<span>' + expiringLabel +
      '临期 · ' + openedLabel +
      '已拆封</span><button type="button" data-jump-health="' + healthFilter + '" data-health-scope="' + scope + '">去查看 ›</button>' : '';
    var taskSummary = [];
    if (showFood && urgent) taskSummary.push(MP.CATEGORIES[urgent].label + '将断粮');
    if (healthVisible) taskSummary.push(expiringBatches ? expiringLabel + '临期' : openedLabel + '已拆封');
    document.getElementById('feedingTasks').classList.toggle('hidden-view', !taskSummary.length);
    document.getElementById('feedingTaskCount').textContent = Utils.formatQuantity(taskSummary.length, '项需要处理');
    document.getElementById('feedingTaskSummary').textContent = taskSummary.join(' · ');

    // 1C. Priority Feeding Queue (FEFO for food and supplements only.)
    var activeFoodAndSupp = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && MP.getCategoryGroup(it.category) !== 'med';
    });
    activeFoodAndSupp.sort(function (a, b) {
      return Number(Domain.isStockOpened(b)) - Number(Domain.isStockOpened(a)) ||
        (Utils.diffDaysFromToday(a.expDate) ?? Infinity) - (Utils.diffDaysFromToday(b.expDate) ?? Infinity);
    });
    document.getElementById('priorityFeedList').innerHTML = activeFoodAndSupp.slice(0, 5).map(function (item, index) {
      var ev = Domain.evaluateItem(item);
      var opened = Domain.isStockOpened(item);
      var reason = ev.status === 'expired' ? '已过期，请检查清理' : opened
        ? '已拆封 · ' + (ev.openRemaining === null ? '未填写开封保鲜期' : Utils.formatDays(ev.openRemaining).text + '内吃完')
        : '未拆封 · ' + (ev.expDays === null ? '未填写过期日期' : '剩 ' + Utils.formatDays(ev.expDays).text);
      return '<div class="priority-row' + (opened ? ' priority-row--opened' : '') + '">' +
        '<span class="priority-index">' + Utils.formatNumber(index + 1) + '</span>' +
        '<div class="priority-copy"><div class="priority-name"><span>' + Utils.escapeHtml(item.brand) +
          '</span> <strong>' + Utils.escapeHtml(item.name) + '</strong></div>' +
          '<div class="priority-reason' + (ev.status === 'expired' ? ' forecast-result--urgent' : '') + '">' + reason + '</div></div>' +
        '<span class="priority-quantity">余 ' + Utils.escapeHtml(Utils.formatQuantity(Number(item.quantity), item.unit)) + '</span>' +
        (ev.status !== 'expired' ? '<button type="button" class="btn-feed btn-feed--compact" aria-label="记喂食：' + Utils.escapeHtml(item.name) +
          '" data-priority-feed="' + Utils.escapeHtml(item.id) + '">' + '<span class="btn-feed__content">' + MP.UI.feedButtonContent() + '</span></button>' : '') +
        '</div>';
    }).join('') || '<div class="priority-empty">暂无在库食品或营养品</div>';

    // 1D. Future Expiry Month Timeline (Scoped)
    var scopedActive = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && (scope === 'all' || MP.getCategoryGroup(it.category) === scope);
    });
    var monthBuckets = {};
    scopedActive.forEach(function (it) {
      var ym = (it.expDate && it.expDate.length >= 7) ? it.expDate.slice(0, 7) : '未标注月份';
      if (!monthBuckets[ym]) {
        monthBuckets[ym] = { ym: ym, items: [], minDays: 99999 };
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
    document.getElementById('expiryTimelineCountBadge').textContent = '· ' + Utils.formatQuantity(sortedMonths.length, '个月份');
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
    var nearest = null;
    var nearestDays = Infinity;
    var monthsHtml = sortedMonths.map(function (ym) {
      var bucket = monthBuckets[ym];
      bucket.items.sort(function (a, b) { return (a.expDate || '9999').localeCompare(b.expDate || '9999'); });
      bucket.items.forEach(function (item) {
        var remaining = Utils.diffDaysFromToday(item.expDate);
        if (remaining !== null && remaining >= 0 && remaining < nearestDays) {
          nearest = item;
          nearestDays = remaining;
        }
      });
      var known = bucket.minDays !== 99999;
      var tone = timelineTone(known ? bucket.minDays : null);
      var ymTitle = Utils.formatMonthLabel(ym);
      var days = !known ? '未填写过期日期' : bucket.minDays < 0 ? '已过期' : Utils.formatDays(bucket.minDays).text;
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
    var nearestHtml = nearest ? '<div class="feeding-timeline-nearest forecast-result--' + timelineTone(nearestDays) +
      '"><div><strong>最近到期</strong> <time>' +
      Utils.escapeHtml(Utils.formatListDate(nearest.expDate)) + '</time><span class="forecast-days">' + (nearestDays === 0 ? '今天到期' : '剩 ' + Utils.formatDays(nearestDays).text) +
      '</span></div>' + timelineProduct(nearest) + '</div>' : '';
    document.getElementById('expiryMonthTimelineList').innerHTML = monthsHtml
      ? nearestHtml + '<ol class="feeding-month-track">' + monthsHtml + '</ol>'
      : '<div class="priority-empty">当前筛选范围暂无在库批次</div>';

    // ==================== SUB-VIEW 2: PALATABILITY & TOLERANCE ARCHIVE (Food vs Supp vs Med Separated!) ====================
    var uniqueProducts = Stats.aggregateUniqueProducts();
    var tierCounts = { love: 0, ok: 0, coax: 0, meh: 0, supp: 0, med: 0 };
    var evaluatedTotal = 0;
    uniqueProducts.forEach(function (prod) {
      if (!prod.palatability) return;
      evaluatedTotal += 1;
      if (prod.group === 'med') {
        tierCounts.med += 1;
      } else if (prod.group === 'supp') {
        tierCounts.supp += 1;
      } else if (tierCounts[prod.palatability] !== undefined) {
        tierCounts[prod.palatability] += 1;
      }
    });
    document.getElementById('tierTotalEvaluatedBadge').textContent = '已评 ' + Utils.formatQuantity(evaluatedTotal, '款');
    document.getElementById('tierEvaluatedBreakdown').textContent = '食品 ' +
      Utils.formatNumber(evaluatedTotal - tierCounts.supp - tierCounts.med) + ' · 营养品 ' +
      Utils.formatNumber(tierCounts.supp) + ' · 药品 ' + Utils.formatNumber(tierCounts.med);

    var tierLabels = {
      love: '超爱吃',
      ok:   '正常吃',
      coax: '需哄吃',
      meh:  '不爱吃',
      supp: '营养品接受度',
      med:  '药品耐受反应'
    };
    var tabBtns = document.querySelectorAll('#palTierTabBar [data-tier-tab]');
    var foodTiers = ['love', 'ok', 'coax', 'meh'];
    var distribution = document.getElementById('palTierDistribution');
    var ratedTiers = foodTiers.filter(function (key) { return tierCounts[key] > 0; });
    distribution.innerHTML = ratedTiers.map(function (key) {
      return '<span data-tier-segment="' + key + '" style="flex-grow:' + tierCounts[key] + '"></span>';
    }).join('');
    distribution.classList.toggle('hidden-view', !ratedTiers.length);
    distribution.setAttribute('aria-label', '普通食品适口性分布：' + ratedTiers.map(function (key) {
      return tierLabels[key] + ' ' + Utils.formatQuantity(tierCounts[key], '款');
    }).join('，'));
    for (var tIdx = 0; tIdx < tabBtns.length; tIdx++) {
      var tk = tabBtns[tIdx].getAttribute('data-tier-tab');
      var countLabel = tabBtns[tIdx].querySelector('[data-tier-count]');
      if (countLabel) countLabel.textContent = tierCounts[tk];
      else tabBtns[tIdx].innerHTML = Utils.getCategoryIcon(tk, 20) + '<span>' + tierLabels[tk] + ' (' + Utils.formatNumber(tierCounts[tk]) + ')</span>';
      tabBtns[tIdx].classList.toggle('pal-unrated', tierCounts[tk] === 0);
      tabBtns[tIdx].classList.toggle('active', tk === st.statsTierTab);
      tabBtns[tIdx].setAttribute('aria-pressed', String(tk === st.statsTierTab));
    }

    var tierMatched = uniqueProducts.filter(function (prod) {
      if (!prod.palatability) return false;
      if (st.statsTierTab === 'all') return true;
      if (st.statsTierTab === 'med') return prod.group === 'med';
      if (st.statsTierTab === 'supp') return prod.group === 'supp';
      return prod.group === 'food' && prod.palatability === st.statsTierTab;
    });

    var filterLabel = tierLabels[st.statsTierTab] || '全部';
    document.getElementById('palFilterSummary').textContent = '当前筛选：' + filterLabel + ' · ' + Utils.formatQuantity(tierMatched.length, '款');
    document.getElementById('clearPalFilterBtn').classList.toggle('hidden-view', st.statsTierTab === 'all');

    var tierListEl = document.getElementById('palTierCardsList');
    var tierPagerEl = document.getElementById('tierPaginationBar');
    if (tierMatched.length === 0) {
      if (tierPagerEl) tierPagerEl.classList.add('hidden-view');
      var foodFilter = foodTiers.includes(st.statsTierTab);
      var emptyIcon = foodFilter
        ? Utils.getPalatabilityIcon(st.statsTierTab)
        : (st.statsTierTab === 'all' ? Utils.getPalatabilityIcon('ok') : Utils.getCategoryIcon(st.statsTierTab, 20));
      var emptyMessage = st.statsTierTab === 'all' ? '暂无评价记录'
        : '还没有「' + filterLabel + '」的记录' + (foodFilter ? '，继续保持～' : '');
      tierListEl.innerHTML = '<div class="pal-record-empty">' + emptyIcon + '<span>' +
        Utils.escapeHtml(emptyMessage) + '</span></div>';
    } else {
      var tPageSize = Number(st.tierPageSize) || 5;
      var tTotalPages = Math.max(1, Math.ceil(tierMatched.length / tPageSize));
      if (st.tierPage > tTotalPages) st.tierPage = tTotalPages;
      if (st.tierPage < 1) st.tierPage = 1;
      var pagedTierItems = tierMatched.slice((st.tierPage - 1) * tPageSize, st.tierPage * tPageSize);

      if (tierMatched.length > tPageSize) {
        tierPagerEl.classList.remove('hidden-view');
        document.getElementById('tierPageInfoText').textContent =
          '第 ' + Utils.formatNumber(st.tierPage) + ' / ' + Utils.formatQuantity(tTotalPages, '页') + ' (共 ' + Utils.formatQuantity(tierMatched.length, '款') + ')';
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
        var catInfo = MP.CATEGORIES[prod.category] || MP.CATEGORIES.dry;
        var palBadge = MP.getPalatabilityBadgeInfo(prod.rep);
        if (prod.group === 'food' && palBadge?.key === st.statsTierTab) palBadge = null;
        var coverSrc = MP.getItemCoverSrc(prod.rep);
        var stockTag = prod.inStockQty > 0
          ? '<span style="font-size:11px;font-weight:700;color:var(--ok);background:var(--ok-soft);padding:2px 7px;border-radius:6px;">在库 ' + Utils.escapeHtml(Utils.formatQuantity(prod.inStockQty, prod.unit)) + '</span>'
          : '<span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--border-warm);padding:2px 7px;border-radius:6px;">已用完/断货</span>';
        return (
          '<div class="pal-record-card">' +
            '<img class="pal-record-cover" src="' + coverSrc + '" alt="' + Utils.escapeHtml(prod.name) + '">' +
            '<div class="pal-record-main">' +
              '<div class="pal-record-tags">' +
                '<span style="font-size:11px;font-weight:700;color:var(--text-main);background:var(--border-warm);padding:1px 6px;border-radius:5px;">' + Utils.getCategoryIcon(prod.category, 20) + ' ' + catInfo.label + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:var(--accent-strong);background:var(--accent-soft);padding:1px 7px;border-radius:5px;">' + Utils.escapeHtml(prod.brand) + '</span>' +
                (palBadge ? '<span style="font-size:11px;font-weight:700;background:' + palBadge.bg + ';color:' + palBadge.text + ';padding:1px 7px;border-radius:999px;">' + Utils.formatPalatabilityBadge(prod.rep, palBadge) + '</span>' : '') +
              '</div>' +
              '<div class="pal-record-title">' +
                Utils.escapeHtml(prod.name) + (prod.spec ? (' <span class="pal-record-spec">(' + Utils.escapeHtml(prod.spec) + ')</span>') : '') +
              '</div>' +
            '</div>' +
            '<div class="pal-record-footer"><div class="pal-record-quantities">' +
                stockTag +
                '<span>累计已核销 ' + Utils.escapeHtml(Utils.formatQuantity(prod.eatenQty, prod.unit)) + '</span>' +
              '</div>' +
              '<button type="button" data-tier-restock="' + Utils.escapeHtml(prod.rep.id) + '">＋复购</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    // ==================== SUB-VIEW 3A: 30-DAY FEEDING PREFERENCES (Food Strictly Separated from Supp & Med!) ====================
    var r30 = metrics.recent30;
    document.getElementById('recent30CountBadge').textContent =
      Utils.formatQuantity(r30.food.length, '顿');

    var prefBox = document.getElementById('recent30PrefBox');
    var foodHtml;
    if (r30.all.length === 0) {
      foodHtml = '<div style="font-size:12.5px;color:var(--text-muted);padding:8px 0;">近期暂无饮食记录，去底部「饮食记录」记几笔就能看到主子的饮食分析啦</div>';
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
        '<span class="feeding-care-label">' + icon + label + ' ' + Utils.formatQuantity(logs.length, '次') + '</span>' +
        '<div class="feeding-care-tags">' + tags + '</div></div>';
    }

    prefBox.innerHTML = foodHtml + '<div class="feeding-care-summary">' +
      '<h3>营养品与药品</h3><p>不计入日常饮食占比</p>' +
      renderCareSummary(r30.supp, '营养品', Utils.getCategoryIcon('supp', 20)) +
      renderCareSummary(r30.med, '用药', Utils.uiIcon('stethoscope', 20)) +
      (r30.nursing.length ? renderCareSummary(r30.nursing, '护理', Utils.uiIcon('clipboard-copy', 20)) : '') +
      '</div>';

    // ==================== SUB-VIEW 3B: BRAND DEEP ARCHIVE (Filterable by Food / Supp / Med) ====================
    var bScope = st.brandScopeFilter || 'all';
    var bScopeBtns = document.querySelectorAll('#brandScopeBar [data-brand-scope]');
    for (var bsIdx = 0; bsIdx < bScopeBtns.length; bsIdx++) {
      bScopeBtns[bsIdx].classList.toggle('active', bScopeBtns[bsIdx].getAttribute('data-brand-scope') === bScope);
    }

    var brandGroups = {};
    uniqueProducts.forEach(function (prod) {
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

    st.items.forEach(function (it) {
      if (it.sourceBatchId) return;
      if (bScope !== 'all' && MP.getCategoryGroup(it.category) !== bScope) return;
      var b = (it.brand || '未命名品牌').trim();
      if (!brandGroups[b]) return;
      var price = Number(it.price) || 0;
      if (price <= 0) return;
      var totalUnitsInBatch = (Number(it.quantity) || 0) + (Number(it.eatenCount) || (Number(it.quantity) <= 0 ? (Number(it.consumedCount) || Number(it.lastQuantity) || 1) : 0));
      if (it.currency === 'JPY') {
        brandGroups[b].spendJpy += price * totalUnitsInBatch;
      } else {
        brandGroups[b].spendCny += price * totalUnitsInBatch;
      }
    });

    var brandNames = Object.keys(brandGroups).sort(function (a, b) {
      return brandGroups[b].activeSkus - brandGroups[a].activeSkus || brandGroups[b].products.length - brandGroups[a].products.length;
    });

    document.getElementById('brandTotalCountBadge').textContent = '共 ' + Utils.formatQuantity(brandNames.length, '个品牌');
    var brandEl = document.getElementById('brandStatsList');
    var brandPagerEl = document.getElementById('brandPaginationBar');
    var pagedBrandNames = Utils.paginateList(brandNames, st, 'brandPage', brandPagerEl);
    if (brandNames.length === 0) {
      brandEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">当前分类下暂无品牌记录</div>';
    } else {
      brandEl.innerHTML = pagedBrandNames.map(function (brand) {
        var group = brandGroups[brand];
        var rows = group.products.map(function (product) {
          var inStock = product.inStockQty > 0;
          return '<li class="brand-product-row">' +
            Utils.getCategoryIcon(product.category) +
            '<span class="brand-product-name">' + Utils.escapeHtml(product.name) + '</span>' +
            '<span class="brand-product-stock' + (inStock ? ' has-stock' : '') + '">' +
              (inStock ? '余 ' + Utils.escapeHtml(Utils.formatQuantity(product.inStockQty, product.unit)) : '已用完') +
            '</span></li>';
        }).join('');
        return '<details class="brand-list-entry"><summary class="brand-list-summary">' +
          '<span class="brand-list-info"><span class="brand-list-name">' + Utils.escapeHtml(brand) + '</span>' +
          '<span class="brand-list-spend' + (group.spendCny || group.spendJpy ? '' : ' is-empty') + '">累计购入 ' +
          formatGroupValueStr(group.spendCny, group.spendJpy) + '</span></span>' +
          '<span class="brand-list-count">在库 ' + Utils.formatQuantity(group.activeSkus, '款') + '</span>' +
          '</summary><ul class="brand-products">' + rows + '</ul></details>';
      }).join('');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
