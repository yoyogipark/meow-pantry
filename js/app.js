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
    var lines = ['🐾 【喵喵粮仓盘点】截至 ' + Utils.getTodayStr() + '（共 ' + active.length + ' 批在库）'];
    active.sort(function (a, b) { return Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays; });
    active.forEach(function (it) {
      var ev = Domain.evaluateItem(it);
      var cat = (MP.CATEGORIES[it.category] || MP.CATEGORIES.dry).label;
      var dayTxt = ev.expDays !== null ? (ev.expDays < 0 ? '已过期' + Math.abs(ev.expDays) + '天' : '剩' + ev.expDays + '天') : '';
      lines.push('• [' + cat + '] ' + it.brand + ' ' + it.name + ' × ' + it.quantity + (it.unit || '') + ' | 到期:' + (it.expDate || '-') + ' (' + dayTxt + ')');
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
    st.attrFilter = 'all';
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
    var logTitle = '「' + targetLog.date + ' ' + product.brand + ' ' + product.name + ' (' + targetLog.amount + ')」';
    var canRevert = targetLog.itemId && (targetLog.flavorChange || Number(targetLog.deductedUnit) > 0 || Number(targetLog.deductedFrac) > 0);
    var revertOpt = canRevert ? { label: '🔄 同时退回该笔记录扣减的罐头余量 / 库存数量', defaultChecked: true } : null;
    UI.openConfirm('删除饮食记录？', '确定要删除 ' + logTitle + ' 吗？', '确认删除', function (doRevert) {
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
        if (ok) UI.showToast(doRevert ? '已删除记录并退回对应库存余量' : '已删除该条饮食记录');
      });
      UI.renderAll();
    }, revertOpt);
  }

  function redemptionMealAmount(item, quantity, fraction) {
    var unit = item.unit || '件';
    if (fraction >= 1 || quantity < 1) return quantity + unit;
    var remainder = Utils.formatRemainFractionText(fraction, unit).replace(/^余/, '剩余');
    var portion = Utils.computePortionGramLabel(remainder, fraction, item.spec);
    return quantity > 1 ? (quantity - 1) + unit + ' + ' + portion : portion;
  }

  App.bindEvents = function () {
    var st = MP.state;

    // 1. Unified 4 Bottom Navigation Tabs: 粮仓库存 / 饮食记录 / 喂养分析 / 备份设置
    document.getElementById('navBtnPantry').addEventListener('click', function () { UI.switchTab('pantry'); });
    document.getElementById('navBtnDaily').addEventListener('click', function () { UI.switchTab('daily'); });
    document.getElementById('navBtnStats').addEventListener('click', function () { UI.switchTab('stats'); });
    document.getElementById('navBtnSettings').addEventListener('click', function () { UI.switchTab('settings'); });

    // 2. Header & Edit Mode Toggle
    document.getElementById('globalEditModeToggle').addEventListener('change', function () {
      st.editMode = Boolean(this.checked);
      UI.renderHeaderSubtitle();
      UI.showToast(st.editMode ? '✏️ 已进入编辑模式，可增删改库存与饮食记录' : '🔒 已锁定为只读浏览模式，防止误触');
    });

    document.getElementById('openAddModalBtn').addEventListener('click', UI.openAddModal);
    document.getElementById('emptyAddBtn').addEventListener('click', UI.openAddModal);
    document.getElementById('closeItemModalBtn').addEventListener('click', UI.closeItemModal);
    document.getElementById('cancelModalBtn').addEventListener('click', UI.closeItemModal);
    document.getElementById('itemModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('itemModalBackdrop')) UI.closeItemModal();
    });

    document.getElementById('clearSamplesBtn').addEventListener('click', function () {
      st.items = st.items.filter(function (it) { return !it.isSample; });
      st.logs = st.logs.filter(function (lg) { return !lg.isSample; });
      st.stockHistory = st.stockHistory.filter(function (h) { return !h.isSample; });
      Storage.saveToStorage();
      UI.renderAll();
      UI.showToast('示例体验数据已清空');
    });

    // 3. Pantry Status Cards, Attribute Select, Category Pills & Search/Sort
    document.getElementById('stockDetailsBtn').addEventListener('click', function () {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      this.textContent = expanded ? '库存数量明细' : '收起库存明细';
      document.getElementById('stockQuantityDetails').classList.toggle('hidden-view', expanded);
    });
    var statusCards = document.querySelectorAll('[data-status-filter]');
    for (var i = 0; i < statusCards.length; i++) {
      statusCards[i].addEventListener('click', function () {
        st.statusFilter = this.getAttribute('data-status-filter');
        if (st.statusFilter === 'empty') st.attrFilter = 'all';
        st.pantryPage = 1;
        UI.renderAll();
      });
    }

    document.getElementById('attrFilterSelect').addEventListener('change', function () {
      st.attrFilter = this.value || 'all';
      st.pantryPage = 1;
      UI.renderAll();
    });
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
      st.sortBy = this.value;
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
      UI.showToast(st.pantryDisplayMode === 'compact' ? '已切换为「极简清单」视图' : '已切换为「详细卡片」视图');
    });

    document.getElementById('prevPageBtn').addEventListener('click', function () {
      if (st.pantryPage > 1) {
        st.pantryPage -= 1;
        UI.renderPantryList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    document.getElementById('nextPageBtn').addEventListener('click', function () {
      st.pantryPage += 1;
      UI.renderPantryList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('pageSizeSelect').addEventListener('change', function () {
      st.pantryPageSize = parseInt(this.value, 10) || 6;
      st.settings.pantryPageSize = st.pantryPageSize;
      st.pantryPage = 1;
      Storage.saveToStorage(true);
      UI.renderPantryList();
    });

    // 4. Pantry Card Delegated Actions (Preview, History, Feed & Restock allowed in Read-Only; Destructive edits require Edit Mode)
    document.getElementById('pantryList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var safeReadActions = { 'preview-img': true, 'log-feed': true, 'item-history': true, 'restock-new': true };
      if (!safeReadActions[action] && !st.editMode) {
        return;
      }
      var id = btn.getAttribute('data-id');
      if (action === 'item-history') {
        UI.openStockHistoryModal(id);
        return;
      }

      var target = st.items.find(function (x) { return x.id === id; });
      if (!target) return;

      if (target.flavors && ['toggle-open', 'consume-one', 'mark-empty'].indexOf(action) !== -1) {
        UI.openFeedModal(target.id, Utils.getTodayStr());
        UI.showToast(action === 'toggle-open' ? '选择口味后点「记录开封」' : '选择口味后点「核销1件」');
        return;
      }

      if (action === 'preview-img') {
        UI.openLightbox(target);
      } else if (action === 'log-feed') {
        UI.openFeedModal(target.id, Utils.getTodayStr());
      } else if (action === 'restock-new' || action === 'restore-stock') {
        UI.openRestockModal(target);
      } else if (action === 'edit') {
        UI.openEditModal(id);
      } else if (action === 'toggle-open') {
        var uLabel = target.unit || '件';
        var curQty = Number(target.quantity) || 0;
        target.isOpened = !target.isOpened;
        if (target.isOpened) {
          target.openedDate = Utils.getTodayStr();
          if (!target.openDaysLimit) {
            target.openDaysLimit = (MP.CATEGORIES[target.category] || MP.CATEGORIES.dry).defaultOpenDays;
          }
          Domain.appendStockHistory({
            action: 'open',
            itemId: target.id,
            category: target.category,
            brand: target.brand,
            name: target.name,
            unit: uLabel,
            deltaText: Domain.hasSharedSeal(target) ? '开封共用密封包装' : '拆封 1' + uLabel,
            beforeQty: curQty,
            afterQty: curQty,
            note: '开启拆封保鲜倒计时（建议 ' + target.openDaysLimit + ' 天内吃完）'
          });
          UI.showToast(curQty > 1
            ? ('已拆封 1 ' + uLabel + '开启保鲜计时，其余 ' + Math.max(0, Utils.round2(curQty - 1)) + ' ' + uLabel + '仍未拆封')
            : '已记录今日拆封，开启保鲜倒计时');
        } else {
          target.openedDate = '';
          target.openRemainFraction = 0;
          Domain.appendStockHistory({
            action: 'unopen',
            itemId: target.id,
            category: target.category,
            brand: target.brand,
            name: target.name,
            unit: uLabel,
            deltaText: '取消拆封',
            beforeQty: curQty,
            afterQty: curQty,
            note: '手动恢复为未拆封状态'
          });
          UI.showToast('已恢复为未拆封状态');
        }
        Storage.saveToStorage();
        UI.renderAll();
      } else if (action === 'consume-one' || action === 'mark-empty') {
        var curQ = Number(target.quantity) || 0;
        if (curQ <= 0) return;
        var unit = target.unit || '件';
        var fraction = target.isOpened && Number(target.openRemainFraction) > 0 ? Number(target.openRemainFraction) : 1;
        UI.openConfirm('确认库存核销？', '核销后将减少库存并更新归档。只有勾选且确认实际份量，才补记今日喂食。', '确认核销', function (alsoLogMeal, quantity, mealQuantity) {
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
              mealSlot: target.category === 'med' ? '🩺 用药/护理' : Utils.getCurrentMealSlot(),
              itemId: target.id, category: target.category, subtype: target.subtype,
              brand: target.brand, name: target.name, amount: amount,
              note: '库存核销 ' + usedCount + unit + '，仅补记确认喂食的份量',
              deductedUnit: confirmed, deductedFrac: fraction
            });
          }
          Storage.saveToStorage(false, function (ok) {
            if (ok) UI.showToast(alsoLogMeal ? '已核销库存并补记喂食' : '已核销库存');
          });
          UI.renderAll();
        }, {
          label: Domain.isSingleServingUnit(target) ? '同时记入今日饮食记录（核销一件时补记 ' + redemptionMealAmount(target, Math.min(1, curQ), fraction) + '）' : '',
          defaultChecked: false,
          redemption: { quantity: curQ, unit: unit, all: action === 'mark-empty' }
        });
      } else if (action === 'delete') {
        UI.openConfirm('删除这条批次记录？', '将移除「' + target.brand + ' ' + target.name + '」，删除后不可撤销。', '确认删除', function () {
          var oldQty = Number(target.quantity) || 0;
          // Detach any linked finished archive so historical eaten records aren't orphaned
          st.items.forEach(function (x) {
            if (x.sourceBatchId === id) x.sourceBatchId = '';
          });
          st.items = st.items.filter(function (x) { return x.id !== id; });
          Domain.appendStockHistory({
            action: 'delete',
            itemId: id,
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

    // 5. Daily Feeding Log Controls & Quick Feed
    document.getElementById('openQuickFeedBtn').addEventListener('click', function () {
      UI.openFeedModal('', st.selectedLogDate);
    });
    document.getElementById('dailyQuickFeedBox').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-quick-feed-item]');
      if (!btn) return;
      UI.openFeedModal(btn.getAttribute('data-quick-feed-item'), st.selectedLogDate);
    });
    document.getElementById('closeFeedModalBtn').addEventListener('click', UI.closeFeedModal);
    document.getElementById('cancelFeedModalBtn').addEventListener('click', UI.closeFeedModal);
    document.getElementById('feedModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('feedModalBackdrop')) UI.closeFeedModal();
    });

    document.getElementById('prevDayBtn').addEventListener('click', function () {
      selectLogDate(Utils.shiftDaysFromDate(st.selectedLogDate || Utils.getTodayStr(), -1));
      UI.renderDailyView();
    });
    document.getElementById('nextDayBtn').addEventListener('click', function () {
      selectLogDate(Utils.shiftDaysFromDate(st.selectedLogDate || Utils.getTodayStr(), 1));
      UI.renderDailyView();
    });
    document.getElementById('goTodayBtn').addEventListener('click', function () {
      selectLogDate(Utils.getTodayStr());
      UI.renderDailyView();
    });
    document.getElementById('dailyDatePicker').addEventListener('change', function () {
      if (this.value) {
        selectLogDate(this.value);
        UI.renderDailyView();
      }
    });

    document.getElementById('dailyFeedTimeline').addEventListener('click', function (ev) {
      var editBtn = ev.target.closest('[data-edit-log]');
      if (editBtn) {
        UI.openEditFeedModal(editBtn.getAttribute('data-edit-log'));
        return;
      }
      var delBtn = ev.target.closest('[data-del-log]');
      if (delBtn) handleDeleteFeedingLog(delBtn.getAttribute('data-del-log'));
    });

    document.getElementById('recentSevenDaysList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-date]');
      if (!btn) return;
      selectLogDate(btn.getAttribute('data-jump-date'));
      st.dailyViewMode = 'day';
      UI.renderDailyView();
      window.scrollTo(0, 0);
    });

    document.getElementById('dailyModeSwitch').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-daily-mode]');
      if (!btn) return;
      st.dailyViewMode = btn.getAttribute('data-daily-mode');
      UI.renderDailyView();
    });

    document.getElementById('jumpToAllDatesBtn').addEventListener('click', function () {
      st.dailyViewMode = 'all';
      UI.renderDailyView();
      window.scrollTo(0, 0);
    });

    document.getElementById('copyPrevDayLogsBtn').addEventListener('click', function () {
      var targetDate = st.selectedLogDate || Utils.getTodayStr();
      var prevDateStr = Utils.shiftDaysFromDate(targetDate, -1);
      // Copy routine food & supplements by default (do NOT accidentally duplicate quarterly deworming med reminders!)
      var prevLogs = st.logs.filter(function (lg) { return lg.date === prevDateStr && lg.category !== 'med'; });
      if (prevLogs.length === 0) {
        UI.showToast('前一天 (' + prevDateStr + ') 没有可复制的日常饮食记录');
        return;
      }
      UI.openConfirm(
        '复制前一天饮食记录？',
        '将把 ' + prevDateStr + ' 的 ' + prevLogs.length + ' 条日常饮食/营养品记录复制到 ' + targetDate + '（自动跳过低频驱虫药记录，复制后可单条微调）。',
        '确认复制',
        function () {
          for (var idx = prevLogs.length - 1; idx >= 0; idx--) {
            var srcLog = prevLogs[idx];
            Domain.appendFeedingLog({
              date: targetDate,
              mealSlot: srcLog.mealSlot,
              itemId: srcLog.itemId,
              category: srcLog.category,
              subtype: srcLog.subtype,
              brand: srcLog.brand,
              name: srcLog.name,
              flavorId: srcLog.flavorId,
              flavorName: srcLog.flavorName,
              flavorPalatability: srcLog.flavorPalatability,
              amount: srcLog.amount,
              note: srcLog.note
            });
          }
          Storage.saveToStorage();
          UI.renderAll();
          UI.showToast('已复制 ' + prevLogs.length + ' 条记录到 ' + targetDate);
        }
      );
    });

    document.getElementById('logHistoryMonthSelect').addEventListener('change', function () {
      st.logMonthFilter = this.value || 'all';
      st.logPage = 1;
      UI.renderAllDatesArchive();
    });
    document.getElementById('logHistorySearchInput').addEventListener('input', function () {
      st.logSearchQuery = this.value || '';
      st.logPage = 1;
      UI.renderAllDatesArchive();
    });
    document.getElementById('logHistoryCatSelect').addEventListener('change', function () {
      st.logCatFilter = this.value || 'all';
      st.logPage = 1;
      UI.renderAllDatesArchive();
    });
    document.getElementById('prevLogPageBtn').addEventListener('click', function () {
      if (st.logPage > 1) {
        st.logPage -= 1;
        UI.renderAllDatesArchive();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    document.getElementById('nextLogPageBtn').addEventListener('click', function () {
      st.logPage += 1;
      UI.renderAllDatesArchive();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('logPageSizeSelect').addEventListener('change', function () {
      st.logPageSize = parseInt(this.value, 10) || 7;
      st.logPage = 1;
      UI.renderAllDatesArchive();
    });

    document.getElementById('allDatesArchiveList').addEventListener('click', function (ev) {
      var editBtn = ev.target.closest('[data-edit-log]');
      if (editBtn) {
        UI.openEditFeedModal(editBtn.getAttribute('data-edit-log'));
        return;
      }
      var delBtn = ev.target.closest('[data-del-log]');
      if (delBtn) {
        handleDeleteFeedingLog(delBtn.getAttribute('data-del-log'));
        return;
      }
      var jumpBtn = ev.target.closest('[data-jump-date]');
      if (jumpBtn) {
        selectLogDate(jumpBtn.getAttribute('data-jump-date'));
        st.dailyViewMode = 'day';
        UI.renderDailyView();
        window.scrollTo(0, 0);
      }
    });

    // 6. Feed Form Interactions & Split-Can Stock Deduction
    function selectedFeedItem() {
      var id = document.getElementById('feedItemId').value;
      return st.items.find(function (item) { return item.id === id; });
    }

    document.getElementById('feedFlavorSelect').addEventListener('change', function () {
      UI.updateFeedFlavor(selectedFeedItem());
    });
    document.getElementById('openFlavorBtn').addEventListener('click', function () {
      var item = selectedFeedItem();
      var flavor = UI.getFeedFlavor(item);
      if (!item || !st.editMode || !Domain.openFlavor(item, flavor, Utils.getTodayStr())) return;
      Storage.saveToStorage();
      UI.updateFeedFlavor(item);
      UI.renderAll();
      UI.showToast('已记录开封');
    });
    document.getElementById('discardFlavorBtn').addEventListener('click', function () {
      var item = selectedFeedItem();
      var flavor = UI.getFeedFlavor(item);
      if (!st.editMode || !flavor) return;
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
            mealSlot: item.category === 'med' ? '🩺 用药/护理' : Utils.getCurrentMealSlot(),
            note: '库存核销时补记', deductedUnit: change.units, deductedFrac: change.fraction,
            flavorId: flavor.id, flavorName: flavor.name,
            flavorPalatability: flavor.palatability, flavorChange: change
          });
        }
        UI.closeFeedModal();
        UI.renderAll();
        Storage.saveToStorage(false, function (ok) {
          if (ok) UI.showToast(alsoLogMeal ? '已核销该口味并补记喂食' : '已核销该口味');
        });
      }, { label: '同时记入今日饮食记录（' + amount + '）', defaultChecked: false });
    });
    document.getElementById('feedStockSelect').addEventListener('change', function () {
      UI.applyFeedStockSelection(this.value);
      UI.syncMedReminderVisibility();
    });
    document.getElementById('feedCategorySelect').addEventListener('change', UI.syncMedReminderVisibility);
    document.getElementById('feedMealSlot').addEventListener('change', UI.syncMedReminderVisibility);

    document.getElementById('feedPortionChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-portion]');
      if (!btn) return;
      var fItemId = document.getElementById('feedItemId').value;
      var target = st.items.find(function (x) { return x.id === fItemId; });
      var rawFrac = btn.getAttribute('data-frac');
      var basePortion = btn.getAttribute('data-portion');
      var chosenFrac = 0;

      if (rawFrac === 'rest' && target) {
        chosenFrac = (target.isOpened && Number(target.openRemainFraction) > 0) ? Number(target.openRemainFraction) : 1;
        var rLabel = Utils.formatRemainFractionText(chosenFrac, target.unit || '罐').replace(/^余/, '');
        document.getElementById('feedAmountInput').value = Utils.computePortionGramLabel(rLabel, chosenFrac, target.spec);
      } else {
        chosenFrac = parseFloat(rawFrac) || 0;
        if (btn.id === 'chipLastPortion') {
          document.getElementById('feedAmountInput').value = basePortion;
        } else if (target && chosenFrac > 0 && chosenFrac < 1) {
          var cleanBase = basePortion.replace(/\s*\([^)]*\)/, '');
          document.getElementById('feedAmountInput').value = Utils.computePortionGramLabel(cleanBase, chosenFrac, target.spec);
        } else if (target && chosenFrac === 1 && target.category === 'can') {
          document.getElementById('feedAmountInput').value = target.spec ? ('1整罐 (' + target.spec + ')') : '1整罐';
        } else {
          document.getElementById('feedAmountInput').value = basePortion;
        }
      }
      UI.syncFeedSplitCanUI(target, chosenFrac);
    });

    document.getElementById('feedAmountInput').addEventListener('input', function () {
      var val = this.value.trim();
      var fItemId = document.getElementById('feedItemId').value;
      var target = st.items.find(function (x) { return x.id === fItemId; });
      UI.syncFeedSplitCanUI(target, UI.inferFractionFromAmountStr(val));
    });

    document.getElementById('feedForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (document.getElementById('feedModalBackdrop').classList.contains('hidden-view')) return;
      var editLogId = document.getElementById('feedLogEditId').value;
      var fDate = document.getElementById('feedDateInput').value || Utils.getTodayStr();
      var fSlot = document.getElementById('feedMealSlot').value;
      var fItemId = document.getElementById('feedItemId').value;
      var fCat = document.getElementById('feedCategorySelect').value;
      var fBrand = document.getElementById('feedBrandInput').value.trim();
      var fName = document.getElementById('feedNameInput').value.trim();
      var fAmount = document.getElementById('feedAmountInput').value.trim();
      var fNote = document.getElementById('feedNoteInput').value.trim();
      var remDays = parseInt(document.getElementById('feedNextReminderDays').value, 10) || 0;
      var nextDue = (remDays > 0 && (fCat === 'med' || fSlot === '🩺 用药/护理'))
        ? Utils.addShelfLife(fDate, remDays, 'days')
        : '';
      var deduct = document.getElementById('feedDeductStock').checked;

      if (!fBrand || !fName || !fAmount) {
        UI.showToast('请填写品牌、品名和投喂份量');
        return;
      }

      if (editLogId) {
        for (var k = 0; k < st.logs.length; k++) {
          if (st.logs[k].id === editLogId) {
            st.logs[k].date = fDate;
            st.logs[k].mealSlot = fSlot;
            if (!st.logs[k].flavorId && !st.logs[k].deductedUnit && !st.logs[k].deductedFrac) st.logs[k].itemId = fItemId;
            if (st.logs[k].category !== fCat) delete st.logs[k].subtype;
            st.logs[k].category = fCat;
            st.logs[k].brand = fBrand;
            st.logs[k].name = fName;
            st.logs[k].amount = fAmount;
            st.logs[k].note = fNote;
            st.logs[k].reminderDays = remDays;
            st.logs[k].nextDueDate = nextDue;
            break;
          }
        }
        selectLogDate(fDate);
        Storage.saveToStorage(false, function (ok) {
          if (ok) UI.showToast('饮食记录修改已保存');
        });
        UI.closeFeedModal();
        UI.renderAll();
        return;
      }

      var usedFrac = parseFloat(document.getElementById('feedUnitFraction').value) || 0;
      var splitToastSuffix = '';
      var actualDeductedUnit = 0;
      var actualDeductedFrac = 0;
      var flavor = null;
      var flavorChange = null;

      if (fItemId) {
        var stItem = st.items.find(function (x) { return x.id === fItemId; });
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
          var portion = UI.getFlavorFeedFraction(fAmount, stItem, flavor);
          flavorChange = Domain.feedFlavor(stItem, flavor, portion.fraction, portion.finish, fDate);
          if (!flavorChange) {
            UI.showToast('请填写有效份量，且不要超过该口味当前一件的余量');
            return;
          }
          flavor.palatability = document.getElementById('feedFlavorPal').value;
          actualDeductedUnit = flavorChange.units;
          actualDeductedFrac = flavorChange.fraction;
        } else {
          var curQ = Number(stItem.quantity) || 0;
          stItem.lastEatenDate = fDate;
          if (curQ > 0 && usedFrac > 0 && (stItem.category === 'can' || Domain.isSingleServingUnit(stItem))) {
            var startRem = (stItem.isOpened && Number(stItem.openRemainFraction) > 0 && Number(stItem.openRemainFraction) < 0.98)
              ? Number(stItem.openRemainFraction)
              : 1.0;
            var nextRemFrac = Utils.round2(startRem - usedFrac);
            if (nextRemFrac <= 0.08) {
              if (!stItem.openedDate) stItem.openedDate = fDate;
              actualDeductedUnit = Domain.recordConsumedUnits(stItem, 1, fDate, '记喂食（' + fAmount + '）吃完整' + (stItem.unit || '罐') + '自动核销');
              actualDeductedFrac = startRem;
              splitToastSuffix = '（本' + (stItem.unit || '罐') + '已吃完并自动核销库存）';
            } else {
              stItem.isOpened = true;
              if (!stItem.openedDate) stItem.openedDate = fDate;
              if (!stItem.openDaysLimit) {
                stItem.openDaysLimit = (MP.CATEGORIES[stItem.category] || MP.CATEGORIES.can).defaultOpenDays;
              }
              stItem.openRemainFraction = nextRemFrac;
              actualDeductedFrac = usedFrac;
              var remStr = Utils.formatRemainFractionText(nextRemFrac, stItem.unit || '罐');
              Domain.appendStockHistory({
                date: fDate,
                action: 'partial',
                itemId: stItem.id,
                category: stItem.category,
                brand: stItem.brand,
                name: stItem.name,
                unit: stItem.unit || '罐',
                deltaText: '本' + (stItem.unit || '罐') + remStr,
                beforeQty: curQ,
                afterQty: curQ,
                note: '分顿投喂 ' + fAmount + '，拆封余量更新为' + remStr
              });
              splitToastSuffix = '（本' + (stItem.unit || '罐') + remStr + '）';
            }
          } else if (deduct && curQ > 0) {
            actualDeductedFrac = stItem.isOpened ? Number(stItem.openRemainFraction) || 0 : 0;
            actualDeductedUnit = Domain.recordConsumedUnits(stItem, 1, fDate, '记喂食同步扣减 1 ' + (stItem.unit || '件'));
            splitToastSuffix = '（已同步扣减 1 ' + (stItem.unit || '件') + '库存）';
          }
        }
      }

      Domain.appendFeedingLog({
        date: fDate,
        mealSlot: fSlot,
        itemId: fItemId,
        category: fCat,
        subtype: stItem && stItem.category === fCat ? stItem.subtype : undefined,
        brand: fBrand,
        name: fName,
        amount: fAmount,
        note: fNote,
        reminderDays: remDays,
        nextDueDate: nextDue,
        deductedUnit: actualDeductedUnit,
        deductedFrac: actualDeductedFrac,
        flavorId: flavor && flavor.id,
        flavorName: flavor && flavor.name,
        flavorPalatability: flavor && flavor.palatability,
        flavorChange: flavorChange
      });

      selectLogDate(fDate);
      Storage.saveToStorage(false, function (ok) {
        if (ok) UI.showToast(nextDue ? ('已记录用药，将于 ' + nextDue + ' 提醒下次护理') : ('已记入 ' + fDate + ' 饮食记录' + splitToastSuffix));
      });
      UI.closeFeedModal();
      UI.renderAll();
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
    });

    document.getElementById('groupSeparationSummary').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-stats-scope-jump]');
      if (!btn) return;
      var clickedKey = btn.getAttribute('data-stats-scope-jump');
      st.statsScopeFilter = (st.statsScopeFilter === clickedKey) ? 'all' : clickedKey;
      Stats.renderStatsView();
    });

    document.getElementById('categoryStatsGrid').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-cat]');
      if (!btn) return;
      var catKey = btn.getAttribute('data-jump-cat');
      clearPantryFilters();
      st.catFilter = catKey;
      UI.renderAll();
      UI.switchTab('pantry');
      UI.showToast('已筛选分类：' + (MP.CATEGORIES[catKey] ? MP.CATEGORIES[catKey].label : catKey));
    });

    document.getElementById('stockHealthBox').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-health]');
      if (!btn) return;
      var hk = btn.getAttribute('data-jump-health');
      clearPantryFilters();
      if (hk === 'opened') {
        st.statusFilter = 'in_stock';
        st.attrFilter = 'opened';
      } else if (hk === 'fresh') {
        st.statusFilter = 'in_stock';
        st.attrFilter = 'fresh';
      } else if (hk === 'expiring') {
        st.statusFilter = 'expiring';
        st.attrFilter = 'all';
      } else if (hk === 'expired') {
        st.statusFilter = 'expired';
        st.attrFilter = 'all';
      }
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
    document.getElementById('prevBrandPageBtn').addEventListener('click', function () {
      if (st.brandPage > 1) { st.brandPage -= 1; Stats.renderStatsView(); }
    });
    document.getElementById('nextBrandPageBtn').addEventListener('click', function () {
      st.brandPage += 1; Stats.renderStatsView();
    });
    document.getElementById('brandPageSizeSelect').addEventListener('change', function () {
      st.brandPageSize = parseInt(this.value, 10) || 5;
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
    });

    document.getElementById('brandStatsList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-jump-brand]');
      if (!btn) return;
      var brandName = btn.getAttribute('data-jump-brand');
      clearPantryFilters();
      st.brandFilter = brandName;
      UI.renderAll();
      UI.switchTab('pantry');
      UI.showToast('已筛选品牌：' + brandName);
    });

    document.getElementById('medReminderBanner').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-dismiss-rem]');
      if (!btn) return;
      var logId = btn.getAttribute('data-dismiss-rem');
      for (var rIdx = 0; rIdx < st.logs.length; rIdx++) {
        if (st.logs[rIdx].id === logId) {
          st.logs[rIdx].reminderDone = true;
          break;
        }
      }
      Storage.saveToStorage();
      UI.renderMedReminderBanner();
      UI.showToast('已标记完成本次用药提醒');
    });

    // 8. Stock Operation History Modal Controls
    document.getElementById('openStockHistoryBtn').addEventListener('click', function () {
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
      UI.syncModalUnitPriceHint();
      if (isEditing && !document.getElementById('fieldIsOpened').checked) {
        var cInfo = MP.CATEGORIES[newCat] || MP.CATEGORIES.dry;
        document.getElementById('fieldOpenLimit').value = String(cInfo.defaultOpenDays);
      }
    });

    document.getElementById('quickBrandChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-pick-brand]');
      if (btn) document.getElementById('fieldBrand').value = btn.getAttribute('data-pick-brand');
    });
    document.getElementById('quickLocationChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-pick-location]');
      if (btn) document.getElementById('fieldLocation').value = btn.getAttribute('data-pick-location');
    });
    document.getElementById('currencyToggleGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-form-currency]');
      if (btn) UI.syncModalCurrencyUI(btn.getAttribute('data-form-currency'));
    });
    document.getElementById('palatabilityGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-pal]');
      if (btn) UI.syncModalPalatabilityUI(btn.getAttribute('data-pal'));
    });

    ['fieldMixedFlavors', 'fieldPackSeal'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', UI.syncPurchasePackaging);
    });
    document.getElementById('flavorRows').addEventListener('input', UI.syncFlavorForm);
    document.getElementById('flavorRows').addEventListener('click', function (ev) {
      var remove = ev.target.closest('[data-remove-flavor]');
      if (!remove || remove.disabled) return;
      remove.closest('.flavor-row').remove();
      UI.syncFlavorForm();
    });
    document.getElementById('addFlavorBtn').addEventListener('click', function () {
      UI.addFlavorRow();
      UI.syncFlavorForm();
    });
    document.getElementById('fieldSubtype').addEventListener('change', UI.updateItemSubtype);
    document.getElementById('fieldUnit').addEventListener('change', UI.markItemUnitManual);
    ['fieldPackagingEnabled', 'fieldPackOuterUnit', 'fieldUnit'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', UI.syncModalUnitPriceHint);
    });
    ['fieldPackCount', 'fieldPackSize'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', UI.syncModalUnitPriceHint);
    });
    document.getElementById('fieldPrice').addEventListener('input', UI.syncModalUnitPriceHint);
    document.getElementById('fieldSpec').addEventListener('input', UI.syncModalUnitPriceHint);
    document.getElementById('fieldProdDate').addEventListener('change', function () {
      UI.autoComputeExpDate();
      UI.syncAllDateDisplays();
    });
    document.getElementById('fieldExpDate').addEventListener('change', UI.syncAllDateDisplays);
    document.getElementById('fieldOpenedDate').addEventListener('change', UI.syncAllDateDisplays);
    document.getElementById('fieldFinishedDate').addEventListener('change', UI.syncAllDateDisplays);
    document.getElementById('fieldQty').addEventListener('input', UI.syncOpenedFieldsVisibility);
    document.getElementById('feedDateInput').addEventListener('change', UI.syncAllDateDisplays);
    document.getElementById('fieldShelfValue').addEventListener('input', UI.autoComputeExpDate);
    document.getElementById('fieldShelfUnit').addEventListener('change', UI.autoComputeExpDate);
    document.getElementById('fieldIsOpened').addEventListener('change', UI.syncOpenedFieldsVisibility);

    document.getElementById('shelfPresetsBar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-preset-months]');
      if (!btn) return;
      document.getElementById('fieldShelfValue').value = btn.getAttribute('data-preset-months');
      document.getElementById('fieldShelfUnit').value = 'months';
      if (document.getElementById('fieldProdDate').value) {
        UI.autoComputeExpDate();
      } else if (document.getElementById('fieldExpDate').value) {
        var backProd = Utils.subtractShelfLife(
          document.getElementById('fieldExpDate').value,
          btn.getAttribute('data-preset-months'),
          'months'
        );
        if (backProd) {
          document.getElementById('fieldProdDate').value = backProd;
          document.getElementById('dateCalcHint').textContent = '已反推生产日期';
          UI.syncAllDateDisplays();
        }
      }
    });

    document.getElementById('calcProdFromExpBtn').addEventListener('click', function () {
      var exp = document.getElementById('fieldExpDate').value;
      var val = document.getElementById('fieldShelfValue').value;
      var unit = document.getElementById('fieldShelfUnit').value;
      if (!exp || !val) {
        UI.showToast('请先填写「过期日期」和「保质期时长」');
        return;
      }
      var prod = Utils.subtractShelfLife(exp, val, unit);
      if (prod) {
        document.getElementById('fieldProdDate').value = prod;
        document.getElementById('dateCalcHint').textContent = '已根据到期日反推出生产日期';
        UI.syncAllDateDisplays();
        UI.showToast('已自动反推生产日期：' + prod);
      }
    });

    document.getElementById('cloneBatchFromEditBtn').addEventListener('click', function () {
      var curId = document.getElementById('fieldId').value;
      var item = st.items.find(function (x) { return x.id === curId; });
      if (item) UI.openRestockModal(item);
    });

    document.getElementById('itemForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var id = document.getElementById('fieldId').value;
      var isRestockMode = document.getElementById('fieldIsRestockMode').value === '1';
      var brand = document.getElementById('fieldBrand').value.trim();
      var name = document.getElementById('fieldName').value.trim();
      var prodDate = Utils.normalizeDateStr(document.getElementById('fieldProdDate').value);
      var expDate = Utils.normalizeDateStr(document.getElementById('fieldExpDate').value);
      if (!brand || !name || !expDate) {
        UI.showToast('请填写品牌、品名和有效的过期日期');
        return;
      }
      if (prodDate && expDate < prodDate) {
        UI.showToast('过期日期不能早于生产日期，请检查日期');
        return;
      }

      var subtypeConfig = MP.FOOD_SUBTYPES[st.formCat];
      var subtype = subtypeConfig ? document.getElementById('fieldSubtype').value : '';
      if (!id && subtypeConfig && !subtypeConfig.options.includes(subtype)) {
        UI.showToast('请选择' + subtypeConfig.label);
        return;
      }
      var packaging = UI.readPurchasePackaging();
      if (document.getElementById('fieldPackagingEnabled').checked && !packaging) {
        UI.showToast('请填写有效的包装数量和内包装单位');
        return;
      }
      var purchasedQty = packaging ? packaging.count * packaging.size : 0;
      var newQty = packaging && !id
        ? purchasedQty
        : Math.max(0, Utils.round2(Number(document.getElementById('fieldQty').value) || 0));
      var original = id && st.items.find(function (item) { return item.id === id; });
      if (original && original.flavors) {
        newQty = original.quantity;
        packaging = original.purchasePackaging;
      }
      var flavors = original && original.flavors;
      if (!id && packaging && document.getElementById('fieldMixedFlavors').checked) {
        flavors = Domain.validateFlavors(UI.readFlavorRows(packaging), packaging, newQty, false);
        if (!flavors) {
          UI.showToast('请填写至少两种不同口味，且每盒口味数量合计须等于包装件数');
          return;
        }
      }
      var enteredPrice = Number(document.getElementById('fieldPrice').value) || 0;
      var openedInForm = Utils.normalizeDateStr(document.getElementById('fieldOpenedDate').value);
      var finishedInForm = Utils.normalizeDateStr(document.getElementById('fieldFinishedDate').value);
      if (newQty <= 0 && openedInForm && finishedInForm && finishedInForm < openedInForm) {
        UI.showToast('用完日期不能早于开封日期');
        return;
      }

      var record = Domain.sanitizeItem({
        id: id || ('item_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
        category: st.formCat,
        subtype: subtype,
        brand: brand,
        name: name,
        spec: document.getElementById('fieldSpec').value.trim(),
        quantity: newQty,
        unit: document.getElementById('fieldUnit').value,
        purchasePackaging: packaging,
        flavors: flavors,
        price: packaging ? enteredPrice / purchasedQty : enteredPrice,
        currency: st.formCurrency || 'CNY',
        prodDate: prodDate,
        shelfLifeValue: document.getElementById('fieldShelfValue').value ? Number(document.getElementById('fieldShelfValue').value) : '',
        shelfLifeUnit: document.getElementById('fieldShelfUnit').value,
        expDate: expDate,
        isOpened: flavors && original ? original.isOpened : (newQty > 0 && document.getElementById('fieldIsOpened').checked),
        openedDate: flavors && original ? original.openedDate : (newQty <= 0
          ? openedInForm
          : (document.getElementById('fieldIsOpened').checked ? (openedInForm || Utils.getTodayStr()) : '')),
        archivedOpenedDate: openedInForm,
        finishedDate: newQty <= 0 ? (finishedInForm || Utils.getTodayStr()) : '',
        openDaysLimit: Number(document.getElementById('fieldOpenLimit').value) || 45,
        palatability: st.formPal,
        location: document.getElementById('fieldLocation').value.trim(),
        batchCode: document.getElementById('fieldBatch').value.trim(),
        notes: document.getElementById('fieldNotes').value.trim(),
        imageData: st.formImage || '',
        isSample: false
      });

      if (id) {
        var prevIt = st.items.find(function (x) { return x.id === id; });
        if (prevIt) {
          var prevQty = Utils.round2(Number(prevIt.quantity) || 0);
          if (prevIt.eatenCount) record.eatenCount = prevIt.eatenCount;
          if (prevIt.openRemainFraction && record.isOpened) record.openRemainFraction = prevIt.openRemainFraction;
          if (prevIt.consumedCount) record.consumedCount = prevIt.consumedCount;
          if (prevIt.lastQuantity) record.lastQuantity = prevIt.lastQuantity;
          if (prevIt.sourceBatchId) record.sourceBatchId = prevIt.sourceBatchId;
          if (!record.finishedDate && prevIt.finishedDate && newQty <= 0) record.finishedDate = prevIt.finishedDate;
          if (!record.archivedOpenedDate && prevIt.archivedOpenedDate) record.archivedOpenedDate = prevIt.archivedOpenedDate;

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
        }
        if (record.quantity > 0 && st.statusFilter === 'empty') {
          st.statusFilter = 'in_stock';
        }
      } else {
        record.lastQuantity = newQty;
        st.items.unshift(record);
        Domain.appendStockHistory({
          action: isRestockMode ? 'restock' : 'create',
          itemId: record.id,
          category: record.category,
          brand: record.brand,
          name: record.name,
          unit: record.unit,
          deltaText: '+' + newQty + record.unit,
          beforeQty: 0,
          afterQty: newQty,
          note: (isRestockMode ? '同款复购新建批次' : '新录入库存批次') + (record.expDate ? (' · 到期 ' + record.expDate) : '')
        });
        if (record.quantity > 0 && st.statusFilter === 'empty') {
          st.statusFilter = 'in_stock';
        }
      }

      Storage.saveToStorage(false, function (ok) {
        if (ok) UI.showToast(id ? '修改已保存' : (isRestockMode ? '同款新批次已复购入库' : '新批次已入库'));
      });
      UI.closeItemModal();
      UI.renderAll();
    });

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
        UI.syncModalPhotoUI(res.kb);
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
      UI.showToast('临期预警已设为 ' + st.settings.warnDays + ' 天');
    });

    document.getElementById('defaultCurrencyGroup').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-def-currency]');
      if (!btn) return;
      st.settings.defaultCurrency = btn.getAttribute('data-def-currency') === 'JPY' ? 'JPY' : 'CNY';
      Storage.saveToStorage();
      UI.renderAll();
      UI.showToast('默认币种已设为' + (st.settings.defaultCurrency === 'JPY' ? '日元 (円)' : '人民币 (CN¥)'));
    });

    document.getElementById('exportJsonBtn').addEventListener('click', function () {
      Storage.exportJsonBackup(function () {
        UI.renderAll();
        UI.showToast('已生成 JSON 完整备份文件（含库存、饮食与流水）');
      });
    });
    document.getElementById('quickBackupNowBtn').addEventListener('click', function () {
      Storage.exportJsonBackup(function () {
        UI.renderAll();
        UI.showToast('已生成 JSON 备份文件');
      });
    });
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
      UI.showToast('已导出饮食记录 CSV');
    });
    document.getElementById('copySummaryBtn').addEventListener('click', copyTextSummary);

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
          '校验通过：包含 ' + check.items.length + ' 条批次记录、' + check.logs.length + ' 条饮食记录与 ' + check.stockHistory.length + ' 条库存流水。请选择导入方式（即使选全量覆盖，系统也会自动保存覆盖前本地快照供随时撤回）：',
          '确认导入',
          function (useSmartMerge) {
            Storage.applyBackupData(check, useSmartMerge, function (ok) {
              if (!ok) return;
              UI.renderAll();
              UI.switchTab('pantry');
              UI.showToast(useSmartMerge ? '已智能合并备份数据' : ('已恢复 ' + check.items.length + ' 条记录（需要可点设置页撤回）'));
            });
          },
          { label: '✅ 智能合并模式（保留手机现有记录并去重合并；取消勾选则为全量覆盖）', defaultChecked: true }
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
      UI.openConfirm('清空全部本地数据？', '此操作仅在你确认后清空库存、饮食记录与流水（清空前会自动保留一份本地恢复快照，也建议先导出 JSON 备份）。', '确认清空', function () {
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

    document.getElementById('confirmCancelBtn').addEventListener('click', UI.closeConfirm);
    document.getElementById('confirmModalBackdrop').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('confirmModalBackdrop')) UI.closeConfirm();
    });
    document.getElementById('confirmStockQuantity').addEventListener('change', UI.syncRedemptionPortion);
    document.getElementById('confirmExtraCheckbox').addEventListener('change', UI.syncRedemptionPortion);
    document.getElementById('confirmOkBtn').addEventListener('click', UI.consumePendingConfirm);
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
              UI.showToast('✨ 检测到新版本已后台静默更新完成');
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
    if (followToday) selectLogDate(today);
    UI.renderAll();
    return true;
  }

  App.init = function () {
    UI.syncStaticBrandIcons();
    App.bindEvents();
    Storage.loadFromStorage(function () {
      UI.renderAll();
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
