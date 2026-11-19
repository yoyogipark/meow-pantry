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
      ? ('已超期 ' + Math.abs(daysLeft) + ' 天（计划 ' + topRem.nextDueDate + '）')
      : (daysLeft === 0 ? '今天到期！' : ('还有 ' + daysLeft + ' 天（计划 ' + topRem.nextDueDate + '）'));
    var toneColor = daysLeft <= 7 ? '#B45309' : '#15803D';

    box.classList.remove('hidden-view');
    box.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
        '<div style="font-size:12px;color:#14532D;">' +
          '<strong>🩺 用药/驱虫备忘：</strong>[' + Utils.escapeHtml(topRem.brand) + '] ' + Utils.escapeHtml(topRem.name) +
          ' · 上次 ' + Utils.escapeHtml(topRem.date) + ' · <span style="font-weight:800;color:' + toneColor + ';">下次 ' + statusTxt + '</span>' +
        '</div>' +
        '<button type="button" data-dismiss-rem="' + Utils.escapeHtml(topRem.id) + '" style="border:none;padding:4px 9px;border-radius:7px;background:#DCFCE7;color:#15803D;font-size:11px;font-weight:700;cursor:pointer;">✓ 已完成</button>' +
      '</div>';
  };

  function formatPieceCount(pieces) {
    return pieces === null ? '件数未明' : '共 ' + pieces + ' 件';
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

  function renderStockQuantityDetails(items, statuses) {
    var summary = Domain.summarizeStockQuantity(items);
    document.getElementById('countStockPieces').textContent = formatPieceCount(summary.pieces);
    var cards = Object.keys(summary.units).map(function (unit) {
      var entry = summary.units[unit];
      var status = statuses[unit];
      var labels = [];
      if (entry.opened) labels.push('<span class="stock-detail-status--opened">开封 ' + entry.opened + '</span>');
      if (status.expiring) labels.push('<span class="stock-detail-status--expiring">临期 ' + status.expiring + '</span>');
      if (status.expired) labels.push('<span class="stock-detail-status--expired">过期 ' + status.expired + '</span>');
      if (status.unknown) labels.push('<span class="stock-detail-note">效期待确认 ' + status.unknown + '</span>');
      if (status.openingUnknown) labels.push('<span class="stock-detail-note">开封状态待确认</span>');
      return '<li class="stock-detail-card' + (entry.opened ? ' stock-detail-card--opened' : '') +
        '" data-stock-unit="' + Utils.escapeHtml(unit) + '">' +
        '<div class="stock-detail-amount"><strong>' + (entry.sealed + entry.opened) + '</strong> <span>' + Utils.escapeHtml(unit) + '</span></div>' +
        (labels.length ? '<div class="stock-detail-statuses">' + labels.join('') + '</div>' : '') + '</li>';
    });
    var other = Object.keys(summary.otherUnits).map(function (unit) {
      return summary.otherUnits[unit] + ' ' + Utils.escapeHtml(unit);
    });
    document.getElementById('stockQuantityDetails').innerHTML =
      '<div class="stock-detail-heading"><h2>库存明细</h2><span class="stock-piece-count">' + formatPieceCount(summary.pieces) + '</span></div>' +
      (cards.length ? '<ul class="stock-detail-grid" role="list">' + cards.join('') + '</ul>' +
        '<p class="stock-detail-caption">件数含已开封包装 · 临期按实际包装计数</p>' : '') +
      (other.length ? '<p class="stock-detail-other">' + other.join(' · ') + '（不计入总件数）</p>' : '') +
      (!cards.length && !other.length ? '<p class="stock-detail-other">目前没有在库数量。</p>' : '');
  }

  function purchasePackagingText(item) {
    return item.purchasePackaging ? Utils.escapeHtml(UI.purchasePackagingLabel(item.purchasePackaging, item.unit)) : '';
  }

  function stockProgressText(item) {
    var pack = item.purchasePackaging;
    return pack ? item.quantity + '/' + (pack.count * pack.size) + ' ' + Utils.escapeHtml(item.unit) : '';
  }

  UI.renderStatusCounts = function () {
    var st = MP.state;
    var cStock = 0;
    var cExpiring = 0;
    var cExpired = 0;
    var attrCounts = { all: 0, opened: 0, fresh: 0, pal_love: 0, group_food: 0, group_care: 0 };
    var emptyItems = [];

    st.items.forEach(function (it) {
      var ev = Domain.evaluateItem(it);
      if (ev.status === 'empty') {
        emptyItems.push(it);
      } else {
        cStock += 1;
        if (ev.status === 'expiring') cExpiring += 1;
        else if (ev.status === 'expired') cExpired += 1;
        if (st.statusFilter === 'in_stock' || st.statusFilter === ev.status) {
          attrCounts.all += 1;
          if (Domain.isStockOpened(it)) attrCounts.opened += 1;
          if (ev.status === 'fresh') attrCounts.fresh += 1;
          if ((it.palatability === 'love' || (it.flavors && it.flavors.some(function (f) { return f.palatability === 'love'; }))) && ev.group === 'food') attrCounts.pal_love += 1;
          attrCounts[ev.group === 'food' ? 'group_food' : 'group_care'] += 1;
        }
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
      el.textContent = String(entry[1]);
      el.classList.toggle('is-zero', entry[1] === 0);
    });
    var statuses = Domain.summarizeStockDetailStatuses(st.items);
    var expiringPieces = 0;
    var expiredPieces = 0;
    Object.values(statuses).forEach(function (status) {
      expiringPieces += status.expiring;
      expiredPieces += status.expired;
    });
    renderStockQuantityDetails(st.items, statuses);
    document.getElementById('countExpiringPieces').textContent = formatPieceCount(expiringPieces);
    document.getElementById('countExpiredPieces').textContent = formatPieceCount(expiredPieces);
    document.getElementById('countEmptyPieces').textContent = formatPieceCount(summarizeArchivedPieces(emptyItems));

    var cards = document.querySelectorAll('[data-status-filter]');
    for (var i = 0; i < cards.length; i++) {
      var key = cards[i].getAttribute('data-status-filter');
      cards[i].classList.toggle('selected', key === st.statusFilter);
      if (key === 'expired') cards[i].classList.toggle('is-zero', cExpired === 0);
    }

    var attrSel = document.getElementById('attrFilterSelect');
    var attrLabels = {
      all: '全部状态',
      opened: '🔓 已拆封',
      fresh: '✅ 效期充裕',
      pal_love: '😍 超爱吃',
      group_food: '🍽️ 普通食品',
      group_care: '💊 营养/药品'
    };
    attrSel.disabled = st.statusFilter === 'empty';
    attrSel.innerHTML = attrSel.disabled
      ? '<option value="all">全部状态</option>'
      : Object.keys(attrLabels).map(function (key) {
        return '<option value="' + key + '">' + attrLabels[key] + ' (' + attrCounts[key] + ')</option>';
      }).join('');
    attrSel.value = attrSel.disabled ? 'all' : st.attrFilter;
  };

  function itemMatchesStatusAndAttr(it, ev) {
    var st = MP.state;
    if (st.statusFilter === 'empty') {
      return ev.status === 'empty';
    }
    if (st.statusFilter === 'in_stock' && ev.status === 'empty') return false;
    if (st.statusFilter !== 'in_stock' && ev.status !== st.statusFilter) return false;

    if (st.attrFilter === 'opened' && !Domain.isStockOpened(it)) return false;
    if (st.attrFilter === 'fresh' && ev.status !== 'fresh') return false;
    if (st.attrFilter === 'pal_love' && !((it.palatability === 'love' || (it.flavors && it.flavors.some(function (f) { return f.palatability === 'love'; }))) && ev.group === 'food')) return false;
    if (st.attrFilter === 'group_food' && ev.group !== 'food') return false;
    if (st.attrFilter === 'group_care' && ev.group === 'food') return false;
    return true;
  }

  UI.renderCategoryPills = function () {
    var st = MP.state;
    var counts = { all: 0, dry: 0, can: 0, freeze: 0, treat: 0, supp: 0, med: 0 };
    if (st.statusFilter === 'empty') {
      var emptyOnly = st.items.filter(function (it) { return Domain.evaluateItem(it).status === 'empty'; });
      var grouped = Domain.groupEmptyItemsByProduct(emptyOnly);
      grouped.forEach(function (g) {
        var cat = g.latestItem.category;
        counts.all += 1;
        if (counts[cat] !== undefined) counts[cat] += 1;
      });
    } else {
      st.items.forEach(function (it) {
        var ev = Domain.evaluateItem(it);
        if (itemMatchesStatusAndAttr(it, ev)) {
          counts.all += 1;
          if (counts[it.category] !== undefined) counts[it.category] += 1;
        }
      });
    }

    var btns = document.querySelectorAll('#categoryBar [data-cat]');
    for (var i = 0; i < btns.length; i++) {
      var cat = btns[i].getAttribute('data-cat');
      var baseLabel = cat === 'all' ? '全部' : (MP.CATEGORIES[cat].icon + ' ' + MP.CATEGORIES[cat].label);
      btns[i].textContent = baseLabel + ' ' + (counts[cat] || 0);
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
    var html = '<option value="all">🏷️ 全部品牌 (' + brands.length + ')</option>';
    brands.forEach(function (b) {
      var selected = st.brandFilter === b ? ' selected' : '';
      html += '<option value="' + Utils.escapeHtml(b) + '"' + selected + '>' + Utils.escapeHtml(b) + ' (' + brandMap[b] + ')</option>';
    });
    sel.innerHTML = html;
  };

  function buildLastFedTagHtml(it) {
    var lastLog = Domain.getLastFedInfoForItem(it);
    if (!lastLog || !lastLog.date) return '';
    var dAgo = Utils.diffDaysBetween(lastLog.date, Utils.getTodayStr());
    var txt = dAgo === 0 ? '今日已喂' : (dAgo === 1 ? '昨天喂过' : (dAgo > 1 && dAgo <= 60 ? (dAgo + '天前喂过') : ('上次 ' + lastLog.date)));
    return '<span style="background:#F1E6D6;color:#4A3A2E;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;">🍽️ ' + Utils.escapeHtml(txt) + '</span>';
  }

  function formatExpiryCountdown(ev) {
    var openingControls = ev.openRemaining !== null && (ev.expDays === null || ev.openRemaining <= ev.expDays);
    var days = openingControls ? ev.openRemaining : ev.expDays;
    if (days === null) return '有效期内';
    if (days < 0) return (openingControls ? '开封超期 ' : '已过期 ') + Math.abs(days) + ' 天';
    if (days === 0) return openingControls ? '开封今天到期' : '今天到期';
    return (openingControls ? '开封保鲜剩 ' : '剩 ') + days + ' 天到期';
  }

  // A zero fraction is also used when an opened package has no measured remainder.
  function detailedOpenStock(item, unit) {
    var quantity = Number(item.quantity);
    var opened = Domain.isStockOpened(item);
    var shared = Domain.hasSharedSeal(item);
    var openPackages = item.flavors
      ? item.flavors.filter(function (flavor) { return flavor.quantity > 0 && flavor.openedDate; })
      : (opened ? [item] : []);
    var stockText = '在库 ' + quantity + ' ' + unit;
    if (shared && opened) stockText += ' · 共用包装已开封';
    var dates = shared || !item.flavors
      ? (item.openedDate ? [item.openedDate] : [])
      : openPackages.map(function (flavor) { return flavor.name + ' ' + flavor.openedDate; });
    var independent = !shared && (item.purchasePackaging || Domain.isPackageUnit(unit) || unit === '粒');
    if (independent && openPackages.length && Number.isSafeInteger(quantity) && quantity >= openPackages.length) {
      var unopenedCount = quantity - openPackages.length;
      var parts = [];
      if (unopenedCount > 0) parts.push('未开封 ' + unopenedCount + ' ' + unit);
      var fractionText = openPackages.length === 1
        ? Utils.formatRemainFractionText(openPackages[0].openRemainFraction, unit) : '';
      if (fractionText) {
        parts.push('开封余 ' + fractionText.slice(1, -unit.length) + ' ' + unit);
      } else {
        parts.push('已开封 ' + openPackages.length + ' ' + unit);
      }
      stockText = parts.join(' + ');
    }
    return { opened: opened, text: stockText, dates: dates, openCount: openPackages.length };
  }

  function expiryTone(days, urgentLimit, warningLimit) {
    if (!Number.isFinite(days)) return 'unknown';
    return days < 0 ? 'expired' : days <= urgentLimit ? 'urgent' : days <= warningLimit ? 'warning' : 'fresh';
  }

  function detailedOpenedBadge(days, openCount) {
    var label = '已开封';
    var tone = expiryTone(days, 2, 5);
    if (days !== null) {
      label = days < 0 ? '开封已过期'
        : days === 0 ? '开封今天到期'
          : '开封' + (openCount > 1 ? '最早' : '') + '剩' + days + '天';
    }
    return '<span class="detail-card-reminder detail-card-open-badge detail-card-open-badge--' + tone + '">' + label + '</span>';
  }

  function detailedShelfProgress(item, days) {
    if (days === null || !item.prodDate || !item.expDate) return '';
    var duration = Utils.diffDaysBetween(item.prodDate, item.expDate);
    if (!(duration > 0)) return '';
    var percentage = Math.max(0, Math.min(100, Math.round(days / duration * 100)));
    var tone = expiryTone(days, 7, 30);
    var label = '有效期剩余 ' + percentage + '%';
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
    var tone = expiryTone(days, 2, 5);
    var label = days < 0 ? '已超保鲜期' : '开封保鲜剩 ' + remaining + ' 天';
    return '<div class="detail-card-open-progress detail-card-open-progress--' + tone + '">' +
      '<div class="detail-card-open-progress-label"><strong>' + label + '</strong><span>共 ' + limit + ' 天</span></div>' +
      '<div class="progress-track" aria-hidden="true"><div class="progress-bar" style="width:' + percent + '%;"></div></div></div>';
  }

  UI.renderPantryList = function () {
    var st = MP.state;
    var q = st.searchQuery.trim().toLowerCase();
    var filtered = st.items.filter(function (it) {
      var ev = Domain.evaluateItem(it);
      if (!itemMatchesStatusAndAttr(it, ev)) return false;
      if (st.catFilter !== 'all' && it.category !== st.catFilter) return false;
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
    }

    var hasExtraFilter = (st.statusFilter !== 'in_stock' || st.attrFilter !== 'all' || st.catFilter !== 'all' || st.brandFilter !== 'all' || Boolean(q));
    var summaryBar = document.getElementById('activeFilterSummaryBar');
    var summaryTxt = document.getElementById('filterResultCountText');
    summaryBar.classList.toggle('hidden-view', !hasExtraFilter);
    if (hasExtraFilter) {
      var displayCount = st.statusFilter === 'empty' ? Domain.groupEmptyItemsByProduct(filtered).length : filtered.length;
      var unitWord = st.statusFilter === 'empty' ? '款产品' : '批商品';
      summaryTxt.textContent = '当前筛选结果：共 ' + displayCount + ' ' + unitWord;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden-view');
      pagerEl.classList.add('hidden-view');
      return;
    }
    emptyEl.classList.add('hidden-view');

    // Product-Grouped Rendering when viewing "已吃完" (empty)
    if (st.statusFilter === 'empty') {
      var productGroups = Domain.groupEmptyItemsByProduct(filtered);
      var gPageSize = Number(st.pantryPageSize) || 6;
      var gTotal = productGroups.length;
      var gPages = Math.max(1, Math.ceil(gTotal / gPageSize));
      if (st.pantryPage > gPages) st.pantryPage = gPages;
      if (st.pantryPage < 1) st.pantryPage = 1;
      var gStart = (st.pantryPage - 1) * gPageSize;
      var pagedGroups = productGroups.slice(gStart, gStart + gPageSize);

      if (gTotal > 6 || gPages > 1) {
        pagerEl.classList.remove('hidden-view');
        document.getElementById('pageInfoText').textContent =
          '第 ' + st.pantryPage + ' / ' + gPages + ' 页 (共 ' + gTotal + ' 款产品)';
        var pBtn = document.getElementById('prevPageBtn');
        var nBtn = document.getElementById('nextPageBtn');
        pBtn.disabled = (st.pantryPage <= 1);
        pBtn.style.opacity = st.pantryPage <= 1 ? '0.45' : '1';
        nBtn.disabled = (st.pantryPage >= gPages);
        nBtn.style.opacity = st.pantryPage >= gPages ? '0.45' : '1';
      } else {
        pagerEl.classList.add('hidden-view');
      }

      if (st.pantryDisplayMode === 'compact') {
        listEl.style.gap = '7px';
        listEl.innerHTML = pagedGroups.map(function (grp) {
          var rep = grp.latestItem;
          var catInfo = MP.CATEGORIES[rep.category] || MP.CATEGORIES.dry;
          var unitStr = Utils.escapeHtml(rep.unit || '件');
          var palIcon = rep.palatability === 'love' ? '😍' : (rep.palatability === 'meh' ? '😒' : '');
          return (
            '<div class="ios-card archive-card archive-row" style="padding:10px 12px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div data-action="edit" data-id="' + Utils.escapeHtml(rep.id) + '" style="min-width:0;flex:1;cursor:pointer;">' +
                '<div class="archive-row" style="display:flex;align-items:center;gap:5px;min-width:0;">' +
                  '<span style="font-size:14px;flex-shrink:0;">' + catInfo.icon + '</span>' +
                  '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 6px;border-radius:6px;flex-shrink:0;">' + Utils.escapeHtml(rep.brand) + '</span>' +
                  '<strong style="font-size:13.5px;color:#2B2320;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(rep.name) + '</strong>' +
                  (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
                '</div>' +
                '<div style="font-size:11px;color:#6B5A4C;margin-top:3px;">' +
                  '共 ' + grp.batches.length + ' 个历史批次' + (rep.spec ? (' · 规格 ' + Utils.escapeHtml(rep.spec)) : '') +
                '</div>' +
              '</div>' +
              '<div class="archive-row" style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
                '<span style="background:#DCFCE7;color:#15803D;padding:3px 8px;border-radius:8px;font-size:12px;font-weight:800;">累计 ' + grp.totalConsumed + unitStr + '</span>' +
                '<button type="button" data-action="restock-new" data-id="' + Utils.escapeHtml(rep.id) + '" style="padding:4px 8px;border-radius:8px;border:1px solid #FDBA74;background:#E8590C;color:#FFFFFF;font-size:11px;font-weight:700;cursor:pointer;">＋复购</button>' +
              '</div>' +
            '</div>'
          );
        }).join('');
        return;
      }

      listEl.style.gap = '12px';
      listEl.innerHTML = pagedGroups.map(function (grp) {
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
            ? '<span style="font-size:11px;font-weight:800;color:#9A3412;background:#FFEDD5;padding:1px 7px;border-radius:6px;">⏱️ 共 ' + cDays + ' 天</span>'
            : '';

          var openFinishLine = '';
          if (bOpen && bFin) {
            openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#44403C;font-weight:600;">🔓 开封 ' + Utils.escapeHtml(bOpen) + ' → ✓ 用完 ' + Utils.escapeHtml(bFin) + '</div>';
          } else if (bFin) {
            openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#57534E;">✓ 用完于 ' + Utils.escapeHtml(bFin) + '</div>';
          } else if (bOpen) {
            openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:#57534E;">🔓 开封于 ' + Utils.escapeHtml(bOpen) + '</div>';
          }

          return (
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#FFFFFF;border:1px solid #E7E5E4;">' +
              '<div style="min-width:0;flex:1;">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<span style="font-size:11px;font-weight:700;color:#57534E;background:#F5F5F4;padding:1px 6px;border-radius:5px;">批次 #' + (grp.batches.length - bIdx) + '</span>' +
                  '<strong style="font-size:12.5px;color:#15803D;">核销 ' + bUsed + ' ' + unitStr + '</strong>' +
                  durationBadgeHtml +
                  (packTxt ? '<span style="font-size:11px;color:#6B5A4C;">购入 ' + packTxt + '</span>' : '') +
                  (priceTxt ? '<span style="font-size:11px;color:#6B5A4C;">' + Utils.escapeHtml(priceTxt) + '</span>' : '') +
                '</div>' +
                openFinishLine +
                '<div style="margin-top:2px;font-size:11px;color:#6B5A4C;">' +
                  '生产 ' + Utils.escapeHtml(bItem.prodDate || '未标') + ' · 到期 ' + Utils.escapeHtml(bItem.expDate || '—') +
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
          ? (' · ⚡ 均每' + unitStr + ' ' + Math.max(1, Math.round(totalDaysSum / totalUnitsWithDays)) + ' 天')
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
                  '<span style="background:#DCFCE7;color:#15803D;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;">累计 ' + grp.totalConsumed + ' ' + unitStr + '</span>' +
                '</div>' +
                '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#2B2320;line-height:1.35;">' + Utils.escapeHtml(rep.name) + '</h3>' +
                '<div style="margin-top:4px;font-size:12px;color:#6B5A4C;">' +
                  (rep.spec ? ('规格 ' + Utils.escapeHtml(rep.spec) + ' · ') : '') + '共归档 ' + grp.batches.length + ' 个历史批次' + avgTxt +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:11px;padding:10px;border-radius:12px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
              '<div style="font-size:11px;font-weight:700;color:#6B5A4C;margin-bottom:7px;">📦 历史批次明细（总计 ' + grp.totalConsumed + ' ' + unitStr + '）</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;">' + batchRowsHtml + '</div>' +
            '</div>' +
            '<div style="margin-top:11px;padding-top:10px;border-top:1px solid #F5F5F4;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(rep.sourceBatchId || rep.id) + '" style="padding:6px 10px;border-radius:9px;border:1px solid #E7E5E4;background:#FAFAF9;color:#57534E;font-size:11.5px;font-weight:600;cursor:pointer;">📜 批次流水</button>' +
              '<button type="button" data-action="restock-new" data-id="' + Utils.escapeHtml(rep.id) + '" style="padding:7px 14px;border-radius:10px;border:1px solid #FDBA74;background:#E8590C;color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">＋ 同款复购入库</button>' +
            '</div>' +
          '</article>'
        );
      }).join('');
      return;
    }

    var pageSize = Number(st.pantryPageSize) || 6;
    var totalItems = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (st.pantryPage > totalPages) st.pantryPage = totalPages;
    if (st.pantryPage < 1) st.pantryPage = 1;

    var startIdx = (st.pantryPage - 1) * pageSize;
    var pagedItems = filtered.slice(startIdx, startIdx + pageSize);

    if (totalItems > 6 || totalPages > 1) {
      pagerEl.classList.remove('hidden-view');
      document.getElementById('pageInfoText').textContent =
        '第 ' + st.pantryPage + ' / ' + totalPages + ' 页 (共 ' + totalItems + ' 款)';
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
      listEl.style.gap = '8px';
      listEl.innerHTML = pagedItems.map(function (it) {
        var ev = Domain.evaluateItem(it);
        var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
        var qtyNum = Number(it.quantity) || 0;
        var unitStr = Utils.escapeHtml(it.unit || '件');
        var badgeBg = '#DCFCE7';
        var badgeText = '#15803D';
        var badgeLabel = formatExpiryCountdown(ev);
        if (ev.status === 'expired') {
          badgeBg = '#FEE2E2'; badgeText = '#DC2626';
        } else if (ev.status === 'expiring') {
          badgeBg = '#FEF3C7'; badgeText = '#B45309';
        }

        var fracTxtCompact = (it.isOpened && it.openRemainFraction > 0) ? Utils.formatRemainFractionText(it.openRemainFraction, it.unit || '罐') : '';
        var openDot = it.isOpened && ev.status !== 'empty'
          ? '<span style="font-size:11px;font-weight:700;color:#E8590C;background:#FFEDD5;padding:1px 5px;border-radius:5px;flex-shrink:0;white-space:nowrap;">🔓' + (fracTxtCompact || '已拆') + '</span>'
          : '';
        var palIcon = it.palatability === 'love' ? (it.category === 'med' ? '✅' : '😍') : (it.palatability === 'coax' ? (it.category === 'med' ? '💦' : '🥺') : (it.palatability === 'meh' ? (it.category === 'med' ? '⚠️' : '😒') : ''));

        var compactMeta = ['<span>到期 ' + Utils.escapeHtml(it.expDate || '—') + '</span>'];
        if (it.flavors) compactMeta.push('<span>' + UI.flavorStockText(it) + '</span>');
        if (it.purchasePackaging) compactMeta.push('<span>购入 ' + purchasePackagingText(it) + '</span>');
        if (it.spec) compactMeta.push('<span>' + Utils.escapeHtml(it.spec) + '</span>');
        if (it.location) compactMeta.push('<span>📍' + Utils.escapeHtml(it.location) + '</span>');

        return (
          '<div class="ios-card" style="padding:10px 12px;border-radius:14px;">' +
            '<div class="compact-card-header">' +
              '<div class="compact-card-tags">' +
                '<span style="font-size:13.5px;flex-shrink:0;">' + catInfo.icon + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 6px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">' + Utils.escapeHtml(it.brand) + '</span>' +
                (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
                openDot +
              '</div>' +
              '<div class="compact-card-tags">' +
                '<span style="background:' + badgeBg + ';color:' + badgeText + ';padding:2px 7px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;">' + badgeLabel + '</span>' +
                '<span style="background:#F5F5F4;border:1px solid #E7E5E4;color:#2B2320;padding:2px 7px;border-radius:8px;font-size:11.5px;font-weight:800;white-space:nowrap;">余' + (stockProgressText(it) || qtyNum + unitStr) + '</span>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" title="记喂食" style="padding:3px 7px;border-radius:8px;border:1px solid #FED7AA;background:#FFF7ED;color:#E8590C;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">🐾喂</button>' +
                '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" class="edit-only" style="padding:3px 7px;border-radius:8px;border:1px solid #E7E5E4;background:#FFFFFF;color:#44403C;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">编辑</button>' +
              '</div>' +
            '</div>' +
            '<div data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" style="cursor:pointer;">' +
              '<div class="compact-title">' + Utils.escapeHtml(it.name) + '</div>' +
              '<div class="compact-meta-row">' + compactMeta.join('') + '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      return;
    }

    // Detailed Product Card Mode (Enhanced with Group Styling, Per-100g Price, Last-Fed Tag & History Button)
    listEl.style.gap = '12px';
    listEl.innerHTML = pagedItems.map(function (it) {
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
      var usedHtml = Number(it.eatenCount) > 0
        ? ' <span class="detail-card-used">已用 ' + Number(it.eatenCount) + ' ' + unitStr + '</span>'
        : '';
      var openedProgress = stock.opened ? detailedOpenedProgress(it, ev.openRemaining) : '';
      var openedBannerHtml = stock.opened
        ? '<div class="detail-card-open-stock detail-card-open-stock--' + expiryTone(ev.openRemaining, 2, 5) + '">' +
          '<div class="detail-card-open-summary">' +
            '<div>' + stockHtml + usedHtml + '</div>' +
            (stock.dates.length ? '<span class="detail-card-open-date">开封 ' + Utils.escapeHtml(stock.dates.join(' · ')) + '</span>' : '') +
          '</div>' + openedProgress + '</div>'
        : '';

      var specParts = it.spec ? [Utils.escapeHtml(it.spec)] : [];
      var price = Utils.formatMoney(it.price, it.currency);
      if (price) {
        var per100 = catInfo.group === 'food' && !it.flavors ? Utils.formatPer100gPrice(it.price, it.currency, it.spec) : '';
        specParts.push(price + '/' + unitStr + (per100 ? '（' + per100.replace(/^≈¥/, '≈CN¥') + '）' : ''));
      }
      var locationParts = [];
      if (it.location) locationParts.push('📍' + Utils.escapeHtml(it.location));
      if (it.batchCode) locationParts.push(Utils.escapeHtml(it.batchCode));

      var shelfText = it.shelfLifeValue
        ? Utils.escapeHtml(it.shelfLifeValue) + (it.shelfLifeUnit === 'days' ? '天' : '个月')
        : '—';
      var expiryNote = '';
      if (stock.opened && ev.expDays !== null) {
        if (ev.expDays < 0) expiryNote = ' · 已过期';
        else if (ev.expDays === 0) expiryNote = ' · 今天到期';
        else if (ev.openRemaining !== null && ev.expDays < ev.openRemaining) expiryNote = ' · 先到期';
      }
      var datePanel = '<div class="detail-card-dates">' +
        '<div><div class="detail-card-date-label">生产日期</div><div>' + Utils.escapeHtml(it.prodDate || '未标注') + '</div></div>' +
        '<div><div class="detail-card-date-label">保质期</div><div>' + shelfText + '</div></div>' +
        '<div><div class="detail-card-date-label">过期日期' + expiryNote + '</div><div class="detail-card-date-expiry">' +
          Utils.escapeHtml(it.expDate || '—') + '</div></div>' +
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
        '<article class="ios-card p-4 detail-card" style="padding:14px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
            thumbHtml +
            '<div style="min-width:0;flex:1;">' +
              '<div class="detail-card-heading">' +
                '<div class="detail-card-tags">' +
                  '<span class="detail-card-category">' + catInfo.icon + ' ' + catInfo.label + (it.subtype ? ' · ' + Utils.escapeHtml(it.subtype) : '') + '</span>' +
                  '<span class="detail-card-brand">' + Utils.escapeHtml(it.brand) + '</span>' +
                '</div>' +
                (stock.opened ? detailedOpenedBadge(ev.openRemaining, stock.openCount)
                  : '<span class="detail-card-reminder detail-card-status detail-card-status--' + expiryTone(ev.expDays, 7, 30) +
                  '">' + Utils.escapeHtml(badgeLabel) + '</span>') +
              '</div>' +
              '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#2B2320;line-height:1.35;word-break:break-word;">' + Utils.escapeHtml(it.name) + '</h3>' +
              ((palHtml || lastFedHtml) ? '<div style="margin-top:4px;display:flex;align-items:center;gap:5px;flex-wrap:wrap;">' + palHtml + lastFedHtml + '</div>' : '') +
              (specParts.length ? '<div class="detail-card-line">' + specParts.join(' · ') + '</div>' : '') +
              (locationParts.length ? '<div class="detail-card-line">' + locationParts.join(' · ') + '</div>' : '') +
              (it.purchasePackaging ? '<div class="detail-card-line">购入 ' + purchasePackagingText(it) + '</div>' : '') +
            '</div>' +
          '</div>' +

          datePanel +
          detailedShelfProgress(it, ev.expDays) +

          openedBannerHtml +
          (it.flavors ? '<div class="flavor-stock">' + UI.flavorStockText(it) + '</div>' : '') +
          (it.notes ? '<div style="margin-top:8px;font-size:12px;color:#57534E;background:#F5F5F4;padding:6px 10px;border-radius:8px;">💬 ' + Utils.escapeHtml(it.notes) + '</div>' : '') +

          '<div style="margin-top:11px;padding-top:10px;border-top:1px solid #F5F5F4;">' +
            '<div class="detail-card-actions">' +
              (stock.opened ? '' : '<div class="detail-card-unopened-stock">' + stockHtml + usedHtml + '</div>') +
              '<div class="detail-card-action-buttons">' +
                '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(it.id) + '" title="查看该批次库存操作流水" style="padding:6px 8px;border-radius:10px;border:1px solid transparent;background:#F1E6D6;color:#3A2A20;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">📜 此商品记录</button>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" style="padding:6px 11px;border-radius:10px;border:1px solid transparent;background:#E8590C;color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">' + feedBtnLabel + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="edit-only grid-safe" style="margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">' +
              '<button type="button" data-action="toggle-open" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #E7E5E4;background:' + (it.isOpened ? '#FFEDD5' : '#FAFAF9') + ';color:' + (it.isOpened ? '#9A3412' : '#57534E') + ';font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' +
                (it.isOpened ? ('🔓 已拆1' + unitStr) : (qtyNum > 1 ? ('🔒 拆1' + unitStr) : '🔒 记开封')) +
              '</button>' +
              '<button type="button" data-action="consume-one" data-id="' + Utils.escapeHtml(it.id) + '" style="min-height:34px;padding:0 4px;border-radius:9px;border:1px solid #DCFCE7;background:#F0FDF4;color:#15803D;font-size:11.5px;font-weight:700;cursor:pointer;overflow-wrap:anywhere;">' +
                '✓ ' + (catInfo.group === 'food' ? '吃完' : '用完') + Math.min(1, qtyNum) + unitStr +
              '</button>' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">✏️ 编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">🗑️ 删除</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
