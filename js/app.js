/* Meow Pantry App Controller: Event Delegation, Form Validation, Stock Ledger Recording & SW Lifecycle */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Storage = MP.Storage;
  var Stats = MP.Stats;
  var UI = MP.UI;
  var App = MP.App = {};

  function copyTextSummary() {
    var active = MP.state.items.filter(function (it) { return (Number(it.quantity) || 0) > 0; });
    var lines = ['【喵喵粮仓盘点】截至 ' + Utils.getTodayStr() + '（共 ' + Utils.formatQuantity(active.length, '批') + '在库）'];
    active.sort(function (a, b) { return Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays; });
    active.forEach(function (it) {
      var ev = Domain.evaluateItem(it);
      var cat = (MP.CATEGORIES[it.category] || MP.CATEGORIES.dry).label;
      var dayTxt = ev.expDays !== null ? (ev.expDays < 0 ? '已过期' + Utils.formatDays(ev.expDays).text : '剩' + Utils.formatDays(ev.expDays).text) : '';
      lines.push('• [' + cat + '] ' + it.brand + ' ' + it.name + ' × ' + Utils.formatQuantity(it.quantity, it.unit) + ' ｜ 过期日期 ' + Utils.formatListDate(it.expDate) + ' (' + dayTxt + ')');
    });
    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        UI.showToast('盘点清单已复制到剪贴板');
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      UI.showToast('盘点清单已复制到剪贴板');
    } catch (e) {
      UI.showToast('复制失败，请使用导出功能');
    }
    document.body.removeChild(ta);
  }

  var lastActiveDayStr = Utils.getTodayStr();
  var followToday = true;

  function selectLogDate(date) {
    MP.state.selectedLogDate = date;
    followToday = date === Utils.getTodayStr();
  }

  function clearPantryFilters() {
    var st = MP.state;
    st.statusFilter = 'in_stock';
    st.pantryHealthFilter = '';
    st.catFilter = 'all';
    st.brandFilter = 'all';
    st.searchQuery = '';
    st.pantryPage = 1;
    document.getElementById('searchInput').value = '';
  }

  function handleDeleteFeedingLog(logId) {
    var st = MP.state;
    var targetLog = st.logs.find(function (lg) { return lg.id === logId; });
    if (!targetLog) return;
    var product = Domain.resolveLogProduct(targetLog);
    var canRevert = targetLog.itemId && (targetLog.flavorChange || Number(targetLog.deductedUnit) > 0 || Number(targetLog.deductedFrac) > 0);
    var units = Number(targetLog.deductedUnit) || 0;
    var unit = targetLog.productUnit || Domain.resolveLogProduct(targetLog, true).unit || '件';
    var restore = units > 0 ? '库存 +' + Utils.formatNumber(units) + ' ' + unit : '恢复开封余量';
    if (units > 0 && (targetLog.portionChange || targetLog.flavorChange || targetLog.deductedFrac > 0)) {
      restore += '，开封余量一并恢复';
    }
    var options = {
      label: canRevert ? '同时退回库存' : '',
      defaultChecked: Boolean(canRevert),
      deleteLog: {
        category: targetLog.category,
        name: [product.brand, product.name].filter(Boolean).join(' '),
        meta: [Utils.formatListDate(targetLog.date), product.subtype || targetLog.subtype || MP.CATEGORIES[targetLog.category]?.label].filter(Boolean).join(' · '),
        amount: String(targetLog.amount || '').replace(/^(\d+(?:[./]\d+)?)\s*(?=[^\d\s])/, '$1 '),
        restore: restore
      }
    };
    UI.openConfirm('删除这条记录？', '', '删除', function (doRevert) {
      var existsIdx = st.logs.findIndex(function (lg) { return lg.id === logId; });
      if (existsIdx === -1) return;
      var freshLog = st.logs[existsIdx];
      if (doRevert && !Domain.revertConsumedFromLog(freshLog)) {
        UI.showToast(freshLog.flavorId
          ? '无法安全退回该口味库存，请先核对该口味后续流水。记录已保留。'
          : '无法安全退回库存，记录已保留。取消勾选退回库存后可仅删除记录。');
        return;
      }
      st.logs = st.logs.filter(function (lg) { return lg.id !== logId; });
      Storage.saveToStorage(false, function (ok) {
        if (ok) UI.showToast(doRevert ? '已删除记录并退回对应库存余量' : '已删除该条每日记录');
      });
      UI.renderAll();
    }, options);
  }

  function showFeedDeductionToast(logId, opened) {
    UI.showToast(opened ? '已记录开封，库存已扣减' : '已记录，库存已扣减', '', '', {
      label: '撤销',
      onClick: function () {
        var st = MP.state;
        var log = st.logs.find(function (entry) { return entry.id === logId; });
        if (!log) {
          UI.showToast('喂食记录已不存在，无法撤销');
          return;
        }
        if (!Domain.revertConsumedFromLog(log)) {
          UI.showToast('库存已发生其他变化，无法安全撤销；喂食记录已保留');
          return;
        }
        st.logs = st.logs.filter(function (entry) { return entry.id !== logId; });
        Storage.saveToStorage(false, function (ok) {
          if (ok) UI.showToast('已撤销喂食记录并恢复库存');
        });
        UI.renderAll();
      }
    });
  }

  function redemptionMealAmount(item, quantity, fraction) {
    var unit = item.unit || '件';
    if (fraction >= 1 || quantity < 1) return quantity + unit;
    var remainder = Utils.formatRemainFractionText(fraction, unit).replace(/^余/, '剩余');
    var portion = Utils.computePortionGramLabel(remainder, fraction, Utils.itemPortionSpec(item));
    return quantity > 1 ? (quantity - 1) + unit + ' + ' + portion : portion;
  }

  App.bindEvents = function () {
    var st = MP.state;

    // 1. Unified 4 Bottom Navigation Tabs: 粮仓库存 / 每日记录 / 喂养分析 / 备份设置
    document.getElementById('navBtnPantry').addEventListener('click', function () { UI.switchTab('pantry'); });
    document.getElementById('navBtnDaily').addEventListener('click', function () { UI.switchTab('daily'); });
    document.getElementById('navBtnStats').addEventListener('click', function () {
      UI.switchTab('stats');
      Stats.syncScopeScroll(true);
    });
    document.getElementById('navBtnSettings').addEventListener('click', function () { UI.switchTab('settings'); });

    // 2. Stock entry
    document.getElementById('openAddModalBtn').addEventListener('click', UI.openAddModal);
    document.getElementById('emptyAddBtn').addEventListener('click', UI.openAddModal);
    document.getElementById('closeItemModalBtn').addEventListener('click', UI.closeItemModal);
    document.getElementById('cancelModalBtn').addEventListener('click', UI.closeItemModal);
    document.getElementById('itemModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('itemModalBackdrop')) UI.closeItemModal();
    });

    document.getElementById('clearSamplesBtn').addEventListener('click', function () {
      var sampleIds = Domain.getSampleItemIds(st.items);
      st.items = st.items.filter(function (it) { return !sampleIds.has(it.id); });
      st.logs = st.logs.filter(function (lg) { return !lg.isSample && !sampleIds.has(lg.itemId); });
      st.stockHistory = st.stockHistory.filter(function (h) { return !h.isSample && !sampleIds.has(h.itemId); });
      Storage.saveToStorage();
      UI.renderAll();
      UI.showToast('示例体验数据已清空');
    });

    // 3. Pantry status cards, category pills, search and sort
    var statusCards = document.querySelectorAll('[data-status-filter]');
    for (var i = 0; i < statusCards.length; i++) {
      statusCards[i].addEventListener('click', function () {
        var status = this.dataset.statusFilter;
        st.statusFilter = st.statusFilter === status ? 'all' : status;
        if (st.statusFilter === 'empty') st.archiveSortBy = 'finished_desc';
        st.pantryHealthFilter = '';
        st.pantryPage = 1;
        if (!st.settings.pantryStatusHintSeen) {
          st.settings.pantryStatusHintSeen = true;
          Storage.saveToStorage(true);
        }
        UI.renderAll({ resetMissingCategory: true });
      });
    }

    function resetPantryFilters() {
      clearPantryFilters();
      UI.renderAll();
    }
    document.getElementById('clearPantryFiltersBtn').addEventListener('click', resetPantryFilters);

    document.getElementById('categoryBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-cat]');
      if (!btn) return;
      st.catFilter = btn.getAttribute('data-cat');
      st.pantryPage = 1;
      UI.renderAll();
    });

    document.getElementById('searchInput').addEventListener('input', function () {
      st.searchQuery = this.value || '';
      st.pantryPage = 1;
      UI.renderPantryList();
    });
    document.getElementById('brandFilterSelect').addEventListener('change', function () {
      st.brandFilter = this.value;
      st.pantryPage = 1;
      UI.renderPantryList();
    });
    document.getElementById('sortSelect').addEventListener('change', function () {
      if (st.statusFilter === 'empty') st.archiveSortBy = this.value;
      else if (st.catFilter === 'supplies') st.supplySortBy = this.value;
      else st.sortBy = this.value;
      st.pantryPage = 1;
      UI.renderPantryList();
    });
    document.getElementById('resetFiltersBtn').addEventListener('click', resetPantryFilters);

    document.getElementById('pantryDisplayToggle').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-display-mode]');
      if (!btn) return;
      st.pantryDisplayMode = btn.getAttribute('data-display-mode');
      st.settings.pantryDisplayMode = st.pantryDisplayMode;
      Storage.saveToStorage(true);
      UI.renderPantryList();
      UI.showToast(st.pantryDisplayMode === 'compact' ? '已切换为「极简清单」视图' : '已切换为「详细卡片」视图', '', 'bottom');
    });

    function bindListPageButtons(pagerId, listId, pageKey, render) {
      var buttons = document.getElementById(pagerId).querySelectorAll('button');
      buttons.forEach(function (button, index) {
        button.addEventListener('click', function () {
          st[pageKey] += index === 0 ? -1 : 1;
          render();
          var reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          document.getElementById(listId).scrollIntoView?.({
            block: 'start',
            behavior: reduceMotion ? 'instant' : 'smooth'
          });
        });
      });
    }
    bindListPageButtons('pantryPaginationBar', 'pantryList', 'pantryPage', UI.renderPantryList);
    document.getElementById('pageSizeSelect').addEventListener('change', function () {
      st.pantryPageSize = Number(this.value) || 5;
      st.settings.pantryPageSize = st.pantryPageSize;
      st.pantryPage = 1;
      Storage.saveToStorage(true);
      UI.renderPantryList();
    });

    // 4. Pantry Card Delegated Actions (Preview, History, Feed & Restock allowed in Read-Only; Destructive edits require Edit Mode)
    var shelfTipTimer;
    var currentShelfTip;
    var shelfPressTimer;
    var compactTipTimer;
    var currentCompactButton;
    var pantryList = document.getElementById('pantryList');
    function closeCompactTip() {
      clearTimeout(compactTipTimer);
      if (!currentCompactButton) return;
      currentCompactButton.setAttribute('aria-expanded', 'false');
      currentCompactButton.nextElementSibling.hidden = true;
      currentCompactButton = null;
    }
    function showShelfTip(progress) {
      if (currentShelfTip) currentShelfTip.classList.add('hidden-view');
      var tip = progress.closest('.detail-card-shelf, .detail-card-open-progress').querySelector('.detail-card-shelf-tip');
      tip.textContent = progress.getAttribute('aria-label');
      tip.classList.remove('hidden-view');
      currentShelfTip = tip;
      clearTimeout(shelfTipTimer);
      shelfTipTimer = setTimeout(function () { tip.classList.add('hidden-view'); }, 2000);
    }
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (event) {
      pantryList.addEventListener(event, function () { clearTimeout(shelfPressTimer); });
    });
    pantryList.addEventListener('pointerdown', function (ev) {
      var progress = ev.target.closest('[data-shelf-progress], [data-open-progress]');
      if (progress && ev.isPrimary && ev.button === 0) {
        clearTimeout(shelfPressTimer);
        shelfPressTimer = setTimeout(function () { if (progress.isConnected) showShelfTip(progress); }, 450);
      }
    });
    function handleShelfTip(ev) {
      var progress = ev.target.closest('[data-shelf-progress], [data-open-progress]');
      if (!progress) return false;
      ev.preventDefault();
      showShelfTip(progress);
      return true;
    }
    pantryList.addEventListener('contextmenu', handleShelfTip);
    function closeCardMenus(except) {
      pantryList.querySelectorAll('.card-overflow-menu:not(.hidden-view)').forEach(function (menu) {
        if (menu === except) return;
        menu.classList.add('hidden-view');
        menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
      });
    }
    function recordItemOpened(target, date, silent) {
      if (!target || target.isOpened || target.flavors) return false;
      var unit = target.unit || '件';
      var quantity = Number(target.quantity) || 0;
      target.isOpened = true;
      target.openedDate = date || Utils.getTodayStr();
      if (target.category !== 'supplies' && target.openDaysLimit === undefined) {
        target.openDaysLimit = (MP.CATEGORIES[target.category] || MP.CATEGORIES.dry).defaultOpenDays;
      }
      Domain.appendStockHistory({
        date: target.openedDate, action: 'open', itemId: target.id, category: target.category,
        openingDate: target.openedDate,
        brand: target.brand, name: target.name, unit: unit, deltaText: '拆封 1' + unit,
        beforeQty: quantity, afterQty: quantity,
        note: target.category === 'supplies' ? '记录日用品开始使用日期'
          : target.openDaysLimit > 0 ? '开启拆封保鲜倒计时（建议 ' + target.openDaysLimit + ' 天内吃完）' : '已记录开封日期'
      });
      if (!silent) UI.showToast(target.openedDate === Utils.getTodayStr() ? '已记录今天开封' : '已记录开封日期：' + Utils.formatCnDateText(target.openedDate), '', target.category === 'supplies' ? 'bottom' : '');
      return true;
    }
    function recordFlavorOpened(item, flavor, date, silent, toastText) {
      var openedDate = Utils.normalizeDateStr(date) || Utils.getTodayStr();
      if (!item || !flavor || !Domain.openFlavor(item, flavor, openedDate)) return false;
      Storage.saveToStorage();
      if (!document.getElementById('feedModalBackdrop').classList.contains('hidden-view') &&
          document.getElementById('feedItemId').value === item.id) {
        UI.updateFeedFlavor(item);
      }
      UI.renderAll();
      if (!silent) UI.showToast(toastText || (openedDate === Utils.getTodayStr() ? '已记录今天开封' : '已记录开封日期：' + Utils.formatCnDateText(openedDate)));
      return true;
    }
    pantryList.addEventListener('click', function (ev) {
      if (handleShelfTip(ev)) return;
      var compactButton = ev.target.closest('[data-compact-tip]');
      if (compactButton) {
        var openingTip = compactButton.getAttribute('aria-expanded') !== 'true';
        closeCompactTip();
        closeCardMenus();
        if (openingTip) {
          compactButton.setAttribute('aria-expanded', 'true');
          compactButton.nextElementSibling.hidden = false;
          currentCompactButton = compactButton;
          if (compactButton.dataset.compactTip === 'palatability') {
            compactTipTimer = setTimeout(closeCompactTip, 2000);
          }
        }
        return;
      }
      var btn = ev.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'card-menu') {
        var menu = btn.nextElementSibling;
        var opening = menu.classList.contains('hidden-view');
        closeCardMenus(opening ? menu : null);
        menu.classList.toggle('hidden-view', !opening);
        btn.setAttribute('aria-expanded', String(opening));
        return;
      }
      closeCardMenus();
      var id = btn.getAttribute('data-id');
      if (action === 'item-history' || action === 'archive-history') {
        UI.openStockHistoryModal(id, action === 'archive-history');
        return;
      }

      var target = st.items.find(function (x) { return x.id === id; });
      if (!target) return;

      if (target.flavors && action === 'toggle-open') {
        UI.openFlavorOpenModal(target);
        return;
      }
      if (target.flavors && ['consume-one', 'mark-empty'].indexOf(action) !== -1) {
        UI.openFeedModal(target.id, Utils.getTodayStr());
        UI.showToast('选择口味后点「核销1件」');
        return;
      }

      if (action === 'preview-img') {
        UI.openLightbox(target);
      } else if (action === 'log-feed') {
        UI.openFeedModal(target.id, Utils.getTodayStr(), false, true);
      } else if (action === 'restock-new' || action === 'restore-stock') {
        UI.openRestockModal(target);
      } else if (action === 'edit') {
        UI.openEditModal(id);
      } else if (action === 'toggle-open') {
        var openToday = Utils.getTodayStr();
        UI.openConfirm('确认记录开封？', '', '确认开封', function (checked, quantity, mealQuantity, selectedDate) {
          if (!st.items.includes(target) || target.isOpened) return;
          if (recordItemOpened(target, selectedDate)) {
            Storage.saveToStorage();
            UI.renderAll();
          }
        }, { confirmTone: 'accent', openDateItem: target, openDate: openToday });
      } else if (action === 'consume-one' || action === 'mark-empty') {
        var curQ = Number(target.quantity) || 0;
        if (curQ <= 0) return;
        if (target.category === 'supplies' && !target.isOpened) {
          UI.showToast('请先记录开封日期');
          return;
        }
        var unit = target.unit || '件';
        var fraction = target.isOpened && Number(target.openRemainFraction) > 0 ? Number(target.openRemainFraction) : 1;
        UI.openConfirm('确认库存核销？', target.category === 'supplies'
          ? '核销后将减少库存并更新日用品使用周期。'
          : '核销后将减少库存并更新归档。只有勾选且确认实际份量，才补记今日喂食。', '确认核销', function (alsoLogMeal, quantity, mealQuantity) {
          if (target.category === 'supplies') alsoLogMeal = false;
          if (!st.items.includes(target) || Number(target.quantity) !== curQ) {
            UI.showToast('库存已变化，请重新核销');
            return;
          }
          var today = Utils.getTodayStr();
          var usedCount = Domain.recordConsumedUnits(target, quantity, today);
          if (!usedCount) return;
          if (alsoLogMeal) {
            var confirmed = Math.min(usedCount, mealQuantity);
            var amount = redemptionMealAmount(target, confirmed, fraction);
            Domain.appendFeedingLog({
              date: today,
              mealSlot: target.category === 'med' ? 'care' : Utils.getCurrentMealSlot(),
              itemId: target.id, category: target.category, subtype: target.subtype,
              brand: target.brand, name: target.name, amount: amount,
              note: '库存核销 ' + usedCount + unit + '，仅补记确认喂食的份量',
              deductedUnit: confirmed, deductedFrac: fraction, consumeHistoryId: st.stockHistory[0].id
            });
          }
          Storage.saveToStorage(false, function (ok) {
            if (ok) UI.showToast(alsoLogMeal ? '已核销库存并补记喂食' : '已核销库存', '', target.category === 'supplies' ? 'bottom' : '');
          });
          UI.renderAll();
        }, {
          label: target.category !== 'supplies' && Domain.isSingleServingUnit(target) ? '同时记入今天的每日记录（核销一件时补记 ' + redemptionMealAmount(target, Math.min(1, curQ), fraction) + '）' : '',
          defaultChecked: false,
          redemption: { quantity: curQ, unit: unit, all: action === 'mark-empty' }
        });
      } else if (action === 'delete') {
        var linkedDeductions = st.logs.some(function (log) {
          return log.itemId === id && (log.portionChange || log.flavorChange || Number(log.deductedUnit) > 0 || Number(log.deductedFrac) > 0);
        });
        UI.openConfirm('删除这条批次记录？', '将移除「' + target.brand + ' ' + target.name + '」，删除后不可撤销。' +
          (linkedDeductions ? ' 关联的喂食记录会保留，但原扣减将无法自动退回。' : ''), '确认删除', function () {
          var oldQty = Number(target.quantity) || 0;
          // Detach any linked finished archive so historical eaten records aren't orphaned
          st.items.forEach(function (x) {
            if (x.sourceBatchId === id) x.sourceBatchId = '';
          });
          st.items = st.items.filter(function (x) { return x.id !== id; });
          Domain.appendStockHistory({
            action: 'delete',
            itemId: id,
            isSample: target.isSample,
            category: target.category,
            brand: target.brand,
            name: target.name,
            unit: target.unit || '件',
            deltaText: oldQty > 0 ? ('-' + oldQty + (target.unit || '件')) : '删除归档',
            beforeQty: oldQty,
            afterQty: 0,
            note: '手动删除批次记录'
          });
          Storage.saveToStorage();
          UI.renderAll();
          UI.showToast('批次记录已删除');
        });
      }
    });
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.card-overflow')) closeCardMenus();
      if (!ev.target.closest('.compact-tip-wrap')) closeCompactTip();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeCompactTip();
    });

    // 5. Daily Feeding Log Controls & Quick Feed
    document.getElementById('openQuickFeedBtn').addEventListener('click', function () {
      UI.openFeedModal('', st.selectedLogDate, false, false, true);
    });
    document.getElementById('dailyQuickFeedBox').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-quick-feed-item]');
      if (!btn) return;
      UI.openFeedModal(btn.getAttribute('data-quick-feed-item'), st.selectedLogDate, false, false, true);
    });
    document.getElementById('closeFeedModalBtn').addEventListener('click', UI.closeFeedModal);
    document.getElementById('cancelFeedModalBtn').addEventListener('click', UI.closeFeedModal);
    document.getElementById('feedModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('feedModalBackdrop')) UI.closeFeedModal();
    });

    ['dailyPrevWeek', 'dailyNextWeek'].forEach(function (id, index) {
      document.getElementById(id).addEventListener('click', function () {
        selectLogDate(UI.shiftDailyWeek(index ? 7 : -7));
        UI.renderDailyView();
      });
    });
    document.getElementById('goTodayBtn').addEventListener('click', function () {
      var today = Utils.getTodayStr();
      selectLogDate(today);
      UI.syncDailyWeek(today, true);
      UI.renderDailyView();
      document.querySelector('#dailyWeekDays [aria-current="date"]').focus();
    });
    document.getElementById('dailyWeekDays').addEventListener('click', function (ev) {
      var day = ev.target.closest('[data-daily-date]');
      if (!day) return;
      selectLogDate(day.dataset.dailyDate);
      UI.renderDailyView();
      document.querySelector('#dailyWeekDays [aria-current="date"]').focus();
    });

    document.getElementById('dailyFeedTimeline').addEventListener('click', function (ev) {
      var addBtn = ev.target.closest('[data-daily-add]');
      if (addBtn) { UI.openFeedModal('', st.selectedLogDate, false, false, true); return; }
      var action = ev.target.closest('[data-edit-log], [data-del-log]');
      if (action) {
        var menu = action.closest('details');
        menu.open = false;
        menu.querySelector('summary').focus();
      }
      var editBtn = ev.target.closest('[data-edit-log]');
      if (editBtn) {
        UI.openEditFeedModal(editBtn.getAttribute('data-edit-log'));
        return;
      }
      var delBtn = ev.target.closest('[data-del-log]');
      if (delBtn) handleDeleteFeedingLog(delBtn.getAttribute('data-del-log'));
    });

    window.addEventListener('resize', UI.syncDailyQuickFeedFade);
    document.getElementById('dailyWeekTitle').addEventListener('click', UI.openDailyHistory);
    document.getElementById('jumpToAllDatesBtn').addEventListener('click', UI.openDailyHistory);
    document.getElementById('dailyHistoryBack').addEventListener('click', UI.closeDailyHistory);
    document.getElementById('dailyHistoryMore').addEventListener('click', UI.loadMoreDailyHistory);
    document.getElementById('dailyHistoryFilters').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-daily-history-filter]');
      if (btn) UI.filterDailyHistory(btn.dataset.dailyHistoryFilter);
    });
    document.getElementById('dailyHistoryList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-daily-history-date]');
      if (!btn) return;
      selectLogDate(btn.dataset.dailyHistoryDate);
      UI.syncDailyWeek(st.selectedLogDate);
      UI.closeDailyHistory();
      document.querySelector('#dailyWeekDays [aria-current="date"]').focus();
    });
    document.addEventListener('click', function (ev) {
      document.querySelectorAll('.daily-record-menu[open]').forEach(function (menu) {
        if (!menu.contains(ev.target)) menu.open = false;
      });
    });

    // 6. Feed Form Interactions & Split-Can Stock Deduction
    function selectedFeedItem() {
      var id = document.getElementById('feedItemId').value;
      return st.items.find(function (item) { return item.id === id; });
    }

    var feedPalatabilityField = document.getElementById('feedFlavorPal');
    feedPalatabilityField.addEventListener('change', function () {
      feedPalatabilityField.dataset.manual = '1';
    });
    document.getElementById('feedFlavorSelect').addEventListener('change', function () {
      var item = selectedFeedItem();
      UI.updateFeedFlavor(item);
      UI.syncFeedSplitCanUI(item);
    });
    document.getElementById('feedReopenLink').addEventListener('click', function () {
      var item = selectedFeedItem();
      var stock = UI.getFeedFlavor(item) || item;
      UI.showToast(stock && Number(stock.openRemainFraction) > 0
        ? '请填写超过当前开封余量的份量，再记录新开封'
        : '请先在库存中填写当前开封余量，再记录新开封');
    });
    document.getElementById('discardFlavorBtn').addEventListener('click', function () {
      var item = selectedFeedItem();
      var flavor = UI.getFeedFlavor(item);
      if (!flavor) return;
      var amount = redemptionMealAmount(item, 1, flavor.openRemainFraction || 1);
      UI.openConfirm('确认库存核销？', '将扣减 1' + item.unit + '「' + flavor.name + '」，并记入库存流水。', '确认核销', function (alsoLogMeal) {
        if (!st.items.includes(item) || !item.flavors.includes(flavor)) return;
        var today = Utils.getTodayStr();
        var change = Domain.feedFlavor(item, flavor, 0, true, today, !alsoLogMeal);
        if (!change) return;
        if (alsoLogMeal) {
          Domain.appendFeedingLog({
            date: today, itemId: item.id, category: item.category, subtype: item.subtype,
            brand: item.brand, name: item.name, amount: amount,
            mealSlot: item.category === 'med' ? 'care' : Utils.getCurrentMealSlot(),
            note: '库存核销时补记', deductedUnit: change.units, deductedFrac: change.fraction,
            flavorId: flavor.id, flavorName: flavor.name,
            flavorPalatability: flavor.palatability, flavorChange: change,
            consumeHistoryId: change.units ? st.stockHistory[0].id : undefined
          });
        }
        UI.closeFeedModal();
        UI.renderAll();
        Storage.saveToStorage(false, function (ok) {
          if (ok) UI.showToast(alsoLogMeal ? '已核销该口味并补记喂食' : '已核销该口味');
        });
      }, { label: '同时记入今天的每日记录（' + amount + '）', defaultChecked: false });
    });
    var stockSelect = document.getElementById('feedStockSelect');
    stockSelect.addEventListener('change', function () { UI.applyFeedBatchChange(this.value); });
    var stockPicker = document.getElementById('feedStockPicker');
    var stockTrigger = document.getElementById('feedStockPickerTrigger');
    stockPicker.addEventListener('click', function (ev) {
      if (stockSelect.disabled) { ev.preventDefault(); return; }
      var option = ev.target.closest('[data-feed-stock-id]');
      if (!option) return;
      stockSelect.value = option.dataset.feedStockId;
      stockSelect.dispatchEvent(new Event('change'));
      stockPicker.open = false;
      (stockSelect.value && stockSelect.value !== '__unstocked__' ? stockTrigger :
        document.getElementById(stockSelect.value === '__unstocked__' ? 'feedNameInput' : 'feedBrandInput')).focus();
    });
    stockPicker.addEventListener('keydown', function (ev) {
      if (!stockPicker.open || ev.key !== 'Escape') return;
      ev.stopPropagation();
      stockPicker.open = false;
      stockTrigger.focus();
    });
    document.getElementById('feedReturnToStock').addEventListener('click', UI.returnToFeedStock);
    document.getElementById('feedCategorySelect').addEventListener('change', UI.syncMedReminderVisibility);
    document.getElementById('feedMealSlot').addEventListener('change', UI.syncMedReminderVisibility);
    var mealPicker = document.getElementById('feedMealPicker');
    mealPicker.addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-meal-slot]');
      if (!button) return;
      var field = document.getElementById('feedMealSlot');
      var nextSlot = button.dataset.mealSlot;
      var typeChanged = (field.value === 'care') !== (nextSlot === 'care');
      if (typeChanged && stockSelect.disabled) {
        UI.showToast('这条记录已关联库存，无法切换记录类型');
        return;
      }
      field.value = nextSlot;
      var category = document.getElementById('feedCategorySelect');
      if (typeChanged && !selectedFeedItem()) {
        category.value = nextSlot === 'care' ? 'med' : 'dry';
      }
      field.dispatchEvent(new Event('change'));
      mealPicker.open = false;
      mealPicker.querySelector('summary').focus();
    });
    mealPicker.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !mealPicker.open) return;
      ev.stopPropagation();
      mealPicker.open = false;
      mealPicker.querySelector('summary').focus();
    });
    document.getElementById('feedForm').addEventListener('click', function (ev) {
      if (!mealPicker.contains(ev.target)) mealPicker.open = false;
      if (!stockPicker.contains(ev.target)) stockPicker.open = false;
    });


    document.getElementById('feedCareTypeGroup').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-feed-care-type]');
      if (button) UI.changeFeedCareType(button.dataset.feedCareType);
    });
    document.getElementById('feedNursingProjects').addEventListener('change', function (ev) {
      UI.syncNursingOther();
      UI.syncNursingProjects(ev.target.matches('[data-nursing-project]'));
      UI.syncFeedReminderInterval();
    });
    document.getElementById('feedNursingOther').addEventListener('input', function () { UI.syncNursingProjects(); });
    document.getElementById('feedAddNursingNote').addEventListener('click', function () {
      document.getElementById('feedForm').dataset.nursingNoteOpen = 'true';
      UI.syncNursingNote();
      document.getElementById('feedNoteInput').focus();
    });

    var outcome = document.getElementById('feedMedicationOutcome');
    document.getElementById('feedMedicationOutcomeChoices').addEventListener('click', function (ev) {
      var choice = ev.target.closest('[data-outcome]');
      if (!choice) return;
      outcome.value = outcome.value === choice.dataset.outcome ? '' : choice.dataset.outcome;
      UI.syncMedicationOutcome();
    });
    outcome.addEventListener('change', UI.syncMedicationOutcome);
    var customReminderDate = document.getElementById('feedCustomReminderDate');
    function openCustomReminderDate() {
      customReminderDate.focus();
      try { customReminderDate.showPicker?.(); } catch { /* The date field remains available for direct entry. */ }
    }
    document.getElementById('feedNextReminderDays').addEventListener('change', function (ev) {
      UI.syncFeedReminderInterval();
      if (ev.isTrusted && this.value === 'custom' && !customReminderDate.disabled) openCustomReminderDate();
    });
    document.getElementById('feedNursingReminderChoices').addEventListener('click', function (ev) {
      var choice = ev.target.closest('[data-nursing-reminder]');
      if (!choice) return;
      document.getElementById('feedForm').dataset.nursingReminderManual = 'true';
      document.getElementById('feedNextReminderDays').value = choice.dataset.nursingReminder;
      UI.syncFeedReminderInterval();
      if (choice.dataset.nursingReminder === 'custom') openCustomReminderDate();
    });
    var customReminderDays = document.getElementById('feedCustomReminderDays');
    customReminderDays.addEventListener('change', UI.syncFeedReminderInterval);
    customReminderDate.addEventListener('change', function () {
      var days = Utils.diffDaysBetween(document.getElementById('feedDateInput').value, this.value);
      customReminderDays.value = days > 0 ? days : '';
      UI.syncFeedReminderInterval();
    });
    var feedAmount = document.getElementById('feedAmountInput');
    var deductionSwitch = document.getElementById('feedDeductStock');
    function refreshFeedPortion(amountChanged) {
      UI.syncFeedSplitCanUI(selectedFeedItem(), amountChanged === true);
    }

    deductionSwitch.addEventListener('change', function () {
      if (!this.checked && document.getElementById('feedAutoOpenBox').dataset.rollover === 'true') {
        document.getElementById('feedAutoOpen').checked = false;
      }
      refreshFeedPortion();
    });
    document.getElementById('feedAutoOpen').addEventListener('change', function () {
      if (!this.checked) {
        var target = selectedFeedItem();
        var portion = target && UI.parseFeedPortion(feedAmount.value, target, UI.getFeedFlavor(target));
        if (document.getElementById('feedAutoOpenBox').dataset.rollover === 'true' ||
            (!document.getElementById('feedForm').classList.contains('feed-care-mode') &&
             (!portion || !Number.isSafeInteger(portion.fraction)))) deductionSwitch.checked = false;
        else if (deductionSwitch.disabled && portion && Number.isSafeInteger(portion.fraction) &&
                 document.getElementById('feedDateInput').value === Utils.getTodayStr()) deductionSwitch.checked = true;
      }
      refreshFeedPortion();
    });
    feedAmount.addEventListener('input', function () {
      delete feedAmount.dataset.doseChoice;
      delete feedAmount.dataset.automaticPortion;
      refreshFeedPortion(feedAmount.value !== feedAmount.dataset.lastDeductionAmount);
    });
    document.getElementById('feedDateInput').addEventListener('change', function () {
      if (this.value !== Utils.getTodayStr()) deductionSwitch.checked = false;
      UI.syncAllDateDisplays();
      UI.syncFeedReminderInterval();
      UI.syncFeedAutoOpen(selectedFeedItem());
      refreshFeedPortion();
    });

    document.getElementById('feedPortionChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-portion]');
      if (!btn) return;
      delete feedAmount.dataset.automaticPortion;
      feedAmount.dataset.doseChoice = btn.id || btn.dataset.portion;
      var item = selectedFeedItem();
      var flavor = UI.getFeedFlavor(item);
      var portion = btn.dataset.portion;
      var previousAmount = feedAmount.value;
      feedAmount.value = btn.hasAttribute('data-package-portion') && item && document.getElementById('feedForm').classList.contains('feed-care-mode')
        ? UI.portionLabel(portion, btn.dataset.frac === '0.34' ? 1 / 3 : Number(btn.dataset.frac), item, flavor)
        : portion;
      refreshFeedPortion(feedAmount.value !== previousAmount);
    });

    document.getElementById('feedForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (document.getElementById('feedModalBackdrop').classList.contains('hidden-view')) return;
      var editLogId = document.getElementById('feedLogEditId').value;
      var fDate = document.getElementById('feedDateInput').value || Utils.getTodayStr();
      var fSlot = Utils.normalizeMealSlot(document.getElementById('feedMealSlot').value);
      var fItemId = document.getElementById('feedItemId').value;
      var fCat = document.getElementById('feedCategorySelect').value;
      var fBrand = document.getElementById('feedBrandInput').value.trim();
      var fName = document.getElementById('feedNameInput').value.trim();
      var fAmount = document.getElementById('feedAmountInput').value.trim();
      var fNote = document.getElementById('feedNoteInput').value.trim();
      var isNursing = fSlot === 'care' && document.getElementById('feedForm').dataset.careType === 'nursing';
      var isMedication = fSlot === 'care' && !isNursing;
      var medicationOutcome = isMedication ? document.getElementById('feedMedicationOutcome').value : undefined;
      var reminderValue = document.getElementById('feedNextReminderDays').value;
      var remDays = reminderValue === 'custom'
        ? Number(document.getElementById('feedCustomReminderDays').value)
        : parseInt(reminderValue, 10) || 0;
      if (reminderValue === 'custom' && (!Number.isInteger(remDays) || remDays < 1 || remDays > 3650)) {
        UI.showToast('请输入 1 到 3650 天的提醒间隔');
        return;
      }
      var sourceId = document.getElementById('feedForm').dataset.reminderSourceId;
      var reminderSource = sourceId && st.logs.find(function (log) {
        return log.id === sourceId && log.category === fCat &&
          (fItemId ? fItemId === log.itemId : fBrand === log.brand && fName === log.name);
      });
      var editingSupplementReminder = fCat === 'supp' && editLogId && st.logs.some(function (log) {
        return log.id === editLogId && log.category === fCat && log.nextDueDate;
      });
      var nextDue = (remDays > 0 && (fCat === 'med' || fSlot === 'care' || (fCat === 'supp' && reminderSource) || editingSupplementReminder))
        ? Utils.addShelfLife(fDate, remDays, 'days')
        : '';
      var deduct = deductionSwitch.checked;
      var autoOpenBox = document.getElementById('feedAutoOpenBox');
      var openingToggle = document.getElementById('feedAutoOpen');
      var canOpen = !autoOpenBox.classList.contains('hidden-view') && !openingToggle.disabled;
      var autoOpenRequested = canOpen && openingToggle.checked;
      var isRollover = autoOpenBox.dataset.rollover === 'true';
      var sealedOnly = canOpen && !isRollover && !openingToggle.checked;
      if (!Utils.normalizeDateStr(fDate)) {
        UI.showToast('请选择有效的喂食日期');
        return;
      }

      if (isNursing) {
        var other = document.getElementById('feedNursingOther').value.trim();
        var projects = Array.from(document.querySelectorAll('[data-nursing-project]:checked'), function (choice) {
          return choice.value === '其他' ? other : choice.value;
        }).filter(Boolean);
        var previous = editLogId && st.logs.find(function (log) { return log.id === editLogId; });
        if (!projects.length && !(previous && Domain.getCareType(previous) === 'nursing' && !previous.careProjects?.length)) {
          UI.showToast('请选择至少一个护理项目');
          return;
        }
        if (previous?.deductedUnit || previous?.deductedFrac || previous?.portionChange || previous?.flavorChange) return;
        var nursingLog = { date: fDate, mealSlot: 'care', careType: 'nursing', category: 'med',
          careProjects: projects, careOther: document.querySelector('[data-nursing-project][value="其他"]').checked ? other : '',
          itemId: '', brand: '', name: '', amount: '', note: fNote, reminderDays: remDays, nextDueDate: nextDue };
        if (previous) {
          Object.assign(previous, nursingLog, { medicationOutcome: undefined, subtype: undefined, flavorPalatability: undefined, unstocked: undefined,
            productSpec: undefined, productUnit: undefined, productUnitWeightGrams: undefined });
        } else {
          Domain.appendFeedingLog(nursingLog);
        }
        selectLogDate(fDate);
        Storage.saveToStorage(false, function (ok) { if (ok) UI.showToast('护理记录已保存'); });
        UI.closeFeedModal();
        UI.renderAll();
        return;
      }

      var isUnstocked = !isMedication && document.getElementById('feedForm').dataset.unstocked === 'true';
      if ((!isMedication && !isUnstocked && !fBrand) || !fName || !fAmount) {
        UI.showToast(isMedication ? '请填写药品名称和用量' : isUnstocked ? '请填写食物名称和投喂份量' : '请填写品牌、品名和投喂份量');
        return;
      }

      if (editLogId) {
        var preservesDeduction = false;
        for (var k = 0; k < st.logs.length; k++) {
          if (st.logs[k].id === editLogId) {
            var previousLog = st.logs[k];
            preservesDeduction = previousLog.amount !== fAmount && Boolean(previousLog.portionChange ||
              previousLog.flavorChange || previousLog.deductedUnit || previousLog.deductedFrac);
            st.logs[k].date = fDate;
            st.logs[k].mealSlot = fSlot;
            st.logs[k].careType = isMedication ? 'medication' : undefined;
            delete st.logs[k].careProjects;
            delete st.logs[k].careOther;
            if (!previousLog.flavorId && !previousLog.deductedUnit && !previousLog.deductedFrac && previousLog.itemId !== fItemId) {
              previousLog.itemId = fItemId;
              delete previousLog.productSpec;
              delete previousLog.productUnit;
              delete previousLog.productUnitWeightGrams;
              delete previousLog.productFeedUsageUnit;
              delete previousLog.productFeedUsagePerItem;
              var product = Domain.resolveLogProduct(previousLog, true);
              previousLog.productSpec = product.spec;
              previousLog.productUnit = product.unit;
              previousLog.productUnitWeightGrams = product.unit_net_weight_g;
            }
            if (st.logs[k].category !== fCat) delete st.logs[k].subtype;
            st.logs[k].category = fCat;
            if (isUnstocked && !fItemId) st.logs[k].unstocked = true;
            else delete st.logs[k].unstocked;
            st.logs[k].brand = fBrand;
            st.logs[k].name = fName;
            st.logs[k].amount = fAmount;
            st.logs[k].note = fNote;
            st.logs[k].flavorPalatability = isMedication ? undefined : feedPalatabilityField.value || undefined;
            st.logs[k].medicationOutcome = Domain.normalizeMedicationOutcome(medicationOutcome);
            st.logs[k].reminderDays = remDays;
            st.logs[k].nextDueDate = nextDue;
            break;
          }
        }
        selectLogDate(fDate);
        Storage.saveToStorage(false, function (ok) {
          if (ok) UI.showToast(preservesDeduction ? '份量已修改，原库存扣减仍保留' : '每日记录修改已保存');
        });
        UI.closeFeedModal();
        UI.renderAll();
        return;
      }

      var splitToastSuffix = '';
      var actualDeductedUnit = 0;
      var actualDeductedFrac = 0;
      var flavor = null;
      var flavorChange = null;
      var portionChange = null;
      var flavorPalatability = isMedication ? '' : feedPalatabilityField.value;
      var pendingFinishPlan = null;
      var beforeAutoOpen = null;
      var beforeFlavorOpen = null;
      var didAutoOpen = false;

      var form = document.getElementById('feedForm');
      var manualFlavor = !fItemId && form.dataset.manualProduct === 'true'
        ? document.getElementById('feedManualFlavor').value.trim() : '';
      var stItem;
      if (!fItemId && !isUnstocked && form.dataset.dailyEntry === 'true' && form.dataset.manualProduct === 'true') {
        var stockBrand = fBrand || '未命名品牌';
        var matches = st.items.filter(function (item) {
          return item.category === fCat && item.brand === stockBrand && item.name === fName;
        });
        stItem = matches.find(function (item) { return item.quantity > 0; }) || matches[0];
        if (!stItem) {
          stItem = Domain.sanitizeItem({
            id: 'item_' + Date.now() + '_' + Math.floor(Math.random() * 1000000),
            category: fCat, brand: stockBrand, name: fName, quantity: 0,
            manualFeedArchive: true, openDaysLimit: null
          });
          st.items.unshift(stItem);
        }
        fItemId = stItem.id;
      } else if (fItemId) {
        stItem = st.items.find(function (x) { return x.id === fItemId; });
        if (!stItem) {
          UI.showToast('库存批次已不存在，请重新选择');
          return;
        }
        if (stItem.flavors) {
          flavor = UI.getFeedFlavor(stItem);
          if (!flavor) {
            UI.showToast('请选择实际喂食的口味');
            return;
          }
        }
        var portion = UI.parseFeedPortion(fAmount, stItem, flavor);
        if (flavor && !portion.valid && !(deduct && portion.finish)) {
          UI.showToast('请输入有效份量，例如「1' + stItem.unit + '」或「半' + stItem.unit + '」。');
          return;
        }
        if (deduct) {
          var plan = isMedication && MP.isFoodCategory(stItem.category)
            ? { error: '所选批次是食品。' }
            : Domain.planFeedingPortion(stItem, flavor, portion, { sealedOnly: sealedOnly });
          if (plan.error) {
            if (isMedication) {
              UI.openConfirm('本次无法扣减库存', plan.error + ' 可以继续保存用药记录。', '仅记录用药', function () {
                deductionSwitch.checked = false;
                document.getElementById('feedForm').requestSubmit();
              });
            } else {
              UI.showToast(plan.error);
            }
            return;
          }
          if (plan.rollover && canOpen && !autoOpenRequested) {
            UI.showToast('请先打开开封开关，再扣减库存');
            return;
          }
          if (plan.rollover) {
            didAutoOpen = true;
          } else if (autoOpenRequested && !flavor && !stItem.isOpened) {
            beforeAutoOpen = { revision: stItem.portionRevision || '', opened: false, openedDate: '', fraction: 0 };
            didAutoOpen = recordItemOpened(stItem, fDate, true);
          } else if (autoOpenRequested && flavor) {
            beforeFlavorOpen = {
              revision: flavor.revision, openedDate: flavor.openedDate, fraction: flavor.openRemainFraction,
              sharedOpenedDate: stItem.isOpened ? stItem.openedDate : ''
            };
            didAutoOpen = Domain.openFlavor(stItem, flavor, fDate);
            if (!didAutoOpen) {
              UI.showToast('无法记录开封，请先检查库存状态');
              return;
            }
          }
          if (flavor) {
            flavorChange = Domain.feedFlavor(stItem, flavor, portion.fraction, portion.finish, fDate, false, sealedOnly, plan);
            if (!flavorChange) return;
            if (beforeFlavorOpen) flavorChange.before = beforeFlavorOpen;
          } else if (!plan.after && !plan.rollover) {
            pendingFinishPlan = { item: stItem, plan: plan, amount: fAmount, date: fDate };
          } else {
            portionChange = Domain.feedBatchPortion(stItem, plan, fDate, fAmount);
            if (portionChange && beforeAutoOpen) portionChange.before = beforeAutoOpen;
          }
          var change = flavorChange || portionChange;
          if (change) {
            actualDeductedUnit = change.units;
            actualDeductedFrac = change.fraction;
            splitToastSuffix = plan.after ? '（已更新开封余量）' : '（已核销 1' + stItem.unit + '）';
          }
        } else if (autoOpenRequested) {
          if (isRollover) {
            UI.showToast('请先开启库存扣减，用完旧余量后才能开新件');
            return;
          }
          didAutoOpen = flavor ? Domain.openFlavor(stItem, flavor, fDate) : recordItemOpened(stItem, fDate, true);
          if (!didAutoOpen) {
            UI.showToast('无法记录开封，请先检查库存状态');
            return;
          }
        }
      }

      var savedFeedLog = Domain.appendFeedingLog({
        date: fDate,
        mealSlot: fSlot,
        itemId: fItemId,
        unstocked: isUnstocked,
        category: fCat,
        subtype: reminderSource?.subtype || (stItem && stItem.category === fCat ? stItem.subtype : undefined),
        brand: fBrand,
        name: fName,
        amount: fAmount,
        note: fNote,
        reminderDays: remDays,
        nextDueDate: nextDue,
        deductedUnit: actualDeductedUnit,
        deductedFrac: actualDeductedFrac,
        flavorId: flavor && flavor.id,
        flavorName: flavor ? flavor.name : manualFlavor,
        flavorPalatability: flavorPalatability,
        medicationOutcome: medicationOutcome,
        careType: isMedication ? 'medication' : undefined,
        flavorChange: flavorChange,
        portionChange: portionChange,
        consumeHistoryId: actualDeductedUnit > 0 ? st.stockHistory[0].id : undefined
      });

      selectLogDate(fDate);
      Storage.saveToStorage(false, function (ok) {
        if (!ok) return;
        if (pendingFinishPlan && savedFeedLog.portionChange) return;
        if (actualDeductedUnit > 0 || actualDeductedFrac > 0) showFeedDeductionToast(savedFeedLog.id, didAutoOpen);
        else UI.showToast(nextDue ? ('已记录用药，将于 ' + nextDue + ' 提醒下次护理') : ('已记入 ' + fDate + ' 每日记录' + splitToastSuffix));
      });
      UI.closeFeedModal();
      UI.renderAll();
      if (pendingFinishPlan) {
        var finishItem = pendingFinishPlan.item;
        var finishUnit = finishItem.unit || (finishItem.category === 'med' ? '支' : '袋');
        var finishTitle = pendingFinishPlan.plan.sealedUnits > 1
          ? '这 ' + pendingFinishPlan.plan.sealedUnits + finishUnit + '已用完，是否核销？'
          : '这' + finishUnit + '已用完，是否核销？';
        UI.openConfirm(finishTitle, '核销后将减少库存并更新归档。', '确认核销', function () {
          if (!st.items.includes(finishItem) || Number(finishItem.quantity) <= 0) return;
          var finishChange = Domain.feedBatchPortion(finishItem, pendingFinishPlan.plan, pendingFinishPlan.date, pendingFinishPlan.amount);
          if (!finishChange) return;
          if (beforeAutoOpen) finishChange.before = beforeAutoOpen;
          savedFeedLog.deductedUnit = finishChange.units;
          savedFeedLog.deductedFrac = finishChange.fraction;
          savedFeedLog.portionChange = finishChange;
          savedFeedLog.consumeHistoryId = finishChange.units > 0 ? st.stockHistory[0].id : undefined;
          Storage.saveToStorage(false, function (ok) { if (ok) showFeedDeductionToast(savedFeedLog.id, didAutoOpen); });
          UI.renderAll();
        }, { alternativeLabel: '暂不' });
      }
    });

    // 7. Stats View Interactions & Drill-Down Filtering to Pantry
    document.getElementById('statsSubTabSwitch').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-stats-subtab]');
      if (!btn) return;
      st.statsSubTab = btn.getAttribute('data-stats-subtab');
      Stats.renderStatsView();
    });

    document.getElementById('statsScopeBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-stats-scope]');
      if (!btn) return;
      st.statsScopeFilter = btn.getAttribute('data-stats-scope');
      Stats.renderStatsView();
      Stats.syncScopeScroll(true);
    });
    document.getElementById('statsScopeBar').addEventListener('scroll', function () { Stats.syncScopeScroll(false); });
    global.addEventListener('resize', function () { Stats.syncScopeScroll(false); });
    document.getElementById('expiryMonthTimelineList').addEventListener('click', function (ev) {
      if (ev.target.closest('[data-toggle-timeline]')) Stats.toggleTimeline();
    });

    document.addEventListener('click', function (ev) {
      var action = ev.target.closest('[data-forecast-action]');
      if (!action) return;
      var type = action.getAttribute('data-forecast-action');
      var category = action.getAttribute('data-forecast-category');
      if (type === 'estimate') {
        UI.showToast(action.title);
      } else if (type === 'settings') {
        UI.switchTab('settings');
        var input = document.querySelector('[data-daily-feed="' + category + '"]');
        input.scrollIntoView?.({ block: 'center' });
        input.focus();
      } else if (type === 'weight') {
        var item = st.items.find(function (row) { return row.id === action.dataset.batchId; });
        if (!item) return;
        UI.switchTab('pantry');
        UI.openEditModal(item.id, 'fieldNetWeight');
      } else if (type === 'remainder') {
        var target = st.items.find(function (row) { return row.id === action.dataset.batchId; });
        if (!target) { UI.showToast('未找到对应的库存批次'); return; }
        clearPantryFilters();
        st.catFilter = 'can';
        st.searchQuery = target.name;
        UI.renderAll();
        UI.switchTab('pantry');
        var list = document.getElementById('pantryList');
        var targetButton;
        for (var pageIndex = 0; pageIndex <= st.items.length; pageIndex++) {
          targetButton = Array.from(list.querySelectorAll('[data-action="item-history"]')).find(function (button) {
            return button.dataset.id === target.id;
          });
          if (targetButton || document.getElementById('nextPageBtn').disabled) break;
          st.pantryPage += 1;
          UI.renderPantryList();
        }
        if (targetButton) targetButton.closest('article, .compact-stock-card')?.scrollIntoView?.({ block: 'center' });
        else UI.showToast('未找到对应的库存批次');
      } else if (type === 'restock') {
        clearPantryFilters();
        st.catFilter = category;
        UI.switchTab('pantry');
        UI.renderAll();
      }
    });

    function saveDailyFeedInput(input) {
      if (!input) return;
      var category = input.dataset.dailyFeed;
      var grams = Number(input.value);
      if (!/^[0-9]+$/.test(input.value) || !Number.isSafeInteger(grams)) {
        input.value = st.settings.dailyFeedGrams[category] ?? 0;
        return;
      }
      input.value = grams;
      if (grams === st.settings.dailyFeedGrams[category]) return;
      st.settings.dailyFeedGrams[category] = grams;
      Storage.saveToStorage();
      UI.renderAll();
    }

    document.getElementById('dailyFeedSettings').addEventListener('change', function (ev) {
      saveDailyFeedInput(ev.target.closest('[data-daily-feed]'));
    });

    document.getElementById('categoryStatsGrid').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-cat]');
      if (!btn) return;
      var catKey = btn.getAttribute('data-jump-cat');
      clearPantryFilters();
      st.catFilter = catKey;
      if (btn.dataset.packageStatus === 'expiring') {
        st.statusFilter = 'expiring';
        st.pantryHealthFilter = 'expiring_packages';
      } else if (btn.dataset.packageStatus === 'opened') {
        st.pantryHealthFilter = 'opened';
      }
      UI.renderAll();
      UI.switchTab('pantry');
      UI.showToast('已筛选分类：' + (MP.CATEGORIES[catKey] ? MP.CATEGORIES[catKey].label : catKey));
    });

    document.getElementById('feedingTaskList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-expiry-item]');
      if (!btn) return;
      var item = st.items.find(function (entry) { return entry.id === btn.dataset.jumpExpiryItem; });
      if (!item) return;
      clearPantryFilters();
      st.catFilter = item.category;
      st.searchQuery = item.name;
      st.statusFilter = Domain.evaluateItem(item).status;
      UI.renderAll();
      UI.switchTab('pantry');
    });

    document.getElementById('palTierTabBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-tier-tab]');
      if (!btn) return;
      st.statsTierTab = btn.getAttribute('data-tier-tab');
      st.tierPage = 1;
      Stats.renderStatsView();
    });
    document.getElementById('clearPalFilterBtn').addEventListener('click', function () {
      st.statsTierTab = 'all';
      st.tierPage = 1;
      Stats.renderStatsView();
      document.querySelector('#palTierTabBar [data-tier-tab]').focus();
    });
    document.getElementById('prevTierPageBtn').addEventListener('click', function () {
      if (st.tierPage > 1) { st.tierPage -= 1; Stats.renderStatsView(); }
    });
    document.getElementById('nextTierPageBtn').addEventListener('click', function () {
      st.tierPage += 1; Stats.renderStatsView();
    });

    document.getElementById('brandScopeBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-brand-scope]');
      if (!btn) return;
      st.brandScopeFilter = btn.getAttribute('data-brand-scope');
      st.brandPage = 1;
      Stats.renderStatsView();
    });
    bindListPageButtons('brandPaginationBar', 'brandStatsList', 'brandPage', Stats.renderStatsView);
    document.getElementById('brandPageSizeSelect').addEventListener('change', function () {
      st.brandPageSize = Number(this.value) || 5;
      st.brandPage = 1;
      Stats.renderStatsView();
    });

    document.getElementById('palTierCardsList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-tier-restock]');
      if (!btn) return;
      var target = st.items.find(function (x) { return x.id === btn.getAttribute('data-tier-restock'); });
      if (target) UI.openRestockModal(target);
    });

    document.getElementById('priorityFeedList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-priority-feed]');
      if (!btn) return;
      UI.openFeedModal(btn.getAttribute('data-priority-feed'), Utils.getTodayStr());
      if (btn.dataset.priorityFlavor) {
        var select = document.getElementById('feedFlavorSelect');
        select.value = btn.dataset.priorityFlavor;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });


    document.getElementById('dailyMedReminders').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-record-reminder]');
      var log = button && st.logs.find(function (entry) { return entry.id === button.dataset.recordReminder; });
      if (log) UI.openFeedFromReminder(log);
    });
    document.getElementById('pantryOverdueMedReminder').addEventListener('click', function () {
      UI.switchTab('daily');
      UI.closeDailyHistory();
    });

    // 8. Stock Operation History Modal Controls
    var historyButton = document.getElementById('openStockHistoryBtn');
    var historyPressTimer;
    var historyLongPressed = false;
    historyButton.addEventListener('pointerdown', function (ev) {
      historyLongPressed = false;
      if (ev.pointerType === 'mouse') return;
      historyPressTimer = window.setTimeout(function () {
        historyLongPressed = true;
        showPantryHistoryHint();
      }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
      historyButton.addEventListener(name, function () { window.clearTimeout(historyPressTimer); });
    });
    historyButton.addEventListener('contextmenu', function (ev) {
      if (ev.pointerType === 'touch' || historyLongPressed) ev.preventDefault();
    });
    historyButton.addEventListener('click', function (ev) {
      if (historyLongPressed && ev.detail > 0) {
        historyLongPressed = false;
        return;
      }
      UI.openStockHistoryModal('');
    });
    document.getElementById('settingsOpenHistoryBtn').addEventListener('click', function () {
      UI.openStockHistoryModal('');
    });
    document.getElementById('closeHistoryModalBtn').addEventListener('click', UI.closeStockHistoryModal);
    document.getElementById('historyModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('historyModalBackdrop')) UI.closeStockHistoryModal();
    });
    document.getElementById('clearHistoryItemFilterBtn').addEventListener('click', function () {
      st.historyItemFilter = '';
      st.historyProductFilter = '';
      st.historyPage = 1;
      UI.renderStockHistoryModal();
    });
    document.getElementById('historyTypeFilterBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-hist-type]');
      if (!btn) return;
      st.historyTypeFilter = btn.getAttribute('data-hist-type');
      st.historyPage = 1;
      UI.renderStockHistoryModal();
    });
    document.getElementById('historySearchInput').addEventListener('input', function () {
      st.historySearchQuery = this.value || '';
      st.historyPage = 1;
      UI.renderStockHistoryModal();
    });
    document.getElementById('prevHistoryPageBtn').addEventListener('click', function () {
      if (st.historyPage > 1) { st.historyPage -= 1; UI.renderStockHistoryModal(); }
    });
    document.getElementById('nextHistoryPageBtn').addEventListener('click', function () {
      st.historyPage += 1; UI.renderStockHistoryModal();
    });
    document.getElementById('exportStockHistoryCsvBtn').addEventListener('click', function () {
      Storage.exportStockHistoryCsv();
      UI.showToast('已导出库存变动流水 CSV');
    });

    // 9. Item Add / Edit Form Controls & Validation
    document.getElementById('modalCatSelector').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-form-cat]');
      if (!btn) return;
      var newCat = btn.getAttribute('data-form-cat');
      var isEditing = Boolean(document.getElementById('fieldId').value);
      UI.syncModalCategoryUI(newCat, !isEditing);
      UI.scrollModalCategoryIntoView();
      UI.syncNetWeight();
      UI.renderQuickBrandChips();
      UI.suggestProductionDate();
      if (!isEditing) UI.autoComputeExpDate();
      UI.syncModalUnitPriceHint();
      if (isEditing && !document.getElementById('fieldIsOpened').checked) {
        var cInfo = MP.CATEGORIES[newCat] || MP.CATEGORIES.dry;
        document.getElementById('fieldOpenLimit').value = String(cInfo.defaultOpenDays);
      }
    });

    document.getElementById('quickBrandChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-pick-brand]');
      if (btn) {
        document.getElementById('fieldBrand').value = btn.getAttribute('data-pick-brand');
        UI.syncNetWeight();
        UI.suggestProductionDate();
        UI.syncModalUnitPriceHint();
      }
    });
    ['quickLocationChips', 'locationSuggestion'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-pick-location]');
        if (!btn) return;
        var location = document.getElementById('fieldLocation');
        location.value = btn.dataset.pickLocation;
        location.focus();
        UI.syncLocationSuggestion();
      });
    });
    document.getElementById('fieldLocation').addEventListener('input', UI.syncLocationSuggestion);
    document.getElementById('quickLocationChips').addEventListener('scroll', UI.syncQuickLocationFade);
    document.getElementById('pickPhotoBtn').addEventListener('click', function () {
      document.getElementById('fieldPhotoInput').click();
    });
    document.getElementById('priceCurrencyUnit').addEventListener('change', function () {
      UI.syncModalCurrencyUI(this.value);
    });
    document.getElementById('palatabilityGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-pal]');
      if (btn) UI.syncModalPalatabilityUI(btn.getAttribute('data-pal'));
    });

    var itemViewport = global.visualViewport;
    if (itemViewport) {
      var itemBackdrop = document.getElementById('itemModalBackdrop');
      function syncItemKeyboardSpace() {
        var keyboard = itemViewport.scale === 1 &&
          itemViewport.height < document.documentElement.clientHeight - 100;
        var offset = keyboard ? Math.max(0, document.documentElement.clientHeight - itemViewport.height - itemViewport.offsetTop) : 0;
        itemBackdrop.style.setProperty('--stock-form-keyboard-offset', offset + 'px');
        if (keyboard) itemBackdrop.style.setProperty('--stock-form-viewport-height', itemViewport.height + 'px');
        else itemBackdrop.style.removeProperty('--stock-form-viewport-height');
        var field = document.activeElement;
        if (keyboard && field?.closest('#itemForm .stock-form-body') && !itemBackdrop.classList.contains('hidden-view')) {
          field.scrollIntoView?.({ block: 'nearest' });
        }
      }
      itemViewport.addEventListener('resize', syncItemKeyboardSpace);
      itemViewport.addEventListener('scroll', syncItemKeyboardSpace);
    }

    document.getElementById('fieldMixedFlavors').addEventListener('change', UI.syncPurchasePackaging);
    document.getElementById('stockPackSealMode').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-pack-seal]');
      if (!button || button.disabled) return;
      document.getElementById('fieldPackSeal').value = button.dataset.packSeal;
      UI.syncPurchasePackaging();
      UI.syncModalUnitPriceHint();
    });
    document.getElementById('flavorRows').addEventListener('input', UI.syncFlavorForm);
    document.getElementById('flavorRows').addEventListener('focusout', function (ev) {
      if (ev.target.matches('[data-flavor-name]') && ev.target.value.trim()) {
        UI.setFlavorNameEditing(ev.target.closest('.flavor-row'), false);
      }
    });
    document.getElementById('flavorRows').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing && ev.target.matches('[data-flavor-name], [data-flavor-count]')) {
        ev.preventDefault();
        ev.target.blur();
      }
    });
    document.getElementById('flavorRows').addEventListener('click', function (ev) {
      var button = ev.target.closest('button');
      if (!button || button.disabled) return;
      var row = button.closest('.flavor-row');
      if (button.hasAttribute('data-remove-flavor')) {
        row.remove();
        UI.syncFlavorForm();
      } else if (button.hasAttribute('data-flavor-name-display')) {
        UI.setFlavorNameEditing(row, true);
        row.querySelector('[data-flavor-name]').focus();
      } else if (button.dataset.flavorStep) {
        UI.changeFlavorCount(row, Number(button.dataset.flavorStep));
      } else if (button.hasAttribute('data-flavor-open')) {
        var panel = row.querySelector('[data-flavor-open-panel]');
        button.setAttribute('aria-expanded', String(!panel.classList.toggle('hidden-view')));
      }
    });
    document.getElementById('flavorQuickActions').addEventListener('click', function (ev) {
      var button = ev.target.closest('button');
      if (!button) return;
      if (button.dataset.flavorDistribute) {
        UI.distributeFlavors();
      } else if (button.dataset.suggestFlavor) {
        if (button.classList.contains('hidden-view')) return;
        UI.addFlavorRow({ name: button.dataset.suggestFlavor });
        UI.syncFlavorForm();
      } else if (button.id === 'addFlavorBtn') {
        UI.addFlavorRow().querySelector('[data-flavor-name]').focus();
        UI.syncFlavorForm();
      }
    });
    document.getElementById('fieldSubtype').addEventListener('change', UI.updateItemSubtype);
    document.getElementById('fieldSubtypeCustom').addEventListener('input', UI.updateItemSubtype);
    document.getElementById('stockEffectTags').addEventListener('click', function (ev) {
      var button = ev.target.closest('button');
      if (!button) return;
      if (button.dataset.effectTag) UI.toggleFormEffectTag(button.dataset.effectTag);
      if (button.dataset.effectCustom) {
        document.getElementById('stockEffectCustom').classList.remove('hidden-view');
        document.getElementById('fieldEffectCustom').focus();
      }
    });
    document.getElementById('addEffectCustomBtn').addEventListener('click', UI.addFormEffectTag);
    document.getElementById('fieldEffectCustom').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); UI.addFormEffectTag(); }
    });
    document.getElementById('fieldUnit').addEventListener('change', UI.markItemUnitManual);
    document.getElementById('fieldUnit').addEventListener('change', UI.syncItemUsageConfig);
    document.getElementById('fieldUsagePerItem').addEventListener('input', UI.syncItemUsageConfig);
    document.getElementById('fieldUsageUnit').addEventListener('change', function () {
      if (this.dataset.syncedUnit && this.dataset.syncedUnit !== this.value && document.getElementById('fieldUsagePerItem').value) {
        document.getElementById('fieldUsagePerItem').value = '';
        UI.showToast('投喂单位已更改，请重新填写换算数量');
      }
      UI.syncItemUsageConfig();
    });
    ['fieldPackagingEnabled', 'fieldPackOuterUnit', 'fieldUnit'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', UI.syncModalUnitPriceHint);
    });
    ['fieldPackCount', 'fieldPackSize'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', UI.syncModalUnitPriceHint);
    });
    document.getElementById('fieldPrice').addEventListener('input', UI.syncModalUnitPriceHint);
    document.getElementById('fieldSpec').addEventListener('input', function () {
      if (document.getElementById('fieldId').value) UI.syncNetWeight();
      UI.syncModalUnitPriceHint();
    });
    document.getElementById('stockWeightPresetOptions').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-preset-grams], [data-spec-unit]');
      if (!button) return;
      if (button.dataset.specUnit) {
        document.getElementById('fieldNetWeightUnit').value = button.dataset.specUnit;
        document.getElementById('fieldNetWeightUnit').dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      var weight = document.getElementById('fieldNetWeight');
      weight.value = button.dataset.presetGrams;
      weight.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('fieldNetWeight').addEventListener('input', function (ev) {
      ev.target.dataset.manualWeight = '1';
      UI.syncModalUnitPriceHint();
    });
    document.getElementById('fieldNetWeightUnit').addEventListener('change', function () {
      delete this.dataset.legacyUnit;
      this.dataset.manualSpecUnit = '1';
      UI.syncNetWeight();
      UI.syncModalUnitPriceHint();
    });
    document.getElementById('stockDateMode').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-stock-date]');
      if (button) UI.selectStockDateMode(button.dataset.stockDate);
    });
    document.getElementById('fieldProdDate').addEventListener('click', UI.confirmProductionDate);
    function acceptSupplyDateOrder(changedField) {
      if (st.formCat !== 'supplies') return true;
      var production = document.getElementById('fieldProdDate').value;
      var expiry = document.getElementById('fieldExpDate').value;
      if (production && expiry && expiry < production) {
        changedField.value = changedField.dataset.lastValid || '';
        UI.syncAllDateDisplays();
        UI.showToast('过期日期不能早于生产日期');
        return false;
      }
      changedField.dataset.lastValid = changedField.value;
      return true;
    }
    document.getElementById('fieldProdDate').addEventListener('change', function () {
      delete this.dataset.computed;
      document.getElementById('dateCalcHint').textContent = '';
      if (!acceptSupplyDateOrder(this)) return;
      UI.confirmProductionDate();
      UI.selectStockDateMode('production');
      UI.autoComputeExpDate();
      UI.syncOpenedFieldsVisibility();
    });
    document.getElementById('fieldExpDate').addEventListener('change', function () {
      delete this.dataset.computed;
      document.getElementById('dateCalcHint').textContent = '';
      if (!acceptSupplyDateOrder(this)) return;
      if (!document.getElementById('fieldId').value) {
        UI.selectStockDateMode('expiry');
        UI.autoComputeExpDate();
      }
      UI.syncAllDateDisplays();
    });
    ['input', 'change'].forEach(function (name) {
      document.getElementById('fieldOpenedDate').addEventListener(name, UI.syncOpenedFieldsVisibility);
    });
    document.getElementById('fieldOpenLimit').addEventListener('input', function () {
      this.dataset.custom = '1';
      UI.syncOpenedFieldsVisibility();
    });
    document.getElementById('fieldFinishedDate').addEventListener('change', UI.syncAllDateDisplays);
    document.getElementById('fieldQty').addEventListener('input', UI.syncModalUnitPriceHint);
    document.getElementById('feedDateInput').addEventListener('change', UI.syncAllDateDisplays);
    function updateStockShelfLife() {
      document.getElementById('fieldShelfValue').dataset.custom = '1';
      UI.autoComputeExpDate();
      UI.renderStockDateEstimate();
    }
    document.getElementById('fieldShelfValue').addEventListener('input', updateStockShelfLife);
    document.getElementById('fieldShelfUnit').addEventListener('change', updateStockShelfLife);
    document.getElementById('fieldIsOpened').addEventListener('change', function () {
      var opened = document.getElementById('fieldOpenedDate');
      if (this.checked && !opened.value) opened.value = Utils.getTodayStr();
      UI.syncOpenedFieldsVisibility();
    });

    document.getElementById('shelfPresetsBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-preset-months]');
      if (!btn) return;
      document.getElementById('fieldShelfValue').value = btn.getAttribute('data-preset-months');
      document.getElementById('fieldShelfUnit').value = 'months';
      if (!document.getElementById('fieldId').value || document.getElementById('fieldProdDate').value) {
        updateStockShelfLife();
      } else if (document.getElementById('fieldExpDate').value) {
        var backProd = Utils.subtractShelfLife(
          document.getElementById('fieldExpDate').value,
          btn.getAttribute('data-preset-months'),
          'months'
        );
        if (backProd) {
          document.getElementById('fieldProdDate').value = backProd;
          UI.confirmProductionDate();
          document.getElementById('dateCalcHint').textContent = '已反推生产日期';
          UI.renderStockDateEstimate();
          UI.syncOpenedFieldsVisibility();
        }
      }
    });

    document.getElementById('calcProdFromExpBtn').addEventListener('click', function () {
      var exp = document.getElementById('fieldExpDate').value;
      var val = document.getElementById('fieldShelfValue').value;
      var unit = document.getElementById('fieldShelfUnit').value;
      if (!exp || !val) {
        UI.showToast('请先填写「过期日期」和「保质期」');
        return;
      }
      var prod = Utils.subtractShelfLife(exp, val, unit);
      if (prod) {
        document.getElementById('fieldProdDate').value = prod;
        UI.confirmProductionDate();
        document.getElementById('dateCalcHint').textContent = '已根据过期日期反推出生产日期';
        UI.syncOpenedFieldsVisibility();
        UI.showToast('已自动反推生产日期：' + prod);
      }
    });

    document.getElementById('cloneBatchFromEditBtn').addEventListener('click', function () {
      var curId = document.getElementById('fieldId').value;
      var item = st.items.find(function (x) { return x.id === curId; });
      if (item) UI.openRestockModal(item);
    });

    document.getElementById('itemForm').addEventListener('change', function (ev) {
      if (!['fieldBrand', 'fieldName', 'fieldSpec', 'fieldUnit', 'fieldSubtype'].includes(ev.target.id)) return;
      UI.syncNetWeight();
      UI.suggestProductionDate();
      UI.syncModalUnitPriceHint();
    });

    document.getElementById('itemModalBackdrop').addEventListener('click', function (ev) {
      document.querySelectorAll('#stockFlavorRatings details[open]').forEach(function (picker) {
        if (!picker.contains(ev.target)) picker.open = false;
      });
    });
    var itemForm = document.getElementById('itemForm');
    itemForm.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('is-invalid')) {
        ev.target.classList.remove('is-invalid');
        ev.target.removeAttribute('aria-invalid');
      }
      UI.syncStockRequiredProgress();
      if (ev.target.id === 'fieldBrand') UI.renderQuickBrandChips();
    });
    itemForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveItemForm();
    });

    function saveItemForm(confirmedLocation, unitConfirmed, unitSnapshotReady) {
      if (document.getElementById('fieldEffectCustom').value.trim()) {
        UI.addFormEffectTag();
      }
      var id = document.getElementById('fieldId').value;
      var isRestockMode = document.getElementById('fieldIsRestockMode').value === '1';
      var brand = document.getElementById('fieldBrand').value.trim();
      var name = document.getElementById('fieldName').value.trim();
      var prodDate = Utils.normalizeDateStr(document.getElementById('fieldProdDate').value);
      var expDate = Utils.normalizeDateStr(document.getElementById('fieldExpDate').value);
      function showFieldError(fieldId, message) {
        var field = typeof fieldId === 'string' ? document.getElementById(fieldId) : fieldId;
        itemForm.classList.add('validation-attempted');
        var more = field.closest('details');
        if (more) more.open = true;
        field.classList.add('is-invalid');
        field.setAttribute('aria-invalid', 'true');
        field.focus({ preventScroll: true });
        field.scrollIntoView?.({ block: 'center' });
        UI.showToast(message);
      }

      var netWeightInput = document.getElementById('fieldNetWeight');
      var netWeight = Number(netWeightInput.value);
      if (!brand) { showFieldError('fieldBrand', '请填写品牌'); return; }
      if (!name) { showFieldError('fieldName', '请填写品名'); return; }
      var subtypeConfig = MP.FOOD_SUBTYPES[st.formCat];
      var subtype = subtypeConfig ? document.getElementById('fieldSubtype').value : '';
      if (subtype === '__custom__') {
        subtype = document.getElementById('fieldSubtypeCustom').value.trim();
        if (!subtype) { showFieldError('fieldSubtypeCustom', '请填写自定义类型'); return; }
      }
      if (!id && subtypeConfig && !subtypeConfig.optional && !subtype) {
        showFieldError('fieldSubtype', '请选择' + subtypeConfig.label);
        return;
      }
      if (!id && !isRestockMode && subtypeConfig && !subtypeConfig.custom && subtype && !subtypeConfig.options.includes(subtype)) {
        showFieldError('fieldSubtype', '请选择' + subtypeConfig.label); return;
      }
      var usageUnit = st.formCat === 'supplies' ? '' : document.getElementById('fieldUsageUnit').value;
      var usageInput = document.getElementById('fieldUsagePerItem');
      var usagePerItem = usageInput.value === '' ? null : Number(usageInput.value);
      if (usagePerItem !== null && (!usageUnit || !Number.isFinite(usagePerItem) || usagePerItem <= 0)) {
        showFieldError('fieldUsagePerItem', '请选择投喂单位并填写大于 0 的换算数量'); return;
      }
      if (!netWeightInput.disabled && (netWeightInput.required || netWeightInput.value || netWeightInput.validity.badInput) &&
          (!Number.isFinite(netWeight) || netWeight <= 0)) {
        showFieldError('fieldNetWeight', st.formCat === 'supplies' ? '请填写大于 0 的每份规格' : '请填写大于 0 的单件净含量');
        return;
      }
      if (st.formCat === 'supplies' && !MP.SUPPLY_SPEC_UNITS.includes(document.getElementById('fieldNetWeightUnit').value)) {
        showFieldError('fieldNetWeightUnit', '请选择容量单位');
        return;
      }
      var packaging = UI.readPurchasePackaging();
      if (document.getElementById('fieldPackagingEnabled').checked && !packaging) {
        var countField = document.getElementById('fieldPackCount');
        var sizeField = document.getElementById('fieldPackSize');
        var invalidCount = !Number.isSafeInteger(Number(countField.value)) || Number(countField.value) < 1;
        var invalidSize = !Number.isSafeInteger(Number(sizeField.value)) || Number(sizeField.value) < 1;
        showFieldError(invalidCount ? countField.id : invalidSize ? sizeField.id : 'packSealIndependentBtn',
          '请核对购买数量、每包装件数、内包装单位和密封方式');
        return;
      }
      var purchasedQty = packaging ? packaging.count * packaging.size : 0;
      var newQty = packaging && !id
        ? purchasedQty
        : Math.max(0, Utils.round2(Number(document.getElementById('fieldQty').value) || 0));
      if (!id && !(newQty > 0)) {
        showFieldError('fieldQty', '请填写大于 0 的入库数量');
        return;
      }
      if (st.formCat !== 'supplies' && !prodDate && !expDate) {
        var dateField = document.getElementById('stockDateMode').dataset.mode === 'expiry' ? 'fieldExpDate' : 'fieldProdDate';
        showFieldError(dateField, '填写生产日期或过期日期其一');
        return;
      }
      if (st.formCat !== 'supplies' && !expDate) {
        showFieldError(id ? 'fieldExpDate' : 'fieldShelfValue', id ? '请填写有效的过期日期' : '填写保质期以推算过期日期');
        return;
      }
      if (prodDate && expDate && expDate < prodDate) {
        showFieldError('fieldExpDate', '过期日期不能早于生产日期');
        return;
      }
      var original = id && st.items.find(function (item) { return item.id === id; });
      var selectedUnit = document.getElementById('fieldUnit').value;
      if (usagePerItem !== null && usageUnit === selectedUnit && usagePerItem !== 1) {
        showFieldError('fieldUsagePerItem', '投喂单位与库存单位相同时，每件数量应为 1'); return;
      }
      if (usagePerItem !== null && usageUnit === 'g' && netWeight > 0 && Math.abs(usagePerItem - netWeight) > 1e-9) {
        showFieldError('fieldUsagePerItem', '克数换算须与单件净含量一致'); return;
      }
      var unitChanged = Boolean(original && selectedUnit !== original.unit);
      if (unitChanged) {
        var unitError = Domain.stockUnitCorrectionError(original, selectedUnit);
        if (unitError) { showFieldError('fieldUnit', unitError); return; }
      }
      if (original && original.flavors) {
        newQty = original.quantity;
        packaging = original.purchasePackaging;
      }
      var flavors = original && original.flavors;
      if (packaging && document.getElementById('fieldMixedFlavors').checked) {
        var invalidFlavorCount = UI.invalidFlavorCount();
        if (invalidFlavorCount) {
          showFieldError(invalidFlavorCount, '请输入有效的整数件数');
          return;
        }
      }
      var adjustments = flavors ? UI.readFlavorAdjustments() : [];
      if (adjustments.some(function (draft) {
        var flavor = Domain.findFlavor(original, draft.id);
        return !flavor || original.sourceBatchId || !Number.isSafeInteger(draft.whole) || draft.whole < 0 ||
          !Number.isFinite(draft.percent) || draft.percent < 0 || draft.percent > 100 ||
          (draft.percent > 0 && !flavor.openedDate) ||
          draft.whole + Number(draft.percent > 0) > flavor.perPack * packaging.count;
      })) {
        showFieldError('flavorSummary', '请核对口味件数和开封余量，不能超过原始配比。');
        return;
      }
      if (!id && packaging && document.getElementById('fieldMixedFlavors').checked) {
        flavors = Domain.validateFlavors(UI.readFlavorRows(packaging), packaging, newQty, false);
        if (!flavors) {
          UI.syncFlavorForm();
          showFieldError('flavorSummary', document.getElementById('flavorSummary').textContent);
          return;
        }
      }
      var enteredPrice = Number(document.getElementById('fieldPrice').value) || 0;
      var openingToggle = document.getElementById('fieldIsOpened');
      var openingInput = document.getElementById('fieldOpenedDate');
      var isOpened = original && original.flavors ? original.isOpened : newQty > 0 && !openingToggle.disabled && openingToggle.checked;
      var openedInForm = Utils.normalizeDateStr(openingInput.value);
      if (newQty > 0 && !isOpened) openedInForm = '';
      if (!openingInput.disabled) {
        var openingError = UI.openingDateError(openedInForm);
        if (openingError) {
          UI.syncOpenedFieldsVisibility();
          showFieldError(openingInput, openingError);
          return;
        }
      }
      var finishedInForm = Utils.normalizeDateStr(document.getElementById('fieldFinishedDate').value);
      if (newQty <= 0 && openedInForm && finishedInForm && finishedInForm < openedInForm) {
        UI.showToast('用完日期不能早于开封日期');
        return;
      }

      var invalid = Array.from(itemForm.elements).find(function (field) {
        return field.willValidate && !field.validity.valid && !field.closest('.hidden-view, details:not([open])');
      });
      if (invalid) { showFieldError(invalid, '请检查此字段的格式或数值范围'); return; }

      var priceInput = document.getElementById('fieldPrice');
      var priceBasis = UI.itemPriceQuantity(packaging, newQty);
      var unitPrice = original && enteredPrice === Number(priceInput.dataset.initialTotal) &&
        priceBasis === Number(priceInput.dataset.initialBasis) ? original.price : enteredPrice / priceBasis;
      var locationInput = document.getElementById('fieldLocation');
      var location = locationInput.value.trim();
      var similar = confirmedLocation === location ? '' : UI.findSimilarLocation(location);
      if (similar) {
        UI.openConfirm('确认存放位置', '已有相似位置：' + similar + '，是否合并？', '合并', function () {
          locationInput.value = similar;
          saveItemForm(similar, unitConfirmed, unitSnapshotReady);
        }, { alternativeLabel: '保持独立', onAlternative: function () { saveItemForm(location, unitConfirmed, unitSnapshotReady); } });
        return;
      }
      if (unitChanged && !unitConfirmed) {
        UI.openConfirm('确认更正内包装单位？',
          '仅更正单位，数量 ' + Utils.formatNumber(Number(original.quantity) || 0) + ' 不变，历史记录里的单位也会一起更新。',
          '确认保存', function () { saveItemForm(confirmedLocation, true, false); });
        return;
      }
      if (unitChanged && !unitSnapshotReady) {
        Storage.savePreRestoreSnapshot(function (ok) {
          if (ok) saveItemForm(confirmedLocation, true, true);
          else UI.showToast('无法保存操作前快照，单位更正已取消。');
        });
        return;
      }
      if (original?.flavors) flavors = UI.readEditedFlavorRatings(flavors);
      var openLimit = document.getElementById('fieldOpenLimit').value;
      var record = Domain.sanitizeItem({
        id: id || ('item_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
        category: st.formCat,
        unit_net_weight_g: st.formCat === 'supplies' ? null : netWeight,
        unit_spec_value: st.formCat === 'supplies' ? netWeight : null,
        unit_spec_unit: st.formCat === 'supplies' ? document.getElementById('fieldNetWeightUnit').value : '',
        subtype: subtype,
        feedUsageUnit: usageUnit,
        feedUsagePerItem: usagePerItem,
        brand: brand,
        name: name,
        spec: document.getElementById('fieldSpec').value.trim(),
        legacySpecInNotes: document.getElementById('fieldSpec').dataset.noteMigrated === 'true',
        effectTags: UI.getFormEffectTags(),
        quantity: newQty,
        unit: selectedUnit,
        purchasePackaging: packaging,
        flavors: flavors,
        price: unitPrice,
        currency: st.formCurrency || 'CNY',
        prodDate: prodDate,
        shelfLifeValue: document.getElementById('fieldShelfValue').value ? Number(document.getElementById('fieldShelfValue').value) : '',
        shelfLifeUnit: document.getElementById('fieldShelfUnit').value,
        expDate: expDate,
        isOpened: isOpened,
        openedDate: flavors && original && newQty > 0 ? original.openedDate : openedInForm,
        archivedOpenedDate: newQty <= 0 ? openedInForm : '',
        finishedDate: newQty <= 0 ? (finishedInForm || Utils.getTodayStr()) : '',
        openDaysLimit: openLimit === '' ? null : Number(openLimit),
        palatability: flavors || st.formCat === 'supplies' ? undefined : st.formPal,
        location: location,
        batchCode: document.getElementById('fieldBatch').value.trim(),
        notes: document.getElementById('fieldNotes').value.trim(),
        imageData: st.formImage || '',
        isSample: false
      });

      var rollbackState = unitChanged ? {
        items: JSON.parse(JSON.stringify(st.items)),
        logs: JSON.parse(JSON.stringify(st.logs)),
        stockHistory: JSON.parse(JSON.stringify(st.stockHistory)),
        settings: JSON.parse(JSON.stringify(st.settings)),
        statusFilter: st.statusFilter
      } : null;

      if (id) {
        var prevIt = st.items.find(function (x) { return x.id === id; });
        if (prevIt) {
          var prevQty = Utils.round2(Number(prevIt.quantity) || 0);
          if (prevIt.eatenCount) record.eatenCount = prevIt.eatenCount;
          if (prevIt.openRemainFraction && record.isOpened) record.openRemainFraction = prevIt.openRemainFraction;
          if (prevQty === newQty && prevIt.isOpened === record.isOpened && prevIt.openedDate === record.openedDate) {
            record.portionRevision = prevIt.portionRevision;
          }
          if (prevIt.consumedCount) record.consumedCount = prevIt.consumedCount;
          if (prevIt.lastQuantity) record.lastQuantity = prevIt.lastQuantity;
          if (prevIt.sourceBatchId) record.sourceBatchId = prevIt.sourceBatchId;
          if (!record.finishedDate && prevIt.finishedDate && newQty <= 0) record.finishedDate = prevIt.finishedDate;
          if (!record.archivedOpenedDate && prevIt.archivedOpenedDate &&
              (prevIt.eatenCount > 0 || prevIt.archivedOpenedDate !== prevIt.openedDate)) {
            record.archivedOpenedDate = prevIt.archivedOpenedDate;
          }

          // If user manually edited an active batch with linked shadow archive to quantity 0, merge shadow archive cleanly!
          if (prevQty > 0 && newQty <= 0) {
            var totalBatchUsed = Utils.round2((Number(prevIt.eatenCount) || 0) + prevQty);
            record.eatenCount = totalBatchUsed;
            record.consumedCount = totalBatchUsed;
            record.lastQuantity = totalBatchUsed;
            st.items = st.items.filter(function (x) {
              return !(x.id !== id && x.sourceBatchId === id && (Number(x.quantity) || 0) <= 0);
            });
          }

          for (var uIdx = 0; uIdx < st.items.length; uIdx++) {
            if (st.items[uIdx].id === id) {
              st.items[uIdx] = record;
              break;
            }
          }
          // Sync linked empty_<id> shadow archive metadata whenever active batch is edited!
          if (newQty > 0) {
            Domain.syncLinkedArchiveForActiveItem(record);
          }

          if (prevQty !== newQty) {
            var diffQ = Utils.round2(newQty - prevQty);
            Domain.appendStockHistory({
              action: 'adjust',
              itemId: record.id,
              category: record.category,
              brand: record.brand,
              name: record.name,
              unit: record.unit,
              deltaText: (diffQ > 0 ? '+' : '') + diffQ + record.unit,
              beforeQty: prevQty,
              afterQty: newQty,
              note: '编辑批次修改库存数量'
            });
          }
          if (newQty > 0 && (prevIt.isOpened !== record.isOpened ||
              (record.isOpened && prevIt.openedDate !== record.openedDate))) {
            Domain.appendStockHistory({
              action: prevIt.isOpened === record.isOpened ? 'adjust' : (record.isOpened ? 'open' : 'unopen'),
              openingDate: record.isOpened ? record.openedDate : '',
              supplyEvent: record.category === 'supplies' ? 'opening_changed' : undefined,
              itemId: record.id,
              category: record.category,
              brand: record.brand,
              name: record.name,
              unit: record.unit,
              beforeQty: newQty,
              afterQty: newQty,
              deltaText: '开封状态变更',
              note: (prevIt.isOpened ? ('已开封 ' + (prevIt.openedDate || '日期未填')) : '未开封') +
                ' → ' + (record.isOpened ? ('已开封 ' + (record.openedDate || '日期未填')) : '未开封')
            });
          }
          if (record.category === 'supplies' && prevQty <= 0 && newQty <= 0 &&
              (prevIt.archivedOpenedDate !== record.archivedOpenedDate || prevIt.finishedDate !== record.finishedDate)) {
            Domain.appendStockHistory({
              action: 'adjust', itemId: record.sourceBatchId || record.id, category: record.category,
              supplyEvent: 'history_dates_changed',
              brand: record.brand, name: record.name, unit: record.unit,
              deltaText: '历史批次日期变更', note: '历史批次日期已修改，原使用周期不再用于估算'
            });
          }
        }
        if (adjustments.length) {
          var reason = document.getElementById('adjustFlavorReason').value.trim();
          // Restore stock first so an intermediate zero does not archive a batch that will still contain stock.
          adjustments.sort(function (a, b) {
            function delta(draft) {
              return draft.whole + Number(draft.percent > 0) - Domain.findFlavor(record, draft.id).quantity;
            }
            return delta(b) - delta(a);
          }).forEach(function (draft) {
            Domain.adjustFlavorStock(record, Domain.findFlavor(record, draft.id), draft.whole, draft.percent, reason);
          });
        }
      } else {
        record.lastQuantity = newQty;
        st.items.unshift(record);
        Domain.appendStockHistory({
          action: isRestockMode ? 'restock' : 'create',
          openingDate: record.isOpened ? record.openedDate : '',
          itemId: record.id,
          category: record.category,
          brand: record.brand,
          name: record.name,
          unit: record.unit,
          deltaText: '+' + newQty + record.unit,
          beforeQty: 0,
          afterQty: newQty,
          note: (isRestockMode ? '同款复购新建批次' : '新录入库存批次') +
            (record.expDate ? (' · 到期 ' + record.expDate) : '') +
            (record.isOpened ? (' · 入库时已开封 ' + (record.openedDate || '日期未填')) : '')
        });
        if (record.quantity > 0 && st.statusFilter === 'empty') {
          st.statusFilter = 'in_stock';
        }
      }

      if (unitChanged) Domain.syncStockUnitCorrection(record, original.unit);

      Storage.saveToStorage(false, function (ok) {
        if (!ok && rollbackState) {
          st.items = rollbackState.items;
          st.logs = rollbackState.logs;
          st.stockHistory = rollbackState.stockHistory;
          st.settings = rollbackState.settings;
          st.statusFilter = rollbackState.statusFilter;
          UI.renderAll();
          UI.showToast('保存失败，单位及历史记录已恢复原状。');
          return;
        }
        if (ok) {
          UI.showToast(id ? '修改已保存' : (isRestockMode ? '同款新批次已复购入库' : '新批次已入库'));
          if (unitChanged) UI.closeItemModal();
        }
      });
      if (!unitChanged) UI.closeItemModal();
      UI.renderAll();
    }

    // 10. Photo Upload & Lightbox
    document.getElementById('fieldPhotoInput').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      Utils.compressImageFile(file, function (res) {
        if (!res || !res.dataUrl) {
          UI.showToast('图片读取失败，请换一张试试');
          return;
        }
        st.formImage = res.dataUrl;
        UI.syncModalPhotoUI();
        UI.showToast('照片已压缩至约 ' + res.kb + ' KB');
      });
    });

    document.getElementById('clearPhotoBtn').addEventListener('click', function () {
      st.formImage = '';
      document.getElementById('fieldPhotoInput').value = '';
      UI.syncModalPhotoUI();
      UI.showToast('已恢复分类默认插画');
    });

    document.getElementById('closeLightboxBtn').addEventListener('click', UI.closeLightbox);
    document.getElementById('photoPreviewBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('photoPreviewBackdrop')) UI.closeLightbox();
    });

    // 11. Settings, Backup, Restore, Pre-Restore Undo & Confirm Modal
    document.getElementById('warnDaysGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-warn-days]');
      if (!btn) return;
      st.settings.warnDays = parseInt(btn.getAttribute('data-warn-days'), 10) || 60;
      Storage.saveToStorage();
      UI.renderAll();
      UI.showToast('临期预警已设为 ' + Utils.formatQuantity(st.settings.warnDays, '天'));
    });

    document.getElementById('defaultCurrencyGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-def-currency]');
      if (!btn) return;
      st.settings.defaultCurrency = btn.getAttribute('data-def-currency') === 'JPY' ? 'JPY' : 'CNY';
      Storage.saveToStorage();
      UI.renderAll();
      UI.showToast('默认币种已设为' + (st.settings.defaultCurrency === 'JPY' ? '日元' : '人民币'));
    });

    function exportJsonBackup() {
      var activeFeedInput = document.activeElement.closest('[data-daily-feed]');
      if (activeFeedInput) {
        saveDailyFeedInput(activeFeedInput);
        if (global.navigator.standalone || global.matchMedia?.('(display-mode: standalone)').matches) {
          activeFeedInput.blur();
        }
      }
      Storage.exportJsonBackup(function (handedOff) {
        if (handedOff) UI.renderSettingsView();
        UI.showToast(handedOff ? '已发起 JSON 导出，请在浏览器中确认文件已保存' : '未能发起 JSON 导出，请重试');
      });
    }

    document.getElementById('exportJsonBtn').addEventListener('click', exportJsonBackup);
    document.getElementById('quickBackupNowBtn').addEventListener('click', exportJsonBackup);
    document.getElementById('settingsBackupNowBtn').addEventListener('click', exportJsonBackup);
    document.getElementById('dismissBackupBannerBtn').addEventListener('click', function () {
      st.backupBannerDismissedCount = Number(st.settings.unsavedChangesCount) || 0;
      document.getElementById('unbackedBanner').classList.add('hidden-view');
    });

    document.getElementById('exportCsvBtn').addEventListener('click', function () {
      Storage.exportItemsCsv();
      UI.showToast('已导出库存盘点表 CSV');
    });
    document.getElementById('exportLogsCsvBtn').addEventListener('click', function () {
      Storage.exportLogsCsv();
      UI.showToast('已导出每日记录 CSV');
    });
    document.getElementById('copySummaryBtn').addEventListener('click', copyTextSummary);

    document.getElementById('openBackupRestoreBtn').addEventListener('click', function () {
      document.getElementById('importJsonInput').click();
    });
    document.getElementById('importJsonInput').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (loadEv) {
        var check = Storage.validateAndParseBackup(String(loadEv.target.result || ''));
        if (!check.ok) {
          UI.showToast(check.error || '备份文件校验未通过');
          ev.target.value = '';
          return;
        }
        UI.openConfirm(
          '导入 JSON 备份恢复',
          '校验通过：包含 ' + Utils.formatQuantity(check.items.length, '条') + '批次记录、' + Utils.formatQuantity(check.logs.length, '条') + '每日记录与 ' + Utils.formatQuantity(check.stockHistory.length, '条') + '库存流水。' +
          (check.missingDeductionTargets ? ' 有 ' + Utils.formatQuantity(check.missingDeductionTargets, '条') + '扣减记录在备份中缺少原批次，历史会保留，缺少原批次时无法自动退库。' : '') +
          (check.detachedArchives ? ' 有 ' + Utils.formatQuantity(check.detachedArchives, '条') + '归档在备份中缺少原批次。' : '') +
          '请选择导入方式（全量覆盖前会保存保护快照）：',
          '确认导入',
          function (useSmartMerge) {
            Storage.applyBackupData(check, useSmartMerge, function (ok, error) {
              if (!ok) {
                if (error) UI.openConfirm('无法恢复备份', error, '知道了', function () {});
                return;
              }
              UI.renderAll();
              UI.switchTab('pantry');
              UI.showToast(useSmartMerge ? '已智能合并备份数据' : ('已恢复 ' + Utils.formatQuantity(check.items.length, '条') + '记录（需要可点设置页撤回）'));
            });
          },
          { icon: 'circle-check', label: '智能合并模式（保留手机现有记录并去重合并；取消勾选则为全量覆盖）', defaultChecked: true }
        );
        ev.target.value = '';
      };
      reader.onerror = function () {
        UI.showToast('读取备份文件失败');
        ev.target.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    });

    document.getElementById('undoOverwriteBtn').addEventListener('click', function () {
      UI.openConfirm(
        '撤回上次全量覆盖恢复？',
        '将恢复到上次全量导入前的本地数据快照（快照时间：' + (st.storageHealth.preRestoreSnapshotTime || '最近一次') + '）。',
        '确认撤回恢复',
        function () {
          Storage.restorePreRestoreSnapshot(function (ok, writeFailed) {
            if (ok) {
              UI.renderAll();
              UI.showToast('已成功恢复到覆盖前的本地快照数据');
            } else if (!writeFailed) {
              UI.showToast('未找到可用的本地快照');
            }
          });
        }
      );
    });

    document.getElementById('clearAllDataBtn').addEventListener('click', function () {
      UI.openConfirm('清空全部本地数据？', '此操作仅在你确认后清空库存、每日记录与流水（清空前会自动保留一份本地恢复快照，也建议先导出 JSON 备份）。', '确认清空', function () {
        Storage.savePreRestoreSnapshot(function (ok) {
          if (!ok) return;
          st.items = [];
          st.logs = [];
          st.stockHistory = [];
          Storage.saveToStorage();
          UI.renderAll();
          UI.showToast('本地数据已清空（如需找回可在设置页点撤回快照）');
        });
      });
    });

    document.getElementById('confirmCancelBtn').addEventListener('click', UI.chooseConfirmAlternative);
    document.getElementById('confirmModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('confirmModalBackdrop')) UI.closeConfirm();
    });
    document.getElementById('confirmStockQuantity').addEventListener('change', UI.syncRedemptionPortion);
    document.getElementById('confirmExtraCheckbox').addEventListener('change', UI.syncRedemptionPortion);
    document.getElementById('confirmOkBtn').addEventListener('click', UI.consumePendingConfirm);
    function syncOpeningPicker(root) {
      var item = st.items.find(function (entry) { return entry.id === root.dataset.itemId; });
      var result = UI.syncOpenDatePicker(root, item);
      if (root.id === 'flavorOpenDatePicker') {
        document.getElementById('confirmFlavorOpenBtn').disabled = Boolean(result.error) ||
          !document.querySelector('#flavorOpenOptions input[name="menuOpenFlavor"]:checked');
      }
    }
    [document.getElementById('confirmOpenDateWrap'), document.getElementById('flavorOpenDatePicker')].forEach(function (root) {
      root.querySelector('[data-open-date-input]').addEventListener('change', function () { syncOpeningPicker(root); });
      root.querySelector('.open-date-presets').addEventListener('click', function (ev) {
        var button = ev.target.closest('[data-open-date-offset]');
        if (!button) return;
        root.querySelector('[data-open-date-input]').value = Utils.shiftDaysFromToday(Number(button.dataset.openDateOffset));
        syncOpeningPicker(root);
      });
    });
    document.getElementById('flavorOpenOptions').addEventListener('change', function () {
      syncOpeningPicker(document.getElementById('flavorOpenDatePicker'));
    });
    document.getElementById('closeFlavorOpenModalBtn').addEventListener('click', UI.closeFlavorOpenModal);
    document.getElementById('flavorOpenModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === this) UI.closeFlavorOpenModal();
    });
    document.getElementById('confirmFlavorOpenBtn').addEventListener('click', function () {
      var modal = document.getElementById('flavorOpenModalBackdrop');
      var item = st.items.find(function (entry) { return entry.id === modal.dataset.itemId; });
      var choice = document.querySelector('#flavorOpenOptions input[name="menuOpenFlavor"]:checked');
      var flavor = item && choice ? Domain.findFlavor(item, choice.value) : null;
      if (!item || !flavor) return;
      var result = UI.syncOpenDatePicker(document.getElementById('flavorOpenDatePicker'), item);
      if (result.error) return;
      if (recordFlavorOpened(item, flavor, result.date)) UI.closeFlavorOpenModal();
    });
  };

  App.registerServiceWorker = function () {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
        // Proactively check for updated sw.js when online
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', function () {
          var newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              UI.showToast('检测到新版本已后台静默更新完成', 'sparkles');
            }
          });
        });
      }).catch(function () {});
    });
  };

  function refreshToday() {
    var today = Utils.getTodayStr();
    if (today === lastActiveDayStr) return false;
    lastActiveDayStr = today;
    if (followToday) {
      selectLogDate(today);
      UI.syncDailyWeek(today, true);
    }
    UI.renderAll();
    return true;
  }

  var historyHintTimer;
  function showPantryHistoryHint() {
    var hint = document.getElementById('pantryHistoryHint');
    hint.classList.add('is-visible');
    window.clearTimeout(historyHintTimer);
    historyHintTimer = window.setTimeout(function () { hint.classList.remove('is-visible'); }, 2500);
  }

  App.init = function () {
    var st = MP.state;
    UI.syncStaticBrandIcons();
    UI.renderNursingProjectChoices();
    document.querySelectorAll('[data-category-icon]').forEach(function (node) {
      node.innerHTML = Utils.getCategoryIcon(node.dataset.categoryIcon, 20);
    });
    UI.initModalAccessibility();
    App.bindEvents();
    Storage.loadFromStorage(function () {
      UI.renderAll();
      if (!st.settings.pantryHistoryHintSeen && st.activeTab === 'pantry') {
        showPantryHistoryHint();
        st.settings.pantryHistoryHintSeen = true;
        Storage.saveToStorage(true);
      }
    });
    App.registerServiceWorker();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !refreshToday()) UI.renderAll();
    });
    window.setInterval(function () {
      if (!document.hidden) refreshToday();
    }, 60000);
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', App.init);
    } else {
      App.init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
