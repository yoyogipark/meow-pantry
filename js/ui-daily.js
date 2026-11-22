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
  var recordTypes = { food: ['喂食', '顿'], medication: ['用药', '次'], nursing: ['护理', '次'] };
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
    if (Domain.getCareType(log) === 'nursing') return { type: '护理', verb: '护理', icon: 'clipboard-copy' };
    if (group === 'supp') return { type: '营养品', verb: '补充', subtype: subtype };
    if (group === 'med' || log.mealSlot === 'care') {
      var type = /驱虫|外驱|内驱/.test(subtype) ? '驱虫' : '用药';
      return { type: type, verb: type, subtype: subtype, icon: 'stethoscope' };
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
      var identity = care.type === '护理' ? (log.careProjects || []).slice().sort() : [product.brand, product.name, log.category];
      var key = JSON.stringify([care.type].concat(identity).map(function (value) {
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
    var dueNursing = due.filter(function (entry) { return Domain.getCareType(entry.log) === 'nursing'; });
    var overdueMedication = overdue - dueNursing.filter(function (entry) { return entry.days < 0; }).length;
    var box = el('dailyMedReminders');
    var wasExpanded = Boolean(box.querySelector('details[open]'));
    var pantry = el('pantryOverdueMedReminder');
    pantry.classList.toggle('hidden-view', !overdueMedication);
    pantry.textContent = overdueMedication ? '有 ' + overdueMedication + ' 项用药已过期 ›' : '';
    el('dailyMedReminderDot').classList.toggle('hidden-view', !due.length);
    el('navBtnDaily').setAttribute('aria-label', due.length ? '每日记录，有' + (dueNursing.length ? '待办提醒' : '用药提醒') : '每日记录');
    box.classList.toggle('hidden-view', !due.length);
    if (!due.length) { box.replaceChildren(); return; }

    function renderEntry(entry) {
      var log = entry.log;
      var product = entry.product;
      return '<div class="med-reminder-card" data-reminder-tone="' + reminderTone(entry.days) + '">' +
        '<span class="med-reminder-icon">' + (Domain.getCareType(log) === 'nursing' ? Utils.uiIcon('clipboard-copy', 20) : stethoscope) + '</span><div class="med-reminder-copy">' +
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
      stethoscope + '</span><div class="med-reminder-copy"><strong>' + due.length + ' 项' + (dueNursing.length === due.length ? '护理' : dueNursing.length ? '待办' : '用药') + '提醒</strong><p title="' +
      esc(summary) + '">' + esc(summary) + '</p></div><span class="med-reminder-action"><span>查看</span></span></summary>' +
      '<div class="med-reminder-list">' + due.map(renderEntry).join('') + '</div></details>';
  };

  function el(id) { return document.getElementById(id); }

  function dateLabel(date) {
    return Utils.formatSentenceDate(date) + ' ' + Utils.getWeekdayName(date);
  }

  function isFood(log) { return MP.getCategoryGroup(log.category) === 'food' && !Domain.getCareType(log); }

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
        (date === selected ? ' aria-current="date"' : '') + '><span>' + Utils.getWeekdayName(date).slice(-1) + '</span><strong>' +
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
      return MP.getCategoryGroup(item.category) !== 'supplies' && item.quantity > 0 && Domain.evaluateItem(item).status !== 'expired';
    });
    function score(item) {
      return (item.isOpened ? (item.openRemainFraction > 0 ? 100 : 60) : 0) + (MP.isFoodCategory(item.category) ? 20 : 0);
    }
    candidates.sort(function (a, b) {
      return score(b) - score(a) || Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays;
    });
    var priorTrack = el('dailyQuickFeedTrack');
    var scrollLeft = priorTrack ? priorTrack.scrollLeft : 0;
    el('dailyQuickFeedBox').innerHTML = candidates.length ? '<p class="daily-support">常用</p>' +
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
    var packageItem = { unit: log.productUnit || product.unit,
      feedUsageUnit: log.productFeedUsageUnit, feedUsagePerItem: log.productFeedUsagePerItem };
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
          label + '<span class="daily-total-values">' + value + '<span class="daily-target">未设目标</span></span>' +
          '<span class="daily-total-track" aria-hidden="true"></span></button>';
        var over = eaten > target;
        return '<div class="daily-total-cell"' + (over ? ' title="超' + quantity(eaten - target, '克') + '"' : '') +
          '>' + label + '<div class="daily-total-values">' + value +
          '<span class="daily-target">/' + quantity(target, '克') + '</span>' +
          (over ? '<span class="daily-total-over">· 超' + quantity(eaten - target, '克') + '</span>' : '') +
          '</div>' +
          '<div class="daily-total-track" aria-hidden="true"><span class="' + (over ? 'is-over' : '') + '" style="width:' +
          Math.min(100, eaten / target * 100) + '%"></span></div></div>';
      }).join('') + '</div>' + (unknown ? '<p class="daily-support">' + quantity(unknown, '条') + '份量无法换算，未计入合计</p>' : '');
  }

  function knownBrand(product) {
    var brand = String(product.brand || '').trim();
    return brand === '未命名' || brand === '未命名品牌' ? '' : brand;
  }

  function recordType(log) {
    var care = Domain.getCareType(log);
    if (log.careProjects?.length || log.careOther || care === 'nursing') return 'nursing';
    return care === 'medication' ? 'medication' : 'food';
  }

  function recordCounts(counts) {
    return Object.keys(recordTypes).filter(function (type) { return counts[type]; }).map(function (type) {
      var label = recordTypes[type];
      return label[0] + ' ' + quantity(counts[type], label[1]);
    }).join(' · ');
  }

  function renderDetails(rows, isToday) {
    var detailOrder = ['breakfast', 'lunch', 'dinner', 'snack', 'other', 'medication', 'nursing'];
    var counts = { food: 0, medication: 0, nursing: 0 };
    rows.forEach(function (row) {
      var type = recordType(row.log);
      counts[type]++;
    });
    el('dailyTotalCountBadge').textContent = recordCounts(counts);
    var empty = rows.length ? '' : '<div class="empty-state daily-empty">' +
      '<span>' + (isToday ? '今天还没有记录' : '这天没有记录') +
      '</span><button type="button" class="ios-btn-text" data-daily-add>记一条</button></div>';
    var records = rows.slice().sort(function (a, b) {
      function key(row) {
        var type = recordType(row.log);
        if (type !== 'food') return detailOrder.indexOf(type);
        var slot = Utils.normalizeMealSlot(row.log.mealSlot);
        return detailOrder.indexOf(slots.includes(slot) ? slot : 'other');
      }
      return key(a) - key(b) || (clock(a.log) ?? 86400) - (clock(b.log) ?? 86400);
    }).map(function (row) {
      if (recordType(row.log) !== 'nursing') return renderDetailRow(row);
      var projects = row.log.careProjects?.filter(Boolean) || [];
      if (!projects.length) projects = [row.log.careOther || '护理'];
      return projects.map(function (project) { return renderDetailRow(row, project); }).join('');
    }).join('');
    el('dailyFeedTimeline').innerHTML = empty + (records ? '<div class="daily-record-card"><ul class="daily-records">' + records + '</ul></div>' : '');
  }

  function renderDetailRow(row, nursingProject) {
    var log = row.log;
    var product = Domain.resolveLogProduct(log);
    var nursing = recordType(log) === 'nursing';
    var brand = knownBrand(product);
    var icon = MP.getNursingProjectIcon(nursingProject);
    var thumb = nursing ? '<span class="daily-nursing-icon">' + Utils.uiIcon(icon, 20) + '</span>' :
      '<img class="daily-record-thumb" src="' + esc(MP.getItemCoverSrc(Domain.resolveLogProduct(log, true))) + '" alt="" loading="lazy">';
    var nameText = nursing ? nursingProject : product.name;
    var name = '<p class="daily-card-title daily-record-name" title="' + esc([nameText, log.note].filter(Boolean).join(' · ')) + '">' +
      esc(nameText) + '</p>';
    var slot = Utils.mealSlotOptions().find(function (option) { return option.id === Utils.normalizeMealSlot(log.mealSlot); });
    var type = recordType(log);
    var metaLabel = type === 'food' ? (slot?.label || '其他') : recordTypes[type][0];
    var metaIcon = type === 'food' ? (slot?.icon || 'utensils') : (type === 'medication' ? 'stethoscope' : icon);
    var medicationOutcome = type === 'medication'
      ? '<span class="daily-medication-outcome">' + Utils.formatMedicationOutcome(log.medicationOutcome || '') + '</span>'
      : '';
    var reminder = nursing ? nursingDetailReminder(log) : detailReminder(log, careInfo(log, product), Utils.getTodayStr());
    var copy = nursing ? name : '<p class="daily-support daily-record-meta">' + Utils.uiIcon(metaIcon, 14) +
      '<span>' + esc([metaLabel, brand].filter(Boolean).join(' · ')) + '</span>' + medicationOutcome + '</p>' + name;
    copy += reminder;
    var amountText = nursing ? (String(log.amount || '').trim() || '1次') : row.amount.primary;
    var amount = '<div class="daily-record-amount"><strong>' + esc(amountText) +
      (row.amount.secondary ? '<span class="daily-record-conversion">' + esc(row.amount.secondary) + '</span>' : '') + '</strong></div>';
    var id = esc(log.id);
    return '<li class="daily-record' + (nursing ? ' daily-record--nursing' : '') + '">' + thumb +
      '<div class="daily-record-copy">' + copy + '</div>' + amount +
      '<details class="daily-record-menu"><summary class="daily-record-more" aria-label="更多操作">' + Utils.uiIcon('more-vertical', 20) + '</summary><div class="daily-record-menu-items">' +
      '<button type="button" data-edit-log="' + id + '">编辑</button><button type="button" data-del-log="' + id + '">删除</button></div></details></li>';
  }

  function nursingDetailReminder(log) {
    var today = Utils.getTodayStr();
    var due = Utils.formatRelativeYearDate(log.nextDueDate, today);
    var days = Utils.diffDaysFromToday(log.nextDueDate, today);
    if (!due || days === null) return '';
    var relative = days === 0 ? '今天' : days > 0 ? days + '天后' : '已过期 ' + -days + ' 天';
    return '<p class="daily-support daily-reminder" data-reminder-tone="' + reminderTone(days) + '">' + bell +
      '<span>下次 ' + esc(due) + ' · ' + esc(relative) + '</span></p>';
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
    var entries = new Map();
    orderedLogs(logs).forEach(function (log) {
      var type = recordType(log);
      var product = Domain.resolveLogProduct(log);
      var amount = type === 'medication' ? displayAmount(log).primary : log.amount;
      var name = type === 'nursing' ? Domain.nursingLabel(log) : product.name;
      var outcome = type === 'medication' ? MP.getMedicationOutcomeInfo(log.medicationOutcome || '') : null;
      var text = type === 'medication'
        ? [knownBrand(product), name, amount, outcome && outcome.emoji + ' ' + outcome.label].filter(Boolean).join(' ')
        : name;
      var key = JSON.stringify([type, product.category, knownBrand(product), name, amount, log.note, log.medicationOutcome, log.nextDueDate]);
      var entry = entries.get(key);
      if (entry) entry.count++;
      else entries.set(key, { text: text, count: 1 });
    });
    return Array.from(entries.values(), function (entry) {
      return entry.text + (entry.count > 1 ? ' ×' + entry.count : '');
    }).join(' · ');
  }

  function renderHistory(logsByDate, today) {
    var days = [];
    var availableTypes = new Set();
    Array.from(logsByDate.keys()).sort().reverse().forEach(function (date) {
      var counts = { food: 0, medication: 0, nursing: 0 };
      var matches = logsByDate.get(date).filter(function (log) {
        var type = recordType(log);
        availableTypes.add(type);
        if (historyFilter !== 'all' && historyFilter !== type) return false;
        counts[type]++;
        return true;
      });
      if (matches.length) days.push({ date: date, logs: matches, counts: counts });
    });
    el('dailyHistoryCount').textContent = '共 ' + quantity(days.length, '天') + '有记录，空白日期不显示';
    el('dailyHistoryFilters').querySelectorAll('button').forEach(function (button) {
      var active = button.dataset.dailyHistoryFilter === historyFilter;
      button.classList.toggle('active', active);
      button.classList.toggle('is-empty', button.dataset.dailyHistoryFilter !== 'all' && !availableTypes.has(button.dataset.dailyHistoryFilter));
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
          var summary = historySummary(day.logs);
          return '<button type="button" class="ios-card daily-history-day" data-daily-history-date="' + esc(day.date) + '">' +
            '<span class="daily-history-date"><strong>' + Number(day.date.slice(-2)) + '</strong><span>' + Utils.getWeekdayName(day.date) + '</span></span>' +
            '<span class="daily-history-copy"><span title="' + esc(summary) + '">' + esc(summary) + '</span><span class="daily-history-counts daily-support">' +
            (day.date === today ? '<span class="daily-history-today">今天</span>' : '') + '<span>' + esc(recordCounts(day.counts)) + '</span></span></span>' +
            '<span class="daily-support">' + quantity(day.logs.length, '条') + ' ›</span></button>';
        }).join('') + '</div></section>';
    }).join('') || '<p class="empty-state">没有' + (recordTypes[historyFilter]?.[0] || '每日') + '记录</p>';
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
    var rows = (logs.get(selected) || []).slice().reverse().map(function (log) { return { log: log, amount: displayAmount(log) }; });
    renderTotals(rows, selected === today);
    renderDetails(rows, selected === today);
  };
})(typeof window !== 'undefined' ? window : globalThis);
