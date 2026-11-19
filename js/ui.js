/* Meow Pantry UI Renderer: Pantry Cards, Quick-Feed Bar, Daily Log, Modals & Stock Operation History Drawer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats;
  var UI = MP.UI = MP.UI || {};

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

  UI.purchasePackagingLabel = function (pack, unit) {
    return pack.count + pack.outerUnit + '装，' + (pack.outerUnit === unit ? '内包装' : '') +
      '共' + (pack.count * pack.size) + unit;
  };

  UI.flavorStockText = function (item, plain, remainingView) {
    if (!item.flavors) return '';
    return item.flavors.map(function (flavor) {
      var text = flavor.name + ' ' + flavor.quantity + (remainingView ? '' : item.unit);
      if (Number(flavor.quantity) > 0 && flavor.openedDate) {
        var rest = flavor.openRemainFraction;
        var spec = Utils.parsePortionSpec(flavor.spec || item.spec);
        var left = '';
        if (rest) {
          left = spec && Number(spec[1]) > 0 && (!spec[3] || spec[3] === item.unit)
            ? '，约余' + Utils.round2(Number(spec[1]) * rest) + spec[2]
            : '，余' + Utils.round2(rest * 100) + '%';
        }
        text += '（1' + item.unit + '使用中' + left + '）';
      }
      if (plain) return text;
      var escaped = Utils.escapeHtml(text);
      return remainingView && Number(flavor.quantity) <= 0
        ? '<s class="flavor-stock-finished" aria-label="' + Utils.escapeHtml(flavor.name + ' 已吃完') + '">' + escaped + '</s>'
        : escaped;
    }).join(' · ');
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
          '<div style="font-size:11px;font-weight:700;color:#6B5A4C;margin-bottom:6px;">⚡ 常喂快捷点选（优先展示已拆封在吃口粮，点一下即填好）：</div>' +
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
      summaryEl.innerHTML = '<span style="font-size:12px;color:#6B5A4C;">当日暂无饮食记录，可点上方快捷口粮或右上角「＋ 记喂食」</span>';
    } else {
      summaryEl.innerHTML = catKeys.map(function (k) {
        var info = MP.CATEGORIES[k] || MP.CATEGORIES.dry;
        var unitW = info.group === 'food' ? '顿' : '次';
        var pillStyle = info.group === 'med'
          ? 'background:#F0FDF4;border:1px solid #BBF7D0;color:#14532D;'
          : (info.group === 'supp' ? 'background:#EAF2DC;border:1px solid #C5DDBC;color:#3D5A24;' : 'background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;');
        return '<span style="' + pillStyle + 'padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;">' + info.icon + ' ' + info.label + ' × ' + catCounts[k] + unitW + '</span>';
      }).join('');
    }

    var timelineEl = document.getElementById('dailyFeedTimeline');
    if (dayLogs.length === 0) {
      timelineEl.innerHTML =
        '<div style="padding:24px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#6B5A4C;font-size:13px;">' +
          '🐾 这天还没有记录主子吃过什么哦' +
        '</div>';
    } else {
      timelineEl.innerHTML = dayLogs.map(function (lg) {
        var product = Domain.resolveLogProduct(lg);
        var catInfo = MP.CATEGORIES[product.category] || MP.CATEGORIES.dry;
        return (
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:14px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:2px 8px;border-radius:7px;">' + Utils.escapeHtml(lg.mealSlot || '🍽️ 投喂') + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#44403C;background:#E7E5E4;padding:2px 7px;border-radius:7px;">' + catInfo.icon + ' ' + Utils.escapeHtml(catInfo.label + (product.subtype ? ' · ' + product.subtype : '')) + '</span>' +
                '<span style="font-size:12px;font-weight:800;color:#15803D;background:#DCFCE7;padding:2px 8px;border-radius:7px;">份量：' + Utils.escapeHtml(lg.amount || '1份') + '</span>' +
              '</div>' +
              '<div style="font-size:14px;font-weight:800;color:#2B2320;">[' + Utils.escapeHtml(product.brand) + '] ' + Utils.escapeHtml(product.name) + '</div>' +
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
        ? '<span style="color:#6B5A4C;">未记录</span>'
        : dLogs.map(function (lg) {
            var product = Domain.resolveLogProduct(lg);
            var ci = MP.CATEGORIES[product.category] || MP.CATEGORIES.dry;
            return ci.icon + Utils.escapeHtml([product.brand, product.name, product.subtype].filter(Boolean).join(' ')) + '(' + Utils.escapeHtml(lg.amount) + ')';
          }).join(' · ');

      sevenHtml.push(
        '<button type="button" data-jump-date="' + dStr + '" style="width:100%;text-align:left;padding:10px 12px;border-radius:12px;border:1.5px solid ' + (isSelected ? '#E8590C' : '#F5F5F4') + ';background:' + (isSelected ? '#FFF7ED' : '#FAFAF9') + ';cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13px;font-weight:800;color:#2B2320;">' + dayTitle + '</div>' +
            '<div style="font-size:12px;color:#57534E;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + itemsPreview + '</div>' +
          '</div>' +
          '<span style="font-size:12px;font-weight:700;color:' + (dLogs.length > 0 ? '#E8590C' : '#6B5A4C') + ';white-space:nowrap;">' + dLogs.length + ' 条 ▶</span>' +
        '</button>'
      );
    }
    document.getElementById('recentSevenDaysList').innerHTML = sevenHtml.join('');

    var isAllMode = (st.dailyViewMode === 'all');
    var modeBtns = document.querySelectorAll('#dailyModeSwitch [data-daily-mode]');
    for (var m = 0; m < modeBtns.length; m++) {
      var mKey = modeBtns[m].getAttribute('data-daily-mode');
      var active = (mKey === st.dailyViewMode);
      modeBtns[m].style.background = active ? '#2B2320' : 'transparent';
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
        var product = Domain.resolveLogProduct(lg);
        var hay = [lg.date, lg.mealSlot, product.brand, product.name, (MP.CATEGORIES[product.category] || MP.CATEGORIES.dry).label, product.subtype, lg.amount, lg.note].join(' ').toLowerCase();
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
        '<div style="padding:28px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#6B5A4C;font-size:13px;">' +
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
        var product = Domain.resolveLogProduct(lg);
        var catInfo = MP.CATEGORIES[product.category] || MP.CATEGORIES.dry;
        return (
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:10px;background:#FFFFFF;border:1px solid #E7E5E4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 7px;border-radius:6px;">' + Utils.escapeHtml(lg.mealSlot || '🍽️ 投喂') + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#44403C;background:#F5F5F4;padding:1px 6px;border-radius:6px;">' + catInfo.icon + ' ' + Utils.escapeHtml(catInfo.label + (product.subtype ? ' · ' + product.subtype : '')) + '</span>' +
                '<span style="font-size:11px;font-weight:800;color:#15803D;background:#DCFCE7;padding:1px 7px;border-radius:6px;">' + Utils.escapeHtml(lg.amount || '1份') + '</span>' +
              '</div>' +
              '<div style="font-size:13px;font-weight:800;color:#2B2320;">[' + Utils.escapeHtml(product.brand) + '] ' + Utils.escapeHtml(product.name) + '</div>' +
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
            '<button type="button" data-jump-date="' + Utils.escapeHtml(dStr) + '" style="background:none;border:none;padding:0;font-size:14px;font-weight:800;color:#2B2320;cursor:pointer;text-align:left;">📅 ' + Utils.escapeHtml(dayHeader) + '</button>' +
            '<span style="font-size:11px;font-weight:700;color:#6B5A4C;">共 ' + items.length + ' 条</span>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:7px;">' + rowsHtml + '</div>' +
        '</div>'
      );
    }).join('');
  };

  // ==================== QUICK FEED MODAL (FIXED READ-ONLY DEDUCT VISIBILITY + PORTION MEMORY) ====================
  UI.populateFeedStockDropdown = function (selectedItemId) {
    var sel = document.getElementById('feedStockSelect');
    var items = MP.state.items;
    var active = items.filter(function (it) {
      return !it.sourceBatchId || !items.some(function (batch) { return batch.id === it.sourceBatchId; });
    }).sort(function (a, b) { return Number(b.quantity > 0) - Number(a.quantity > 0); });
    var html = '<option value="">-- 手动填写或选择商品批次 --</option>';
    active.forEach(function (it) {
      var ci = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
      var remSuffix = (it.isOpened && it.openRemainFraction > 0) ? (' · ' + Utils.formatRemainFractionText(it.openRemainFraction, it.unit)) : '';
      var isSel = (selectedItemId && it.id === selectedItemId) ? ' selected' : '';
      html += '<option value="' + Utils.escapeHtml(it.id) + '"' + isSel + '>' + ci.icon + ' [' + Utils.escapeHtml(it.brand) + '] ' + Utils.escapeHtml(it.name) + '（' + (it.quantity > 0 ? '余' + it.quantity + Utils.escapeHtml(it.unit || '') + remSuffix : '已核销，可补记') + '）</option>';
    });
    sel.innerHTML = html;
  };

  UI.syncMedReminderVisibility = function () {
    var cat = document.getElementById('feedCategorySelect').value;
    var slot = document.getElementById('feedMealSlot').value;
    var box = document.getElementById('medNextReminderBox');
    box.classList.toggle('hidden-view', !(cat === 'med' || slot === '🩺 用药/护理'));
  };

  UI.syncFeedSplitCanUI = function (target) {
    var editing = Boolean(document.getElementById('feedLogEditId').value);
    var deduct = document.getElementById('feedDeductStock');
    var hint = document.getElementById('feedSplitHintTag');
    var rest = document.getElementById('chipFinishRestCan');
    var info = document.getElementById('feedSplitAutoInfo');
    var flavor = target && target.flavors && UI.getFeedFlavor(target);
    var unit = target && target.unit || '罐';
    var remaining = flavor ? flavor.openRemainFraction : target && !target.flavors && target.openRemainFraction;
    document.getElementById('feedDeductBox').classList.toggle('hidden-view', !target || editing);
    deduct.disabled = !target || target.quantity < 1 || editing ||
      Boolean(target && !Domain.isPackageUnit(unit) && unit !== '粒') ||
      Boolean(flavor && flavor.quantity < 1);
    if (deduct.disabled) deduct.checked = false;
    hint.textContent = remaining > 0 ? '🔓 当前' + Utils.formatRemainFractionText(remaining, unit) : '';
    rest.classList.toggle('hidden-view', !(remaining > 0 && deduct.checked));
    rest.textContent = '✨ 吃完本' + unit + '剩余';
    info.classList.toggle('hidden-view', !target || editing);
    if (!target || !deduct.checked) {
      info.textContent = deduct.disabled && target && target.quantity > 0
        ? '此批次或口味当前无法安全扣减，只记录喂食。'
        : '仅记录喂食，库存和开封余量保持原样。';
      return;
    }
    var portion = UI.parseFeedPortion(document.getElementById('feedAmountInput').value, target, flavor);
    var plan = Domain.planFeedingPortion(target, flavor, portion);
    info.textContent = plan.error || (plan.after
      ? '本次将更新开封余量（' + Utils.formatRemainFractionText(plan.after, unit) + '），暂不核销整件。'
      : '本次将核销 1' + unit + '库存。');
  };

  UI.portionLabel = function (base, fraction, item, flavor) {
    var spec = item && Utils.parsePortionSpec(flavor && flavor.spec || item.spec);
    if (!spec || Number(spec[1]) <= 0 || (spec[3] && spec[3] !== item.unit)) return base;
    return base + ' (约' + Utils.round2(Number(spec[1]) * fraction) + spec[2] + ')';
  };

  UI.parseFeedPortion = function (amount, item, flavor) {
    var text = String(amount || '').trim();
    if (/^(吃完|用完)$/.test(text)) return { finish: true };
    var mass = /^(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升)$/i.exec(text);
    if (mass && Number(mass[1]) > 0) {
      var spec = item && Utils.parsePortionSpec(flavor && flavor.spec || item.spec);
      var ratio = 0;
      if (spec && (!spec[3] || spec[3] === item.unit)) {
        var actualUnit = mass[2].toLowerCase();
        var specUnit = spec[2].toLowerCase();
        var actualVolume = /^(ml|毫升)$/.test(actualUnit);
        if (actualVolume === /^(ml|毫升)$/.test(specUnit)) {
          ratio = Number(mass[1]) * (/^(kg|千克)$/.test(actualUnit) ? 1000 : 1) /
            (Number(spec[1]) * (/^(kg|千克)$/.test(specUnit) ? 1000 : 1));
        }
      }
      return { valid: true, fraction: Number.isFinite(ratio) ? ratio : 0 };
    }
    text = text.replace(/\s*[（(](?:约?\s*\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升)|1\/2)[）)]$/i, '').trim();
    var unit = item && item.unit;
    var hasUnit = Boolean(unit && text.endsWith(unit));
    if (hasUnit) text = text.slice(0, -unit.length).trim();
    if (text === '半') return { valid: true, fraction: 0.5 };
    var parts = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
    var fraction = parts ? Number(parts[1]) / Number(parts[2])
      : (hasUnit && /^\d+(?:\.\d+)?整?$/.test(text) ? Number(text.replace(/整$/, '')) : 0);
    return { valid: Number.isFinite(fraction) && fraction > 0, fraction: fraction };
  };

  function syncPortionChips(item) {
    var unit = item && item.unit || '罐';
    var presets = { '0.5': '半', '0.34': '1/3', '0.25': '1/4', '1': '1' };
    document.querySelectorAll('#feedPortionChips [data-package-portion]').forEach(function (button) {
      var portion = presets[button.dataset.frac] + unit;
      button.dataset.portion = portion;
      button.textContent = portion;
      button.classList.toggle('hidden-view', Boolean(item && !Domain.isPackageUnit(unit) && unit !== '粒'));
    });
    document.querySelector('#feedPortionChips [data-portion="1支"]:not([data-package-portion])')
      .classList.toggle('hidden-view', Boolean(item));
  }

  UI.getFeedFlavor = function (item) {
    return Domain.findFlavor(item, document.getElementById('feedFlavorSelect').value);
  };

  UI.syncFeedFlavor = function (item, historical) {
    var wrap = document.getElementById('feedFlavorFields');
    var select = document.getElementById('feedFlavorSelect');
    var hasFlavor = Boolean(historical && historical.flavorId || item && item.flavors);
    wrap.classList.toggle('hidden-view', !hasFlavor);
    select.disabled = Boolean(historical);
    document.getElementById('feedFlavorPal').disabled = Boolean(historical);
    document.getElementById('openFlavorBtn').disabled = Boolean(historical);
    document.getElementById('discardFlavorBtn').disabled = Boolean(historical);
    select.innerHTML = '<option value="">请选择口味</option>';
    if (historical && hasFlavor) {
      select.add(new Option(historical.flavorName, historical.flavorId, true, true));
      document.getElementById('feedFlavorPal').value = historical.flavorPalatability || '';
      document.getElementById('feedFlavorHint').textContent = '历史口味与库存流水关联';
    } else if (hasFlavor) {
      item.flavors.forEach(function (f) {
        select.add(new Option(f.name + ' · 余' + f.quantity + item.unit, f.id));
      });
      UI.updateFeedFlavor(item);
    }
  };

  UI.updateFeedFlavor = function (item) {
    var flavor = UI.getFeedFlavor(item);
    var pal = document.getElementById('feedFlavorPal');
    pal.disabled = !flavor;
    pal.value = flavor ? flavor.palatability : '';
    document.getElementById('discardFlavorBtn').disabled = !MP.state.editMode || !flavor || flavor.quantity <= 0;
    var open = document.getElementById('openFlavorBtn');
    open.textContent = item && Domain.hasSharedSeal(item) ? '记录共用包装开封' : '记录该口味开封';
    open.disabled = !MP.state.editMode || !flavor || flavor.quantity <= 0 || Boolean(Domain.hasSharedSeal(item) ? item.isOpened : flavor.openedDate);
    document.getElementById('feedFlavorHint').textContent = flavor
      ? '支持克数、分数或件数。当前' + UI.flavorStockText({ flavors: [flavor], spec: item.spec, unit: item.unit }, true)
      : '请先选择实际喂食的口味';
  };

  UI.applyFeedStockSelection = function (itemId) {
    var target = MP.state.items.find(function (it) { return it.id === itemId; }) || null;
    document.getElementById('feedItemId').value = target ? target.id : '';
    UI.syncFeedFlavor(target);
    syncPortionChips(target);
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
          lastPortionChip.textContent = '⚡ 上次：' + lastFed.amount;
        } else {
          lastPortionChip.classList.add('hidden-view');
        }
      }

      var defaultPortion = '40g';
      var curRemFrac = (target.isOpened && Number(target.openRemainFraction) > 0 && Number(target.openRemainFraction) < 1)
        ? Number(target.openRemainFraction)
        : 0;

      if (target.category === 'can') {
        if (curRemFrac > 0) {
          defaultPortion = UI.portionLabel(curRemFrac + target.unit, curRemFrac, target);
        } else if (lastFed && lastFed.amount) {
          defaultPortion = lastFed.amount;
        } else {
          defaultPortion = '半' + target.unit;
        }
      } else if (lastFed && lastFed.amount) {
        defaultPortion = lastFed.amount;
      } else if (target.category === 'freeze') {
        defaultPortion = '15g';
      } else if (target.category === 'treat') {
        defaultPortion = '1' + target.unit;
      } else if (target.category === 'supp') {
        defaultPortion = '1份 / 5cm';
      } else if (target.category === 'med') {
        defaultPortion = '1' + (target.unit || '支');
      }

      document.getElementById('feedAmountInput').value = defaultPortion;
      document.getElementById('feedDeductLabel').textContent = '📦 同步扣减库存';
      document.getElementById('feedAmountInput').placeholder = '如 25g、半' + target.unit + '、1' + target.unit;
      if (target.flavors) {
        if (lastPortionChip) lastPortionChip.classList.add('hidden-view');
        document.getElementById('feedAmountInput').value = '';
      }
      UI.syncFeedSplitCanUI(target);
    } else {
      if (lastPortionChip) lastPortionChip.classList.add('hidden-view');
      UI.syncFeedSplitCanUI(null);
    }
  };

  UI.openFeedModal = function (itemId, customDate) {
    document.getElementById('feedModalTitle').textContent = '🐾 记录饮食 / 营养 / 用药';
    document.getElementById('feedStockSelect').disabled = false;
    document.getElementById('feedLogEditId').value = '';
    document.getElementById('feedAmountInput').placeholder = '如 40g、半罐、1支';
    UI.syncFeedFlavor(null);
    syncPortionChips(null);
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
        UI.syncFeedSplitCanUI(null);
      }
    }
    UI.syncMedReminderVisibility();
    UI.syncAllDateDisplays();
    UI.showModal('feedModalBackdrop', 'feedStockSelect');
  };

  UI.openEditFeedModal = function (logId) {
    var lg = MP.state.logs.find(function (x) { return x.id === logId; });
    if (!lg) return;
    document.getElementById('feedModalTitle').textContent = '✏️ 编辑饮食记录';
    document.getElementById('feedLogEditId').value = lg.id;
    document.getElementById('feedDateInput').value = lg.date || Utils.getTodayStr();
    document.getElementById('feedMealSlot').value = lg.mealSlot || '🌅 早饭';
    // A deduction belongs to the original batch even when the meal details are edited.
    document.getElementById('feedStockSelect').disabled = Boolean(lg.deductedUnit || lg.deductedFrac || lg.flavorId);
    UI.syncFeedFlavor(null, lg);
    syncPortionChips(MP.state.items.find(function (item) { return item.id === lg.itemId; }));
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
    UI.showModal('feedModalBackdrop', 'feedAmountInput');
  };

  UI.closeFeedModal = function () {
    UI.hideModal('feedModalBackdrop');
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
    UI.showModal('historyModalBackdrop', 'historySearchInput');
  };

  UI.closeStockHistoryModal = function () {
    UI.hideModal('historyModalBackdrop');
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
        '<div style="padding:28px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#6B5A4C;font-size:13px;">' +
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
              '<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;background:' + meta.bg + ';color:' + meta.text + ';">' + meta.icon + ' ' + meta.label + '</span>' +
              '<span style="font-size:11px;color:#6B5A4C;">' + Utils.escapeHtml(h.timestamp) + '</span>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:800;color:#2B2320;">' + ci.icon + ' [' + Utils.escapeHtml(h.brand) + '] ' + Utils.escapeHtml(h.name) + '</div>' +
            (h.note ? '<div style="margin-top:2px;font-size:11.5px;color:#57534E;">' + Utils.escapeHtml(h.note) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="font-size:12.5px;font-weight:800;color:' + meta.text + ';">' + Utils.escapeHtml(h.deltaText || '—') + '</div>' +
            '<div style="margin-top:2px;font-size:11px;color:#6B5A4C;">' + h.beforeQty + ' → ' + h.afterQty + Utils.escapeHtml(h.unit) + '</div>' +
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
      badgeEl.style.background = '#E8590C';
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
  var subtypeDraft = {};
  var manualItemUnit = false;

  function resetSubtypeForm(item, editing) {
    subtypeDraft = {};
    manualItemUnit = Boolean(item);
    if (!item || !item.subtype) return;
    var config = MP.FOOD_SUBTYPES[item.category];
    if (config && (editing || config.options.includes(item.subtype))) {
      subtypeDraft[item.category] = item.subtype;
    }
  }

  function syncItemSubtype(catKey) {
    var config = MP.FOOD_SUBTYPES[catKey];
    var field = document.getElementById('fieldSubtype');
    var editing = Boolean(document.getElementById('fieldId').value);
    document.getElementById('itemSubtypeWrap').classList.toggle('hidden-view', !config);
    field.disabled = !config;
    field.required = Boolean(config && !editing);
    field.options.length = 0;
    if (!config) return;
    document.getElementById('itemSubtypeLabel').textContent = config.label;
    field.add(new Option(editing ? '未指定' : '请选择' + config.label, ''));
    config.options.forEach(function (option) { field.add(new Option(option, option)); });
    var value = subtypeDraft[catKey] || '';
    if (value && !config.options.includes(value)) field.add(new Option(value + '（历史）', value));
    field.value = value;
  }

  UI.updateItemSubtype = function () {
    var catKey = MP.state.formCat;
    var config = MP.FOOD_SUBTYPES[catKey];
    var subtype = document.getElementById('fieldSubtype').value;
    subtypeDraft[catKey] = subtype;
    var unit = document.getElementById('fieldUnit');
    var index = config && config.options.indexOf(subtype);
    if (!manualItemUnit && !unit.disabled && config && config.units && index >= 0) {
      unit.value = config.units[index];
      UI.syncModalUnitPriceHint();
    }
  };

  UI.markItemUnitManual = function () { manualItemUnit = true; };

  UI.syncNetWeight = function (resetValue) {
    var input = document.getElementById('fieldNetWeight');
    var wet = MP.state.formCat === 'can';
    var editing = Boolean(document.getElementById('fieldId').value);
    input.disabled = !wet;
    input.required = wet && !editing;
    document.getElementById('netWeightField').classList.toggle('hidden-view', !wet);
    if (resetValue || !wet) {
      input.value = '';
      delete input.dataset.suggestedWeight;
    }
    if (!wet || editing || (input.value && input.value !== input.dataset.suggestedWeight)) return;
    var product = { category: 'can' };
    [['brand', 'fieldBrand'], ['name', 'fieldName'], ['spec', 'fieldSpec'], ['unit', 'fieldUnit']].forEach(function (pair) {
      product[pair[0]] = document.getElementById(pair[1]).value.trim();
    });
    if (!product.brand || !product.name) return;
    var key = Domain.getProductGroupKey(product);
    var match = MP.state.items.find(function (item) {
      return item.unit_net_weight_g > 0 && Domain.getProductGroupKey(item) === key;
    });
    input.value = match ? match.unit_net_weight_g : '';
    input.dataset.suggestedWeight = input.value;
  };

  UI.syncModalCategoryUI = function (catKey, applyDefaults) {
    var st = MP.state;
    st.formCat = catKey;
    var catInfo = MP.CATEGORIES[catKey] || MP.CATEGORIES.dry;
    var btns = document.querySelectorAll('#modalCatSelector [data-form-cat]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-form-cat') === catKey);
    }
    if (applyDefaults) {
      var unitField = document.getElementById('fieldUnit');
      if (!unitField.disabled && !manualItemUnit) {
        var config = MP.FOOD_SUBTYPES[catKey];
        var index = config && config.options.indexOf(subtypeDraft[catKey]);
        unitField.value = config && config.units && index >= 0 ? config.units[index] : catInfo.defaultUnit;
      }
      document.getElementById('fieldOpenLimit').value = String(catInfo.defaultOpenDays);
      if (!document.getElementById('fieldShelfValue').value) {
        document.getElementById('fieldShelfValue').value = String(catInfo.defaultShelfMonths);
        document.getElementById('fieldShelfUnit').value = 'months';
      }
    }
    syncItemSubtype(catKey);
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

  var flavorRowSequence = 0;

  UI.addFlavorRow = function (flavor, editing) {
    var entry = flavor || {};
    var row = document.createElement('div');
    row.className = 'flavor-row';
    row.dataset.flavorId = entry.id || 'flavor-' + (++flavorRowSequence);
    row.innerHTML =
      '<input class="ios-input" data-flavor-name aria-label="口味名称" placeholder="口味名称">' +
      '<input class="ios-input" data-flavor-count aria-label="每盒口味件数" placeholder="每盒件数" type="number" min="1" step="1" inputmode="numeric">' +
      '<input class="ios-input" data-flavor-spec aria-label="口味单件规格" placeholder="单件规格（可选）">' +
      '<button type="button" class="ios-btn ios-btn-secondary" data-remove-flavor>删除</button>';
    row.querySelector('[data-flavor-name]').value = entry.name || '';
    row.querySelector('[data-flavor-count]').value = entry.perPack || '';
    row.querySelector('[data-flavor-spec]').value = entry.spec || '';
    if (editing) {
      Array.from(row.children).forEach(function (control) { control.disabled = true; });
      row.lastElementChild.textContent = '余 ' + entry.quantity + document.getElementById('fieldUnit').value;
    }
    document.getElementById('flavorRows').appendChild(row);
  };

  UI.readFlavorRows = function (pack) {
    return Array.from(document.querySelectorAll('#flavorRows .flavor-row')).map(function (row) {
      var perPack = Number(row.querySelector('[data-flavor-count]').value);
      return {
        id: row.dataset.flavorId,
        name: row.querySelector('[data-flavor-name]').value,
        perPack: perPack,
        quantity: perPack * pack.count,
        spec: row.querySelector('[data-flavor-spec]').value
      };
    });
  };

  UI.syncFlavorForm = function () {
    var packaging = document.getElementById('fieldPackagingEnabled').checked;
    var editing = Boolean(document.getElementById('fieldId').value);
    var toggle = document.getElementById('fieldMixedFlavors');
    var enabled = packaging && toggle.checked;
    toggle.disabled = !packaging || editing;
    document.getElementById('fieldPackSeal').disabled = !packaging || editing;
    document.getElementById('flavorFields').classList.toggle('hidden-view', !enabled);
    document.getElementById('addFlavorBtn').classList.toggle('hidden-view', editing);
    var fields = document.getElementById('flavorRows');
    if (enabled && !fields.children.length) {
      UI.addFlavorRow();
      UI.addFlavorRow();
    }
    Array.from(fields.querySelectorAll('input')).forEach(function (control) { control.disabled = !enabled || editing; });
    var pack = UI.readPurchasePackaging();
    var message = '';
    if (enabled && editing) {
      message = '原始配比保留，盘点差异可按口味调整。';
    } else if (enabled && pack) {
      var rows = UI.readFlavorRows(pack);
      var allocated = rows.reduce(function (sum, row) { return sum + row.perPack; }, 0);
      var diff = pack.size - allocated;
      message = '每包装已分配 ' + allocated + '/' + pack.size + ' 件，本次共 ' + allocated * pack.count + ' 件';
      if (diff) message += ' · 每包装' + (diff > 0 ? '还差 ' : '多填 ') + Math.abs(diff) + ' 件';
    }
    document.getElementById('flavorSummary').textContent = message;
    if (enabled) document.getElementById('fieldQty').readOnly = true;
    var checkbox = document.getElementById('fieldIsOpened');
    checkbox.disabled = enabled;
    checkbox.closest('label').classList.toggle('hidden-view', enabled);
  };

  UI.readPurchasePackaging = function () {
    if (!document.getElementById('fieldPackagingEnabled').checked) return null;
    return Domain.validatePackaging({
      count: document.getElementById('fieldPackCount').value,
      outerUnit: document.getElementById('fieldPackOuterUnit').value,
      size: document.getElementById('fieldPackSize').value,
      seal: document.getElementById('fieldPackSeal').value
    }, document.getElementById('fieldUnit').value);
  };

  UI.syncUnitCorrection = function (currentUnit) {
    var current = document.getElementById('currentStockUnit');
    var target = document.getElementById('correctedUnit');
    if (current.value !== currentUnit) target.value = '';
    current.value = currentUnit;
    document.getElementById('correctUnitBtn').disabled =
      !current.value || !target.value || current.value === target.value;
  };

  UI.syncPurchasePackaging = function () {
    var enabled = document.getElementById('fieldPackagingEnabled').checked;
    var editing = Boolean(document.getElementById('fieldId').value);
    var pack = UI.readPurchasePackaging();
    var qty = document.getElementById('fieldQty');
    var unitField = document.getElementById('fieldUnit');
    var unit = unitField.value;
    var total = pack ? pack.count * pack.size : 0;
    var price = Number(document.getElementById('fieldPrice').value);
    document.getElementById('purchasePackagingFields').classList.toggle('hidden-view', !enabled);
    document.getElementById('fieldQtyLabel').textContent = enabled ? (editing ? '剩余数量' : '入库数量') : '数量 *';
    document.getElementById('fieldUnitLabel').textContent = enabled ? '内包装' : '单位';
    document.getElementById('fieldPriceLabel').textContent = enabled ? '购入总价' : '单价';
    qty.readOnly = enabled && !editing;
    qty.step = enabled ? '1' : '0.01';
    unitField.disabled = editing;
    var correction = document.getElementById('unitCorrectionFields');
    var item = editing && MP.state.items.find(function (entry) { return entry.id === document.getElementById('fieldId').value; });
    var canShowCorrection = Boolean(item && !item.sourceBatchId);
    correction.classList.toggle('hidden-view', !canShowCorrection);
    document.getElementById('unitCorrectionHint').classList.toggle('hidden-view', !canShowCorrection);
    UI.syncUnitCorrection(item ? item.unit : '');
    ['fieldPackCount', 'fieldPackOuterUnit', 'fieldPackSize'].forEach(function (id) {
      document.getElementById(id).disabled = !enabled || editing;
    });
    if (qty.readOnly) qty.value = total || '';
    var preview = '';
    if (enabled) {
      preview = pack
        ? UI.purchasePackagingLabel(pack, unit)
        : (document.getElementById('fieldPackSeal').value === 'shared'
          ? '每个共用密封包装单独录入一批，购买数量填 1。'
          : '请输入有效的整包装数量，并选择内包装单位。');
      if (pack && price > 0) {
        preview += ' · 平均 ' + Utils.formatMoney(price / total, MP.state.formCurrency) + '/' + unit;
        if (pack.count > 1) preview += ' · ' + Utils.formatMoney(price / pack.count, MP.state.formCurrency) + '/' + pack.outerUnit;
      }
    }
    document.getElementById('purchasePackagingPreview').textContent = preview;
    UI.syncFlavorForm();
    UI.syncOpenedFieldsVisibility();
  };

  UI.syncFlavorAdjustment = function (item) {
    var flavor = Domain.findFlavor(item, document.getElementById('adjustFlavorSelect').value);
    var qty = document.getElementById('adjustFlavorWhole');
    var percent = document.getElementById('adjustFlavorPercent');
    var opened = Boolean(flavor && flavor.openedDate && flavor.quantity > 0);
    qty.value = flavor ? flavor.quantity - Number(opened) : '';
    qty.max = flavor ? flavor.perPack * item.purchasePackaging.count - Number(opened) : 0;
    percent.closest('label').classList.toggle('hidden-view', !opened);
    percent.disabled = !opened;
    percent.value = opened ? Utils.round2((flavor.openRemainFraction || 1) * 100) : '';
  };

  function setPurchasePackagingForm(item) {
    var pack = item && item.purchasePackaging;
    var editing = Boolean(document.getElementById('fieldId').value);
    var toggle = document.getElementById('fieldPackagingEnabled');
    toggle.checked = Boolean(pack);
    toggle.disabled = editing;
    document.getElementById('fieldPackSeal').value = pack && pack.seal === 'shared' ? 'shared' : 'independent';
    document.getElementById('fieldMixedFlavors').checked = Boolean(item && item.flavors);
    document.getElementById('flavorRows').replaceChildren();
    var count = document.getElementById('fieldPackCount');
    var outer = document.getElementById('fieldPackOuterUnit');
    var size = document.getElementById('fieldPackSize');
    count.value = pack ? pack.count : 1;
    outer.querySelectorAll('[data-legacy-unit]').forEach(function (option) { option.remove(); });
    if (editing && pack && !Array.from(outer.options).some(function (option) { return option.value === pack.outerUnit; })) {
      var legacy = new Option(pack.outerUnit, pack.outerUnit);
      legacy.dataset.legacyUnit = 'true';
      outer.add(legacy);
    }
    outer.value = pack ? pack.outerUnit : '盒';
    if (outer.selectedIndex < 0) outer.value = '盒';
    size.value = pack ? pack.size : 8;
    count.disabled = outer.disabled = size.disabled = editing || !pack;
    var unit = document.getElementById('fieldUnit');
    if (item) {
      if (!Array.from(unit.options).some(function (option) { return option.value === item.unit; })) {
        unit.add(new Option(item.unit, item.unit));
      }
      unit.value = item.unit;
    } else {
      unit.value = (MP.CATEGORIES[MP.state.formCat] || MP.CATEGORIES.dry).defaultUnit;
    }
    if (item && item.flavors) item.flavors.forEach(function (flavor) { UI.addFlavorRow(flavor, editing); });
    var adjustment = document.getElementById('flavorAdjustmentFields');
    adjustment.classList.toggle('hidden-view', !(editing && item && item.flavors && !item.sourceBatchId));
    adjustment.open = false;
    var flavorSelect = document.getElementById('adjustFlavorSelect');
    flavorSelect.options.length = 0;
    if (editing && item.flavors) item.flavors.forEach(function (flavor) {
      flavorSelect.add(new Option(flavor.name, flavor.id));
    });
    document.getElementById('adjustFlavorReason').value = '';
    UI.syncFlavorAdjustment(item);
    document.getElementById('unitCorrectionFields').open = false;
    document.getElementById('correctedUnit').value = '';
    var price = item && item.price;
    document.getElementById('fieldPrice').value = price
      ? String(pack ? Utils.round2(price * pack.count * pack.size) : price)
      : '';
    UI.syncPurchasePackaging();
  }

  UI.syncModalCurrencyUI = function (curCode) {
    var cur = curCode === 'JPY' ? 'JPY' : 'CNY';
    MP.state.formCurrency = cur;
    var unitEl = document.getElementById('priceCurrencyUnit');
    var priceInput = document.getElementById('fieldPrice');
    if (cur === 'JPY') {
      unitEl.textContent = '円';
      priceInput.step = '1';
      priceInput.placeholder = '380';
    } else {
      unitEl.textContent = '元';
      priceInput.step = '0.01';
      priceInput.placeholder = '0.00';
    }
    var btns = document.querySelectorAll('#currencyToggleGroup [data-form-currency]');
    for (var i = 0; i < btns.length; i++) {
      var active = btns[i].getAttribute('data-form-currency') === cur;
      btns[i].style.background = active ? '#2B2320' : 'transparent';
      btns[i].style.color = active ? '#FFFFFF' : '#57534E';
    }
    UI.syncModalUnitPriceHint();
  };

  UI.syncModalUnitPriceHint = function () {
    var hintEl = document.getElementById('modalUnitPriceHint');
    if (!hintEl) return;
    UI.syncPurchasePackaging();
    if (document.getElementById('fieldPackagingEnabled').checked || !MP.isFoodCategory(MP.state.formCat)) {
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
      box.firstElementChild.classList.remove('hidden-view');
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

    if (document.getElementById('fieldPackagingEnabled').checked &&
        document.getElementById('fieldMixedFlavors').checked) {
      box.classList.remove('hidden-view');
      box.firstElementChild.classList.add('hidden-view');
      limitCol.classList.remove('hidden-view');
      finCol.classList.add('hidden-view');
      return;
    }
    box.firstElementChild.classList.remove('hidden-view');
    var pack = UI.readPurchasePackaging();
    titleEl.textContent = pack && pack.seal === 'shared'
      ? '🔓 共用密封包装已拆'
      : '🔓 当前有 1 件已拆封（单独计算开封保鲜期）';
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
    document.getElementById('fieldUnit').disabled = false;
    resetSubtypeForm();
    UI.syncModalCategoryUI(defaultCat, true);
    UI.syncNetWeight(true);
    setPurchasePackagingForm();
    UI.autoComputeExpDate();
    UI.syncModalCurrencyUI(st.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'fieldBrand');
  };

  UI.openEditModal = function (id, focusId) {
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
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    UI.syncNetWeight(true);
    document.getElementById('fieldNetWeight').value = item.unit_net_weight_g || '';
    setPurchasePackagingForm(item);
    UI.syncModalCurrencyUI(item.currency || 'CNY');
    UI.syncModalPalatabilityUI(item.palatability || '');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', focusId || 'fieldBrand');
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
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    UI.syncNetWeight(true);
    document.getElementById('fieldNetWeight').value = item.unit_net_weight_g || '';
    setPurchasePackagingForm(item);
    UI.syncModalCurrencyUI(item.currency || MP.state.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI(item.palatability || '');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'fieldQty');
    UI.showToast('已带入同款资料，请确认新批次日期与数量');
  };

  UI.closeItemModal = function () {
    UI.hideModal('itemModalBackdrop');
  };

  UI.openLightbox = function (item) {
    if (!item) return;
    document.getElementById('lightboxTitle').textContent = (item.brand || '') + ' · ' + (item.name || '');
    document.getElementById('lightboxImg').src = MP.getItemCoverSrc(item);
    document.getElementById('lightboxMeta').textContent =
      '生产日：' + (item.prodDate || '未标注') + ' ｜ 过期日：' + (item.expDate || '—') + (item.batchCode ? (' ｜ ' + item.batchCode) : '');
    UI.showModal('photoPreviewBackdrop', 'closeLightboxBtn');
  };

  UI.closeLightbox = function () {
    UI.hideModal('photoPreviewBackdrop');
  };

})(typeof window !== 'undefined' ? window : globalThis);
