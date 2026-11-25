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

  function itemHasStatus(item, status) {
    var counts = Object.values(Domain.summarizeStockDetailStatuses([item]));
    return counts.length ? counts.some(function (count) { return count[status] > 0; })
      : Domain.evaluateItem(item).status === status;
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

  function archivedItemCount(item) {
    return Number(item.consumedCount) || Number(item.lastQuantity) || 0;
  }

  function archivePieceCount(batches) {
    return Utils.round2(batches.reduce(function (sum, item) { return sum + archivedItemCount(item); }, 0));
  }

  function latestArchiveDate(group) {
    return group.batches.reduce(function (latest, item) {
      return item.finishedDate > latest ? item.finishedDate : latest;
    }, '');
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

  function archiveLiveStockPill(quantity, unit) {
    return quantity > 0 ? '<span class="stock-quantity-pill">同款在库 ' +
      Utils.escapeHtml(Utils.formatQuantity(Utils.round2(quantity), unit)) + '</span>' : '';
  }

  function detailedStockQuantityPill(item) {
    var unit = item.unit || '件';
    var used = Number(item.eatenCount) || 0;
    var opened = detailedOpenStock(item, unit).packageCount;
    return '<span class="stock-quantity-pill detail-card-stock-pill">' +
      '<span class="stock-quantity-main">在库 ' + Utils.escapeHtml(Utils.formatQuantity(Number(item.quantity) || 0, unit)) + '</span>' +
      (opened > 0 ? '<span class="stock-quantity-open"><i aria-hidden="true"></i>开封 ' + Utils.escapeHtml(Utils.formatNumber(opened)) + '</span>' : '') +
      (used > 0 ? '<span class="stock-quantity-used">' + (item.discardedCount ? '核销 ' : '已用 ') + Utils.escapeHtml(Utils.formatNumber(used)) + '</span>' : '') +
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
    var foodProducts = new Set();
    var brands = new Set();

    st.items.forEach(function (it) {
      if (Number(it.quantity) > 0) {
        if (MP.isFoodCategory(it.category)) {
          foodProducts.add(Domain.getProductGroupKey(it));
          if (it.brand && it.brand.trim()) brands.add(it.brand.trim());
        }
      }
      var ev = Domain.evaluateItem(it);
      if (ev.status === 'empty') {
        if (it.manualFeedArchive !== true) emptyItems.push(it);
      } else {
        cStock += 1;
        if (itemHasStatus(it, 'expiring')) cExpiring += 1;
        if (itemHasStatus(it, 'expired')) cExpired += 1;

      }
    });
    var cEmpty = Domain.groupEmptyItemsByProduct(emptyItems).length;
    document.getElementById('pantryStockSummary').textContent =
      '口粮 ' + Utils.formatQuantity(foodProducts.size, '款') + ' · ' + Utils.formatQuantity(brands.size, '个品牌');

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
    var archiveMode = st.statusFilter === 'empty';
    document.getElementById('countEmptyPieces').textContent = formatPieceCount(
      archiveMode ? archivePieceCount(emptyItems) : summarizeArchivedPieces(emptyItems)
    );

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
    if (st.statusFilter === 'expiring' || st.statusFilter === 'expired') {
      if (!itemHasStatus(it, st.statusFilter)) return false;
    } else if (st.statusFilter !== 'in_stock' && st.statusFilter !== 'all' && ev.status !== st.statusFilter) return false;
    if (st.pantryHealthFilter === 'opened') return Domain.isStockOpened(it);
    if (st.pantryHealthFilter === 'expiring_or_opened') return itemHasStatus(it, 'expiring') || Domain.isStockOpened(it);
    return true;
  }

  function pantryEntries(items) {
    // Keep the existing archive cards when an archived product appears alongside live batches.
    if (MP.state.statusFilter === 'empty') {
      var redeemed = items.filter(function (item) { return !item.manualFeedArchive; });
      var manual = items.filter(function (item) { return item.manualFeedArchive; });
      return Domain.groupEmptyItemsByProduct(redeemed).concat(Domain.groupEmptyItemsByProduct(manual))
        .map(function (group) { return { archive: group }; });
    }
    var archives = Domain.groupEmptyItemsByProduct(items.filter(function (item) { return item.quantity <= 0; }));
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

  UI.renderCategoryPills = function (resetMissingCategory) {
    var st = MP.state;
    var counts = { all: 0, dry: 0, can: 0, freeze: 0, treat: 0, supp: 0, med: 0, supplies: 0 };
    var matched = st.items.filter(function (item) { return itemMatchesStatus(item, Domain.evaluateItem(item)); });
    var archiveMode = st.statusFilter === 'empty';
    if (archiveMode) matched = matched.filter(function (item) { return !item.manualFeedArchive; });
    pantryEntries(matched).forEach(function (entry) {
      var item = entry.item || entry.archive.latestItem;
      counts.all += 1;
      if (counts[item.category] !== undefined) counts[item.category] += 1;
    });

    if (resetMissingCategory && st.catFilter !== 'all' && !counts[st.catFilter]) st.catFilter = 'all';
    var bar = document.getElementById('categoryBar');
    var btns = bar.querySelectorAll('[data-cat]');
    var visibleCategories = 0;
    for (var i = 0; i < btns.length; i++) {
      var cat = btns[i].getAttribute('data-cat');
      var baseLabel = cat === 'all' ? '全部' : (MP.CATEGORIES[cat]?.label || '其他');
      var icon = cat === 'all' ? '' : Utils.getCategoryIcon(cat, 20) + ' ';
      btns[i].innerHTML = icon + Utils.escapeHtml(baseLabel) + ' ' + Utils.formatNumber(counts[cat] || 0);
      var hidden = cat !== 'all' && !counts[cat] && cat !== st.catFilter;
      btns[i].classList.toggle('hidden-view', hidden);
      btns[i].classList.toggle('active', cat === st.catFilter);
      if (cat !== 'all' && !hidden) visibleCategories += 1;
    }
    var collapsed = visibleCategories === 1 && counts.all > 0 &&
      (st.catFilter === 'all' || counts[st.catFilter] > 0);
    bar.classList.toggle('is-collapsed', collapsed);
    bar.toggleAttribute('inert', collapsed);
    bar.setAttribute('aria-hidden', String(collapsed));
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

  function detailCardRatings(item) {
    var entries = item.flavors
      ? item.flavors.map(function (flavor) {
          return { name: flavor.name, badge: MP.getPalatabilityBadgeInfo({ category: item.category, palatability: flavor.palatability }) };
        })
      : (function () {
          var badge = MP.getPalatabilityBadgeInfo(item);
          return badge ? [{ name: '', badge: badge }] : [];
        })();
    var ratings = entries.filter(function (entry) { return entry.badge; });
    if (!ratings.length) return '';
    var label = entries.map(function (entry) {
      return (entry.name ? entry.name + '：' : '') + (entry.badge ? entry.badge.label : '未测');
    }).join('；');
    var icons = ratings.slice(0, 2).map(function (rating) {
      return '<span class="detail-card-rating-icon" aria-hidden="true">' +
        Utils.escapeHtml(rating.badge.emoji || MP.getPalatabilityEmoji(rating.badge.key)) + '</span>';
    }).join('');
    var extra = ratings.length > 2
      ? '<span class="detail-card-rating-more" aria-hidden="true">+' + (ratings.length - 2) + '</span>' : '';
    var details = entries.map(function (entry) {
      var badge = entry.badge;
      var text = (entry.name ? entry.name + ' ' : '') +
        (badge ? (badge.emoji || MP.getPalatabilityEmoji(badge.key)) + ' ' + badge.label : '未测');
      return '<span>' + Utils.escapeHtml(text) + '</span>';
    }).join('');
    var tipId = 'detail-pal-' + Utils.escapeHtml(item.id);
    return '<span class="compact-tip-wrap detail-card-rating-wrap">' +
      '<button type="button" class="detail-card-palatability" ' +
      'data-compact-tip="palatability" aria-label="' + Utils.escapeHtml(label) + '" aria-expanded="false" aria-describedby="' + tipId + '">' +
      icons + extra + '</button><span id="' + tipId + '" class="compact-tip detail-card-rating-tip" role="tooltip" hidden>' +
      details + '</span></span>';
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
    var openText = opened ? '已开封 ' + Utils.formatQuantity(Math.max(1, openPackages.length), unit) : '';
    if (shared && opened) stockText += ' · 共用包装已开封';
    if (shared && opened) openText = '共用包装已开封';
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
        openText = '开封余 ' + fractionText.slice(1);
      } else {
        parts.push('已开封 ' + Utils.formatQuantity(openPackages.length, unit));
        openText = '已开封 ' + Utils.formatQuantity(openPackages.length, unit);
      }
      stockText = parts.join(' + ');
    }
    return { opened: opened, text: stockText, openText: openText, dates: dates, openCount: openPackages.length, packageCount: packageCount };
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

  function renderDetailedDatePanel(item, evaluated, opened) {
    var hasProduction = Boolean(item.prodDate);
    var hasShelf = Boolean(item.shelfLifeValue);
    var hasExpiry = Boolean(item.expDate);
    if (!hasProduction && !hasShelf && !hasExpiry) return '';
    var columnCount = Number(hasProduction) + Number(hasShelf) + Number(hasExpiry);
    var percentage = hasProduction && hasExpiry ? shelfRemainingPercentage(item, evaluated.expDays) : null;
    var tone = evaluated.expDays === null ? 'unknown' : percentage === null ? Utils.formatDays(evaluated.expDays).tone
      : evaluated.expDays < 0 ? 'urgent' : percentage > 30 ? 'fresh' : percentage >= 10 ? 'warning' : 'urgent';
    var cells = '';
    if (hasProduction) cells += '<div><div class="detail-card-date-label">生产日期</div><div>' + Utils.escapeHtml(item.prodDate) + '</div></div>';
    if (hasShelf) cells += '<div class="detail-card-shelf-life"><div class="detail-card-date-label">保质期</div><div>' +
      Utils.escapeHtml(Utils.formatQuantity(item.shelfLifeValue, item.shelfLifeUnit === 'days' ? '天' : '个月')) + '</div></div>';
    if (hasExpiry) {
      var daysText = Utils.formatDays(evaluated.expDays).text;
      var prefix = evaluated.expDays < 0 ? '过期' : '剩';
      var expiryDays = '<span class="detail-card-expiry-days detail-card-status detail-card-status--' + tone + '" aria-label="' +
        prefix + daysText + '"><span class="detail-card-expiry-prefix" aria-hidden="true">' + prefix + '</span>' +
        '<span aria-hidden="true">' + daysText + '</span></span>';
      cells += '<div><div class="detail-card-date-label">过期日期</div><div class="detail-card-date-expiry">' +
        Utils.escapeHtml(item.expDate) + expiryDays + '</div></div>';
    }
    return '<div class="detail-card-shelf detail-card-track--' + tone + (opened ? ' detail-card-shelf--opened' : '') + '">' +
      '<div class="detail-card-dates detail-card-dates--' + columnCount + '">' + cells + (percentage === null ? '' : detailedShelfProgress(percentage)) + '</div>' +
      '<span class="detail-card-shelf-tip hidden-view" role="status"></span></div>';
  }

  function openedRemainingPercentage(item, days) {
    var limit = Number(item.openDaysLimit);
    if (!Number.isInteger(limit) || limit <= 0 || !Number.isFinite(days)) return null;
    return Math.min(100, Math.max(0, days) / limit * 100);
  }

  function detailedOpenedProgress(item, days) {
    var percent = openedRemainingPercentage(item, days);
    if (percent === null) return '';
    var limit = Number(item.openDaysLimit);
    var remaining = Math.max(0, days);
    var tone = Utils.formatDays(days).tone;
    var label = days < 0 ? '已超开封保鲜期' : '开封保鲜期剩余 ' + Utils.formatDays(remaining).text;
    return '<div class="detail-card-open-progress detail-card-open-progress--' + tone + '">' +
      '<div class="detail-card-open-progress-label"><strong>' + label + '</strong><span>共 ' + Utils.formatQuantity(limit, '天') + '</span></div>' +
      '<button type="button" class="progress-track" data-open-progress aria-label="开封保鲜期剩余 ' + Utils.formatPercent(percent) + '">' +
      '<span class="progress-bar" style="width:' + percent + '%;" aria-hidden="true"></span></button>' +
      '<span class="detail-card-shelf-tip hidden-view" role="status"></span></div>';
  }

  function detailedFlavorOpenStock(item, unit, evaluated) {
    var flavors = item.flavors.filter(function (flavor) {
      return Number(flavor.quantity) > 0 && flavor.openedDate;
    });
    if (!flavors.length) return '';
    var groups = flavors.map(function (flavor) {
      var fraction = Utils.formatRemainFractionText(flavor.openRemainFraction, unit, true);
      var days = Utils.openShelfDaysRemaining(flavor.openedDate, item.openDaysLimit);
      return '<div class="detail-card-open-flavor">' +
        '<div class="detail-card-open-summary">' +
          '<div class="detail-card-open-flavor-stock"><strong>' + Utils.escapeHtml(flavor.name) +
            '</strong> <span>开封余 ' + Utils.escapeHtml(fraction ? fraction.slice(1) : '未记录') + '</span></div>' +
          '<span class="detail-card-open-date">开封日期 ' + Utils.escapeHtml(flavor.openedDate) + '</span>' +
        '</div>' + detailedOpenedProgress(item, days) + '</div>';
    }).join('');
    return '<div class="detail-card-open-stock detail-card-open-stock--' +
      Utils.formatDays(evaluated.openRemaining).tone + '">' + groups + '</div>';
  }

  function stockActionIcon(path) {
    return '<svg class="stock-action-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg> ';
  }

  function cardOverflowMenu(item, showHistory) {
    var id = Utils.escapeHtml(item.id);
    var canOpen = Number(item.quantity) > 0 && (item.flavors
      ? item.flavors.some(function (flavor) {
          return Number(flavor.quantity) > 0 && (Domain.hasSharedSeal(item) ? !item.isOpened : !flavor.openedDate);
        })
      : !item.isOpened && (MP.isFoodCategory(item.category) || item.category === 'med' || item.category === 'supplies'));
    return '<div class="card-overflow">' +
      '<button type="button" class="card-overflow-trigger" data-action="card-menu" data-id="' + id + '" aria-label="更多操作" aria-expanded="false">' + Utils.uiIcon('more-vertical', 20) + '</button>' +
      '<div class="card-overflow-menu hidden-view" role="menu">' +
        (canOpen ? '<button type="button" data-action="toggle-open" data-menu-action data-id="' + id + '" role="menuitem">' + Utils.uiIcon('lock-open') + '<span>' + (item.category === 'supplies' ? '开封' : '记开封') + '</span></button>' : '') +
        '<button type="button" data-action="edit" data-menu-action data-id="' + id + '" role="menuitem">' + Utils.uiIcon('pencil') + '<span>编辑</span></button>' +
        (showHistory ? '<button type="button" data-action="item-history" data-menu-action data-id="' + id + '" role="menuitem">' + Utils.uiIcon('refresh-cw') + '<span>历史记录</span></button>' : '') +
        '<hr><button type="button" class="card-overflow-delete" data-action="delete" data-menu-action data-id="' + id + '" role="menuitem">' + Utils.uiIcon('trash-2') + '<span>删除</span></button>' +
      '</div></div>';
  }

  function renderSupplyInventoryCard(group, historyIcon) {
    var item = group.item;
    var enoughData = Number.isFinite(Number(group.averageCycleDays)) && Number(group.averageCycleDays) > 0 && group.remainingDays !== null;
    var id = Utils.escapeHtml(item.id);
    var opened = Boolean(item.isOpened && item.openedDate);
    var actionContent = UI.feedButtonContent('记用完');
    var cover = MP.getItemCoverSrc(item);
    var photo = '<button type="button" data-action="preview-img" data-id="' + id + '" aria-label="查看日用品图片" class="detail-card-photo">' +
      '<img src="' + Utils.escapeHtml(cover) + '" alt="' + Utils.escapeHtml(item.name) + '">' + UI.itemPhotoCountBadge(item) + '</button>';
    var spec = Utils.formatInventoryItemSpec(item);
    var unitPrice = Utils.formatMoney(item.price, item.currency, group.unit);
    var specPrice = [spec ? spec + '/' + group.unit : '', unitPrice].filter(Boolean).join(' · ');
    var purchased = Number(item.lastQuantity) || (Number(item.quantity) || 0) + (Number(item.eatenCount) || 0);
    var locationPurchase = [item.location ? Utils.uiIcon('map-pin', 14) + Utils.escapeHtml(item.location) : '',
      item.batchCode ? '购入渠道 ' + Utils.escapeHtml(item.batchCode) : '',
      purchased > 0 ? '购入 ' + Utils.escapeHtml(Utils.formatNumber(purchased) + group.unit) : ''].filter(Boolean).join(' · ');
    var ev = Domain.evaluateItem(item);
    var datePanel = renderDetailedDatePanel(item, ev, opened);
    var freshPanel = '';
    if (Number(item.openDaysLimit) > 0) {
      var freshDays = opened ? Utils.openShelfDaysRemaining(item.openedDate, Number(item.openDaysLimit)) : null;
      freshPanel = '<div class="supply-detail-fresh"><span>开封后保鲜期 ' + Utils.formatQuantity(item.openDaysLimit, '天') + '</span>' +
        (freshDays === null ? '' : '<strong>' + (freshDays < 0 ? '已超过 ' : '剩 ') + Utils.formatDays(freshDays).text + '</strong>') + '</div>';
    }
    var estimatePanel = enoughData ? '<div class="supply-detail-estimate">本批剩 ' +
      Utils.escapeHtml(Utils.formatNumber(group.quantity) + ' ' + group.unit) + ' · 预计还能用 ' +
      Utils.formatNumber(group.remainingDays) + ' 天</div>' :
      item.isSample ? '<div class="supply-detail-estimate">示例库存未计入预测</div>' : '';
    if (opened) {
      var usedDays = Number(group.currentUsedDays) || 0;
      var average = Number(group.averageCycleDays);
      var ratio = average > 0 ? usedDays / average * 100 : 0;
      var progressTone = ratio > 100 ? 'danger' : ratio >= 70 ? 'warning' : 'ok';
      var estimateText = ratio > 100
        ? '已超过平均 ' + Utils.formatNumber(Math.max(0, usedDays - average)) + ' 天'
        : '预计还能用 ' + Utils.formatNumber(group.remainingDays) + ' 天';
      estimatePanel = '<div class="supply-current-cycle supply-current-cycle--' + progressTone + '">' +
        '<div><span>当前这' + Utils.escapeHtml(group.unit) + ' · 开封 ' + Utils.escapeHtml(item.openedDate) + '</span><span>已用 ' + Utils.formatNumber(usedDays) + '天</span></div>' +
        (enoughData ? '<strong>' + estimateText + '</strong>' : item.isSample ? '<strong>示例库存未计入预测</strong>' : '') +
        (enoughData ? '<span class="progress-track"><i class="progress-bar" style="width:' + Math.min(100, ratio) + '%"></i></span>' : '') + '</div>';
    }
    return '<article class="ios-card detail-card supply-detail-card" data-id="' + id + '">' + cardOverflowMenu(item) +
      '<div class="detail-card-top"><div class="detail-card-image-column">' + photo + '</div>' +
        '<div class="detail-card-information"><div class="supply-detail-identity">' + Utils.getCategoryIcon('supplies', 20) +
          '<span>日用品</span><i>·</i><b title="' + Utils.escapeHtml(item.brand) + '">' + Utils.escapeHtml(item.brand) + '</b></div>' +
          '<h3 class="supply-detail-name">' + Utils.escapeHtml(item.name) + '</h3>' +
          (specPrice ? '<div class="detail-card-line">' + Utils.escapeHtml(specPrice) + '</div>' : '') +
          (!opened ? estimatePanel : '') +
          (locationPurchase ? '<div class="detail-card-line supply-detail-location">' + locationPurchase + '</div>' : '') + '</div></div>' +
      datePanel + freshPanel + (opened ? estimatePanel : '') +
      '<div class="supply-inventory-footer"><div class="supply-detail-stats"><strong>在库 ' + Utils.escapeHtml(Utils.formatNumber(group.quantity) + group.unit) + '</strong>' +
        (opened ? '<span><i></i>开封 ' + Utils.formatNumber(group.openedCount || 1) + '</span>' : '') +
        (group.usedCount > 0 ? '<span>' + (group.discardedCount ? '核销 ' : '已用 ') + Utils.escapeHtml(Utils.formatNumber(group.usedCount) + group.unit) + '</span>' : '') + '</div>' +
        '<div class="detail-card-action-buttons"><button type="button" data-action="item-history" data-id="' + id + '" aria-label="历史记录" title="历史记录" class="detail-card-history-btn">' + historyIcon + '</button>' +
          (opened ? '<button type="button" data-action="consume-one" data-id="' + id + '" class="btn-feed inventory-primary-action">' + actionContent + '</button>' : '') + '</div></div></article>';
  }

  UI.renderPantryList = function () {
    var historyIcon = document.querySelector('#openStockHistoryBtn svg').outerHTML;
    var st = MP.state;
    var archiveMode = st.statusFilter === 'empty';
    var sort = document.getElementById('sortSelect');
    var supplyMode = !archiveMode && st.catFilter === 'supplies';
    Array.from(sort.options).forEach(function (option) {
      option.hidden = archiveMode ? !['finished_desc', 'brand_asc'].includes(option.value)
        : supplyMode ? !['supply_days_asc', 'supply_arrival_desc'].includes(option.value)
        : ['finished_desc', 'supply_days_asc', 'supply_arrival_desc'].includes(option.value);
    });
    sort.value = archiveMode ? st.archiveSortBy || 'finished_desc' : supplyMode ? st.supplySortBy || 'supply_days_asc' : st.sortBy;
    var q = st.searchQuery.trim().toLowerCase();
    var filtered = st.items.filter(function (it) {
      var ev = Domain.evaluateItem(it);
      if (!itemMatchesStatus(it, ev)) return false;
      if (st.catFilter === 'food' ? ev.group !== 'food' :
        st.catFilter !== 'all' && it.category !== st.catFilter) return false;
      if (st.brandFilter !== 'all' && (it.brand || '').trim() !== st.brandFilter) return false;
      if (q) {
        var hay = [it.brand, it.name, it.spec, Utils.formatItemSpec(it), Utils.formatInventoryItemSpec(it), it.location, it.batchCode, it.notes]
          .concat((it.flavors || []).map(function (flavor) { return flavor.name; }))
          .join(' ')
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (!archiveMode) filtered.sort(function (a, b) {
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
    var supplyEstimateMap = new Map(Domain.getSupplyUsageEstimates(st.items, st.stockHistory).map(function (group) {
      return [group.key, group];
    }));
    function supplyBatchEstimate(item) {
      return Domain.getSupplyBatchEstimate(item, supplyEstimateMap.get(Domain.getProductGroupKey(item)));
    }
    if (archiveMode) {
      entries.sort(function (a, b) {
        var left = a.archive, right = b.archive;
        if (sort.value === 'brand_asc') return left.latestItem.brand.localeCompare(right.latestItem.brand, 'zh-CN');
        return latestArchiveDate(right).localeCompare(latestArchiveDate(left));
      });
    } else if (supplyMode) {
      entries.sort(function (a, b) {
        if (!a.item || !b.item) return Number(!a.item) - Number(!b.item);
        var left = supplyBatchEstimate(a.item), right = supplyBatchEstimate(b.item);
        if (sort.value === 'supply_arrival_desc') return String(right.latestArrivalDate).localeCompare(String(left.latestArrivalDate));
        return (left.remainingDays === null ? Infinity : left.remainingDays) - (right.remainingDays === null ? Infinity : right.remainingDays);
      });
    }
    if (st.pantryDisplayMode === 'compact' && !archiveMode && !supplyMode && sort.value === 'exp_asc') {
      var groupOrder = { expired: 0, expiring: 1, fresh: 2 };
      entries.sort(function (a, b) {
        return (a.item ? groupOrder[Domain.evaluateItem(a.item).status] : 3) -
          (b.item ? groupOrder[Domain.evaluateItem(b.item).status] : 3);
      });
    }
    var hasExtraFilter = (st.statusFilter !== 'in_stock' || Boolean(st.pantryHealthFilter) || st.catFilter !== 'all' || st.brandFilter !== 'all' || Boolean(q));
    var summaryBar = document.getElementById('activeFilterSummaryBar');
    var summaryTxt = document.getElementById('filterResultCountText');
    summaryBar.classList.toggle('hidden-view', !hasExtraFilter);
    if (hasExtraFilter) {
      var displayCount = entries.length;
      var unitWord = st.statusFilter === 'empty' ? '款产品' : st.statusFilter === 'all' ? '条商品记录' : '批商品';
      var redeemed = filtered.filter(function (item) { return !item.manualFeedArchive; });
      summaryTxt.textContent = archiveMode
        ? Utils.formatQuantity(pantryEntries(redeemed).length, '款') + '，共 ' + Utils.formatQuantity(archivePieceCount(redeemed), '件已核销')
        : '当前筛选结果：共 ' + Utils.formatQuantity(displayCount, unitWord);
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
        var totals = liveTotals.get(key) || { quantity: 0 };
        totals.quantity += Number(item.quantity);
        liveTotals.set(key, totals);
      });
    }

    if (archiveMode) {
      var esc = Utils.escapeHtml;
      function dateText(date) { return date ? date.slice(5) : ''; }
      function redemption(count, unit) { return count ? '核销 ' + Utils.formatQuantity(count, unit) : '核销数量未记录'; }
      function archiveThumb(item) {
        var photo = MP.getItemCoverSrc(item);
        return '<span class="redeemed-thumb">' +
          (photo ? '<img src="' + esc(photo) + '" alt="">' : Utils.getCategoryIcon(item.category)) + UI.itemPhotoCountBadge(item) + '</span>';
      }
      function archiveAction(action, item, label, extra) {
        return '<button type="button" data-action="' + action + '" data-id="' + esc(item.id) + '"' + (extra || '') + '>' + label + '</button>';
      }
      function batchDuration(item) {
        return item.discardedCount ? null : Utils.calcConsumeDays(item.archivedOpenedDate || item.openedDate, item.finishedDate);
      }
      function archiveBody(group, batches, total, unit) {
        var days = 0, datedUnits = 0;
        var costs = new Map();
        var rows = batches.map(function (item, index) {
          var count = archivedItemCount(item);
          var duration = batchDuration(item);
          if (duration !== null && count > 0 && (item.category !== 'supplies' || count === 1)) {
            days += duration;
            datedUnits += count;
          }
          if (Number(item.price) > 0 && count > 0) {
            var currency = item.currency || 'CNY';
            var cost = costs.get(currency) || { price: 0, units: 0 };
            cost.price += Number(item.price) * count;
            cost.units += count;
            costs.set(currency, cost);
          }
          var opening = dateText(item.archivedOpenedDate || item.openedDate);
          var finished = dateText(item.finishedDate);
          var dates = [opening && opening + (item.category === 'med' ? ' 使用' : ' 开封'),
            finished && finished + (item.discardedCount ? ' 核销（含丢弃 ' + Utils.formatQuantity(item.discardedCount, unit) + '）' : ' 用完')].filter(Boolean).join(' → ');
          var pack = item.purchasePackaging;
          var purchase = [
            pack && '购入 ' + UI.purchasePackagingLabel(pack, item.unit),
            Utils.formatMoney(pack ? item.price * pack.size * pack.count : item.price, item.currency, pack ? '' : unit),
            item.batchCode && '购入渠道 ' + item.batchCode
          ].filter(Boolean).join(' · ');
          var shelf = [item.prodDate && '产 ' + item.prodDate, item.expDate && '期 ' + item.expDate].filter(Boolean).join(' · ');
          return '<div class="redeemed-batch"><div class="redeemed-batch-main"><span class="redeemed-batch-id">' +
            '#' + (batches.length - index) + '</span><span>' + esc(dates || '核销日期未记录') + '</span>' +
            (batches.length > 1 && count > 0 ? '<span>' + esc(Utils.formatQuantity(count, unit)) + '</span>' : '') +
            (duration !== null ? '<span class="redeemed-duration">用时 ' + Utils.formatQuantity(duration, '天') + '</span>' : '') +
            '</div>' + (purchase ? '<div class="redeemed-muted">' + esc(purchase) + '</div>' : '') +
            (shelf ? '<div class="redeemed-muted">' + esc(shelf) + '</div>' : '') +
            cardOverflowMenu(item, false) + '</div>';
        });
        var metrics = datedUnits ? ['均每' + unit + ' ' + Utils.formatQuantity(Math.max(1, Math.round(days / datedUnits)), '天')] : [];
        costs.forEach(function (cost, currency) {
          metrics.push((batches.length > 1 ? '平均' : '') + Utils.formatMoney(cost.price / cost.units, currency, unit));
        });
        var countLabel = redemption(total, unit);
        var summary = '<div class="redeemed-summary"><strong>' + esc(batches.length > 1 && total ? '共' + countLabel : countLabel) + '</strong>' +
          esc((batches.length > 1 ? ' · ' + batches.length + '批' : '') + (metrics.length ? ' · ' + metrics.join(' · ') : '')) + '</div>';
        var folded = rows.length > 3 ? '<details class="redeemed-older"><summary>查看更早 ' + (rows.length - 3) + ' 批</summary>' +
          rows.slice(3).join('') + '</details>' : '';
        var rep = group.latestItem;
        var stock = liveTotals.get(group.groupKey)?.quantity || 0;
        return {
          summary: summary,
          batches: '<div class="redeemed-batches">' + rows.slice(0, 3).join('') + folded + '</div>',
          footer: '<div class="archive-footer redeemed-footer">' + archiveLiveStockPill(stock, unit) +
            archiveAction('archive-history', rep, historyIcon, ' aria-label="流水" title="流水"') +
            archiveAction('restock-new', rep, '复购入库') + '</div>'
        };
      }
      function renderRedeemed(group, compact) {
        var item = group.latestItem;
        var batches = group.batches.slice().sort(function (a, b) { return String(b.finishedDate || '').localeCompare(String(a.finishedDate || '')); });
        var unit = item.unit || '件';
        var total = archivePieceCount(batches);
        var content = archiveBody(group, batches, total, unit);
        var thumbnail = archiveThumb(item);
        if (compact) {
          var duration = batchDuration(batches[0]);
          var meta = [redemption(total, unit), duration !== null && '用时 ' + Utils.formatQuantity(duration, '天'), dateText(batches[0].finishedDate)].filter(Boolean);
          return '<article class="ios-card archive-card redeemed-compact"><details><summary>' + thumbnail +
            '<span class="redeemed-compact-copy"><span class="redeemed-compact-name"><strong>' + esc(item.name) + '</strong> ' + esc(item.brand) +
            '</span><span class="redeemed-muted">' + esc(meta.join(' · ')) + '</span></span><span class="redeemed-chevron" aria-hidden="true">›</span></summary>' +
            '<div class="redeemed-expanded">' + content.batches + content.footer + '</div></details></article>';
        }
        var spec = Utils.formatInventoryItemSpec(item);
        return '<article class="ios-card archive-card redeemed-card"><div class="redeemed-heading">' +
          archiveAction('preview-img', item, thumbnail, ' class="redeemed-photo" aria-label="查看商品图片"') +
          '<div class="redeemed-copy"><div class="redeemed-tags"><span class="redeemed-category">' + esc(MP.CATEGORIES[item.category].label) +
          '</span>' + (item.brand ? '<span class="redeemed-brand">' + esc(item.brand) + '</span>' : '') + detailCardRatings(item) +
          '</div><h3>' + esc(item.name) + (spec ? ' <small>' + esc(spec) + '</small>' : '') + '</h3>' +
          content.summary + '</div></div>' + content.batches + content.footer + '</article>';
      }
      var compact = st.pantryDisplayMode === 'compact';
      listEl.style.gap = compact ? '8px' : '12px';
      var months = new Map();
      var cards = [];
      pagedItems.forEach(function (entry) {
        var group = entry.archive;
        var month = group.batches.every(function (item) { return item.manualFeedArchive; }) ? '手动归档' : latestArchiveDate(group).slice(0, 7);
        var card = renderRedeemed(group, compact);
        if (!compact && month !== '手动归档') { cards.push(card); return; }
        if (!months.has(month)) months.set(month, []);
        months.get(month).push(card);
      });
      listEl.innerHTML = cards.join('') + Array.from(months.keys()).sort(function (a, b) {
        return a === '手动归档' ? 1 : b === '手动归档' ? -1 : b.localeCompare(a);
      }).map(function (month) {
        var label = month === '手动归档' ? month : month ? Number(month.slice(5)) + ' 月' : '核销月份未记录';
        if (month && month !== '手动归档' && month.slice(0, 4) !== Utils.getTodayStr().slice(0, 4)) {
          label = month.slice(0, 4) + ' 年 ' + label;
        }
        return '<section class="redeemed-month"><h3>' + esc(label) + '</h3>' + months.get(month).join('') + '</section>';
      }).join('');
      return;
    }

    function archiveFooter(group) {
      var item = group.latestItem;
      var totals = liveTotals.get(group.groupKey) || { quantity: 0 };
      return '<div class="archive-footer">' +
        archiveLiveStockPill(totals.quantity, item.unit || '件') +
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
      return (
        '<div class="ios-card archive-card" style="padding:10px 12px;border-radius:14px;">' +
          '<div data-action="edit" data-id="' + Utils.escapeHtml(rep.id) + '" style="min-width:0;flex:1;cursor:pointer;">' +
            '<div class="archive-row" style="display:flex;align-items:center;gap:5px;min-width:0;">' +
              Utils.getCategoryIcon(rep.category) +
              '<span style="font-size:11px;font-weight:700;color:var(--accent-strong);background:var(--accent-soft);padding:1px 6px;border-radius:6px;flex-shrink:0;">' + Utils.escapeHtml(rep.brand) + '</span>' +
              '<strong style="font-size:13.5px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(rep.name) + '</strong>' +
              archiveBadge(grp) +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">' +
              '共 ' + Utils.formatQuantity(grp.batches.length, '个历史批次') + (Utils.formatInventoryItemSpec(rep) ? (' · 规格 ' + Utils.escapeHtml(Utils.formatInventoryItemSpec(rep))) : '') +
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
      var palHtml = detailCardRatings(rep);
      var coverSrc = MP.getItemCoverSrc(rep);
      var realTag = MP.getItemImages(rep).length
        ? '<span style="position:absolute;bottom:3px;right:3px;background:var(--photo-badge-bg);color:var(--text-on-accent);font-size:11px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
        : '';
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(rep.id) + '" aria-label="查看口粮图片" style="position:relative;width:64px;height:64px;padding:0;border:1px solid var(--border-warm);border-radius:14px;overflow:hidden;background:var(--control-bg);flex-shrink:0;cursor:pointer;">' +
          '<img src="' + Utils.escapeHtml(coverSrc) + '" alt="' + Utils.escapeHtml(rep.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          realTag + UI.itemPhotoCountBadge(rep) +
        '</button>';

      var totalDaysSum = 0;
      var totalUnitsWithDays = 0;

      var batchRowsHtml = grp.batches.map(function (bItem, bIdx) {
        var bUsed = Number(bItem.consumedCount) || Number(bItem.lastQuantity) || 1;
        var packTxt = purchasePackagingText(bItem);
        var priceTxt = bItem.price ? (' · ' + Utils.formatMoney(bItem.price, bItem.currency)) : '';
        var bOpen = bItem.archivedOpenedDate || bItem.openedDate || '';
        var bFin = bItem.finishedDate || '';
        var cDays = bItem.discardedCount ? null : Utils.calcConsumeDays(bOpen, bFin);
        if (cDays !== null && (bItem.category !== 'supplies' || bUsed === 1)) {
          totalDaysSum += cDays;
          totalUnitsWithDays += bUsed;
        }
        var durationBadgeHtml = cDays !== null
          ? '<span style="font-size:11px;font-weight:800;color:var(--accent-strong);background:var(--accent-soft);padding:1px 7px;border-radius:6px;">' + Utils.uiIcon('timer') + '共 ' + Utils.formatQuantity(cDays, '天') + '</span>'
          : '';

        var openFinishLine = '';
        if (bItem.discardedCount && bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-muted);">核销日期 ' + Utils.escapeHtml(bFin) + ' · 含丢弃 ' + Utils.escapeHtml(Utils.formatQuantity(bItem.discardedCount, bItem.unit || '件')) + '</div>';
        } else if (bOpen && bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-main);font-weight:600;">' + Utils.uiIcon('lock-open') + '开封日期 ' + Utils.escapeHtml(bOpen) + ' → ' + Utils.uiIcon('circle-check') + '用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bFin) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-muted);">✓ 用完日期 ' + Utils.escapeHtml(bFin) + '</div>';
        } else if (bOpen) {
          openFinishLine = '<div style="margin-top:3px;font-size:11.5px;color:var(--text-muted);">' + Utils.uiIcon('lock-open') + '开封日期 ' + Utils.escapeHtml(bOpen) + '</div>';
        }

        return (
          '<div class="archive-batch-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 44px 8px 10px;border-radius:10px;background:var(--card-bg);border:1px solid var(--border-warm);">' +
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
                (bItem.batchCode ? (' · 购入渠道 ' + Utils.escapeHtml(bItem.batchCode)) : '') +
              '</div>' +
            '</div>' +
            cardOverflowMenu(bItem, false) +
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
                (Utils.formatInventoryItemSpec(rep) ? ('规格 ' + Utils.escapeHtml(Utils.formatInventoryItemSpec(rep)) + ' · ') : '') + '共归档 ' + Utils.formatQuantity(grp.batches.length, '个历史批次') + avgTxt +
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

    UI.renderPantryDetail = function (id) {
      var item = st.items.find(function (candidate) { return candidate.id === id && Number(candidate.quantity) > 0; });
      return item ? renderDetailedItem({ item: item }) : '';
    };

    if (st.pantryDisplayMode === 'compact') {
      listEl.style.gap = '8px';
      var compactRows = pagedItems.map(function (entry) {
        if (entry.archive) return renderCompactArchive(entry.archive);
        var it = entry.item;
        var ev = Domain.evaluateItem(it);
        var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
        var expiryDays = ev.expDays;
        var expiryLabel = expiryDays === null ? '未填写过期日期'
          : expiryDays < 0 ? '已过期 ' + Utils.formatDays(expiryDays).text
          : '剩 ' + Utils.formatDays(expiryDays).text;
        var opened = it.category === 'supplies' ? Boolean(it.isOpened && it.openedDate) : Domain.isStockOpened(it);
        var openDays = ev.openRemaining;
        var openLabel = !opened ? '未开封' : openDays === null ? '未填写开封保鲜期'
          : openDays < 0 ? '开封超期 ' + Utils.formatDays(openDays).text : '开封剩 ' + Utils.formatDays(openDays).text;
        var showOpening = openDays !== null && (expiryDays === null || openDays < expiryDays);
        var statusDays = showOpening ? openDays : expiryDays;
        var statusLabel = showOpening ? openLabel : expiryLabel;
        if (it.category === 'supplies' && !it.expDate && !showOpening) statusLabel = '';
        var id = Utils.escapeHtml(it.id);
        var unit = it.unit || '件';
        var compactStock = detailedOpenStock(it, unit);
        var compactOpened = opened ? Math.max(1, compactStock.openCount) : 0;
        var compactUsed = Number(it.eatenCount) || 0;
        var stockText = '在库 ' + Utils.formatQuantity(Number(it.quantity) || 0, unit) +
          ' · 开封 ' + Utils.formatNumber(compactOpened) +
          (compactUsed > 0 ? ' · ' + (it.discardedCount ? '核销 ' : '已用 ') + Utils.formatNumber(compactUsed) : '');
        var displaySpec = Utils.formatInventoryItemSpec(it);
        var daysTone = Utils.formatDays(statusDays).tone;
        var tone = daysTone === 'unknown' ? 'unknown' : ['expired', 'urgent'].includes(daysTone) ? 'danger'
          : daysTone === 'warning' ? 'warning' : 'ok';
        var thumb = '<img src="' + Utils.escapeHtml(MP.getItemCoverSrc(it)) + '" alt="">';
        var remainingPercent = compactOpened > 0 ? openedRemainingPercentage(it, openDays) : null;
        var percent = remainingPercent === null ? null : 100 - remainingPercent;
        if (compactOpened > 0 && ev.status === 'expired') percent = 100;
        var action = catInfo.group === 'supplies' ? 'consume-one' : 'log-feed';
        var actionLabel = catInfo.group === 'supplies' ? '记用完' : catInfo.group === 'med' ? '记用药' : '记喂食';
        return '<div class="compact-stock-card compact-tone--' + tone + '" data-id="' + id + '">' +
          ((catInfo.group !== 'supplies' || opened) ? '<button type="button" class="compact-swipe-action" data-action="' + action +
            '" data-id="' + id + '" tabindex="-1" aria-hidden="true" inert>' + Utils.uiIcon('paw-print', 20) + '<span>' + actionLabel + '</span></button>' : '') +
          '<button type="button" class="compact-row-main" data-compact-detail="' + id + '" aria-label="查看批次详情：' +
            Utils.escapeHtml([it.brand, catInfo.label, it.name, displaySpec, statusLabel, stockText].filter(Boolean).join('，') +
              (catInfo.group !== 'supplies' || opened ? '。左滑或按左方向键显示' + actionLabel : '')) + '">' +
            '<span class="compact-thumb">' + thumb + '</span><span class="compact-summary">' +
              '<span class="compact-summary-top"><span class="compact-summary-brand">' + Utils.escapeHtml([it.brand, catInfo.label].filter(Boolean).join(' · ')) +
                '</span>' + (statusLabel ? '<span class="compact-summary-status">' + Utils.escapeHtml(statusLabel) + '</span>' : '') + '</span>' +
              '<span class="compact-summary-title"><span class="compact-summary-name">' + Utils.escapeHtml(it.name) + '</span>' +
                (displaySpec ? '<span class="compact-summary-spec">' + Utils.escapeHtml(displaySpec) + '</span>' : '') + '</span>' +
              '<span class="compact-summary-stock">' + Utils.escapeHtml(stockText) + '</span>' +
              '<span class="compact-summary-progress' + (percent === null ? ' is-empty' : '') + '">' +
                (percent === null ? '' : '<span style="width:' + percent + '%"></span>') + '</span></span></button></div>';
      }).join('');
      listEl.innerHTML = '<div class="compact-list">' + compactRows + '</div>';
      if (UI.maybeShowCompactSwipeHint) UI.maybeShowCompactSwipeHint();
      return;
    }

    // Detailed Product Card Mode (Enhanced with Group Styling, Per-100g Price, Last-Fed Tag & History Button)
    listEl.style.gap = supplyMode ? '8px' : '12px';
    function renderDetailedItem(entry) {
      if (entry.archive) return renderDetailedArchive(entry.archive);
      var it = entry.item;
      if (it.category === 'supplies') {
        return renderSupplyInventoryCard(supplyBatchEstimate(it), historyIcon);
      }
      var ev = Domain.evaluateItem(it);
      var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
      var unit = it.unit || '件';
      var stock = detailedOpenStock(it, unit);

      var subtypeLabel = it.subtype || '';
      if (subtypeLabel.includes(catInfo.label)) {
        subtypeLabel = subtypeLabel.split(catInfo.label).join('')
          .replace(/^[\s·・\/、_-]+|[\s·・\/、_-]+$/g, '');
      }

      var palHtml = detailCardRatings(it);
      var lastFedHtml = buildLastFedTagHtml(it);


      var qtyNum = Number(it.quantity) || 0;
      var unitStr = Utils.escapeHtml(unit);
      var stockHtml = '<span class="detail-card-stock-text">' + Utils.escapeHtml(stock.openText) + '</span>';
      var openedProgress = stock.opened ? detailedOpenedProgress(it, ev.openRemaining) : '';
      var openedBannerHtml = stock.opened
        ? '<div class="detail-card-open-stock detail-card-open-stock--' + Utils.formatDays(ev.openRemaining).tone + '">' +
          '<div class="detail-card-open-summary">' +
            '<div>' + stockHtml + '</div>' +
            (stock.dates.length ? '<span class="detail-card-open-date">开封日期 ' + Utils.escapeHtml(stock.dates.join(' · ')) + '</span>' : '') +
          '</div>' + openedProgress + '</div>'
        : '';
      if (stock.opened && ['can', 'treat'].includes(it.category) && it.flavors && !Domain.hasSharedSeal(it)) {
        openedBannerHtml = detailedFlavorOpenStock(it, unit, ev) || openedBannerHtml;
      }

      var displaySpec = Utils.formatInventoryItemSpec(it);
      var priceLine = packagedPriceText(it, unit);
      var price = Utils.formatMoney(it.price, it.currency, unit);
      if (!priceLine && price) {
        var per100 = catInfo.group === 'food' && !it.flavors ? Utils.formatPer100gPrice(it.price, it.currency, it.unit_net_weight_g) : '';
        priceLine = Utils.escapeHtml(price) + (per100 ? '（' + per100 + '）' : '');
      }
      var locationParts = [];
      if (it.location) locationParts.push(Utils.iconLabel('map-pin', it.location));
      if (it.batchCode) locationParts.push('购入渠道 ' + Utils.escapeHtml(it.batchCode));
      if (it.purchasePackaging) locationParts.push(purchasePackagingText(it));

      var datePanel = renderDetailedDatePanel(it, ev, stock.opened);

      var coverSrc = MP.getItemCoverSrc(it);
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="查看口粮图片" class="detail-card-photo">' +
          '<img src="' + Utils.escapeHtml(coverSrc) + '" alt="' + Utils.escapeHtml(it.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          lastFedHtml + UI.itemPhotoCountBadge(it) +
        '</button>';

      var feedBtnLabel = catInfo.group === 'supplies' ? '记用完' : catInfo.group === 'med' ? '记用药' : '记喂食';
      var primaryAction = catInfo.group === 'supplies' ? 'consume-one' : 'log-feed';

      return (
        '<article class="ios-card p-4 detail-card">' + cardOverflowMenu(it) +
          '<div class="detail-card-top">' +
            '<div class="detail-card-image-column">' + thumbHtml + '</div>' +
            '<div class="detail-card-information">' +
              '<div class="detail-card-heading">' +
                '<div class="detail-card-tags">' +
                  '<span class="detail-card-identity">' +
                    '<span class="detail-card-category">' + Utils.getCategoryIcon(it.category, 20) + '<span>' + catInfo.label + (subtypeLabel ? ' · ' + Utils.escapeHtml(subtypeLabel) : '') + '</span></span>' +
                    '<span class="detail-card-brand" title="' + Utils.escapeHtml(it.brand) + '">' + Utils.escapeHtml(it.brand) + '</span>' +
                  '</span>' +
                  palHtml +
                '</div>' +
              '</div>' +
              '<h3 class="detail-card-product-title" title="' + Utils.escapeHtml([it.name, displaySpec].filter(Boolean).join(' ')) + '">' +
                '<span class="detail-card-product-name">' + Utils.escapeHtml(it.name) + '</span>' +
                (displaySpec ? '<span class="product-title-spec">' + Utils.escapeHtml(displaySpec) + '</span>' : '') + '</h3>' +
              (priceLine ? '<div class="detail-card-line detail-card-price">' + priceLine + '</div>' : '') +
              (locationParts.length ? '<div class="detail-card-line detail-card-location" title="' +
                Utils.escapeHtml([it.location, it.batchCode && '购入渠道 ' + it.batchCode, it.purchasePackaging && UI.purchasePackagingLabel(it.purchasePackaging, unit)].filter(Boolean).join(' · ')) +
                '">' + locationParts.join(' · ') + '</div>' : '') +
            '</div>' +
          '</div>' +

          datePanel +

          openedBannerHtml +
          (it.flavors && !['can', 'treat'].includes(it.category) ? '<div class="flavor-stock"><strong>剩余：</strong>' + UI.flavorStockText(it, false, true) + '</div>' : '') +
          (it.notes ? '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);background:var(--status-neutral-bg);padding:6px 10px;border-radius:8px;">' + Utils.iconLabel('message-circle', it.notes) + '</div>' : '') +

          '<div style="margin-top:11px;padding-top:10px;border-top:1px solid var(--status-neutral-bg);">' +
            '<div class="detail-card-actions">' +
              '<div class="detail-card-stock-tags">' + detailedStockQuantityPill(it) + '</div>' +
              '<div class="detail-card-action-buttons">' +
                '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="历史记录" title="历史记录" class="detail-card-history-btn">' + historyIcon + '</button>' +
                '<button type="button" data-action="' + primaryAction + '" data-id="' + Utils.escapeHtml(it.id) + '" class="btn-feed inventory-primary-action">' + UI.feedButtonContent(feedBtnLabel) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }
    listEl.innerHTML = pagedItems.map(renderDetailedItem).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
