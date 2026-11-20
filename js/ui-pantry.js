/* Meow Pantry inventory status, filters, stock details, and pantry card renderer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var UI = MP.UI = MP.UI || {};

  UI.renderMedReminderBanner = function () {
    var box = document.getElementById('medReminderBanner');
    if (!box) return;
    var activeRems = MP.state.logs.filter(function (lg) {
      return lg.nextDueDate && !lg.reminderDone;
    });
    if (activeRems.length === 0) {
      box.classList.add('hidden-view');
      return;
    }
    activeRems.sort(function (a, b) {
      return String(a.nextDueDate).localeCompare(String(b.nextDueDate));
    });
    var topRem = activeRems[0];
    var daysLeft = Utils.diffDaysFromToday(topRem.nextDueDate);
    var statusTxt = daysLeft < 0
      ? ('已超期 ' + Utils.formatDays(daysLeft).text + '（计划 ' + Utils.formatSentenceDate(topRem.nextDueDate) + '）')
      : (daysLeft === 0 ? '今天到期！' : ('还有 ' + Utils.formatDays(daysLeft).text + '（计划 ' + Utils.formatSentenceDate(topRem.nextDueDate) + '）'));
    var toneColor = daysLeft <= 7 ? '#B45309' : '#15803D';

    box.classList.remove('hidden-view');
    box.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
        '<div style="font-size:12px;color:#14532D;">' +
          '<strong>🩺 用药/驱虫备忘：</strong>[' + Utils.escapeHtml(topRem.brand) + '] ' + Utils.escapeHtml(topRem.name) +
          ' · 上次 ' + Utils.escapeHtml(Utils.formatSentenceDate(topRem.date)) + ' · <span style="font-weight:800;color:' + toneColor + ';">下次 ' + statusTxt + '</span>' +
        '</div>' +
        '<button type="button" data-dismiss-rem="' + Utils.escapeHtml(topRem.id) + '" style="border:none;padding:4px 9px;border-radius:7px;background:#DCFCE7;color:#15803D;font-size:11px;font-weight:700;cursor:pointer;">✓ 已完成</button>' +
      '</div>';
  };

  function formatPieceCount(pieces) {
    return pieces === null ? '件数未明' : '共 ' + Utils.formatQuantity(pieces, '件');
  }

  function summarizeArchivedPieces(items) {
    var batches = new Map();
    var total = 0;
    for (var item of items) {
      if (!item.unit || Domain.hasSharedSeal(item)) return null;
      var pieces = 0;
      if (item.purchasePackaging || Domain.isPackageUnit(item.unit)) {
        // History lists can fall back to one when the quantity is missing. Totals need a recorded value.
        var consumed = Number(item.consumedCount) || 0;
        var last = Number(item.lastQuantity) || 0;
        pieces = consumed || last;
        if (!Number.isSafeInteger(pieces) || pieces <= 0 || (consumed && last && consumed !== last)) {
          return null;
        }
      }
      var batchId = item.sourceBatchId || item.id;
      var previous = batches.get(batchId);
      if (previous) {
        if (previous.unit !== item.unit || previous.pieces !== pieces) return null;
      } else {
        batches.set(batchId, { unit: item.unit, pieces: pieces });
        total += pieces;
      }
    }
    return Number.isSafeInteger(total) ? total : null;
  }

  function purchasePackagingText(item) {
    var pack = item.purchasePackaging;
    return pack ? '购入 ' + Utils.escapeHtml(UI.purchasePackagingLabel(pack, item.unit)) : '';
  }

  function packagedPriceText(item, unit) {
    var pack = item.purchasePackaging;
    var price = Number(item.price);
    if (!pack || !(price > 0) || !Number.isFinite(price)) return '';
    var unitPrice = Utils.formatMoney(price, item.currency, unit);
    var packPrice = Utils.formatMoney(price * pack.size, item.currency, pack.outerUnit);
    return Utils.escapeHtml(unitPrice + ' · ' + packPrice + '（' + Utils.formatQuantity(pack.size, unit) + '）');
  }

  function stockQuantityPill(item) {
    var unit = item.unit || '件';
    var used = Number(item.eatenCount);
    var stock = detailedOpenStock(item, item.unit || '件');
    var note = used > 0 ? '已用 ' + Utils.formatQuantity(used, unit)
      : stock.packageCount > 0 ? '开封 ' + Utils.formatQuantity(stock.packageCount, unit) : '';
    return '<span class="stock-quantity-pill"><span>在库 ' + Utils.escapeHtml(Utils.formatQuantity(Number(item.quantity) || 0, unit)) + '</span>' +
      (note ? ' <span class="stock-quantity-used' + (used > 0 ? '' : ' stock-quantity-open') + '">' + Utils.escapeHtml(note) + '</span>' : '') +
      '</span>';
  }

  UI.renderStatusCounts = function () {
    var st = MP.state;
    var cStock = 0;
    var cExpiring = 0;
    var cExpired = 0;
    var warningDays = Number(st.settings.warnDays) || 60;
    document.getElementById('statCardExpiring').title =
      '包装剩 ' + Utils.formatQuantity(warningDays, '天') + '以内，或开封保鲜期剩余 ' + Utils.formatQuantity(Math.min(10, warningDays), '天') + '以内';
    var emptyItems = [];

    st.items.forEach(function (it) {
      var ev = Domain.evaluateItem(it);
      if (ev.status === 'empty') {
        emptyItems.push(it);
      } else {
        cStock += 1;
        if (ev.status === 'expiring') cExpiring += 1;
        else if (ev.status === 'expired') cExpired += 1;

      }
    });
    var cEmpty = Domain.groupEmptyItemsByProduct(emptyItems).length;

    [
      ['countInStock', cStock],
      ['countExpiring', cExpiring],
      ['countExpired', cExpired],
      ['countEmpty', cEmpty]
    ].forEach(function (entry) {
      var el = document.getElementById(entry[0]);
      el.textContent = Utils.formatNumber(entry[1]);
      el.classList.toggle('is-zero', entry[1] === 0);
    });
    var statuses = Domain.summarizeStockDetailStatuses(st.items);
    var expiringPieces = 0;
    var expiredPieces = 0;
    Object.values(statuses).forEach(function (status) {
      expiringPieces += status.expiring;
      expiredPieces += status.expired;
    });
    document.getElementById('countStockPieces').textContent = formatPieceCount(Domain.summarizeStockQuantity(st.items).pieces);
    document.getElementById('countExpiringPieces').textContent = formatPieceCount(expiringPieces);
    document.getElementById('countExpiredPieces').textContent = formatPieceCount(expiredPieces);
    document.getElementById('countEmptyPieces').textContent = formatPieceCount(summarizeArchivedPieces(emptyItems));

    var cards = document.querySelectorAll('[data-status-filter]');
    for (var i = 0; i < cards.length; i++) {
      var key = cards[i].getAttribute('data-status-filter');
      cards[i].classList.toggle('selected', key === st.statusFilter);
      cards[i].setAttribute('aria-pressed', String(key === st.statusFilter));
      if (key === 'expired') cards[i].classList.toggle('is-zero', cExpired === 0);
    }

    document.getElementById('pantryStatusHint').classList.toggle('hidden-view', st.settings.pantryStatusHintSeen);
  };

  function itemMatchesStatus(it, ev) {
    var st = MP.state;
    if (st.pantryHealthFilter === 'expiring_packages') {
      return Object.values(Domain.summarizeStockDetailStatuses([it])).some(function (unit) { return unit.expiring > 0; });
    }
    if (st.statusFilter === 'in_stock' && ev.status === 'empty') return false;
    if (st.statusFilter !== 'in_stock' && st.statusFilter !== 'all' && ev.status !== st.statusFilter) return false;
    if (st.pantryHealthFilter === 'opened') return Domain.isStockOpened(it);
    if (st.pantryHealthFilter === 'expiring_or_opened') return ev.status === 'expiring' || Domain.isStockOpened(it);
    return true;
  }

  function pantryEntries(items) {
    // Keep the existing archive cards when an archived product appears alongside live batches.
    var archives = Domain.groupEmptyItemsByProduct(items.filter(function (item) { return item.quantity <= 0; }));
    if (MP.state.statusFilter === 'empty') return archives.map(function (group) { return { archive: group }; });
    var byKey = new Map(archives.map(function (group) { return [group.groupKey, group]; }));
    var entries = [];
    items.forEach(function (item) {
      if (item.quantity > 0) {
        entries.push({ item: item });
        return;
      }
      var key = Domain.getProductGroupKey(item);
      if (byKey.has(key)) {
        entries.push({ archive: byKey.get(key) });
        byKey.delete(key);
      }
    });
    return entries;
  }

  UI.renderCategoryPills = function () {
    var st = MP.state;
    var counts = { all: 0, dry: 0, can: 0, freeze: 0, treat: 0, supp: 0, med: 0 };
    var matched = st.items.filter(function (item) { return itemMatchesStatus(item, Domain.evaluateItem(item)); });
    pantryEntries(matched).forEach(function (entry) {
      var item = entry.item || entry.archive.latestItem;
      counts.all += 1;
      if (counts[item.category] !== undefined) counts[item.category] += 1;
    });

    var btns = document.querySelectorAll('#categoryBar [data-cat]');
    for (var i = 0; i < btns.length; i++) {
      var cat = btns[i].getAttribute('data-cat');
      var baseLabel = cat === 'all' ? '全部' : (MP.CATEGORIES[cat].icon + ' ' + MP.CATEGORIES[cat].label);
      btns[i].textContent = baseLabel + ' ' + Utils.formatNumber(counts[cat] || 0);
      btns[i].classList.toggle('active', cat === st.catFilter);
    }
  };

  UI.renderBrandDropdown = function () {
    var st = MP.state;
    var sel = document.getElementById('brandFilterSelect');
    var brandMap = Object.create(null);
    st.items.forEach(function (it) {
      if (it.sourceBatchId && (Number(it.quantity) || 0) <= 0) return;
      if (it.brand && it.brand.trim()) {
        var b = it.brand.trim();
        brandMap[b] = (brandMap[b] || 0) + 1;
      }
    });
    var brands = Object.keys(brandMap).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    if (st.brandFilter !== 'all' && !brandMap[st.brandFilter]) {
      st.brandFilter = 'all';
    }
    var html = '<option value="all">全部品牌</option>';
    brands.forEach(function (b) {
      var selected = st.brandFilter === b ? ' selected' : '';
      html += '<option value="' + Utils.escapeHtml(b) + '"' + selected + '>' + Utils.escapeHtml(b) + '</option>';
    });
    sel.innerHTML = html;
  };

  function buildLastFedTagHtml(it) {
    var lastLog = Domain.getLastFedInfoForItem(it);
    if (!lastLog || !lastLog.date) return '';
    var dAgo = Utils.diffDaysBetween(lastLog.date, Utils.getTodayStr());
    var txt = dAgo === 0 ? '今日已喂' : (dAgo === 1 ? '昨天喂过' : (dAgo > 1 && dAgo <= 60 ? (Utils.formatQuantity(dAgo, '天') + '前喂过') : ('上次 ' + Utils.formatSentenceDate(lastLog.date))));
    return '<span style="background:#F1E6D6;color:#4A3A2E;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;">🍽️ ' + Utils.escapeHtml(txt) + '</span>';
  }

  function formatExpiryCountdown(ev) {
    var openingControls = ev.openRemaining !== null && (ev.expDays === null || ev.openRemaining <= ev.expDays);
    var days = openingControls ? ev.openRemaining : ev.expDays;
    if (days === null) return '未填写过期日期';
    if (days < 0) return (openingControls ? '开封超期 ' : '已过期 ') + Utils.formatDays(days).text;
    if (days === 0) return openingControls ? '开封今天到期' : '今天到期';
    return (openingControls ? '开封保鲜期剩余 ' : '剩 ') + Utils.formatDays(days).text + '到期';
  }

  // A zero fraction is also used when an opened package has no measured remainder.
  function detailedOpenStock(item, unit) {
    var quantity = Number(item.quantity);
    var opened = Domain.isStockOpened(item);
    var shared = Domain.hasSharedSeal(item);
    var openPackages = item.flavors
      ? item.flavors.filter(function (flavor) { return flavor.quantity > 0 && flavor.openedDate; })
      : (opened ? [item] : []);
    var stockText = '在库 ' + Utils.formatQuantity(quantity, unit);
    if (shared && opened) stockText += ' · 共用包装已开封';
    var dates = shared || !item.flavors
      ? (item.openedDate ? [item.openedDate] : [])
      : openPackages.map(function (flavor) { return flavor.name + ' ' + flavor.openedDate; });
    var independent = !shared && (item.purchasePackaging || Domain.isPackageUnit(unit) || unit === '粒');
    var packageCount = independent && Number.isSafeInteger(quantity) && quantity >= openPackages.length ? openPackages.length : 0;
    if (packageCount) {
      var unopenedCount = quantity - openPackages.length;
      var parts = [];
      if (unopenedCount > 0) parts.push('未开封 ' + Utils.formatQuantity(unopenedCount, unit));
      var fractionText = openPackages.length === 1
        ? Utils.formatRemainFractionText(openPackages[0].openRemainFraction, unit, true) : '';
      if (fractionText) {
        parts.push('开封余 ' + fractionText.slice(1));
      } else {
        parts.push('已开封 ' + Utils.formatQuantity(openPackages.length, unit));
      }
      stockText = parts.join(' + ');
    }
    return { opened: opened, text: stockText, dates: dates, openCount: openPackages.length, packageCount: packageCount };
  }

  function detailedOpenedBadge(days, openCount) {
    var label = '已开封';
    var tone = Utils.formatDays(days).tone;
    if (days !== null) {
      label = days < 0 ? '开封已过期'
        : days === 0 ? '开封今天到期'
          : '开封' + (openCount > 1 ? '最早' : '') + '剩' + Utils.formatDays(days).text;
    }
    return '<span class="detail-card-reminder detail-card-open-badge detail-card-open-badge--' + tone + '">' + label + '</span>';
  }

  function detailedShelfProgress(item, days) {
    if (days === null || !item.prodDate || !item.expDate) return '';
    var duration = Utils.diffDaysBetween(item.prodDate, item.expDate);
    if (!(duration > 0)) return '';
    var percentage = Math.max(0, Math.min(100, Math.round(days / duration * 100)));
    var tone = Utils.formatDays(days).tone;
    var label = '保质期剩余 ' + Utils.formatPercent(percentage);
    return '<div class="detail-card-shelf">' +
      '<div class="detail-card-line">' + label + '</div>' +
      '<div class="progress-track detail-card-track detail-card-track--' + tone + '" aria-hidden="true">' +
        '<div class="progress-bar" style="width:' + percentage + '%;"></div>' +
      '</div></div>';
  }

  function detailedOpenedProgress(item, days) {
    var limit = Number(item.openDaysLimit);
    if (!Number.isInteger(limit) || limit <= 0 || !Number.isFinite(days)) return '';

    var remaining = Math.max(0, days);
    var percent = Math.min(100, remaining / limit * 100);
    var tone = Utils.formatDays(days).tone;
    var label = days < 0 ? '已超开封保鲜期' : '开封保鲜期剩余 ' + Utils.formatDays(remaining).text;
    return '<div class="detail-card-open-progress detail-card-open-progress--' + tone + '">' +
      '<div class="detail-card-open-progress-label"><strong>' + label + '</strong><span>共 ' + Utils.formatQuantity(limit, '天') + '</span></div>' +
      '<div class="progress-track" aria-hidden="true"><div class="progress-bar" style="width:' + percent + '%;"></div></div></div>';
  }

  function stockActionIcon(path) {
    return '<svg class="stock-action-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg> ';
  }

  UI.renderPantryList = function () {
    var historyIcon = document.querySelector('#openStockHistoryBtn svg').outerHTML;
    var st = MP.state;
    var q = st.searchQuery.trim().toLowerCase();
    var filtered = st.items.filter(function (it) {
      var ev = Domain.evaluateItem(it);
      if (!itemMatchesStatus(it, ev)) return false;
      if (st.catFilter === 'food' ? ev.group !== 'food' :
        st.catFilter !== 'all' && it.category !== st.catFilter) return false;
      if (st.brandFilter !== 'all' && (it.brand || '').trim() !== st.brandFilter) return false;
      if (q) {
        var hay = [it.brand, it.name, it.spec, it.location, it.batchCode, it.notes]
          .join(' ')
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    filtered.sort(function (a, b) {
      var ea = Domain.evaluateItem(a);
      var eb = Domain.evaluateItem(b);
      if (st.sortBy === 'exp_asc') return ea.effectiveDays - eb.effectiveDays;
      if (st.sortBy === 'exp_desc') return eb.effectiveDays - ea.effectiveDays;
      if (st.sortBy === 'prod_desc') return String(b.prodDate || '').localeCompare(String(a.prodDate || ''));
      if (st.sortBy === 'qty_desc') return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
      if (st.sortBy === 'brand_asc') return String(a.brand || '').localeCompare(String(b.brand || ''), 'zh-CN');
      return 0;
    });

    var listEl = document.getElementById('pantryList');
    var emptyEl = document.getElementById('emptyStateBox');
    var pagerEl = document.getElementById('pantryPaginationBar');

    // Sync Display Mode Toggle UI
    var dBtns = document.querySelectorAll('#pantryDisplayToggle [data-display-mode]');
    for (var dIdx = 0; dIdx < dBtns.length; dIdx++) {
      var dm = dBtns[dIdx].getAttribute('data-display-mode');
      var isAct = (dm === st.pantryDisplayMode);
      dBtns[dIdx].classList.toggle('active', isAct);
      dBtns[dIdx].setAttribute('aria-pressed', String(isAct));
    }

    var entries = pantryEntries(filtered);
    var hasExtraFilter = (st.statusFilter !== 'in_stock' || Boolean(st.pantryHealthFilter) || st.catFilter !== 'all' || st.brandFilter !== 'all' || Boolean(q));
    var summaryBar = document.getElementById('activeFilterSummaryBar');
    var summaryTxt = document.getElementById('filterResultCountText');
    summaryBar.classList.toggle('hidden-view', !hasExtraFilter);
    if (hasExtraFilter) {
      var displayCount = entries.length;
      var unitWord = st.statusFilter === 'empty' ? '款产品' : st.statusFilter === 'all' ? '条商品记录' : '批商品';
      summaryTxt.textContent = '当前筛选结果：共 ' + Utils.formatQuantity(displayCount, unitWord);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden-view');
      pagerEl.classList.add('hidden-view');
      return;
    }
    emptyEl.classList.add('hidden-view');

    var liveTotals = new Map();
    if (entries.some(function (entry) { return entry.archive; })) {
      st.items.forEach(function (item) {
        if (!(Number(item.quantity) > 0)) return;
        var key = Domain.getProductGroupKey(item);
        var totals = liveTotals.get(key) || { quantity: 0, eatenCount: 0 };
        totals.quantity += Number(item.quantity);
        totals.eatenCount += Number(item.eatenCount) || 0;
        liveTotals.set(key, totals);
      });
    }

    function archiveFooter(group) {
      var item = group.latestItem;
      var totals = liveTotals.get(group.groupKey) || { quantity: 0, eatenCount: 0 };
      return '<div class="archive-footer">' +
        stockQuantityPill({ unit: item.unit, quantity: Utils.round2(totals.quantity), eatenCount: Utils.round2(totals.eatenCount) }) +
        '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(item.sourceBatchId || item.id) + '">流水</button>' +
        '<button type="button" data-action="restock-new" data-id="' + Utils.escapeHtml(item.id) + '">复购入库</button>' +
        '</div>';
    }

    function archiveBadge(group) {
      return '<span class="detail-card-reminder detail-card-status archive-total">累计 ' +
        Utils.escapeHtml(Utils.formatQuantity(group.totalConsumed, group.latestItem.unit || '件')) + '</span>';
    }
    function renderCompactArchive(grp) {
      var rep = grp.latestItem;
      var catInfo = MP.CATEGORIES[rep.category] || MP.CATEGORIES.dry;
      var palIcon = rep.palatability === 'love' ? '😍' : (rep.palatability === 'meh' ? '😒' : '');
      return (
        '<div class="ios-card archive-card" style="padding:10px 12px;border-radius:14px;">' +
          '<div data-action="edit" data-id="' + Utils.escapeHtml(rep.id) + '" style="min-width:0;flex:1;cursor:pointer;">' +
            '<div class="archive-row" style="display:flex;align-items:center;gap:5px;min-width:0;">' +
              '<span style="font-size:14px;flex-shrink:0;">' + catInfo.icon + '</span>' +
              '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 6px;border-radius:6px;flex-shrink:0;">' + Utils.escapeHtml(rep.brand) + '</span>' +
              '<strong style="font-size:13.5px;color:#2B2320;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(rep.name) + '</strong>' +
              (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
              archiveBadge(grp) +
            '</div>' +
            '<div style="font-size:11px;color:#6B5A4C;margin-top:3px;">' +
              '共 ' + Utils.formatQuantity(grp.batches.length, '个历史批次') + (Utils.formatItemSpec(rep) ? (' · 规格 ' + Utils.escapeHtml(Utils.formatItemSpec(rep))) : '') +
            '</div>' +
          '</div>' +
          archiveFooter(grp) +
        '</div>'
      );
    }


    function renderDetailedArchive(grp) {
      var rep = grp.latestItem;
      var catInfo = MP.CATEGORIES[rep.category] || MP.CATEGORIES.dry;
      var unitStr = Utils.escapeHtml(rep.unit || '件');
      var palInfoRep = MP.getPalatabilityBadgeInfo(rep);
      var palHtml = palInfoRep
        ? '<span style="background:' + palInfoRep.bg + ';color:' + palInfoRep.text + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">' + palInfoRep.label + '</span>'
        : '';
      var coverSrc = MP.getItemCoverSrc(rep);
      var realTag = rep.imageData
        ? '<span style="position:absolute;bottom:3px;right:3px;background:rgba(28,25,23,0.75);color:#FFF;font-size:11px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
        : '';
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(rep.id) + '" aria-label="查看口粮图片" style="position:relative;width:64px;height:64px;padding:0;border:1px solid #E7E5E4;border-radius:14px;overflow:hidden;background:#FAFAF9;flex-shrink:0;cursor:pointer;">' +
          '<img src="' + coverSrc + '" alt="' + Utils.escapeHtml(rep.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          realTag +
        '</button>';

      var totalDaysSum = 0;
      var totalUnitsWithDays = 0;

      var batchRowsHtml = grp.batches.map(function (bItem, bIdx) {
        var bUsed = Number(bItem.consumedCount) || Number(bItem.lastQuantity) || 1;
        var packTxt = purchasePackagingText(bItem);
        var priceTxt = bItem.price ? (' · ' + Utils.formatMoney(bItem.price, bItem.currency)) : '';
        var bOpen = bItem.archivedOpenedDate || bItem.openedDate || '';
        var bFin = bItem.finishedDate || '';
        var cDays = Utils.calcConsumeDays(bOpen, bFin);
        if (cDays !== null) {
          totalDaysSum += cDays;
          totalUnitsWithDays += bUsed;
        }
        var durationBadgeHtml = cDays !== null
          ? '<span style="font-size:11px;font-weight:800;color:#9A3412;background:#FFEDD5;padding:1px 7px;border-radius:6px;">⏱️ 共 ' + Utils.formatQuantity(cDays, '天') + '</span>'
          : '';

        var openFinishLine = '';
        if (bOpen && bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#44403C;font-weight:600;">🔓 开封日期 ' + Utils.escapeHtml(bOpen) + ' → ✓ 用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#57534E;">✓ 用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bOpen) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#57534E;">🔓 开封日期 ' + Utils.escapeHtml(bOpen) + '</div>';
        }

        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#FFFFFF;border:1px solid #E7E5E4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                '<span style="font-size:11px;font-weight:700;color:#57534E;background:#F5F5F4;padding:1px 6px;border-radius:5px;">批次 #' + (grp.batches.length - bIdx) + '</span>' +
                '<strong style="font-size:12.5px;color:#15803D;">核销 ' + Utils.escapeHtml(Utils.formatQuantity(bUsed, rep.unit || '件')) + '</strong>' +
                durationBadgeHtml +
                (packTxt ? '<span style="font-size:11px;color:#6B5A4C;">' + packTxt + '</span>' : '') +
                (priceTxt ? '<span style="font-size:11px;color:#6B5A4C;">' + Utils.escapeHtml(priceTxt) + '</span>' : '') +
              '</div>' +
              openFinishLine +
              '<div style="margin-top:2px;font-size:11px;color:#6B5A4C;">' +
                '生产日期 ' + Utils.escapeHtml(Utils.formatListDate(bItem.prodDate, '未填写')) + ' · 过期日期 ' + Utils.escapeHtml(Utils.formatListDate(bItem.expDate, '—')) +
                (bItem.batchCode ? (' · ' + Utils.escapeHtml(bItem.batchCode)) : '') +
              '</div>' +
            '</div>' +
            '<div class="edit-only" style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(bItem.id) + '" style="padding:4px 8px;border-radius:7px;border:1px solid #E7E5E4;background:#FAFAF9;color:#44403C;font-size:11px;font-weight:600;cursor:pointer;">编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(bItem.id) + '" style="padding:4px 8px;border-radius:7px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11px;font-weight:600;cursor:pointer;">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      var avgTxt = totalUnitsWithDays > 0
        ? (' · ⚡ 均每' + unitStr + ' ' + Utils.formatDays(Math.max(1, Math.round(totalDaysSum / totalUnitsWithDays))).text)
        : '';

      return (
        '<article class="ios-card archive-card" style="padding:15px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:11px;">' +
            thumbHtml +
            '<div style="min-width:0;flex:1;">' +
              '<div class="archive-row" style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">' +
                '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:4px;">' +
                  '<span style="background:#F5F5F4;color:#44403C;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                  '<span style="background:#FFE3CC;color:#7A3410;padding:2px 9px;border-radius:8px;font-size:12px;font-weight:700;">' + Utils.escapeHtml(rep.brand) + '</span>' +
                  palHtml +
                '</div>' +
                archiveBadge(grp) +
              '</div>' +
              '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#2B2320;line-height:1.35;">' + Utils.escapeHtml(rep.name) + '</h3>' +
              '<div style="margin-top:4px;font-size:12px;color:#6B5A4C;">' +
                (Utils.formatItemSpec(rep) ? ('规格 ' + Utils.escapeHtml(Utils.formatItemSpec(rep)) + ' · ') : '') + '共归档 ' + Utils.formatQuantity(grp.batches.length, '个历史批次') + avgTxt +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:11px;padding:10px;border-radius:12px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
            '<div style="font-size:11px;font-weight:700;color:#6B5A4C;margin-bottom:7px;">📦 历史批次明细（总计 ' + grp.totalConsumed + ' ' + unitStr + '）</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' + batchRowsHtml + '</div>' +
          '</div>' +
          archiveFooter(grp) +
        '</article>'
      );
    }

    var pageSize = Number(st.pantryPageSize) || 6;
    var totalItems = entries.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (st.pantryPage > totalPages) st.pantryPage = totalPages;
    if (st.pantryPage < 1) st.pantryPage = 1;

    var startIdx = (st.pantryPage - 1) * pageSize;
    var pagedItems = entries.slice(startIdx, startIdx + pageSize);

    if (totalItems > 6 || totalPages > 1) {
      pagerEl.classList.remove('hidden-view');
      document.getElementById('pageInfoText').textContent =
        '第 ' + Utils.formatNumber(st.pantryPage) + ' / ' + Utils.formatQuantity(totalPages, '页') + ' (共 ' + Utils.formatQuantity(totalItems, st.statusFilter === 'empty' ? '款产品' : st.statusFilter === 'all' ? '条' : '款') + ')';
      var prevBtn = document.getElementById('prevPageBtn');
      var nextBtn = document.getElementById('nextPageBtn');
      prevBtn.disabled = (st.pantryPage <= 1);
      prevBtn.style.opacity = st.pantryPage <= 1 ? '0.45' : '1';
      nextBtn.disabled = (st.pantryPage >= totalPages);
      nextBtn.style.opacity = st.pantryPage >= totalPages ? '0.45' : '1';
      var sizeSel = document.getElementById('pageSizeSelect');
      if (sizeSel && String(sizeSel.value) !== String(pageSize)) {
        sizeSel.value = String(pageSize);
      }
    } else {
      pagerEl.classList.add('hidden-view');
    }

    if (st.pantryDisplayMode === 'compact') {
      listEl.style.gap = st.statusFilter === 'empty' ? '7px' : '8px';
      listEl.innerHTML = pagedItems.map(function (entry) {
        if (entry.archive) return renderCompactArchive(entry.archive);
        var it = entry.item;
        var ev = Domain.evaluateItem(it);
        var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
        var expiryDays = ev.expDays;
        var expiryLabel = expiryDays === null ? '未填写过期日期'
          : expiryDays < 0 ? '已过期 ' + Utils.formatDays(expiryDays).text
          : expiryDays === 0 ? '今天到期' : '剩 ' + Utils.formatDays(expiryDays).text;

        var fracTxtCompact = (it.isOpened && it.openRemainFraction > 0) ? Utils.formatRemainFractionText(it.openRemainFraction, it.unit || '罐', true) : '';
        var palIcon = it.palatability === 'love' ? (it.category === 'med' ? '✅' : '😍') : (it.palatability === 'coax' ? (it.category === 'med' ? '💦' : '🥺') : (it.palatability === 'meh' ? (it.category === 'med' ? '⚠️' : '😒') : ''));

        var freshnessBadge = '';
        if (Domain.isStockOpened(it)) {
          var openDays = ev.openRemaining;
          var freshness = openDays === null ? '未填写开封保鲜期'
            : openDays < 0 ? '开封超期 ' + Utils.formatDays(openDays).text : '开封剩 ' + Utils.formatDays(openDays).text;
          freshnessBadge = '<span class="detail-card-open-badge compact-freshness detail-card-open-badge--' +
            Utils.formatDays(openDays).tone + '">' +
            '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2M12 15v2"/></svg>' +
            '<span>' + Utils.escapeHtml(freshness) + '</span></span>';
        }
        var displaySpec = Utils.formatItemSpec(it);
        var identity = Utils.escapeHtml([it.name, displaySpec, fracTxtCompact].filter(Boolean).join(' · '));
        var id = Utils.escapeHtml(it.id);

        return (
          '<div class="ios-card compact-stock-card" data-action="edit" data-id="' + id + '">' +
            '<div class="compact-card-header">' +
              '<div class="compact-card-tags compact-card-identity">' +
                '<span class="compact-category-icon">' + catInfo.icon + '</span>' +
                '<span class="compact-brand" title="' + Utils.escapeHtml(it.brand) + '">' + Utils.escapeHtml(it.brand) + '</span>' +
                (palIcon ? '<span class="compact-palatability">' + palIcon + '</span>' : '') +
              '</div>' +
              '<span class="detail-card-status compact-expiry-badge detail-card-status--' +
                Utils.formatDays(expiryDays).tone + '">' + Utils.escapeHtml(expiryLabel) + '</span>' +
            '</div>' +
            '<div class="compact-card-main">' +
              '<div class="compact-title" title="' + identity + '">' +
                '<span class="compact-product-name">' + Utils.escapeHtml(it.name) + '</span>' +
                (displaySpec ? '<span class="product-title-spec">' + Utils.escapeHtml(displaySpec) + '</span>' : '') +
                (fracTxtCompact ? '<span class="compact-product-extra">' + Utils.escapeHtml(fracTxtCompact) + '</span>' : '') +
              '</div>' +
              '<div class="compact-card-controls">' +
                '<button type="button" data-action="log-feed" data-id="' + id + '" title="记喂食" class="compact-feed-btn">🐾 喂</button>' +
                '<button type="button" data-action="edit" data-id="' + id + '" class="edit-only compact-edit-btn">编辑</button>' +
              '</div>' +
            '</div>' +
            '<div class="compact-stock-row' + (freshnessBadge ? ' has-freshness' : '') + '">' +
              stockQuantityPill(it) +
              '<span class="compact-location"' + (it.location ? ' title="' + Utils.escapeHtml(it.location) + '"' : '') + '>' +
                (it.location ? '📍' + Utils.escapeHtml(it.location) : '') + '</span>' +
              freshnessBadge +
            '</div>' +
          '</div>'
        );
      }).join('');
      return;
    }

    // Detailed Product Card Mode (Enhanced with Group Styling, Per-100g Price, Last-Fed Tag & History Button)
    listEl.style.gap = '12px';
    listEl.innerHTML = pagedItems.map(function (entry) {
      if (entry.archive) return renderDetailedArchive(entry.archive);
      var it = entry.item;
      var ev = Domain.evaluateItem(it);
      var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
      var unit = it.unit || '件';
      var stock = detailedOpenStock(it, unit);
      var badgeLabel = formatExpiryCountdown(ev);

      var palInfo = MP.getPalatabilityBadgeInfo(it);
      var palHtml = palInfo
        ? '<span style="background:' + palInfo.bg + ';color:' + palInfo.text + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">' + palInfo.label + '</span>'
        : '';
      var lastFedHtml = buildLastFedTagHtml(it);


      var qtyNum = Number(it.quantity) || 0;
      var unitStr = Utils.escapeHtml(unit);
      var stockHtml = '<span class="detail-card-stock-text">' + Utils.escapeHtml(stock.text) + '</span>';
      var openedProgress = stock.opened ? detailedOpenedProgress(it, ev.openRemaining) : '';
      var openedBannerHtml = stock.opened
        ? '<div class="detail-card-open-stock detail-card-open-stock--' + Utils.formatDays(ev.openRemaining).tone + '">' +
          '<div class="detail-card-open-summary">' +
            '<div>' + stockHtml + '</div>' +
            (stock.dates.length ? '<span class="detail-card-open-date">开封日期 ' + Utils.escapeHtml(stock.dates.join(' · ')) + '</span>' : '') +
          '</div>' + openedProgress + '</div>'
        : '';

      var displaySpec = Utils.formatItemSpec(it);
      var priceLine = packagedPriceText(it, unit);
      var price = Utils.formatMoney(it.price, it.currency, unit);
      if (!priceLine && price) {
        var per100 = catInfo.group === 'food' && !it.flavors ? Utils.formatPer100gPrice(it.price, it.currency, it.unit_net_weight_g) : '';
        priceLine = Utils.escapeHtml(price) + (per100 ? '（' + per100 + '）' : '');
      }
      var locationParts = [];
      if (it.location) locationParts.push('📍' + Utils.escapeHtml(it.location));
      if (it.batchCode) locationParts.push(Utils.escapeHtml(it.batchCode));
      if (it.purchasePackaging) locationParts.push(purchasePackagingText(it));

      var shelfText = it.shelfLifeValue
        ? Utils.formatQuantity(it.shelfLifeValue, it.shelfLifeUnit === 'days' ? '天' : '个月')
        : '—';
      var expiryNote = '';
      if (stock.opened && ev.expDays !== null) {
        if (ev.expDays < 0) expiryNote = ' · 已过期';
        else if (ev.expDays === 0) expiryNote = ' · 今天到期';
        else if (ev.openRemaining !== null && ev.expDays < ev.openRemaining) expiryNote = ' · 先到期';
      }
      var datePanel = '<div class="detail-card-dates">' +
        '<div><div class="detail-card-date-label">生产日期</div><div>' + Utils.escapeHtml(Utils.formatListDate(it.prodDate, '未填写')) + '</div></div>' +
        '<div><div class="detail-card-date-label">保质期</div><div>' + shelfText + '</div></div>' +
        '<div><div class="detail-card-date-label">过期日期' + expiryNote + '</div><div class="detail-card-date-expiry">' +
          Utils.escapeHtml(Utils.formatListDate(it.expDate, '—')) + '</div></div>' +
        '</div>';

      var coverSrc = MP.getItemCoverSrc(it);
      var realTag = it.imageData
        ? '<span style="position:absolute;bottom:3px;right:3px;background:rgba(28,25,23,0.75);color:#FFF;font-size:11px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
        : '';
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="查看口粮图片" style="position:relative;width:64px;height:64px;padding:0;border:1px solid #E7E5E4;border-radius:14px;overflow:hidden;background:#FAFAF9;flex-shrink:0;cursor:pointer;">' +
          '<img src="' + coverSrc + '" alt="' + Utils.escapeHtml(it.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          realTag +
        '</button>';

      var feedBtnLabel = catInfo.group === 'med' ? '🩺 记用药' : (catInfo.group === 'supp' ? '💊 记喂食' : '🐾 记喂食');

      return (
        '<article class="ios-card p-4 detail-card">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
            thumbHtml +
            '<div style="min-width:0;flex:1;">' +
              '<div class="detail-card-heading">' +
                '<div class="detail-card-tags">' +
                  '<span class="detail-card-category">' + catInfo.icon + ' ' + catInfo.label + (it.subtype ? ' · ' + Utils.escapeHtml(it.subtype) : '') + '</span>' +
                  '<span class="detail-card-brand">' + Utils.escapeHtml(it.brand) + '</span>' +
                '</div>' +
                (stock.opened ? detailedOpenedBadge(ev.openRemaining, stock.openCount)
                  : '<span class="detail-card-reminder detail-card-status detail-card-status--' + Utils.formatDays(ev.expDays).tone +
                  '">' + Utils.escapeHtml(badgeLabel) + '</span>') +
              '</div>' +
              '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#2B2320;line-height:1.35;word-break:break-word;">' + Utils.escapeHtml(it.name) +
                (displaySpec ? ' <span class="product-title-spec">' + Utils.escapeHtml(displaySpec) + '</span>' : '') + '</h3>' +
              ((palHtml || lastFedHtml) ? '<div style="margin-top:4px;display:flex;align-items:center;gap:5px;flex-wrap:wrap;">' + palHtml + lastFedHtml + '</div>' : '') +
              (priceLine ? '<div class="detail-card-line">' + priceLine + '</div>' : '') +
              (locationParts.length ? '<div class="detail-card-line">' + locationParts.join(' · ') + '</div>' : '') +
            '</div>' +
          '</div>' +

          datePanel +
          detailedShelfProgress(it, ev.expDays) +

          openedBannerHtml +
          (it.flavors ? '<div class="flavor-stock"><strong>剩余：</strong>' + UI.flavorStockText(it, false, true) + '</div>' : '') +
          (it.notes ? '<div style="margin-top:8px;font-size:12px;color:#57534E;background:#F5F5F4;padding:6px 10px;border-radius:8px;">💬 ' + Utils.escapeHtml(it.notes) + '</div>' : '') +

          '<div style="margin-top:11px;padding-top:10px;border-top:1px solid #F5F5F4;">' +
            '<div class="detail-card-actions">' +
              stockQuantityPill(it) +
              '<div class="detail-card-action-buttons">' +
                '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(it.id) + '" title="查看该批次库存操作流水" class="detail-card-history-btn">' + historyIcon + '<span>历史记录</span></button>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" style="padding:6px 11px;border-radius:10px;border:1px solid transparent;background:var(--accent);color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">' + feedBtnLabel + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="edit-only grid-safe" style="margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">' +
              '<button type="button" data-action="toggle-open" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #E7E5E4;background:' + (it.isOpened ? '#FFEDD5' : '#FAFAF9') + ';color:' + (it.isOpened ? '#9A3412' : '#57534E') + ';font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' +
                stockActionIcon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="' +
                  (it.isOpened ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 1 1 8 0v4') + '"/>') +
                (it.isOpened ? '已拆1' + unitStr : qtyNum > 1 ? '拆1' + unitStr : '记开封') +
              '</button>' +
              '<button type="button" data-action="consume-one" data-id="' + Utils.escapeHtml(it.id) + '" style="min-height:34px;padding:0 4px;border-radius:9px;border:1px solid #DCFCE7;background:#F0FDF4;color:#15803D;font-size:11.5px;font-weight:700;cursor:pointer;overflow-wrap:anywhere;">' +
                stockActionIcon('<path d="m5 12 4 4L19 6"/>') + (catInfo.group === 'food' ? '吃完' : '用完') + Math.min(1, qtyNum) + unitStr +
              '</button>' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">' + stockActionIcon('<path d="m15 5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/>') + '编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' + stockActionIcon('<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>') + '删除</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
