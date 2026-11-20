/* Daily feeding and its history view. All portion conversions are display-only. */
(function (global) {
  'use strict';
  var MP = global.MeowPantry;
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var UI = MP.UI;
  var PAGE_SIZE = 20;
  var categories = ['dry', 'freeze', 'can'];
  var slots = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
  var weekEnd = Utils.getTodayStr();
  var showingHistory = false;
  var historyFilter = 'all';
  var historyLimit = PAGE_SIZE;
  var historyScroll = 0;
  var esc = Utils.escapeHtml;
  var quantity = Utils.formatQuantity;
  var bell = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8m-8 12a2 2 0 0 0 4 0"/></svg>';

  var MED_REMINDER_WINDOW_DAYS = 7;
  var reminderIntervals = { 30: '1个月后', 60: '2个月后', 90: '3个月后', 180: '半年后', 365: '1年后' };
  var stethoscope = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3v1m6-1v1M4 4H3v5a5 5 0 0 0 10 0V4h-1M8 14v2a5 5 0 0 0 10 0v-2"/><circle cx="18" cy="11" r="3"/></svg>';
  var checkIcon = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg>';

  function careInfo(log, product) {
    var subtype = String(log.subtype || product.subtype || '').trim();
    var group = MP.getCategoryGroup(log.category);
    if (group === 'supp') return { type: '营养品', verb: '补充', subtype: subtype };
    if (group === 'med' || log.mealSlot === 'care') {
      var type = /驱虫|外驱|内驱/.test(subtype) ? '驱虫' : '用药';
      return { type: type, verb: type, subtype: subtype };
    }
    return null;
  }

  function reminderStatus(days) {
    return days < 0 ? '已过期 ' + -days + ' 天' : days === 0 ? '今天' : '还有 ' + days + ' 天';
  }

  function reminderTone(days) {
    return days < 0 ? 'danger' : days <= MED_REMINDER_WINDOW_DAYS ? 'warning' : '';
  }

  function reminderInterval(days) {
    if (!(days > 0)) return '';
    if (reminderIntervals[days]) return reminderIntervals[days];
    if (days < 30) return days + '天后';
    if (days < 360) return Math.round(days / 30) + '个月后';
    return Math.round(days / 365) + '年后';
  }

  function detailReminder(log, care, today) {
    var due = Utils.formatRelativeYearDate(log.nextDueDate, today);
    if (!due || !care) return '';
    var days = Utils.diffDaysFromToday(log.nextDueDate, today);
    var tone = reminderTone(days);
    var suffix = tone ? reminderStatus(days) : reminderInterval(log.reminderDays);
    return '<p class="daily-support daily-reminder" data-reminder-tone="' + tone + '">' + bell +
      '下次' + esc(care.verb) + ' ' + esc(due) + (suffix ? ' · ' + esc(suffix) : '') + '</p>';
  }

  UI.renderMedReminderBanner = function () {
    var today = Utils.getTodayStr();
    var latest = new Map();
    MP.state.logs.forEach(function (log) {
      var product = Domain.resolveLogProduct(log);
      var care = careInfo(log, product);
      if (!care) return;
      var key = JSON.stringify([product.brand, product.name, log.category, care.type].map(function (value) {
        return String(value || '').trim().toLowerCase();
      }));
      var previous = latest.get(key);
      var time = clock(log);
      if (!previous || log.date > previous.log.date ||
          (log.date === previous.log.date && time !== null && previous.time !== null && time > previous.time)) {
        latest.set(key, { log: log, product: product, time: time });
      }
    });
    var due = Array.from(latest.values()).filter(function (entry) {
      entry.days = Utils.diffDaysFromToday(entry.log.nextDueDate, today);
      return !entry.log.reminderDone && entry.days !== null && entry.days <= MED_REMINDER_WINDOW_DAYS;
    }).sort(function (a, b) { return a.days - b.days; });

    var overdue = due.filter(function (entry) { return entry.days < 0; }).length;
    var box = el('dailyMedReminders');
    var wasExpanded = Boolean(box.querySelector('details[open]'));
    var pantry = el('pantryOverdueMedReminder');
    pantry.classList.toggle('hidden-view', !overdue);
    pantry.textContent = overdue ? '有 ' + overdue + ' 项用药已过期 ›' : '';
    el('dailyMedReminderDot').classList.toggle('hidden-view', !due.length);
    el('navBtnDaily').setAttribute('aria-label', due.length ? '饮食记录，有用药提醒' : '饮食记录');
    box.classList.toggle('hidden-view', !due.length);
    if (!due.length) { box.replaceChildren(); return; }

    function renderEntry(entry) {
      var log = entry.log;
      var product = entry.product;
      return '<div class="med-reminder-card" data-reminder-tone="' + reminderTone(entry.days) + '">' +
        '<span class="med-reminder-icon">' + stethoscope + '</span><div class="med-reminder-copy">' +
        '<div class="med-reminder-title"><span class="med-reminder-name"><span>' + esc(knownBrand(product)) +
        '</span> <strong>' + esc(product.name) + '</strong></span><span class="med-reminder-status">' +
        esc(reminderStatus(entry.days)) + '</span></div><p>上次 ' +
        esc(Utils.formatRelativeYearDate(log.date, today)) + ' · 计划 ' +
        esc(Utils.formatRelativeYearDate(log.nextDueDate, today)) + '</p></div>' +
        '<button class="med-reminder-action" type="button" data-record-reminder="' + esc(log.id) +
        '"><span>' + checkIcon + '记录</span></button></div>';
    }

    if (due.length === 1) { box.innerHTML = renderEntry(due[0]); return; }
    var first = due[0];
    var more = [];
    if (overdue > 1) more.push('另 ' + (overdue - 1) + ' 项已过期');
    if (due.length - Math.max(1, overdue)) more.push('另 ' + (due.length - Math.max(1, overdue)) + ' 项临近计划日');
    var summary = [knownBrand(first.product), first.product.name].filter(Boolean).join(' ') +
      ' · ' + reminderStatus(first.days) + (more.length ? '，' + more.join('，') : '');
    box.innerHTML = '<details class="med-reminder-group" data-reminder-tone="' + reminderTone(first.days) +
      '"' + (wasExpanded ? ' open' : '') + '><summary class="med-reminder-card"><span class="med-reminder-icon">' +
      stethoscope + '</span><div class="med-reminder-copy"><strong>' + due.length + ' 项用药提醒</strong><p title="' +
      esc(summary) + '">' + esc(summary) + '</p></div><span class="med-reminder-action"><span>查看</span></span></summary>' +
      '<div class="med-reminder-list">' + due.map(renderEntry).join('') + '</div></details>';
  };

  function el(id) { return document.getElementById(id); }

  function dateLabel(date) {
    return Utils.formatSentenceDate(date) + ' ' + Utils.getWeekdayName(date);
  }

  function isFood(log) { return MP.getCategoryGroup(log.category) === 'food'; }

  function weekTitle(start, end) {
    var from = start.slice(0, 7);
    var to = end.slice(0, 7);
    var firstDay = Number(start.slice(-2));
    var lastDay = Number(end.slice(-2));
    var firstMonth = Utils.formatMonthLabel(from);
    if (from === to) return firstMonth + ' · ' + firstDay + '–' + lastDay + '日';
    var secondMonth = from.slice(0, 4) === to.slice(0, 4)
      ? Number(to.slice(5)) + '月' : Utils.formatMonthLabel(to);
    return firstMonth + '–' + secondMonth + ' · ' + firstDay + '日–' + lastDay + '日';
  }

  UI.syncDailyWeek = function (date, reset) {
    var first = Utils.shiftDaysFromDate(weekEnd, -6);
    if (reset || date < first || date > weekEnd) weekEnd = date;
  };

  UI.shiftDailyWeek = function (offset) {
    var today = Utils.getTodayStr();
    if (offset > 0 && weekEnd >= today) return MP.state.selectedLogDate;
    weekEnd = Utils.shiftDaysFromDate(weekEnd, offset);
    if (weekEnd > today) weekEnd = today;
    var shifted = Utils.shiftDaysFromDate(MP.state.selectedLogDate, offset);
    var start = Utils.shiftDaysFromDate(weekEnd, -6);
    return shifted < start ? start : shifted > weekEnd ? weekEnd : shifted;
  };

  function renderWeek(logsByDate, selected, today) {
    var first = Utils.shiftDaysFromDate(weekEnd, -6);
    el('dailyWeekTitleText').textContent = weekTitle(first, weekEnd);
    el('dailyNextWeek').disabled = weekEnd >= today;
    el('dailyPastWeek').classList.toggle('hidden-view', first <= today && today <= weekEnd);
    el('dailyPastDate').textContent = dateLabel(selected);
    el('dailyWeekDays').innerHTML = Array.from({ length: 7 }, function (_, index) {
      var date = Utils.shiftDaysFromDate(first, index);
      var count = (logsByDate.get(date) || []).length;
      var label = dateLabel(date) + '，' + quantity(count, '条记录');
      return '<button type="button" data-daily-date="' + date + '" aria-label="' + esc(label) + '"' +
        (date === selected ? ' aria-current="date"' : '') + '><span>' + Utils.getWeekdayName(date) + '</span><strong>' +
        Number(date.slice(-2)) + '</strong><i class="' + (count ? 'has-record' : '') + '" aria-hidden="true"></i></button>';
    }).join('');
  }

  UI.syncDailyQuickFeedFade = function () {
    var track = el('dailyQuickFeedTrack');
    if (!track || !track.clientWidth) return;
    track.parentElement.classList.toggle('has-more', track.scrollWidth - track.clientWidth - track.scrollLeft > 1);
  };

  function renderQuickFeed(items) {
    var candidates = items.filter(function (item) {
      return item.quantity > 0 && Domain.evaluateItem(item).status !== 'expired';
    });
    function score(item) {
      return (item.isOpened ? (item.openRemainFraction > 0 ? 100 : 60) : 0) + (MP.isFoodCategory(item.category) ? 20 : 0);
    }
    candidates.sort(function (a, b) {
      return score(b) - score(a) || Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays;
    });
    var priorTrack = el('dailyQuickFeedTrack');
    var scrollLeft = priorTrack ? priorTrack.scrollLeft : 0;
    el('dailyQuickFeedBox').innerHTML = candidates.length ? '<p class="daily-support">常喂</p>' +
      '<div class="daily-quick-feed-strip"><div id="dailyQuickFeedTrack" class="filter-chips no-scrollbar">' +
      candidates.slice(0, 5).map(function (item) {
        return '<button type="button" class="pill-chip" data-quick-feed-item="' + esc(item.id) + '">' + esc(item.name) + '</button>';
      }).join('') + '</div></div>' : '';
    el('dailyQuickFeedBox').classList.toggle('hidden-view', !candidates.length);
    var track = el('dailyQuickFeedTrack');
    if (track) {
      track.scrollLeft = scrollLeft;
      track.addEventListener('scroll', UI.syncDailyQuickFeedFade, { passive: true });
      UI.syncDailyQuickFeedFade();
    }
  }

  function parseWeight(text) {
    var value = /^(约\s*)?(\d+(?:\.\d+)?)\s*(kg|千克|g|克)$/i.exec(text);
    if (!value) return null;
    return { grams: Number(value[2]) * (/^(kg|千克)$/i.test(value[3]) ? 1000 : 1), estimated: Boolean(value[1]) };
  }

  function displayAmount(log) {
    var amount = String(log.amount || '').trim();
    var primary = amount;
    var piece = /^(\d+(?:\.\d+)?)\s*([支包袋盒杯罐瓶粒件份])$/.exec(amount);
    if (piece) primary = quantity(Number(piece[1]), piece[2]);
    var weight = parseWeight(amount);
    if (weight) return { primary: (weight.estimated ? '约' : '') + quantity(weight.grams, '克'), grams: isFood(log) ? weight.grams : null };
    if (!isFood(log)) return { primary: primary, grams: null };

    if (!categories.includes(log.category)) return { primary: amount, grams: null };

    var product = Domain.resolveLogProduct(log, true);
    var hint = /\s*[（(]([^（）()]+)[）)]$/.exec(amount);
    var portion = hint ? amount.slice(0, hint.index).trim() : amount;
    var packageItem = { unit: log.productUnit || product.unit };
    var specifiedUnit = /(支|包|袋|盒|杯|罐|瓶|粒|件|份)$/.exec(portion);
    if (!packageItem.unit && specifiedUnit) packageItem.unit = specifiedUnit[1];
    var parsed = UI.parseFeedPortion(portion, packageItem);
    var fraction = parsed.valid ? parsed.fraction : parsed.finish ? (log.deductedFrac || log.deductedUnit) : 0;
    var unitWeight = Number(log.productUnitWeightGrams || product.unit_net_weight_g);
    var grams = fraction > 0 && unitWeight > 0 ? fraction * unitWeight : null;
    if (grams === null && hint) {
      var recordedEstimate = parseWeight(hint[1]);
      if (recordedEstimate) grams = recordedEstimate.grams;
    }
    if (grams === null) return { primary: amount, grams: null };
    var estimated = '约' + quantity(grams, '克');
    return log.category === 'can' && specifiedUnit
      ? { primary: portion.replace(/\s+/g, ''), secondary: estimated, grams: grams }
      : { primary: estimated, grams: grams };
  }

  function mealName(log) {
    if (log.category === 'med') return '用药';
    return Utils.formatMealSlot(log.mealSlot);
  }

  function clock(log) {
    var raw = typeof log.time === 'string' ? log.time : '';
    if (!raw && typeof log.timestamp === 'string' && log.timestamp.slice(0, 10) === log.date) raw = log.timestamp.slice(11);
    var value = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    if (!value || Number(value[1]) > 23 || Number(value[2]) > 59 || Number(value[3] || 0) > 59) return null;
    return Number(value[1]) * 3600 + Number(value[2]) * 60 + Number(value[3] || 0);
  }

  function orderedLogs(logs) {
    // Stored newest first. Reverse a copy so equal keys keep entry order.
    return logs.slice().reverse().sort(function (a, b) {
      var care = Number(!isFood(a)) - Number(!isFood(b));
      if (care) return care;
      var aTime = clock(a);
      var bTime = clock(b);
      if (aTime !== null && bTime !== null) return aTime - bTime;
      if (aTime !== null || bTime !== null) return aTime !== null ? -1 : 1;
      var aMeal = slots.indexOf(Utils.normalizeMealSlot(a.mealSlot));
      var bMeal = slots.indexOf(Utils.normalizeMealSlot(b.mealSlot));
      return (aMeal < 0 ? slots.length : aMeal) - (bMeal < 0 ? slots.length : bMeal);
    });
  }

  function renderTotals(rows, isToday) {
    var settings = MP.state.settings.dailyFeedGrams || {};
    var box = el('dailyTotals');
    if (!categories.some(function (key) { return Number(settings[key]) > 0; })) {
      box.innerHTML = '<button type="button" class="ios-btn-text" data-forecast-action="settings" data-forecast-category="dry">设置每日喂食量，查看每日对比 ›</button>';
      return;
    }
    var totals = { dry: 0, freeze: 0, can: 0 };
    var unknown = 0;
    rows.forEach(function (row) {
      if (!categories.includes(row.log.category)) return;
      if (row.amount.grams === null) unknown++;
      else totals[row.log.category] += row.amount.grams;
    });
    box.innerHTML = '<div class="daily-heading"><h3 class="daily-card-title">' + (isToday ? '今日合计' : '当日合计') +
      '</h3><span class="daily-support">对比每日喂食量</span></div><div class="daily-total-grid">' +
      categories.map(function (key) {
        var target = Number(settings[key]);
        var eaten = totals[key];
        var value = '<strong data-consumed-grams>' + (target > 0 ? Utils.formatNumber(eaten, 0) : quantity(eaten, '克')) + '</strong>';
        var label = '<span class="daily-support">' + MP.CATEGORIES[key].label + '</span>';
        if (!(target > 0)) return '<button type="button" class="daily-total-unset" data-forecast-action="settings" data-forecast-category="' + key + '">' +
          label + value + '<span class="daily-target">未设目标</span></button>';
        var over = eaten > target;
        return '<div class="daily-total-cell">' + label + '<div class="daily-total-values">' + value +
          '<span class="daily-target">/' + quantity(target, '克') + '</span>' +
          (over ? '<span class="daily-target daily-over" title="超' + quantity(eaten - target, '克') +
            '"> · 超' + quantity(eaten - target, '克') + '</span>' : '') + '</div>' +
          '<div class="daily-total-track" aria-hidden="true"><span class="' + (over ? 'is-over' : '') + '" style="width:' +
          Math.min(100, eaten / target * 100) + '%"></span></div></div>';
      }).join('') + '</div>' + (unknown ? '<p class="daily-support">' + quantity(unknown, '条') + '份量无法换算，未计入合计</p>' : '');
  }

  function knownBrand(product) {
    var brand = String(product.brand || '').trim();
    return brand === '未命名' || brand === '未命名品牌' ? '' : brand;
  }

  function displayedProductName(log) {
    var product = Domain.resolveLogProduct(log);
    var brand = knownBrand(product);
    return !isFood(log) && brand ? brand + ' ' + product.name : product.name;
  }

  function renderDetails(rows, isToday) {
    var food = rows.filter(function (row) { return isFood(row.log); }).length;
    el('dailyTotalCountBadge').textContent = '喂食 ' + quantity(food, '顿') + ' · 护理 ' + quantity(rows.length - food, '次');
    var empty = food ? '' : '<div class="empty-state daily-empty">' +
      '<span>' + (isToday ? '今天还没有喂食记录' : '这天没有喂食记录') +
      '</span><button type="button" class="ios-btn-text" data-daily-add>记一条</button></div>';
    var records = rows.map(function (row) {
      var log = row.log;
      var product = Domain.resolveLogProduct(log);
      var brand = knownBrand(product);
      var name = brand ? brand + ' ' + product.name : product.name;
      var category = MP.CATEGORIES[log.category] || MP.CATEGORIES.dry;
      var care = careInfo(log, product);
      var heading = care ? care.type + (care.subtype && care.subtype !== care.type ? ' · ' + care.subtype : '')
        : mealName(log) + ' · ' + category.label;
      var id = esc(log.id);
      return '<li class="daily-record' + (care ? ' daily-record--care' : '') + '">' + Utils.getCategoryIcon(log.category) +
        '<div class="daily-record-copy"><p class="daily-support">' + esc(heading) + '</p><p class="daily-card-title daily-record-name" title="' + esc(name) + '">' +
        (brand ? '<span>' + esc(brand) + '</span> ' : '') + '<strong>' + esc(product.name) + '</strong></p>' +
        (log.note ? '<p class="daily-support">' + esc(log.note) + '</p>' : '') +
        detailReminder(log, care, Utils.getTodayStr()) +
        '</div><div class="daily-record-amount"><strong>' + esc(row.amount.primary) + '</strong>' +
        (row.amount.secondary ? '<span class="daily-support">· ' + esc(row.amount.secondary) + '</span>' : '') + '</div>' +
        '<details class="daily-record-menu"><summary class="daily-record-more" aria-label="更多操作"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></summary><div class="daily-record-menu-items">' +
        '<button type="button" data-edit-log="' + id + '">编辑</button><button type="button" data-del-log="' + id + '">删除</button></div></details></li>';
    }).join('');
    el('dailyFeedTimeline').innerHTML = empty + (records ? '<ul class="ios-card daily-records">' + records + '</ul>' : '');
  }

  function groupedLogs() {
    var map = new Map();
    MP.state.logs.forEach(function (log) {
      if (!map.has(log.date)) map.set(log.date, []);
      map.get(log.date).push(log);
    });
    return map;
  }

  function historySummary(logs) {
    var counts = new Map();
    var care = 0;
    logs.forEach(function (log) {
      if (!isFood(log)) { care++; return; }
      var label = MP.CATEGORIES[log.category].label;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    var parts = Array.from(counts, function (row) { return row[0] + ' ' + quantity(row[1], '顿'); });
    if (care) parts.push('护理 ' + quantity(care, '次'));
    return parts.join(' · ');
  }

  function renderHistory(logsByDate, today) {
    var days = [];
    Array.from(logsByDate.keys()).sort().reverse().forEach(function (date) {
      var matches = logsByDate.get(date).filter(function (log) {
        return historyFilter === 'all' || (historyFilter === 'food') === isFood(log);
      });
      if (matches.length) days.push({ date: date, logs: matches });
    });
    el('dailyHistoryCount').textContent = '共 ' + quantity(days.length, '天') + '有记录，空白日期不显示';
    el('dailyHistoryFilters').querySelectorAll('button').forEach(function (button) {
      var active = button.dataset.dailyHistoryFilter === historyFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    var monthCounts = new Map();
    days.forEach(function (day) {
      var month = day.date.slice(0, 7);
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    });
    var visibleMonths = new Map();
    days.slice(0, historyLimit).forEach(function (day) {
      var ym = day.date.slice(0, 7);
      if (!visibleMonths.has(ym)) visibleMonths.set(ym, []);
      visibleMonths.get(ym).push(day);
    });
    el('dailyHistoryList').innerHTML = Array.from(visibleMonths, function (entry) {
      return '<section><div class="daily-heading daily-detail-heading"><h3 class="daily-card-title">' +
        esc(Utils.formatMonthLabel(entry[0])) + '</h3><span class="daily-support">' + quantity(monthCounts.get(entry[0]), '天') +
        '</span></div><div class="daily-history-days">' + entry[1].map(function (day) {
          var ordered = orderedLogs(day.logs);
          var summary = ordered.slice(0, 3).map(function (log) {
            var amount = displayAmount(log);
            return displayedProductName(log) + ' ' + amount.primary + (amount.secondary ? ' · ' + amount.secondary : '');
          }).join(' · ') + (ordered.length > 3 ? ' …' : '');
          return '<button type="button" class="ios-card daily-history-day" data-daily-history-date="' + esc(day.date) + '">' +
            '<span class="daily-history-date"><strong>' + Number(day.date.slice(-2)) + '</strong><span>' + Utils.getWeekdayName(day.date) + '</span></span>' +
            '<span class="daily-history-copy"><span title="' + esc(summary) + '">' + esc(summary) + '</span><span class="daily-support">' +
            (day.date === today ? '今天 · ' : '') + esc(historySummary(day.logs)) + '</span></span>' +
            '<span class="daily-support">' + quantity(day.logs.length, '条') + ' ›</span></button>';
        }).join('') + '</div></section>';
    }).join('') || '<p class="empty-state">暂无符合条件的饮食记录</p>';
    el('dailyHistoryMore').classList.toggle('hidden-view', days.length <= historyLimit);
    el('dailyHistoryEnd').classList.toggle('hidden-view', !days.length || days.length > historyLimit);
  }

  UI.openDailyHistory = function () {
    showingHistory = true;
    UI.renderDailyView();
    window.scrollTo(0, historyScroll);
  };

  UI.closeDailyHistory = function () {
    historyScroll = window.scrollY || 0;
    showingHistory = false;
    UI.renderDailyView();
    window.scrollTo(0, 0);
  };

  UI.filterDailyHistory = function (filter) {
    if (filter === historyFilter) return;
    historyFilter = filter;
    historyLimit = PAGE_SIZE;
    historyScroll = 0;
    UI.renderDailyView();
    window.scrollTo(0, 0);
  };

  UI.loadMoreDailyHistory = function () {
    historyLimit += PAGE_SIZE;
    UI.renderDailyView();
  };

  UI.renderDailyView = function () {
    var today = Utils.getTodayStr();
    var selected = MP.state.selectedLogDate || today;
    var logs = groupedLogs();
    el('dailyHome').classList.toggle('hidden-view', showingHistory);
    el('dailyHistory').classList.toggle('hidden-view', !showingHistory);
    if (showingHistory) { renderHistory(logs, today); return; }
    UI.syncDailyWeek(selected);
    el('dailyDateLabel').textContent = dateLabel(selected) + (selected === today ? ' · 今天' : '');
    renderWeek(logs, selected, today);
    renderQuickFeed(MP.state.items);
    var rows = orderedLogs(logs.get(selected) || []).map(function (log) { return { log: log, amount: displayAmount(log) }; });
    renderTotals(rows, selected === today);
    renderDetails(rows, selected === today);
  };
})(typeof window !== 'undefined' ? window : globalThis);
