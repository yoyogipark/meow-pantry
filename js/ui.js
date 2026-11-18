/* Meow Pantry UI Renderer: Pantry Cards, Quick-Feed Bar, Daily Log, Modals & Stock Operation History Drawer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats;
  var UI = MP.UI = {};

  var pendingConfirmFn = null;
  var toastTimer = null;

  UI.showToast = function (msg) {
    var el = document.getElementById('toastEl');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden-view');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden-view');
    }, 2300);
  };

  UI.openConfirm = function (title, message, okLabel, onConfirm, extraOpt) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOkBtn').textContent = okLabel || '确定';
    var extraWrap = document.getElementById('confirmExtraOptionWrap');
    var extraChk = document.getElementById('confirmExtraCheckbox');
    var extraLbl = document.getElementById('confirmExtraLabel');
    if (extraOpt && extraOpt.label) {
      extraWrap.classList.remove('hidden-view');
      extraChk.checked = Boolean(extraOpt.defaultChecked);
      extraLbl.textContent = extraOpt.label;
    } else {
      extraWrap.classList.add('hidden-view');
      extraChk.checked = false;
    }
    pendingConfirmFn = onConfirm;
    document.getElementById('confirmModalBackdrop').classList.remove('hidden-view');
  };

  UI.closeConfirm = function () {
    pendingConfirmFn = null;
    document.getElementById('confirmModalBackdrop').classList.add('hidden-view');
  };

  UI.consumePendingConfirm = function () {
    var fn = pendingConfirmFn;
    if (!fn) return;
    var checked = document.getElementById('confirmExtraCheckbox').checked;
    UI.closeConfirm();
    fn(checked);
  };

  UI.syncAllDateDisplays = function () {
    var ids = ['dailyDatePicker', 'fieldProdDate', 'fieldExpDate', 'fieldOpenedDate', 'fieldFinishedDate', 'feedDateInput'];
    for (var i = 0; i < ids.length; i++) {
      var inp = document.getElementById(ids[i]);
      var txt = document.getElementById(ids[i] + 'Text');
      if (inp && txt) {
        txt.textContent = inp.value ? Utils.formatCnDateText(inp.value) : '选择日期';
      }
    }
  };

  UI.syncStaticBrandIcons = function () {
    var covers = MP.COVERS || {};
    if (covers.appIcon) {
      var hImg = document.getElementById('headerMascotImg');
      if (hImg) hImg.src = covers.appIcon;
      var appleIcon = document.getElementById('appleTouchIconLink');
      if (appleIcon && !appleIcon.getAttribute('data-keep-file')) appleIcon.href = covers.appIcon;
    }
  };

  UI.switchTab = function (tabName) {
    MP.state.activeTab = tabName;
    var views = {
      pantry: document.getElementById('viewPantry'),
      daily: document.getElementById('viewDaily'),
      stats: document.getElementById('viewStats'),
      settings: document.getElementById('viewSettings')
    };
    var navs = {
      pantry: document.getElementById('navBtnPantry'),
      daily: document.getElementById('navBtnDaily'),
      stats: document.getElementById('navBtnStats'),
      settings: document.getElementById('navBtnSettings')
    };
    Object.keys(views).forEach(function (k) {
      if (views[k]) views[k].classList.toggle('hidden-view', k !== tabName);
      if (navs[k]) navs[k].classList.toggle('active', k === tabName);
    });
    window.scrollTo(0, 0);
  };

  UI.renderAll = function () {
    UI.renderSampleBanner();
    UI.renderHeaderSubtitle();
    UI.renderStatusCounts();
    UI.renderCategoryPills();
    UI.renderBrandDropdown();
    UI.renderMedReminderBanner();
    UI.renderPantryList();
    UI.renderDailyView();
    Stats.renderStatsView();
    UI.renderSettingsView();
  };

  UI.renderSampleBanner = function () {
    var hasSamples = MP.state.items.some(function (it) { return Boolean(it.isSample); });
    var banner = document.getElementById('sampleBanner');
    if (banner) banner.classList.toggle('hidden-view', !hasSamples);
  };

  UI.syncEditModeUI = function () {
    var st = MP.state;
    var chk = document.getElementById('globalEditModeToggle');
    var lbl = document.getElementById('globalEditModeText');
    if (chk) chk.checked = Boolean(st.editMode);
    document.body.classList.toggle('is-edit-mode', Boolean(st.editMode));
    if (lbl) lbl.textContent = st.editMode ? '编辑中' : '编辑';
  };

  // Header subtitle cleanly distinguishes ordinary food count from supplement/medicine count!
  UI.renderHeaderSubtitle = function () {
    UI.syncEditModeUI();
    var foodCount = 0;
    var careCount = 0;
    var brandsSet = {};
    MP.state.items.forEach(function (it) {
      if ((Number(it.quantity) || 0) > 0) {
        if (MP.getCategoryGroup(it.category) === 'food') foodCount += 1;
        else careCount += 1;
        if (it.brand) brandsSet[it.brand.trim()] = true;
      }
    });
    var brandTotal = Object.keys(brandsSet).length;
    var subText = '口粮 ' + foodCount + ' 款';
    if (careCount > 0) subText += ' · 营养/药护 ' + careCount + ' 款';
    subText += ' · ' + brandTotal + ' 个品牌';
    var subEl = document.getElementById('headerSubtitle');
    if (subEl) subEl.textContent = subText;
  };

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

  UI.renderStatusCounts = function () {
    var st = MP.state;
    var cStock = 0;
    var cExpiring = 0;
    var cExpired = 0;
    var cOpened = 0;
    var cFresh = 0;
    var cLove = 0;
    var cCare = 0;
    var emptyItems = [];

    st.items.forEach(function (it) {
      var ev = Domain.evaluateItem(it);
      if (ev.status === 'empty') {
        emptyItems.push(it);
      } else {
        cStock += 1;
        if (ev.status === 'expiring') cExpiring += 1;
        else if (ev.status === 'expired') cExpired += 1;
        else cFresh += 1;
        if (it.isOpened) cOpened += 1;
        if (it.palatability === 'love' && ev.group === 'food') cLove += 1;
        if (ev.group !== 'food') cCare += 1;
      }
    });
    var cEmpty = Domain.groupEmptyItemsByProduct(emptyItems).length;

    document.getElementById('countInStock').textContent = String(cStock);
    document.getElementById('countExpiring').textContent = String(cExpiring);
    document.getElementById('countExpired').textContent = String(cExpired);
    document.getElementById('countEmpty').textContent = String(cEmpty);

    var cards = document.querySelectorAll('[data-status-filter]');
    for (var i = 0; i < cards.length; i++) {
      var key = cards[i].getAttribute('data-status-filter');
      cards[i].classList.toggle('selected', key === st.statusFilter);
    }

    // Sync integrated status/group dropdown inside the existing filter card
    var attrSel = document.getElementById('attrFilterSelect');
    if (attrSel) {
      if (st.statusFilter === 'empty') {
        attrSel.disabled = true;
        attrSel.style.opacity = '0.55';
        attrSel.value = 'all';
      } else {
        attrSel.disabled = false;
        attrSel.style.opacity = '1';
        var optMap = [
          { val: 'all',        txt: '📋 全部状态 (' + cStock + ')' },
          { val: 'opened',     txt: '🔓 已拆封 (' + cOpened + ')' },
          { val: 'fresh',      txt: '✅ 效期充裕 (' + cFresh + ')' },
          { val: 'group_food', txt: '🍽️ 普通食品' },
          { val: 'group_care', txt: '💊 营养/药品 (' + cCare + ')' }
        ];
        attrSel.innerHTML = optMap.map(function (o) {
          var selAttr = st.attrFilter === o.val ? ' selected' : '';
          return '<option value="' + o.val + '"' + selAttr + '>' + o.txt + '</option>';
        }).join('');
      }
    }
  };

  function itemMatchesStatusAndAttr(it, ev) {
    var st = MP.state;
    if (st.statusFilter === 'empty') {
      return ev.status === 'empty';
    }
    if (st.statusFilter === 'in_stock' && ev.status === 'empty') return false;
    if (st.statusFilter !== 'in_stock' && ev.status !== st.statusFilter) return false;

    if (st.attrFilter === 'opened' && !it.isOpened) return false;
    if (st.attrFilter === 'fresh' && ev.status !== 'fresh') return false;
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
    var brandMap = {};
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
    return '<span style="background:#F0F9FF;color:#0369A1;padding:2px 7px;border-radius:999px;font-size:10.5px;font-weight:700;">🍽️ ' + Utils.escapeHtml(txt) + '</span>';
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
      dBtns[dIdx].style.background = isAct ? '#1C1917' : 'transparent';
      dBtns[dIdx].style.color = isAct ? '#FFFFFF' : '#57534E';
    }

    var hasExtraFilter = (st.statusFilter !== 'in_stock' || st.attrFilter !== 'all' || st.catFilter !== 'all' || st.brandFilter !== 'all' || Boolean(q));
    var summaryBar = document.getElementById('activeFilterSummaryBar');
    var summaryTxt = document.getElementById('filterResultCountText');
    if (summaryBar && summaryTxt) {
      if (hasExtraFilter) {
        var displayCount = st.statusFilter === 'empty' ? Domain.groupEmptyItemsByProduct(filtered).length : filtered.length;
        var unitWord = st.statusFilter === 'empty' ? '款产品' : '批商品';
        summaryTxt.textContent = '当前筛选结果：共 ' + displayCount + ' ' + unitWord;
        summaryBar.classList.remove('hidden-view');
      } else {
        summaryBar.classList.add('hidden-view');
      }
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
            '<div class="ios-card" style="padding:10px 12px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div data-action="edit" data-id="' + Utils.escapeHtml(rep.id) + '" style="min-width:0;flex:1;cursor:pointer;">' +
                '<div style="display:flex;align-items:center;gap:5px;min-width:0;">' +
                  '<span style="font-size:14px;flex-shrink:0;">' + catInfo.icon + '</span>' +
                  '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 6px;border-radius:6px;flex-shrink:0;">' + Utils.escapeHtml(rep.brand) + '</span>' +
                  '<strong style="font-size:13.5px;color:#1C1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(rep.name) + '</strong>' +
                  (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
                '</div>' +
                '<div style="font-size:11px;color:#78716C;margin-top:3px;">' +
                  '共 ' + grp.batches.length + ' 个历史批次' + (rep.spec ? (' · 规格 ' + Utils.escapeHtml(rep.spec)) : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
                '<span style="background:#DCFCE7;color:#15803D;padding:3px 8px;border-radius:8px;font-size:12px;font-weight:800;white-space:nowrap;">累计 ' + grp.totalConsumed + unitStr + '</span>' +
                '<button type="button" data-action="restock-new" data-id="' + Utils.escapeHtml(rep.id) + '" style="padding:4px 8px;border-radius:8px;border:1px solid #FDBA74;background:#EA580C;color:#FFFFFF;font-size:11px;font-weight:700;cursor:pointer;">＋复购</button>' +
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
          ? '<span style="position:absolute;bottom:3px;right:3px;background:rgba(28,25,23,0.75);color:#FFF;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
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
                  (priceTxt ? '<span style="font-size:11px;color:#78716C;">' + Utils.escapeHtml(priceTxt) + '</span>' : '') +
                '</div>' +
                openFinishLine +
                '<div style="margin-top:2px;font-size:11px;color:#78716C;">' +
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
          '<article class="ios-card p-4" style="padding:15px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:11px;">' +
              thumbHtml +
              '<div style="min-width:0;flex:1;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">' +
                  '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:4px;">' +
                    '<span style="background:#F5F5F4;color:#44403C;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                    '<span style="background:#FFEDD5;color:#9A3412;padding:2px 9px;border-radius:8px;font-size:12px;font-weight:700;">' + Utils.escapeHtml(rep.brand) + '</span>' +
                    palHtml +
                  '</div>' +
                  '<span style="white-space:nowrap;background:#DCFCE7;color:#15803D;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;flex-shrink:0;">累计 ' + grp.totalConsumed + ' ' + unitStr + '</span>' +
                '</div>' +
                '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#1C1917;line-height:1.35;">' + Utils.escapeHtml(rep.name) + '</h3>' +
                '<div style="margin-top:4px;font-size:12px;color:#78716C;">' +
                  (rep.spec ? ('规格 ' + Utils.escapeHtml(rep.spec) + ' · ') : '') + '共归档 ' + grp.batches.length + ' 个历史批次' + avgTxt +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:11px;padding:10px;border-radius:12px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
              '<div style="font-size:11px;font-weight:700;color:#78716C;margin-bottom:7px;">📦 历史批次明细（总计 ' + grp.totalConsumed + ' ' + unitStr + '）</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;">' + batchRowsHtml + '</div>' +
            '</div>' +
            '<div style="margin-top:11px;padding-top:10px;border-top:1px solid #F5F5F4;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(rep.sourceBatchId || rep.id) + '" style="padding:6px 10px;border-radius:9px;border:1px solid #E7E5E4;background:#FAFAF9;color:#57534E;font-size:11.5px;font-weight:600;cursor:pointer;">📜 批次流水</button>' +
              '<button type="button" data-action="restock-new" data-id="' + Utils.escapeHtml(rep.id) + '" style="padding:7px 14px;border-radius:10px;border:1px solid #FDBA74;background:#EA580C;color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">＋ 同款复购入库</button>' +
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
        var badgeLabel = ev.expDays !== null ? (ev.expDays === 0 ? '今天到期' : ('剩' + ev.expDays + '天')) : '有效期内';

        if (ev.status === 'expired') {
          badgeBg = '#FEE2E2'; badgeText = '#DC2626';
          badgeLabel = (ev.expDays !== null && ev.expDays < 0)
            ? ('已过期' + Math.abs(ev.expDays) + '天')
            : ('开封超期' + Math.abs(ev.openRemaining || 0) + '天');
        } else if (it.isOpened && ev.openRemaining !== null && (ev.expDays === null || ev.openRemaining <= ev.expDays)) {
          badgeBg = ev.openRemaining <= 5 ? '#FEF3C7' : '#FFF7ED';
          badgeText = ev.openRemaining <= 5 ? '#B45309' : '#C2410C';
          badgeLabel = ev.openRemaining === 0 ? '开封今天到期' : ('保鲜剩' + ev.openRemaining + '天');
        } else if (ev.status === 'expiring') {
          badgeBg = '#FEF3C7'; badgeText = '#B45309';
          badgeLabel = ev.expDays === 0 ? '今天到期' : ('剩' + ev.expDays + '天');
        }

        var fracTxtCompact = (it.isOpened && it.openRemainFraction > 0) ? Utils.formatRemainFractionText(it.openRemainFraction, it.unit || '罐') : '';
        var openDot = it.isOpened && ev.status !== 'empty'
          ? '<span style="font-size:10px;font-weight:700;color:#EA580C;background:#FFEDD5;padding:1px 5px;border-radius:5px;flex-shrink:0;white-space:nowrap;">🔓' + (fracTxtCompact || '已拆') + '</span>'
          : '';
        var palIcon = it.palatability === 'love' ? (it.category === 'med' ? '✅' : '😍') : (it.palatability === 'coax' ? (it.category === 'med' ? '💦' : '🥺') : (it.palatability === 'meh' ? (it.category === 'med' ? '⚠️' : '😒') : ''));

        var compactMeta = ['<span>到期 ' + Utils.escapeHtml(it.expDate || '—') + '</span>'];
        if (it.spec) compactMeta.push('<span>' + Utils.escapeHtml(it.spec) + '</span>');
        if (it.location) compactMeta.push('<span>📍' + Utils.escapeHtml(it.location) + '</span>');

        return (
          '<div class="ios-card" style="padding:10px 12px;border-radius:14px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">' +
              '<div style="display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;">' +
                '<span style="font-size:13.5px;flex-shrink:0;">' + catInfo.icon + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 6px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">' + Utils.escapeHtml(it.brand) + '</span>' +
                (palIcon ? '<span style="font-size:12px;flex-shrink:0;">' + palIcon + '</span>' : '') +
                openDot +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
                '<span style="background:' + badgeBg + ';color:' + badgeText + ';padding:2px 7px;border-radius:999px;font-size:10.5px;font-weight:800;white-space:nowrap;">' + badgeLabel + '</span>' +
                '<span style="background:#F5F5F4;border:1px solid #E7E5E4;color:#1C1917;padding:2px 7px;border-radius:8px;font-size:11.5px;font-weight:800;white-space:nowrap;">余' + qtyNum + unitStr + '</span>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" title="记喂食" style="padding:3px 7px;border-radius:8px;border:1px solid #FED7AA;background:#FFF7ED;color:#EA580C;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">🐾喂</button>' +
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
      var badgeBg = '#DCFCE7';
      var badgeText = '#15803D';
      var barColor = '#16A34A';
      var badgeLabel = '';

      if (ev.status === 'expired') {
        badgeBg = '#FEE2E2'; badgeText = '#DC2626'; barColor = '#DC2626';
        badgeLabel = (ev.expDays !== null && ev.expDays < 0)
          ? ('已过期 ' + Math.abs(ev.expDays) + ' 天')
          : ('开封超期 ' + Math.abs(ev.openRemaining || 0) + ' 天');
      } else if (ev.status === 'expiring') {
        badgeBg = '#FEF3C7'; badgeText = '#B45309'; barColor = '#F59E0B';
        badgeLabel = ev.expDays === 0 ? '今天到期' : ('剩 ' + ev.expDays + ' 天到期');
      } else {
        badgeLabel = ev.expDays !== null ? ('剩 ' + ev.expDays + ' 天到期') : '有效期内';
      }

      var shelfText = it.shelfLifeValue
        ? (it.shelfLifeValue + (it.shelfLifeUnit === 'days' ? '天' : '个月'))
        : '—';

      var palInfo = MP.getPalatabilityBadgeInfo(it);
      var palHtml = palInfo
        ? '<span style="background:' + palInfo.bg + ';color:' + palInfo.text + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">' + palInfo.label + '</span>'
        : '';
      var lastFedHtml = buildLastFedTagHtml(it);

      var catBadgeBg = catInfo.group === 'med' ? '#DCFCE7' : (catInfo.group === 'supp' ? '#E0F2FE' : '#F5F5F4');
      var catBadgeCol = catInfo.group === 'med' ? '#14532D' : (catInfo.group === 'supp' ? '#075985' : '#44403C');

      var qtyNum = Number(it.quantity) || 0;
      var unitStr = Utils.escapeHtml(it.unit || '件');
      var fracBannerTxt = Utils.formatRemainFractionText(it.openRemainFraction, unitStr);
      var openedBannerHtml = '';
      if (it.isOpened && ev.status !== 'empty') {
        var openColor = (ev.openRemaining !== null && ev.openRemaining <= 5) ? '#DC2626' : '#C2410C';
        var openMsg = ev.openRemaining !== null
          ? (ev.openRemaining < 0 ? ('已超期 ' + Math.abs(ev.openRemaining) + ' 天') : ('保鲜剩 ' + ev.openRemaining + ' 天'))
          : '保鲜追踪中';
        var sealedLeft = Math.max(0, Utils.round2(qtyNum - 1));
        var openParts = ['🔓 已拆 1' + unitStr + (fracBannerTxt ? ('(' + fracBannerTxt + ')') : '')];
        if (sealedLeft > 0) openParts.push('未拆 ' + sealedLeft + unitStr);
        if (it.openedDate) openParts.push('开封 ' + Utils.escapeHtml(it.openedDate));
        openedBannerHtml =
          '<div style="margin-top:8px;padding:6px 9px;border-radius:10px;background:#FFF7ED;border:1px dashed #FDBA74;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;">' +
            '<span style="color:#7C2D12;">' + openParts.join(' · ') + '</span>' +
            '<strong style="color:' + openColor + ';white-space:nowrap;">' + openMsg + '</strong>' +
          '</div>';
      }

      var metaTags = [];
      if (it.spec) metaTags.push('规格 ' + Utils.escapeHtml(it.spec));
      if (it.location) metaTags.push('📍 ' + Utils.escapeHtml(it.location));
      if (it.price) {
        var per100Txt = catInfo.group === 'food' ? Utils.formatPer100gPrice(it.price, it.currency, it.spec) : '';
        metaTags.push(Utils.formatMoney(it.price, it.currency) + '/' + unitStr + (per100Txt ? (' (' + per100Txt + ')') : ''));
      }
      if (it.batchCode) metaTags.push(Utils.escapeHtml(it.batchCode));

      var coverSrc = MP.getItemCoverSrc(it);
      var realTag = it.imageData
        ? '<span style="position:absolute;bottom:3px;right:3px;background:rgba(28,25,23,0.75);color:#FFF;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;">实拍</span>'
        : '';
      var thumbHtml =
        '<button type="button" data-action="preview-img" data-id="' + Utils.escapeHtml(it.id) + '" aria-label="查看口粮图片" style="position:relative;width:64px;height:64px;padding:0;border:1px solid #E7E5E4;border-radius:14px;overflow:hidden;background:#FAFAF9;flex-shrink:0;cursor:pointer;">' +
          '<img src="' + coverSrc + '" alt="' + Utils.escapeHtml(it.name) + '" style="width:100%;height:100%;object-fit:cover;display:block;">' +
          realTag +
        '</button>';

      var feedBtnLabel = catInfo.group === 'med' ? '🩺 记用药' : (catInfo.group === 'supp' ? '💊 记喂食' : '🐾 记喂食');

      return (
        '<article class="ios-card p-4" style="padding:14px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
            thumbHtml +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<div style="display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;">' +
                  '<span style="background:' + catBadgeBg + ';color:' + catBadgeCol + ';padding:2px 6px;border-radius:7px;font-size:10.5px;font-weight:700;white-space:nowrap;flex-shrink:0;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                  '<span style="background:#FFEDD5;color:#9A3412;padding:2px 7px;border-radius:7px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + Utils.escapeHtml(it.brand) + '</span>' +
                '</div>' +
                '<span style="white-space:nowrap;background:' + badgeBg + ';color:' + badgeText + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;flex-shrink:0;">' + badgeLabel + '</span>' +
              '</div>' +
              '<h3 style="margin:0;font-size:15.5px;font-weight:800;color:#1C1917;line-height:1.35;word-break:break-word;">' + Utils.escapeHtml(it.name) + '</h3>' +
              ((palHtml || lastFedHtml) ? '<div style="margin-top:4px;display:flex;align-items:center;gap:5px;flex-wrap:wrap;">' + palHtml + lastFedHtml + '</div>' : '') +
              (metaTags.length ? '<div style="margin-top:4px;font-size:11.5px;color:#78716C;line-height:1.4;">' + metaTags.join(' · ') + '</div>' : '') +
            '</div>' +
          '</div>' +

          '<div style="margin-top:10px;padding:8px 10px;border-radius:12px;background:#FAFAF9;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:12px;">' +
            '<div><div style="color:#A8A29E;font-size:10.5px;">生产日期</div><div style="font-weight:600;color:#44403C;">' + Utils.escapeHtml(it.prodDate || '未标注') + '</div></div>' +
            '<div><div style="color:#A8A29E;font-size:10.5px;">保质期</div><div style="font-weight:600;color:#44403C;">' + Utils.escapeHtml(shelfText) + '</div></div>' +
            '<div><div style="color:#A8A29E;font-size:10.5px;">过期日期</div><div style="font-weight:700;color:#1C1917;">' + Utils.escapeHtml(it.expDate || '—') + '</div></div>' +
          '</div>' +

          '<div class="progress-track" style="margin-top:8px;">' +
            '<div class="progress-bar" style="width:' + ev.pctRemaining + '%;background:' + barColor + ';"></div>' +
          '</div>' +

          openedBannerHtml +
          (it.notes ? '<div style="margin-top:8px;font-size:12px;color:#57534E;background:#F5F5F4;padding:6px 10px;border-radius:8px;">💬 ' + Utils.escapeHtml(it.notes) + '</div>' : '') +

          '<div style="margin-top:11px;padding-top:10px;border-top:1px solid #F5F5F4;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">' +
              '<div style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;background:#F5F5F4;border:1px solid #E7E5E4;border-radius:10px;padding:5px 9px;min-width:0;">' +
                '<span style="font-size:11px;font-weight:600;color:#78716C;">在库</span>' +
                '<span style="font-size:14px;font-weight:800;color:#1C1917;">' + qtyNum + ' ' + unitStr + '</span>' +
                (Number(it.eatenCount) > 0
                  ? '<span style="font-size:10.5px;font-weight:700;color:#15803D;background:#DCFCE7;padding:1px 6px;border-radius:6px;">已用' + Number(it.eatenCount) + unitStr + '</span>'
                  : ''
                ) +
                (it.isOpened && qtyNum > 0
                  ? '<span style="font-size:10.5px;font-weight:700;color:#EA580C;background:#FFEDD5;padding:1px 6px;border-radius:6px;">拆封中</span>'
                  : ''
                ) +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
                '<button type="button" data-action="item-history" data-id="' + Utils.escapeHtml(it.id) + '" title="查看该批次库存操作流水" style="padding:6px 8px;border-radius:10px;border:1px solid #E7E5E4;background:#FAFAF9;color:#57534E;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">📜 流水</button>' +
                '<button type="button" data-action="log-feed" data-id="' + Utils.escapeHtml(it.id) + '" style="padding:6px 11px;border-radius:10px;border:1px solid #FED7AA;background:#FFF7ED;color:#EA580C;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">' + feedBtnLabel + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="edit-only grid-safe" style="margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">' +
              '<button type="button" data-action="toggle-open" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #E7E5E4;background:' + (it.isOpened ? '#FFEDD5' : '#FAFAF9') + ';color:' + (it.isOpened ? '#9A3412' : '#57534E') + ';font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">' +
                (it.isOpened ? ('🔓 已拆1' + unitStr) : (qtyNum > 1 ? ('🔒 拆1' + unitStr) : '🔒 记开封')) +
              '</button>' +
              '<button type="button" data-action="consume-one" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #DCFCE7;background:#F0FDF4;color:#15803D;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">' +
                (qtyNum > 1 ? ('✓ 用完1' + unitStr) : '✓ 记吃完') +
              '</button>' +
              '<button type="button" data-action="edit" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">✏️ 编辑</button>' +
              '<button type="button" data-action="delete" data-id="' + Utils.escapeHtml(it.id) + '" style="height:34px;padding:0 4px;border-radius:9px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;">🗑️ 删除</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  };

  // ==================== DAILY FEEDING LOG & 1-TAP QUICK FEED BAR ====================
  UI.renderDailyView = function () {
    var st = MP.state;
    var selDate = st.selectedLogDate || Utils.getTodayStr();
    var picker = document.getElementById('dailyDatePicker');
    if (picker && picker.value !== selDate) {
      picker.value = selDate;
    }
    UI.syncAllDateDisplays();

    var diff = Utils.diffDaysFromToday(selDate);
    var relTag = diff === 0 ? '（今天）' : (diff === -1 ? '（昨天）' : (diff === 1 ? '（明天）' : ''));
    document.getElementById('dailyDateLabel').textContent =
      selDate + ' ' + Utils.getWeekdayName(selDate) + relTag;

    // Render Quick-Feed Shortcuts (Opened cans/bags & recently fed active food/supplements)
    var qfBox = document.getElementById('dailyQuickFeedBox');
    if (qfBox) {
      var activeCandidates = st.items.filter(function (it) {
        return (Number(it.quantity) || 0) > 0 && Domain.evaluateItem(it).status !== 'expired';
      });
      activeCandidates.sort(function (a, b) {
        // Prioritize opened fractional cans first, then opened bags/bottles, then food over med
        var aScore = (a.isOpened && a.openRemainFraction > 0 ? 100 : (a.isOpened ? 60 : 0)) + (MP.isFoodCategory(a.category) ? 20 : 0);
        var bScore = (b.isOpened && b.openRemainFraction > 0 ? 100 : (b.isOpened ? 60 : 0)) + (MP.isFoodCategory(b.category) ? 20 : 0);
        return bScore - aScore || Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays;
      });
      var quickTop = activeCandidates.slice(0, 5);
      if (quickTop.length === 0) {
        qfBox.classList.add('hidden-view');
      } else {
        qfBox.classList.remove('hidden-view');
        qfBox.innerHTML =
          '<div style="font-size:11px;font-weight:700;color:#78716C;margin-bottom:6px;">⚡ 常喂快捷点选（优先展示已拆封在吃口粮，点一下即填好）：</div>' +
          '<div class="no-scrollbar" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;">' +
            quickTop.map(function (it) {
              var ci = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
              var remNote = (it.isOpened && it.openRemainFraction > 0)
                ? (' · ' + Utils.formatRemainFractionText(it.openRemainFraction, it.unit))
                : (it.isOpened ? ' · 拆封中' : '');
              return (
                '<button type="button" data-quick-feed-item="' + Utils.escapeHtml(it.id) + '" style="white-space:nowrap;padding:5px 10px;border-radius:999px;border:1px solid ' + (it.isOpened ? '#FDBA74' : '#E7E5E4') + ';background:' + (it.isOpened ? '#FFF7ED' : '#FAFAF9') + ';color:' + (it.isOpened ? '#9A3412' : '#44403C') + ';font-size:11.5px;font-weight:700;cursor:pointer;">' +
                  ci.icon + ' ' + Utils.escapeHtml(it.brand) + '·' + Utils.escapeHtml(it.name.slice(0, 8)) + Utils.escapeHtml(remNote) +
                '</button>'
              );
            }).join('') +
          '</div>';
      }
    }

    var dayLogs = st.logs.filter(function (lg) { return lg.date === selDate; });
    var dayFoodCount = dayLogs.filter(function (lg) { return MP.getCategoryGroup(lg.category) === 'food'; }).length;
    var dayCareCount = dayLogs.length - dayFoodCount;
    document.getElementById('dailyTotalCountBadge').textContent =
      '饮食 ' + dayFoodCount + ' 顿' + (dayCareCount > 0 ? (' · 营养/药护 ' + dayCareCount + ' 次') : '');

    var catCounts = {};
    dayLogs.forEach(function (lg) {
      var c = lg.category || 'dry';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    var summaryEl = document.getElementById('dailySummaryBar');
    var catKeys = Object.keys(MP.CATEGORIES).filter(function (k) { return catCounts[k] > 0; });
    if (catKeys.length === 0) {
      summaryEl.innerHTML = '<span style="font-size:12px;color:#A8A29E;">当日暂无饮食记录，可点上方快捷口粮或右上角「＋ 记喂食」</span>';
    } else {
      summaryEl.innerHTML = catKeys.map(function (k) {
        var info = MP.CATEGORIES[k] || MP.CATEGORIES.dry;
        var unitW = info.group === 'food' ? '顿' : '次';
        var pillStyle = info.group === 'med'
          ? 'background:#F0FDF4;border:1px solid #BBF7D0;color:#14532D;'
          : (info.group === 'supp' ? 'background:#F0F9FF;border:1px solid #BAE6FD;color:#075985;' : 'background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;');
        return '<span style="' + pillStyle + 'padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;">' + info.icon + ' ' + info.label + ' × ' + catCounts[k] + unitW + '</span>';
      }).join('');
    }

    var timelineEl = document.getElementById('dailyFeedTimeline');
    if (dayLogs.length === 0) {
      timelineEl.innerHTML =
        '<div style="padding:24px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#78716C;font-size:13px;">' +
          '🐾 这天还没有记录主子吃过什么哦' +
        '</div>';
    } else {
      timelineEl.innerHTML = dayLogs.map(function (lg) {
        var catInfo = MP.CATEGORIES[lg.category] || MP.CATEGORIES.dry;
        return (
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:14px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:2px 8px;border-radius:7px;">' + Utils.escapeHtml(lg.mealSlot || '🍽️ 投喂') + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#44403C;background:#E7E5E4;padding:2px 7px;border-radius:7px;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                '<span style="font-size:12px;font-weight:800;color:#15803D;background:#DCFCE7;padding:2px 8px;border-radius:7px;">份量：' + Utils.escapeHtml(lg.amount || '1份') + '</span>' +
              '</div>' +
              '<div style="font-size:14px;font-weight:800;color:#1C1917;">[' + Utils.escapeHtml(lg.brand) + '] ' + Utils.escapeHtml(lg.name) + '</div>' +
              (lg.note ? '<div style="margin-top:3px;font-size:12px;color:#57534E;">💬 ' + Utils.escapeHtml(lg.note) + '</div>' : '') +
              (lg.nextDueDate ? '<div style="margin-top:3px;font-size:11px;font-weight:700;color:#15803D;">🩺 下次提醒日：' + Utils.escapeHtml(lg.nextDueDate) + '</div>' : '') +
            '</div>' +
            '<div class="edit-only" style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
              '<button type="button" data-edit-log="' + Utils.escapeHtml(lg.id) + '" style="padding:5px 8px;border-radius:8px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11px;font-weight:700;cursor:pointer;">编辑</button>' +
              '<button type="button" data-del-log="' + Utils.escapeHtml(lg.id) + '" aria-label="删除此条喂食记录" style="padding:5px 8px;border-radius:8px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11px;font-weight:600;cursor:pointer;">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    var sevenHtml = [];
    for (var dOffset = 0; dOffset >= -6; dOffset--) {
      var dStr = Utils.shiftDaysFromToday(dOffset);
      var dLogs = st.logs.filter(function (lg) { return lg.date === dStr; });
      var isSelected = (dStr === selDate);
      var dayTitle = dOffset === 0 ? (dStr + ' (今天)') : (dOffset === -1 ? (dStr + ' (昨天)') : (dStr + ' ' + Utils.getWeekdayName(dStr)));
      var itemsPreview = dLogs.length === 0
        ? '<span style="color:#A8A29E;">未记录</span>'
        : dLogs.map(function (lg) {
            var ci = MP.CATEGORIES[lg.category] || MP.CATEGORIES.dry;
            return ci.icon + Utils.escapeHtml(lg.brand) + '(' + Utils.escapeHtml(lg.amount) + ')';
          }).join(' · ');

      sevenHtml.push(
        '<button type="button" data-jump-date="' + dStr + '" style="width:100%;text-align:left;padding:10px 12px;border-radius:12px;border:1.5px solid ' + (isSelected ? '#EA580C' : '#F5F5F4') + ';background:' + (isSelected ? '#FFF7ED' : '#FAFAF9') + ';cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13px;font-weight:800;color:#1C1917;">' + dayTitle + '</div>' +
            '<div style="font-size:12px;color:#57534E;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + itemsPreview + '</div>' +
          '</div>' +
          '<span style="font-size:12px;font-weight:700;color:' + (dLogs.length > 0 ? '#EA580C' : '#A8A29E') + ';white-space:nowrap;">' + dLogs.length + ' 条 ▶</span>' +
        '</button>'
      );
    }
    document.getElementById('recentSevenDaysList').innerHTML = sevenHtml.join('');

    var isAllMode = (st.dailyViewMode === 'all');
    var modeBtns = document.querySelectorAll('#dailyModeSwitch [data-daily-mode]');
    for (var m = 0; m < modeBtns.length; m++) {
      var mKey = modeBtns[m].getAttribute('data-daily-mode');
      var active = (mKey === st.dailyViewMode);
      modeBtns[m].style.background = active ? '#1C1917' : 'transparent';
      modeBtns[m].style.color = active ? '#FFFFFF' : '#57534E';
    }
    var allBtn = document.getElementById('allDatesModeBtn');
    if (allBtn) allBtn.textContent = '📚 全部日期记录 (' + st.logs.length + ')';

    document.getElementById('singleDayControlsBox').classList.toggle('hidden-view', isAllMode);
    document.getElementById('dailySingleDayView').classList.toggle('hidden-view', isAllMode);
    document.getElementById('allDatesControlsBox').classList.toggle('hidden-view', !isAllMode);
    document.getElementById('dailyAllDatesView').classList.toggle('hidden-view', !isAllMode);
    if (isAllMode) UI.renderAllDatesArchive();
  };

  UI.renderAllDatesArchive = function () {
    var st = MP.state;
    var monthSet = {};
    st.logs.forEach(function (lg) {
      if (lg.date && lg.date.length >= 7) {
        var ym = lg.date.slice(0, 7);
        monthSet[ym] = (monthSet[ym] || 0) + 1;
      }
    });
    var months = Object.keys(monthSet).sort(function (a, b) { return b.localeCompare(a); });
    var monthSel = document.getElementById('logHistoryMonthSelect');
    if (monthSel) {
      if (st.logMonthFilter !== 'all' && !monthSet[st.logMonthFilter]) {
        st.logMonthFilter = 'all';
      }
      var mHtml = '<option value="all">🗓️ 全部月份 (' + st.logs.length + '条)</option>';
      months.forEach(function (ym) {
        var selAttr = (st.logMonthFilter === ym) ? ' selected' : '';
        mHtml += '<option value="' + Utils.escapeHtml(ym) + '"' + selAttr + '>' + Utils.escapeHtml(ym) + ' (' + monthSet[ym] + '条)</option>';
      });
      monthSel.innerHTML = mHtml;
    }

    var q = (st.logSearchQuery || '').trim().toLowerCase();
    var catF = st.logCatFilter || 'all';
    var monthF = st.logMonthFilter || 'all';

    var matched = st.logs.filter(function (lg) {
      if (monthF !== 'all' && String(lg.date || '').slice(0, 7) !== monthF) return false;
      if (catF === 'group_food' && MP.getCategoryGroup(lg.category) !== 'food') return false;
      else if (catF !== 'all' && catF !== 'group_food' && lg.category !== catF) return false;
      if (q) {
        var hay = [lg.date, lg.mealSlot, lg.brand, lg.name, lg.amount, lg.note].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    var byDate = {};
    matched.forEach(function (lg) {
      var d = lg.date || '未知日期';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(lg);
    });

    var sortedDates = Object.keys(byDate).sort(function (a, b) {
      return String(b).localeCompare(String(a));
    });

    document.getElementById('allDatesStatsBadge').textContent =
      '共 ' + sortedDates.length + ' 天 · ' + matched.length + ' 条记录';

    var listEl = document.getElementById('allDatesArchiveList');
    var logPagerEl = document.getElementById('allDatesPaginationBar');
    if (sortedDates.length === 0) {
      if (logPagerEl) logPagerEl.classList.add('hidden-view');
      listEl.innerHTML =
        '<div style="padding:28px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#78716C;font-size:13px;">' +
          '🐾 没有找到匹配的饮食记录' +
        '</div>';
      return;
    }

    var lPageSize = Number(st.logPageSize) || 7;
    var lTotalPages = Math.max(1, Math.ceil(sortedDates.length / lPageSize));
    if (st.logPage > lTotalPages) st.logPage = lTotalPages;
    if (st.logPage < 1) st.logPage = 1;
    var pagedDates = sortedDates.slice((st.logPage - 1) * lPageSize, st.logPage * lPageSize);

    if (sortedDates.length > 7 || lTotalPages > 1) {
      logPagerEl.classList.remove('hidden-view');
      document.getElementById('logPageInfoText').textContent =
        '第 ' + st.logPage + ' / ' + lTotalPages + ' 页 (共 ' + sortedDates.length + ' 天)';
      var lpPrev = document.getElementById('prevLogPageBtn');
      var lpNext = document.getElementById('nextLogPageBtn');
      lpPrev.disabled = (st.logPage <= 1);
      lpPrev.style.opacity = st.logPage <= 1 ? '0.45' : '1';
      lpNext.disabled = (st.logPage >= lTotalPages);
      lpNext.style.opacity = st.logPage >= lTotalPages ? '0.45' : '1';
      var lSizeSel = document.getElementById('logPageSizeSelect');
      if (lSizeSel && String(lSizeSel.value) !== String(lPageSize)) {
        lSizeSel.value = String(lPageSize);
      }
    } else {
      logPagerEl.classList.add('hidden-view');
    }

    listEl.innerHTML = pagedDates.map(function (dStr) {
      var items = byDate[dStr];
      var diff = Utils.diffDaysFromToday(dStr);
      var rel = diff === 0 ? ' (今天)' : (diff === -1 ? ' (昨天)' : '');
      var dayHeader = dStr + ' ' + Utils.getWeekdayName(dStr) + rel;

      var rowsHtml = items.map(function (lg) {
        var catInfo = MP.CATEGORIES[lg.category] || MP.CATEGORIES.dry;
        return (
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:10px;background:#FFFFFF;border:1px solid #E7E5E4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 7px;border-radius:6px;">' + Utils.escapeHtml(lg.mealSlot || '🍽️ 投喂') + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#44403C;background:#F5F5F4;padding:1px 6px;border-radius:6px;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                '<span style="font-size:11px;font-weight:800;color:#15803D;background:#DCFCE7;padding:1px 7px;border-radius:6px;">' + Utils.escapeHtml(lg.amount || '1份') + '</span>' +
              '</div>' +
              '<div style="font-size:13px;font-weight:800;color:#1C1917;">[' + Utils.escapeHtml(lg.brand) + '] ' + Utils.escapeHtml(lg.name) + '</div>' +
              (lg.note ? '<div style="margin-top:2px;font-size:11.5px;color:#57534E;">💬 ' + Utils.escapeHtml(lg.note) + '</div>' : '') +
              (lg.nextDueDate ? '<div style="margin-top:2px;font-size:11px;font-weight:700;color:#15803D;">🩺 下次提醒：' + Utils.escapeHtml(lg.nextDueDate) + '</div>' : '') +
            '</div>' +
            '<div class="edit-only" style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
              '<button type="button" data-edit-log="' + Utils.escapeHtml(lg.id) + '" style="padding:4px 7px;border-radius:7px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11px;font-weight:700;cursor:pointer;">编辑</button>' +
              '<button type="button" data-del-log="' + Utils.escapeHtml(lg.id) + '" style="padding:4px 7px;border-radius:7px;border:1px solid #FEE2E2;background:#FEF2F2;color:#DC2626;font-size:11px;font-weight:600;cursor:pointer;">删除</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      return (
        '<div style="padding:12px;border-radius:14px;background:#FAFAF9;border:1px solid #E7E5E4;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
            '<button type="button" data-jump-date="' + Utils.escapeHtml(dStr) + '" style="background:none;border:none;padding:0;font-size:14px;font-weight:800;color:#1C1917;cursor:pointer;text-align:left;">📅 ' + Utils.escapeHtml(dayHeader) + '</button>' +
            '<span style="font-size:11px;font-weight:700;color:#78716C;">共 ' + items.length + ' 条</span>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:7px;">' + rowsHtml + '</div>' +
        '</div>'
      );
    }).join('');
  };

  // ==================== QUICK FEED MODAL (FIXED READ-ONLY DEDUCT VISIBILITY + PORTION MEMORY) ====================
  UI.populateFeedStockDropdown = function (selectedItemId) {
    var sel = document.getElementById('feedStockSelect');
    var active = MP.state.items.filter(function (it) { return (Number(it.quantity) || 0) > 0; });
    var html = '<option value="">-- 手动填写或从下方在库商品中选择 --</option>';
    active.forEach(function (it) {
      var ci = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
      var remSuffix = (it.isOpened && it.openRemainFraction > 0) ? (' · ' + Utils.formatRemainFractionText(it.openRemainFraction, it.unit)) : '';
      var isSel = (selectedItemId && it.id === selectedItemId) ? ' selected' : '';
      html += '<option value="' + Utils.escapeHtml(it.id) + '"' + isSel + '>' + ci.icon + ' [' + Utils.escapeHtml(it.brand) + '] ' + Utils.escapeHtml(it.name) + ' (余' + Number(it.quantity) + Utils.escapeHtml(it.unit || '') + remSuffix + ')</option>';
    });
    sel.innerHTML = html;
  };

  UI.syncMedReminderVisibility = function () {
    var cat = document.getElementById('feedCategorySelect').value;
    var slot = document.getElementById('feedMealSlot').value;
    var box = document.getElementById('medNextReminderBox');
    box.classList.toggle('hidden-view', !(cat === 'med' || slot === '🩺 用药/护理'));
  };

  // CRITICAL BUG FIX: Always keep `#feedDeductBox` visible when adding a new feeding log (even in read-only mode!)
  // Only hide `#feedDeductBox` when editing an existing historical log (`#feedLogEditId` non-empty) to prevent double-deduction!
  UI.syncFeedSplitCanUI = function (target, chosenFrac) {
    var fracInput = document.getElementById('feedUnitFraction');
    var hintTag = document.getElementById('feedSplitHintTag');
    var finishRestChip = document.getElementById('chipFinishRestCan');
    var splitAutoInfo = document.getElementById('feedSplitAutoInfo');
    var manualDeductWrap = document.getElementById('feedManualDeductLabelWrap');
    var deductBox = document.getElementById('feedDeductBox');
    var isEditingLog = Boolean(document.getElementById('feedLogEditId').value);

    var frac = Number(chosenFrac) || 0;
    fracInput.value = String(frac);

    if (isEditingLog) {
      deductBox.classList.add('hidden-view');
      return;
    }

    if (!target) {
      hintTag.textContent = '';
      finishRestChip.classList.add('hidden-view');
      splitAutoInfo.classList.add('hidden-view');
      deductBox.classList.add('hidden-view');
      return;
    }

    deductBox.classList.remove('hidden-view');
    var u = target.unit || '罐';
    var curRemFrac = (target.isOpened && Number(target.openRemainFraction) > 0 && Number(target.openRemainFraction) < 0.98)
      ? Number(target.openRemainFraction)
      : 0;

    if (curRemFrac > 0) {
      var remLabel = Utils.formatRemainFractionText(curRemFrac, u);
      hintTag.textContent = '🔓 当前已拆1' + u + '（' + remLabel + '）';
      finishRestChip.classList.remove('hidden-view');
      finishRestChip.textContent = '✨ 吃完本' + u + '剩余 (' + remLabel.replace(/^余/, '') + ')';
    } else {
      hintTag.textContent = target.category === 'can' ? '💡 分顿吃可点下方 1/2罐 或 1/3罐 自动记余量' : '';
      finishRestChip.classList.add('hidden-view');
    }

    if (frac > 0 && (target.category === 'can' || Domain.isSingleServingUnit(target))) {
      var startRem = curRemFrac > 0 ? curRemFrac : 1.0;
      var afterRem = Utils.round2(startRem - frac);
      splitAutoInfo.classList.remove('hidden-view');
      manualDeductWrap.style.display = 'none';
      document.getElementById('feedDeductStock').checked = false;
      if (afterRem <= 0.08) {
        splitAutoInfo.innerHTML = curRemFrac > 0
          ? ('✅ <strong>本' + u + '刚好全部吃完！</strong>保存后将自动核销这 1 ' + u + '并归入【已吃完】，其余未拆库存不受影响。')
          : ('✅ <strong>整' + u + '核销：</strong>保存后将自动从库存扣减 1 ' + u + '并归入【已吃完】。');
      } else {
        var afterTxt = Utils.formatRemainFractionText(afterRem, u);
        splitAutoInfo.innerHTML = '🔓 <strong>分顿自动追踪：</strong>保存后这 1 ' + u + '将标为【拆封中 · ' + afterTxt + '】（暂不扣整' + u + '，下次吃完剩余时自动核销）。';
      }
    } else {
      splitAutoInfo.classList.add('hidden-view');
      manualDeductWrap.style.display = 'flex';
    }
  };

  UI.inferFractionFromAmountStr = function (val) {
    if (!val) return 0;
    if (/半|1\/2|0\.5/.test(val)) return 0.5;
    if (/1\/3/.test(val)) return 0.34;
    if (/2\/3/.test(val)) return 0.67;
    if (/1\/4/.test(val)) return 0.25;
    if (/3\/4/.test(val)) return 0.75;
    if (/^1(整)?(罐|支|粒)/.test(val)) return 1;
    return 0;
  };

  UI.applyFeedStockSelection = function (itemId) {
    var target = MP.state.items.find(function (it) { return it.id === itemId; }) || null;
    document.getElementById('feedItemId').value = target ? target.id : '';
    var lastPortionChip = document.getElementById('chipLastPortion');

    if (target) {
      document.getElementById('feedCategorySelect').value = target.category || 'dry';
      if (!document.getElementById('feedLogEditId').value) {
        if (target.category === 'med') {
          document.getElementById('feedMealSlot').value = '🩺 用药/护理';
        } else if (target.category === 'treat' || target.category === 'freeze') {
          document.getElementById('feedMealSlot').value = '🍪 加餐/零食';
        }
      }
      document.getElementById('feedBrandInput').value = target.brand || '';
      document.getElementById('feedNameInput').value = target.name || '';

      var lastFed = Domain.getLastFedInfoForItem(target);
      if (lastPortionChip) {
        if (lastFed && lastFed.amount) {
          lastPortionChip.classList.remove('hidden-view');
          lastPortionChip.setAttribute('data-portion', lastFed.amount);
          lastPortionChip.setAttribute('data-frac', String(UI.inferFractionFromAmountStr(lastFed.amount)));
          lastPortionChip.textContent = '⚡ 上次：' + lastFed.amount;
        } else {
          lastPortionChip.classList.add('hidden-view');
        }
      }

      var defaultPortion = '40g';
      var defaultFrac = 0;
      var curRemFrac = (target.isOpened && Number(target.openRemainFraction) > 0 && Number(target.openRemainFraction) < 0.98)
        ? Number(target.openRemainFraction)
        : 0;

      if (target.category === 'can') {
        if (curRemFrac > 0) {
          var rTxt = Utils.formatRemainFractionText(curRemFrac, target.unit || '罐').replace(/^余/, '');
          defaultPortion = Utils.computePortionGramLabel(rTxt, curRemFrac, target.spec);
          defaultFrac = curRemFrac;
        } else if (lastFed && lastFed.amount) {
          defaultPortion = lastFed.amount;
          defaultFrac = UI.inferFractionFromAmountStr(lastFed.amount) || 0.5;
        } else {
          defaultPortion = Utils.computePortionGramLabel('半罐', 0.5, target.spec);
          defaultFrac = 0.5;
        }
      } else if (lastFed && lastFed.amount) {
        defaultPortion = lastFed.amount;
        defaultFrac = UI.inferFractionFromAmountStr(lastFed.amount);
      } else if (target.category === 'freeze') {
        defaultPortion = '15g';
      } else if (target.category === 'treat') {
        defaultPortion = '1支';
        defaultFrac = (target.unit === '支') ? 1 : 0;
      } else if (target.category === 'supp') {
        defaultPortion = '1份 / 5cm';
      } else if (target.category === 'med') {
        defaultPortion = '1' + (target.unit || '支');
        defaultFrac = 1;
      }

      document.getElementById('feedAmountInput').value = defaultPortion;
      document.getElementById('feedDeductLabel').textContent =
        '📦 这袋/瓶刚好空了？同时扣减 1 ' + (target.unit || '件') + '库存（余 ' + Number(target.quantity) + (target.unit || '件') + '）';
      UI.syncFeedSplitCanUI(target, defaultFrac);
    } else {
      if (lastPortionChip) lastPortionChip.classList.add('hidden-view');
      UI.syncFeedSplitCanUI(null, 0);
    }
  };

  UI.openFeedModal = function (itemId, customDate) {
    document.getElementById('feedModalTitle').textContent = '🐾 记录饮食 / 营养 / 用药';
    document.getElementById('feedLogEditId').value = '';
    var dateToUse = customDate || (MP.state.activeTab === 'daily' ? MP.state.selectedLogDate : Utils.getTodayStr());
    document.getElementById('feedDateInput').value = dateToUse;
    document.getElementById('feedMealSlot').value = Utils.getCurrentMealSlot();
    document.getElementById('feedDeductStock').checked = false;
    document.getElementById('feedNextReminderDays').value = '0';
    document.getElementById('feedNoteInput').value = '';
    UI.populateFeedStockDropdown(itemId || '');

    if (itemId) {
      UI.applyFeedStockSelection(itemId);
    } else {
      var firstOpened = MP.state.items.find(function (it) { return (Number(it.quantity) || 0) > 0 && it.isOpened; });
      var firstActive = firstOpened || MP.state.items.find(function (it) { return (Number(it.quantity) || 0) > 0; });
      if (firstActive) {
        document.getElementById('feedStockSelect').value = firstActive.id;
        UI.applyFeedStockSelection(firstActive.id);
      } else {
        document.getElementById('feedItemId').value = '';
        document.getElementById('feedBrandInput').value = '';
        document.getElementById('feedNameInput').value = '';
        document.getElementById('feedAmountInput').value = '40g';
        UI.syncFeedSplitCanUI(null, 0);
      }
    }
    UI.syncMedReminderVisibility();
    UI.syncAllDateDisplays();
    document.getElementById('feedModalBackdrop').classList.remove('hidden-view');
  };

  UI.openEditFeedModal = function (logId) {
    var lg = MP.state.logs.find(function (x) { return x.id === logId; });
    if (!lg) return;
    document.getElementById('feedModalTitle').textContent = '✏️ 编辑饮食记录';
    document.getElementById('feedLogEditId').value = lg.id;
    document.getElementById('feedDateInput').value = lg.date || Utils.getTodayStr();
    document.getElementById('feedMealSlot').value = lg.mealSlot || '🌅 早饭';
    UI.populateFeedStockDropdown(lg.itemId || '');
    document.getElementById('feedItemId').value = lg.itemId || '';
    document.getElementById('feedCategorySelect').value = lg.category || 'dry';
    document.getElementById('feedBrandInput').value = lg.brand || '';
    document.getElementById('feedNameInput').value = lg.name || '';
    document.getElementById('feedAmountInput').value = lg.amount || '';
    document.getElementById('feedNoteInput').value = lg.note || '';
    document.getElementById('feedNextReminderDays').value = String(lg.reminderDays || 0);
    document.getElementById('feedDeductStock').checked = false;
    document.getElementById('feedDeductBox').classList.add('hidden-view');
    UI.syncMedReminderVisibility();
    UI.syncAllDateDisplays();
    document.getElementById('feedModalBackdrop').classList.remove('hidden-view');
  };

  UI.closeFeedModal = function () {
    document.getElementById('feedModalBackdrop').classList.add('hidden-view');
  };

  // ==================== STOCK OPERATION HISTORY MODAL ====================
  UI.openStockHistoryModal = function (filterItemId) {
    var st = MP.state;
    st.historyItemFilter = filterItemId || '';
    st.historyTypeFilter = 'all';
    st.historyPage = 1;
    var searchInp = document.getElementById('historySearchInput');
    if (searchInp) searchInp.value = '';
    st.historySearchQuery = '';
    UI.renderStockHistoryModal();
    document.getElementById('historyModalBackdrop').classList.remove('hidden-view');
  };

  UI.closeStockHistoryModal = function () {
    document.getElementById('historyModalBackdrop').classList.add('hidden-view');
  };

  UI.renderStockHistoryModal = function () {
    var st = MP.state;
    var titleEl = document.getElementById('historyModalTitle');
    var clearItemBtn = document.getElementById('clearHistoryItemFilterBtn');

    if (st.historyItemFilter) {
      var refItem = st.items.find(function (x) { return x.id === st.historyItemFilter || x.sourceBatchId === st.historyItemFilter; });
      titleEl.textContent = refItem ? ('📜 流水 · ' + refItem.brand + ' ' + refItem.name) : '📜 单品库存操作流水';
      if (clearItemBtn) clearItemBtn.classList.remove('hidden-view');
    } else {
      titleEl.textContent = '📜 库存操作历史流水';
      if (clearItemBtn) clearItemBtn.classList.add('hidden-view');
    }

    var tBtns = document.querySelectorAll('#historyTypeFilterBar [data-hist-type]');
    for (var i = 0; i < tBtns.length; i++) {
      var tk = tBtns[i].getAttribute('data-hist-type');
      tBtns[i].classList.toggle('active', tk === st.historyTypeFilter);
    }

    var q = (st.historySearchQuery || '').trim().toLowerCase();
    var matched = st.stockHistory.filter(function (h) {
      if (st.historyItemFilter && h.itemId !== st.historyItemFilter) return false;
      if (st.historyTypeFilter !== 'all') {
        var meta = MP.STOCK_ACTION_META[h.action] || MP.STOCK_ACTION_META.adjust;
        if (meta.group !== st.historyTypeFilter) return false;
      }
      if (q) {
        var hay = [h.brand, h.name, h.note, h.deltaText, h.timestamp].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    var listEl = document.getElementById('stockHistoryList');
    var pagerEl = document.getElementById('historyPaginationBar');
    document.getElementById('historyCountBadge').textContent = '共 ' + matched.length + ' 条记录';

    if (matched.length === 0) {
      if (pagerEl) pagerEl.classList.add('hidden-view');
      listEl.innerHTML =
        '<div style="padding:28px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#78716C;font-size:13px;">' +
          '📭 暂无匹配的库存变动流水（后续入库、拆封、分顿投喂、核销吃完或撤回退库都会自动记录在这里）' +
        '</div>';
      return;
    }

    var hSize = Number(st.historyPageSize) || 15;
    var hPages = Math.max(1, Math.ceil(matched.length / hSize));
    if (st.historyPage > hPages) st.historyPage = hPages;
    if (st.historyPage < 1) st.historyPage = 1;
    var sliced = matched.slice((st.historyPage - 1) * hSize, st.historyPage * hSize);

    if (hPages > 1) {
      pagerEl.classList.remove('hidden-view');
      document.getElementById('historyPageInfo').textContent = '第 ' + st.historyPage + ' / ' + hPages + ' 页';
      document.getElementById('prevHistoryPageBtn').disabled = (st.historyPage <= 1);
      document.getElementById('nextHistoryPageBtn').disabled = (st.historyPage >= hPages);
    } else {
      pagerEl.classList.add('hidden-view');
    }

    listEl.innerHTML = sliced.map(function (h) {
      var meta = MP.STOCK_ACTION_META[h.action] || MP.STOCK_ACTION_META.adjust;
      var ci = MP.CATEGORIES[h.category] || MP.CATEGORIES.dry;
      return (
        '<div style="padding:10px 12px;border-radius:12px;background:#FAFAF9;border:1px solid #E7E5E4;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
              '<span style="font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:6px;background:' + meta.bg + ';color:' + meta.text + ';">' + meta.icon + ' ' + meta.label + '</span>' +
              '<span style="font-size:11px;color:#78716C;">' + Utils.escapeHtml(h.timestamp) + '</span>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:800;color:#1C1917;">' + ci.icon + ' [' + Utils.escapeHtml(h.brand) + '] ' + Utils.escapeHtml(h.name) + '</div>' +
            (h.note ? '<div style="margin-top:2px;font-size:11.5px;color:#57534E;">' + Utils.escapeHtml(h.note) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="font-size:12.5px;font-weight:800;color:' + meta.text + ';">' + Utils.escapeHtml(h.deltaText || '—') + '</div>' +
            '<div style="margin-top:2px;font-size:10.5px;color:#78716C;">' + h.beforeQty + ' → ' + h.afterQty + Utils.escapeHtml(h.unit) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  };

  // ==================== ITEM ADD / EDIT / RESTOCK MODAL ====================
  UI.renderQuickLocationChips = function () {
    var existing = {};
    var merged = [];
    MP.state.items.forEach(function (it) {
      if (it.location && it.location.trim() && !existing[it.location.trim()]) {
        existing[it.location.trim()] = true;
        merged.push(it.location.trim());
      }
    });
    MP.COMMON_LOCATIONS.forEach(function (loc) {
      if (!existing[loc]) {
        existing[loc] = true;
        merged.push(loc);
      }
    });
    var box = document.getElementById('quickLocationChips');
    if (!box) return;
    box.innerHTML = merged.slice(0, 8).map(function (loc) {
      return '<button type="button" data-pick-location="' + Utils.escapeHtml(loc) + '" style="white-space:nowrap;padding:3px 8px;border-radius:999px;border:1px solid #E7E5E4;background:#FAFAF9;color:#57534E;font-size:11px;cursor:pointer;">📍 ' + Utils.escapeHtml(loc) + '</button>';
    }).join('');
  };

  UI.renderQuickBrandChips = function () {
    UI.renderQuickLocationChips();
    var existing = {};
    var merged = [];
    MP.state.items.forEach(function (it) {
      if (it.brand && it.brand.trim() && !existing[it.brand.trim()]) {
        existing[it.brand.trim()] = true;
        merged.push(it.brand.trim());
      }
    });
    MP.COMMON_BRANDS.forEach(function (b) {
      if (!existing[b]) {
        existing[b] = true;
        merged.push(b);
      }
    });
    var box = document.getElementById('quickBrandChips');
    box.innerHTML = merged.slice(0, 10).map(function (b) {
      return '<button type="button" data-pick-brand="' + Utils.escapeHtml(b) + '" style="white-space:nowrap;padding:4px 9px;border-radius:999px;border:1px solid #E7E5E4;background:#FAFAF9;color:#57534E;font-size:11px;cursor:pointer;">' + Utils.escapeHtml(b) + '</button>';
    }).join('');
  };

  UI.syncModalPhotoUI = function (kbHint) {
    var st = MP.state;
    var previewEl = document.getElementById('formPhotoPreview');
    var badgeEl = document.getElementById('formPhotoBadge');
    var clearBtn = document.getElementById('clearPhotoBtn');
    var hintEl = document.getElementById('photoCompressHint');
    var covers = MP.COVERS || {};
    if (st.formImage) {
      previewEl.src = st.formImage;
      badgeEl.textContent = '实拍图';
      badgeEl.style.background = '#EA580C';
      clearBtn.classList.remove('hidden-view');
      hintEl.textContent = kbHint
        ? ('已自动压缩至约 ' + kbHint + ' KB，存入本地数据库')
        : '已绑定自定义实拍图（可随时重拍或恢复默认插画）';
    } else {
      previewEl.src = covers[st.formCat] || covers.dry || '';
      badgeEl.textContent = '默认插画';
      badgeEl.style.background = '#44403C';
      clearBtn.classList.add('hidden-view');
      hintEl.textContent = '不传图自动配分类插画；实拍会自动压缩至约 25KB 省空间';
    }
  };

  // Distinct palatability/tolerance labels for Ordinary Food vs Supplements vs Medicine!
  UI.syncModalCategoryUI = function (catKey, applyDefaults) {
    var st = MP.state;
    st.formCat = catKey;
    var catInfo = MP.CATEGORIES[catKey] || MP.CATEGORIES.dry;
    var btns = document.querySelectorAll('#modalCatSelector [data-form-cat]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-form-cat') === catKey);
    }
    if (applyDefaults) {
      document.getElementById('fieldUnit').value = catInfo.defaultUnit;
      document.getElementById('fieldOpenLimit').value = String(catInfo.defaultOpenDays);
      if (!document.getElementById('fieldShelfValue').value) {
        document.getElementById('fieldShelfValue').value = String(catInfo.defaultShelfMonths);
        document.getElementById('fieldShelfUnit').value = 'months';
      }
    }
    UI.syncModalPhotoUI();

    var palTitle = document.getElementById('palatabilityFieldTitle');
    var bLove = document.getElementById('palBtnLove');
    var bOk = document.getElementById('palBtnOk');
    var bCoax = document.getElementById('palBtnCoax');
    var bMeh = document.getElementById('palBtnMeh');
    if (catKey === 'med') {
      if (palTitle) palTitle.textContent = '🩺 给药反应与耐受度记录（选填）';
      if (bLove) bLove.textContent = '✅ 无异常';
      if (bOk) bOk.textContent = '💊 好喂';
      if (bCoax) bCoax.textContent = '💦 抗拒';
      if (bMeh) bMeh.textContent = '⚠️ 不适';
    } else if (catKey === 'supp') {
      if (palTitle) palTitle.textContent = '💊 营养品接受度反馈（选填）';
      if (bLove) bLove.textContent = '💊 主动吃';
      if (bOk) bOk.textContent = '😋 拌粮吃';
      if (bCoax) bCoax.textContent = '🥺 需哄喂';
      if (bMeh) bMeh.textContent = '😒 拒食';
    } else {
      if (palTitle) palTitle.textContent = '🐾 猫咪适口性记录（4档选填）';
      if (bLove) bLove.textContent = '😍 超爱';
      if (bOk) bOk.textContent = '😋 正常';
      if (bCoax) bCoax.textContent = '🥺 需哄';
      if (bMeh) bMeh.textContent = '😒 不吃';
    }
    UI.syncModalUnitPriceHint();
  };

  UI.syncModalCurrencyUI = function (curCode) {
    var cur = curCode === 'JPY' ? 'JPY' : 'CNY';
    MP.state.formCurrency = cur;
    var prefixEl = document.getElementById('pricePrefixSymbol');
    var priceInput = document.getElementById('fieldPrice');
    if (cur === 'JPY') {
      prefixEl.textContent = 'JP¥';
      priceInput.step = '1';
      priceInput.placeholder = '380';
    } else {
      prefixEl.textContent = 'CN¥';
      priceInput.step = '0.01';
      priceInput.placeholder = '0.00';
    }
    var btns = document.querySelectorAll('#currencyToggleGroup [data-form-currency]');
    for (var i = 0; i < btns.length; i++) {
      var active = btns[i].getAttribute('data-form-currency') === cur;
      btns[i].style.background = active ? '#1C1917' : 'transparent';
      btns[i].style.color = active ? '#FFFFFF' : '#57534E';
    }
    UI.syncModalUnitPriceHint();
  };

  UI.syncModalUnitPriceHint = function () {
    var hintEl = document.getElementById('modalUnitPriceHint');
    if (!hintEl) return;
    if (!MP.isFoodCategory(MP.state.formCat)) {
      hintEl.textContent = '';
      return;
    }
    var pVal = document.getElementById('fieldPrice').value;
    var sVal = document.getElementById('fieldSpec').value;
    var txt = Utils.formatPer100gPrice(pVal, MP.state.formCurrency, sVal);
    hintEl.textContent = txt ? ('· ' + txt) : '';
  };

  UI.syncModalPalatabilityUI = function (palKey) {
    MP.state.formPal = palKey || '';
    var btns = document.querySelectorAll('#palatabilityGroup [data-pal]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-pal') === MP.state.formPal);
    }
  };

  UI.syncOpenedFieldsVisibility = function () {
    var qtyVal = Number(document.getElementById('fieldQty').value);
    var isEditingFinished = Boolean(document.getElementById('fieldId').value) && qtyVal <= 0;
    var checked = document.getElementById('fieldIsOpened').checked;
    var box = document.getElementById('openedExtraFields');
    var titleEl = document.getElementById('openedCheckboxTitle');
    var chkEl = document.getElementById('fieldIsOpened');
    var limitCol = document.getElementById('openLimitColWrap');
    var finCol = document.getElementById('finishedDateColWrap');

    if (isEditingFinished) {
      titleEl.textContent = '📦 历史批次开封日与用完日（自动算消耗天数）';
      chkEl.classList.add('hidden-view');
      box.classList.remove('hidden-view');
      limitCol.classList.add('hidden-view');
      finCol.classList.remove('hidden-view');
      if (!document.getElementById('fieldFinishedDate').value) {
        document.getElementById('fieldFinishedDate').value = Utils.getTodayStr();
      }
      UI.syncAllDateDisplays();
      return;
    }

    titleEl.textContent = '🔓 当前有 1 件已拆封（单独计算开封保鲜期）';
    chkEl.classList.remove('hidden-view');
    limitCol.classList.remove('hidden-view');
    finCol.classList.add('hidden-view');

    if (checked) {
      box.classList.remove('hidden-view');
      if (!document.getElementById('fieldOpenedDate').value) {
        document.getElementById('fieldOpenedDate').value = Utils.getTodayStr();
      }
      UI.syncAllDateDisplays();
    } else {
      box.classList.add('hidden-view');
    }
  };

  UI.autoComputeExpDate = function () {
    var prod = document.getElementById('fieldProdDate').value;
    var val = document.getElementById('fieldShelfValue').value;
    var unit = document.getElementById('fieldShelfUnit').value;
    if (prod && val) {
      var computed = Utils.addShelfLife(prod, val, unit);
      if (computed) {
        document.getElementById('fieldExpDate').value = computed;
        document.getElementById('dateCalcHint').textContent = '已由生产日+保质期自动算出过期日';
        UI.syncAllDateDisplays();
      }
    }
  };

  UI.openAddModal = function () {
    var st = MP.state;
    document.getElementById('modalTitle').textContent = '录入粮仓商品';
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldBrand').value = '';
    document.getElementById('fieldName').value = '';
    document.getElementById('fieldSpec').value = '';
    document.getElementById('fieldQty').value = '1';
    document.getElementById('fieldPrice').value = '';
    document.getElementById('fieldProdDate').value = Utils.getTodayStr();
    document.getElementById('fieldShelfValue').value = '18';
    document.getElementById('fieldShelfUnit').value = 'months';
    document.getElementById('fieldExpDate').value = Utils.addShelfLife(Utils.getTodayStr(), 18, 'months');
    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldLocation').value = '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = '';
    document.getElementById('dateCalcHint').textContent = '填任意两项自动推算';

    st.formImage = '';
    document.getElementById('fieldPhotoInput').value = '';
    var defaultCat = st.catFilter !== 'all' ? st.catFilter : 'dry';
    UI.syncModalCategoryUI(defaultCat, true);
    UI.autoComputeExpDate();
    UI.syncModalCurrencyUI(st.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    document.getElementById('itemModalBackdrop').classList.remove('hidden-view');
  };

  UI.openEditModal = function (id) {
    var item = MP.state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    document.getElementById('modalTitle').textContent = '编辑商品与批次信息';
    document.getElementById('fieldId').value = item.id;
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('cloneBatchFromEditWrap').classList.remove('hidden-view');
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    document.getElementById('fieldQty').value = String(item.quantity !== undefined ? item.quantity : 1);
    document.getElementById('fieldUnit').value = item.unit || '袋';
    document.getElementById('fieldPrice').value = item.price ? String(item.price) : '';
    document.getElementById('fieldProdDate').value = item.prodDate || '';
    document.getElementById('fieldShelfValue').value = item.shelfLifeValue ? String(item.shelfLifeValue) : '';
    document.getElementById('fieldShelfUnit').value = item.shelfLifeUnit || 'months';
    document.getElementById('fieldExpDate').value = item.expDate || '';
    document.getElementById('fieldIsOpened').checked = Boolean(item.isOpened);
    document.getElementById('fieldOpenedDate').value = item.openedDate || item.archivedOpenedDate || '';
    document.getElementById('fieldFinishedDate').value = item.finishedDate || '';
    document.getElementById('fieldOpenLimit').value = String(item.openDaysLimit || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = item.batchCode || '';
    document.getElementById('fieldNotes').value = item.notes || '';
    document.getElementById('dateCalcHint').textContent = '修改日期或时长可自动重算';

    MP.state.formImage = item.imageData || '';
    document.getElementById('fieldPhotoInput').value = '';
    UI.syncModalCategoryUI(item.category || 'dry', false);
    UI.syncModalCurrencyUI(item.currency || 'CNY');
    UI.syncModalPalatabilityUI(item.palatability || '');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    document.getElementById('itemModalBackdrop').classList.remove('hidden-view');
  };

  UI.openRestockModal = function (item) {
    if (!item) return;
    document.getElementById('modalTitle').textContent = '同款复购入库（新建批次）';
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '1';
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    var defaultNewQty = Number(item.lastQuantity) > 0 ? Number(item.lastQuantity) : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
    document.getElementById('fieldQty').value = String(defaultNewQty);
    document.getElementById('fieldUnit').value = item.unit || '袋';
    document.getElementById('fieldPrice').value = item.price ? String(item.price) : '';

    var sVal = item.shelfLifeValue ? Number(item.shelfLifeValue) : ((MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultShelfMonths || 18);
    var sUnit = item.shelfLifeUnit || 'months';
    var today = Utils.getTodayStr();
    document.getElementById('fieldProdDate').value = today;
    document.getElementById('fieldShelfValue').value = String(sVal);
    document.getElementById('fieldShelfUnit').value = sUnit;
    document.getElementById('fieldExpDate').value = Utils.addShelfLife(today, sVal, sUnit);
    document.getElementById('dateCalcHint').textContent = '⚠️ 已预填同款信息，请核对新批次的生产日期与到期日';

    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldOpenLimit').value = String(item.openDaysLimit || (MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultOpenDays || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = item.notes || '';

    MP.state.formImage = item.imageData || '';
    document.getElementById('fieldPhotoInput').value = '';
    UI.syncModalCategoryUI(item.category || 'dry', false);
    UI.syncModalCurrencyUI(item.currency || MP.state.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI(item.palatability || '');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    document.getElementById('itemModalBackdrop').classList.remove('hidden-view');
    UI.showToast('已带入同款资料，请确认新批次日期与数量');
  };

  UI.closeItemModal = function () {
    document.getElementById('itemModalBackdrop').classList.add('hidden-view');
  };

  UI.openLightbox = function (item) {
    if (!item) return;
    document.getElementById('lightboxTitle').textContent = (item.brand || '') + ' · ' + (item.name || '');
    document.getElementById('lightboxImg').src = MP.getItemCoverSrc(item);
    document.getElementById('lightboxMeta').textContent =
      '生产日：' + (item.prodDate || '未标注') + ' ｜ 过期日：' + (item.expDate || '—') + (item.batchCode ? (' ｜ ' + item.batchCode) : '');
    document.getElementById('photoPreviewBackdrop').classList.remove('hidden-view');
  };

  UI.closeLightbox = function () {
    document.getElementById('photoPreviewBackdrop').classList.add('hidden-view');
  };

  // ==================== SETTINGS & STORAGE HEALTH VIEW ====================
  UI.renderSettingsView = function () {
    var st = MP.state;
    var btns = document.querySelectorAll('#warnDaysGroup [data-warn-days]');
    for (var i = 0; i < btns.length; i++) {
      var d = parseInt(btns[i].getAttribute('data-warn-days'), 10);
      btns[i].className = (d === st.settings.warnDays) ? 'ios-btn ios-btn-primary' : 'ios-btn ios-btn-secondary';
    }
    var curBtns = document.querySelectorAll('#defaultCurrencyGroup [data-def-currency]');
    for (var j = 0; j < curBtns.length; j++) {
      var ck = curBtns[j].getAttribute('data-def-currency');
      curBtns[j].className = (ck === (st.settings.defaultCurrency || 'CNY'))
        ? 'ios-btn ios-btn-primary'
        : 'ios-btn ios-btn-secondary';
    }

    var undoWrap = document.getElementById('undoOverwriteWrap');
    var undoTimeTxt = document.getElementById('undoSnapshotTimeText');
    if (undoWrap) {
      undoWrap.classList.toggle('hidden-view', !st.storageHealth.hasPreRestoreSnapshot);
      if (undoTimeTxt && st.storageHealth.preRestoreSnapshotTime) {
        undoTimeTxt.textContent = '自动保护快照时间：' + st.storageHealth.preRestoreSnapshotTime;
      }
    }

    var activeItemsCount = st.items.filter(function (it) { return !(it.sourceBatchId && (Number(it.quantity) || 0) <= 0); }).length;
    var customPhotos = st.items.filter(function (it) { return Boolean(it.imageData) && !it.sourceBatchId; }).length;
    var hasCustomItems = st.items.some(function (it) { return !it.isSample; }) || st.logs.some(function (lg) { return !lg.isSample; });
    var unsaved = Number(st.settings.unsavedChangesCount) || 0;
    var lastBk = st.settings.lastBackupDate || '';
    var needBackup = (unsaved > 0) || (hasCustomItems && !lastBk);
    var badgeCount = unsaved > 0 ? unsaved : (needBackup ? 1 : 0);

    var dotEl = document.getElementById('backupNoticeDot');
    var topBanner = document.getElementById('unbackedBanner');
    var topBannerTxt = document.getElementById('unbackedBannerText');
    var setBadge = document.getElementById('settingsBackupBadge');

    if (needBackup) {
      if (dotEl) {
        dotEl.textContent = badgeCount > 99 ? '99+' : String(badgeCount);
        dotEl.classList.remove('hidden-view');
      }
      if (topBanner) {
        if (badgeCount >= 5 && st.backupBannerDismissedCount !== badgeCount) {
          topBanner.classList.remove('hidden-view');
          if (topBannerTxt) {
            topBannerTxt.innerHTML = lastBk
              ? ('<strong>备份提醒：</strong>自上次备份 (' + Utils.escapeHtml(lastBk) + ') 后已有 <strong>' + badgeCount + ' 项</strong>改动未备份')
              : ('<strong>备份提醒：</strong>已累计 <strong>' + badgeCount + ' 项</strong>数据变动未导出 JSON 备份');
          }
        } else {
          topBanner.classList.add('hidden-view');
        }
      }
      if (setBadge) {
        setBadge.style.background = '#FEF2F2';
        setBadge.style.color = '#DC2626';
        setBadge.textContent = '⚠️ ' + badgeCount + ' 项改动待备份';
      }
    } else {
      if (dotEl) dotEl.classList.add('hidden-view');
      if (topBanner) topBanner.classList.add('hidden-view');
      if (setBadge) {
        setBadge.style.background = '#DCFCE7';
        setBadge.style.color = '#15803D';
        setBadge.textContent = lastBk ? ('✅ 已备份 (' + lastBk + ')') : '✅ 暂无未备份改动';
      }
    }

    var engineLabel = (st.storageHealth.idbAvailable && st.storageHealth.lsAvailable)
      ? '双引擎同步正常 (IndexedDB + LocalStorage)'
      : (st.storageHealth.lsAvailable ? 'LocalStorage 本地存储正常' : '内存会话模式');

    document.getElementById('storageStatusText').textContent =
      engineLabel + ' · 已存 ' + activeItemsCount + ' 批商品、' + st.logs.length + ' 条饮食记录、' + st.stockHistory.length + ' 条库存流水（含 ' + customPhotos + ' 张实拍图）';
  };
})(typeof window !== 'undefined' ? window : globalThis);
