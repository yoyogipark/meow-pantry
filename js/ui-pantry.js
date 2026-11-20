/* Meow Pantry inventory status, filters, stock details, and pantry card renderer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var UI = MP.UI = MP.UI || {};

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
    var foodBatches = 0;
    var brands = new Set();

    st.items.forEach(function (it) {
      if (Number(it.quantity) > 0) {
        if (MP.isFoodCategory(it.category)) foodBatches += 1;
        if (it.brand && it.brand.trim()) brands.add(it.brand.trim());
      }
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
    document.getElementById('pantryStockSummary').textContent =
      '口粮 ' + Utils.formatQuantity(foodBatches, '款') + ' · ' + Utils.formatQuantity(brands.size, '个品牌');

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
      var baseLabel = cat === 'all' ? '全部' : (MP.CATEGORIES[cat]?.label || '其他');
      var icon = cat === 'all' ? '' : Utils.getCategoryIcon(cat, 20) + ' ';
      btns[i].innerHTML = icon + Utils.escapeHtml(baseLabel) + ' ' + Utils.formatNumber(counts[cat] || 0);
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
    if (dAgo === null || dAgo < 0) return '';
    var tone = dAgo === 0 ? 'today' : dAgo > 7 ? 'overdue' : 'recent';
    var label = dAgo === 0 ? '今天' : dAgo === 1 ? '昨天' : Utils.formatQuantity(dAgo, '天') + '前';
    var check = dAgo === 0
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
      : '';
    return '<span class="detail-card-photo-fed detail-card-photo-fed--' + tone + '" aria-label="上次喂食：' +
      label + '">' + check + label + '</span>';
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

  function shelfRemainingPercentage(item, days) {
    if (days === null || !item.prodDate || !item.expDate) return null;
    var duration = Utils.diffDaysBetween(item.prodDate, item.expDate);
    return duration > 0 ? Math.max(0, Math.min(100, days / duration * 100)) : null;
  }

  function detailedShelfProgress(percentage) {
    if (percentage === null) return '';
    var label = '保质期剩余 ' + Utils.formatPercent(percentage);
    return '<button type="button" class="progress-track detail-card-track" data-shelf-progress aria-label="' + label + '">' +
      '<span class="progress-bar" style="width:' + percentage + '%;" aria-hidden="true"></span></button>';
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
      '<button type="button" class="progress-track" data-open-progress aria-label="开封保鲜期剩余 ' + Utils.formatPercent(percent) + '">' +
      '<span class="progress-bar" style="width:' + percent + '%;" aria-hidden="true"></span></button>' +
      '<span class="detail-card-shelf-tip hidden-view" role="status"></span></div>';
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

    var pagedItems = Utils.paginateList(entries, st, 'pantryPage', pagerEl);
    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden-view');
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
      var palKey = MP.getItemPalatability(rep);
      var palIcon = palKey === 'mixed' ? '口味分化'
        : (['love', 'meh'].includes(palKey) && MP.getCategoryGroup(rep.category) !== 'med'
          ? Utils.getPalatabilityIcon(palKey) : '');
      return (
        '<div class="ios-card archive-card" style="padding:10px 12px;border-radius:14px;">' +
          '<div data-action="edit" data-id="' + Utils.escapeHtml(rep.id) + '" style="min-width:0;flex:1;cursor:pointer;">' +
            '<div class="archive-row" style="display:flex;align-items:center;gap:5px;min-width:0;">' +
              Utils.getCategoryIcon(rep.category) +
              '<span style="font-size:11px;font-weight:700;color:var(--accent-strong);background:var(--accent-soft);padding:1px 6px;border-radius:6px;flex-shrink:0;">' + Utils.escapeHtml(rep.brand) + '</span>' +
              '<strong style="font-size:13.5px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(rep.name) + '</strong>' +
              (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
              archiveBadge(grp) +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">' +
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
        ? '<span style="background:' + palInfoRep.bg + ';color:' + palInfoRep.text + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">' + Utils.formatPalatabilityBadge(rep, palInfoRep) + '</span>'
        : '';
      var coverSrc = MP.getItemCoverSrc(rep);
      var realTag = rep.imageData
        ? '<span style="position:absolute;bottom:3px;right:3px;background:var(--photo-badge-bg);color:var(--text-on-accent);font-size:11px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
        : '';
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(rep.id) + '" aria-label="查看口粮图片" style="position:relative;width:64px;height:64px;padding:0;border:1px solid var(--border-warm);border-radius:14px;overflow:hidden;background:var(--control-bg);flex-shrink:0;cursor:pointer;">' +
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
          ? '<span style="font-size:11px;font-weight:800;color:var(--accent-strong);background:var(--accent-soft);padding:1px 7px;border-radius:6px;">' + Utils.uiIcon('timer') + '共 ' + Utils.formatQuantity(cDays, '天') + '</span>'
          : '';

        var openFinishLine = '';
        if (bOpen && bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-main);font-weight:600;">' + Utils.uiIcon('lock-open') + '开封日期 ' + Utils.escapeHtml(bOpen) + ' → ' + Utils.uiIcon('circle-check') + '用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-muted);">✓ 用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bOpen) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-muted);">' + Utils.uiIcon('lock-open') + '开封日期 ' + Utils.escapeHtml(bOpen) + '</div>';
        }

        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:var(--card-bg);border:1px solid var(--border-warm);">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                '<span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--status-neutral-bg);padding:1px 6px;border-radius:5px;">批次 #' + (grp.batches.length - bIdx) + '</span>' +
                '<strong style="font-size:12.5px;color:var(--ok);">核销 ' + Utils.escapeHtml(Utils.formatQuantity(bUsed, rep.unit || '件')) + '</strong>' +
                durationBadgeHtml +
                (packTxt ? '<span style="font-size:11px;color:var(--text-muted);">' + packTxt + '</span>' : '') +
                (priceTxt ? '<span style="font-size:11px;color:var(--text-muted);">' + Utils.escapeHtml(priceTxt) + '</span>' : '') +
              '</div>' +
              openFinishLine +
              '<div style="margin-top:2px;font-size:11px;color:var(--text-muted);">' +
                '生产日期 ' + Utils.escapeHtml(Utils.formatListDate(bItem.prodDate, '未填写')) + ' · 过期日期 ' + Utils.escapeHtml(Utils.formatListDate(bItem.expDate, '—')) +
                (bItem.batchCode ? (' · ' + Utils.escapeHtml(bItem.batchCode)) : '') +
              '</div>' +
            '</div>' +
            '<div class="edit-only" style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(bItem.id) + '" style="padding:4px 8px;border-radius:7px;border:1px solid var(--border-warm);background:var(--control-bg);color:var(--text-main);font-size:11px;font-weight:600;cursor:pointer;">编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(bItem.id) + '" style="padding:4px 8px;border-radius:7px;border:1px solid var(--danger-soft);background:var(--danger-soft);color:var(--status-danger-text);font-size:11px;font-weight:600;cursor:pointer;">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      var avgTxt = totalUnitsWithDays > 0
        ? (' · ' + Utils.uiIcon('zap') + '均每' + unitStr + ' ' + Utils.formatDays(Math.max(1, Math.round(totalDaysSum / totalUnitsWithDays))).text)
        : '';

      return (
        '<article class="ios-card archive-card" style="padding:15px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:11px;">' +
            thumbHtml +
            '<div style="min-width:0;flex:1;">' +
              '<div class="archive-row" style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">' +
                '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:4px;">' +
                  '<span style="background:var(--status-neutral-bg);color:var(--text-main);padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">' + Utils.getCategoryIcon(rep.category, 20) + ' ' + catInfo.label + '</span>' +
                  '<span style="background:var(--brand-surface);color:var(--brand-ink);padding:2px 9px;border-radius:8px;font-size:12px;font-weight:700;">' + Utils.escapeHtml(rep.brand) + '</span>' +
                  palHtml +
                '</div>' +
                archiveBadge(grp) +
              '</div>' +
              '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:var(--text-main);line-height:1.35;">' + Utils.escapeHtml(rep.name) + '</h3>' +
              '<div style="margin-top:4px;font-size:12px;color:var(--text-muted);">' +
                (Utils.formatItemSpec(rep) ? ('规格 ' + Utils.escapeHtml(Utils.formatItemSpec(rep)) + ' · ') : '') + '共归档 ' + Utils.formatQuantity(grp.batches.length, '个历史批次') + avgTxt +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:11px;padding:10px;border-radius:12px;background:var(--control-bg);border:1px solid var(--status-neutral-bg);">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:7px;">' + Utils.uiIcon('package') + '历史批次明细（总计 ' + grp.totalConsumed + ' ' + unitStr + '）</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' + batchRowsHtml + '</div>' +
          '</div>' +
          archiveFooter(grp) +
        '</article>'
      );
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
        var palInfo = MP.getPalatabilityBadgeInfo(it);
        var palIcon = palInfo ? Utils.formatPalatabilityBadge(it, palInfo) : '';

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
                '<span class="compact-category-icon">' + Utils.getCategoryIcon(it.category, 20) + '</span>' +
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
                '<button type="button" data-action="log-feed" data-id="' + id + '" class="btn-feed">' + UI.feedButtonContent(catInfo.group === 'med' ? '记用药' : '') + '</button>' +
                '<button type="button" data-action="edit" data-id="' + id + '" class="edit-only compact-edit-btn">编辑</button>' +
              '</div>' +
            '</div>' +
            '<div class="compact-stock-row' + (freshnessBadge ? ' has-freshness' : '') + '">' +
              stockQuantityPill(it) +
              '<span class="compact-location"' + (it.location ? ' title="' + Utils.escapeHtml(it.location) + '"' : '') + '>' +
                (it.location ? Utils.iconLabel('map-pin', it.location) : '') + '</span>' +
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

      var subtypeLabel = it.subtype || '';
      if (subtypeLabel.includes(catInfo.label)) {
        subtypeLabel = subtypeLabel.split(catInfo.label).join('')
          .replace(/^[\s·・\/、_-]+|[\s·・\/、_-]+$/g, '');
      }

      var palInfo = MP.getPalatabilityBadgeInfo(it);
      var palHtml = palInfo
        ? '<span class="detail-card-palatability" data-rating="' + Utils.escapeHtml(palInfo.key) + '" style="--rating-bg:' + palInfo.bg + ';--rating-ink:' + palInfo.text + ';">' + (catInfo.group === 'food' ? Utils.getPalatabilityIcon(palInfo.key) : '') + Utils.escapeHtml(palInfo.label) + '</span>'
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
      if (it.location) locationParts.push(Utils.iconLabel('map-pin', it.location));
      if (it.batchCode) locationParts.push(Utils.escapeHtml(it.batchCode));
      if (it.purchasePackaging) locationParts.push(purchasePackagingText(it));

      var shelfText = it.shelfLifeValue
        ? Utils.formatQuantity(it.shelfLifeValue, it.shelfLifeUnit === 'days' ? '天' : '个月')
        : '—';
      var percentage = shelfRemainingPercentage(it, ev.expDays);
      var tone = ev.expDays < 0 ? 'urgent' : percentage === null ? 'unknown'
        : percentage > 30 ? 'fresh' : percentage >= 10 ? 'warning' : 'urgent';
      var expiryDays = '';
      if (ev.expDays !== null) {
        var daysText = Utils.formatDays(ev.expDays).text;
        var prefix = ev.expDays < 0 ? '过期' : '剩';
        expiryDays = '<span class="detail-card-expiry-days detail-card-status detail-card-status--' + tone + '" aria-label="' +
          prefix + daysText + '"><span class="detail-card-expiry-prefix" aria-hidden="true">' + prefix + '</span>' +
          '<span aria-hidden="true">' + daysText + '</span></span>';
      }
      var datePanel = '<div class="detail-card-shelf detail-card-track--' + tone + (stock.opened ? ' detail-card-shelf--opened' : '') + '">' +
        '<div class="detail-card-dates">' +
          '<div><div class="detail-card-date-label">生产日期</div><div>' + Utils.escapeHtml(Utils.formatListDate(it.prodDate, '未填写')) + '</div></div>' +
          '<div class="detail-card-shelf-life"><div class="detail-card-date-label">保质期</div><div>' + shelfText + '</div></div>' +
          '<div><div class="detail-card-date-label">过期日期</div><div class="detail-card-date-expiry">' +
            Utils.escapeHtml(Utils.formatListDate(it.expDate, '—')) + expiryDays + '</div></div>' +
          detailedShelfProgress(percentage) + '</div>' +
        '<span class="detail-card-shelf-tip hidden-view" role="status"></span></div>';

      var coverSrc = MP.getItemCoverSrc(it);
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="查看口粮图片" class="detail-card-photo">' +
          '<img src="' + coverSrc + '" alt="' + Utils.escapeHtml(it.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          lastFedHtml +
        '</button>';

      var feedBtnLabel = catInfo.group === 'med' ? '记用药' : '记喂食';

      return (
        '<article class="ios-card p-4 detail-card">' +
          '<div class="detail-card-top">' +
            '<div class="detail-card-image-column">' + thumbHtml + '</div>' +
            '<div class="detail-card-information">' +
              '<div class="detail-card-heading">' +
                '<div class="detail-card-tags">' +
                  '<span class="detail-card-category">' + Utils.getCategoryIcon(it.category, 20) + ' ' + catInfo.label + (subtypeLabel ? ' · ' + Utils.escapeHtml(subtypeLabel) : '') + '</span>' +
                  '<span class="detail-card-brand" title="' + Utils.escapeHtml(it.brand) + '">' + Utils.escapeHtml(it.brand) + '</span>' +
                '</div>' +
              '</div>' +
              '<h3 class="detail-card-product-title" title="' + Utils.escapeHtml([it.name, displaySpec].filter(Boolean).join(' ')) + '">' +
                '<span class="detail-card-product-name">' + Utils.escapeHtml(it.name) + '</span>' +
                (displaySpec ? '<span class="product-title-spec">' + Utils.escapeHtml(displaySpec) + '</span>' : '') + '</h3>' +
              (priceLine ? '<div class="detail-card-line detail-card-price">' + priceLine + '</div>' : '') +
              (locationParts.length ? '<div class="detail-card-line detail-card-location" title="' +
                Utils.escapeHtml([it.location, it.batchCode, it.purchasePackaging && UI.purchasePackagingLabel(it.purchasePackaging, unit)].filter(Boolean).join(' · ')) +
                '">' + locationParts.join(' · ') + '</div>' : '') +
            '</div>' +
          '</div>' +

          datePanel +

          openedBannerHtml +
          (it.flavors ? '<div class="flavor-stock"><strong>剩余：</strong>' + UI.flavorStockText(it, false, true) + '</div>' : '') +
          (it.notes ? '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);background:var(--status-neutral-bg);padding:6px 10px;border-radius:8px;">' + Utils.iconLabel('message-circle', it.notes) + '</div>' : '') +

          '<div style="margin-top:11px;padding-top:10px;border-top:1px solid var(--status-neutral-bg);">' +
            '<div class="detail-card-actions">' +
              '<div class="detail-card-stock-tags">' + stockQuantityPill(it) + palHtml + '</div>' +
              '<div class="detail-card-action-buttons">' +
                '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="历史记录" title="历史记录" class="detail-card-history-btn">' + historyIcon + '</button>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" class="btn-feed">' + UI.feedButtonContent(feedBtnLabel) + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="edit-only grid-safe" style="margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">' +
              '<button type="button" data-action="toggle-open" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid var(--border-warm);background:' + (it.isOpened ? 'var(--accent-soft)' : 'var(--control-bg)') + ';color:' + (it.isOpened ? 'var(--accent-strong)' : 'var(--text-muted)') + ';font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' +
                stockActionIcon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="' +
                  (it.isOpened ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 1 1 8 0v4') + '"/>') +
                (it.isOpened ? '已拆1' + unitStr : qtyNum > 1 ? '拆1' + unitStr : '记开封') +
              '</button>' +
              '<button type="button" data-action="consume-one" data-id="' + Utils.escapeHtml(it.id) + '" style="min-height:34px;padding:0 4px;border-radius:9px;border:1px solid var(--ok-soft);background:var(--ok-soft);color:var(--ok);font-size:11.5px;font-weight:700;cursor:pointer;overflow-wrap:anywhere;">' +
                stockActionIcon('<path d="m5 12 4 4L19 6"/>') + (catInfo.group === 'food' ? '吃完' : '用完') + Math.min(1, qtyNum) + unitStr +
              '</button>' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid var(--accent-edge);background:var(--accent-soft);color:var(--accent-strong);font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">' + stockActionIcon('<path d="m15 5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/>') + '编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid var(--danger-soft);background:var(--danger-soft);color:var(--status-danger-text);font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' + stockActionIcon('<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>') + '删除</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
