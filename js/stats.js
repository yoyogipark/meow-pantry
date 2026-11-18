/* Meow Pantry Feeding Analytics Engine (Food vs Supplement vs Medicine Separation + Drill-Down Filters) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats = {};

  function addUnitQuantity(totals, unit, quantity) {
    if (quantity > 0) totals[unit] = Utils.round2((totals[unit] || 0) + quantity);
  }

  function formatUnitQuantities(totals) {
    return Object.keys(totals).map(function (unit) {
      return totals[unit] + unit;
    }).join(' · ');
  }

  Stats.aggregateUniqueProducts = function () {
    var map = {};
    var list = [];
    MP.state.items.forEach(function (it) {
      var key = Domain.getProductGroupKey(it);
      var q = Number(it.quantity) || 0;
      var eaten = q <= 0 ? (Number(it.consumedCount) || Number(it.lastQuantity) || 0) : 0;
      if (!map[key]) {
        map[key] = {
          key: key,
          rep: it,
          category: it.category || 'dry',
          group: MP.getCategoryGroup(it.category),
          brand: (it.brand || '未命名品牌').trim(),
          name: (it.name || '未命名').trim(),
          spec: it.spec || '',
          unit: it.unit || '件',
          palatability: it.palatability || '',
          inStockQty: 0,
          eatenQty: 0,
          batchCount: 0,
          totalDays: 0,
          daysUnits: 0
        };
        list.push(map[key]);
      }
      var entry = map[key];
      if (!it.sourceBatchId) {
        entry.batchCount += 1;
      }
      entry.inStockQty = Utils.round2(entry.inStockQty + q);
      entry.eatenQty = Utils.round2(entry.eatenQty + eaten);
      if (it.palatability) entry.palatability = it.palatability;
      if (it.imageData && !entry.rep.imageData) entry.rep = it;
      if (q <= 0) {
        var cDays = Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
        if (cDays !== null && eaten > 0) {
          entry.totalDays += cDays;
          entry.daysUnits += eaten;
        }
      }
    });
    return list;
  };

  // Pure calculation helper (testable in Node without DOM) for verifying Food vs Supp vs Med separation!
  Stats.computeOverviewMetrics = function (items, logs) {
    var groupTotals = {
      food: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      supp: { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 },
      med:  { batches: 0, cny: 0, jpy: 0, eatenBatches: 0 }
    };
    var catStats = {};
    Object.keys(MP.CATEGORIES).forEach(function (k) {
      catStats[k] = {
        group: MP.CATEGORIES[k].group,
        skus: 0,
        stockByUnit: Object.create(null),
        eatenByUnit: Object.create(null),
        durationByUnit: Object.create(null)
      };
    });

    items.forEach(function (it) {
      var q = Number(it.quantity) || 0;
      var ck = catStats[it.category] ? it.category : 'dry';
      var grp = MP.getCategoryGroup(ck);
      var category = catStats[ck];
      var unit = it.unit || '件';
      if (q > 0) {
        groupTotals[grp].batches += 1;
        if (it.price) {
          if (it.currency === 'JPY') groupTotals[grp].jpy += q * Number(it.price);
          else groupTotals[grp].cny += q * Number(it.price);
        }
        category.skus += 1;
        addUnitQuantity(category.stockByUnit, unit, q);
      } else {
        var used = Number(it.consumedCount) || Number(it.lastQuantity) || 1;
        groupTotals[grp].eatenBatches += 1;
        addUnitQuantity(category.eatenByUnit, unit, used);
        var cd = Utils.calcConsumeDays(it.archivedOpenedDate || it.openedDate, it.finishedDate);
        if (cd !== null) {
          var duration = category.durationByUnit[unit] || (category.durationByUnit[unit] = { days: 0, quantity: 0 });
          duration.days += cd;
          duration.quantity += used;
        }
      }
    });

    var cutoffStr = Utils.shiftDaysFromToday(-30);
    var recentLogs = (logs || []).filter(function (lg) {
      return String(lg.date || '') >= cutoffStr;
    });
    var foodLogs = recentLogs.filter(function (lg) { return MP.getCategoryGroup(lg.category) === 'food'; });
    var suppLogs = recentLogs.filter(function (lg) { return MP.getCategoryGroup(lg.category) === 'supp'; });
    var medLogs = recentLogs.filter(function (lg) { return MP.getCategoryGroup(lg.category) === 'med'; });

    return {
      groupTotals: groupTotals,
      catStats: catStats,
      recent30: {
        all: recentLogs,
        food: foodLogs,
        supp: suppLogs,
        med: medLogs
      }
    };
  };

  function formatGroupValueStr(cny, jpy) {
    var parts = [];
    if (cny > 0) parts.push('CN¥' + Math.round(cny).toLocaleString('en-US'));
    if (jpy > 0) parts.push(Math.round(jpy).toLocaleString('en-US') + '円');
    return parts.length ? parts.join(' + ') : '¥0';
  }

  Stats.renderStatsView = function () {
    var st = MP.state;
    var subTab = st.statsSubTab || 'stock';
    var subBtns = document.querySelectorAll('#statsSubTabSwitch [data-stats-subtab]');
    for (var sIdx = 0; sIdx < subBtns.length; sIdx++) {
      var sk = subBtns[sIdx].getAttribute('data-stats-subtab');
      var active = (sk === subTab);
      subBtns[sIdx].style.background = active ? '#1C1917' : 'transparent';
      subBtns[sIdx].style.color = active ? '#FFFFFF' : '#57534E';
    }
    var svStock = document.getElementById('statsSubViewStock');
    var svPal = document.getElementById('statsSubViewPal');
    var svBrand = document.getElementById('statsSubViewBrand');
    if (svStock) svStock.classList.toggle('hidden-view', subTab !== 'stock');
    if (svPal) svPal.classList.toggle('hidden-view', subTab !== 'pal');
    if (svBrand) svBrand.classList.toggle('hidden-view', subTab !== 'brand');

    var metrics = Stats.computeOverviewMetrics(st.items, st.logs);
    var gt = metrics.groupTotals;
    var catStats = metrics.catStats;

    // Scope switcher inside Stock Overview ('all' | 'food' | 'supp' | 'med')
    var scope = st.statsScopeFilter || 'all';
    var scopeBtns = document.querySelectorAll('#statsScopeBar [data-stats-scope]');
    for (var scIdx = 0; scIdx < scopeBtns.length; scIdx++) {
      var scKey = scopeBtns[scIdx].getAttribute('data-stats-scope');
      scopeBtns[scIdx].classList.toggle('active', scKey === scope);
    }

    var scopedCny = scope === 'all' ? (gt.food.cny + gt.supp.cny + gt.med.cny) : gt[scope].cny;
    var scopedJpy = scope === 'all' ? (gt.food.jpy + gt.supp.jpy + gt.med.jpy) : gt[scope].jpy;
    var scopeTitlePrefix = scope === 'food' ? '食品在库 ' : (scope === 'supp' ? '营养品在库 ' : (scope === 'med' ? '药品在库 ' : '全仓在库 '));
    var totalBadge = document.getElementById('totalValueBadge');
    if (totalBadge) {
      totalBadge.textContent = scopeTitlePrefix + formatGroupValueStr(scopedCny, scopedJpy);
    }

    // 1A-0. Explicit 3-Group Separation Summary Strip (普通食品 vs 营养品 vs 药品)
    var sepStripEl = document.getElementById('groupSeparationSummary');
    if (sepStripEl) {
      sepStripEl.innerHTML = [
        { key: 'food', icon: '🍽️', label: '普通食品', bg: '#FFF7ED', border: '#FED7AA', titleColor: '#9A3412', data: gt.food, unitWord: '批在库' },
        { key: 'supp', icon: '💊', label: '营养品',   bg: '#F0F9FF', border: '#BAE6FD', titleColor: '#0369A1', data: gt.supp, unitWord: '批在库' },
        { key: 'med',  icon: '🩺', label: '药品护理', bg: '#F0FDF4', border: '#BBF7D0', titleColor: '#15803D', data: gt.med,  unitWord: '批在库' }
      ].map(function (card) {
        var isSel = (scope === card.key);
        return (
          '<button type="button" data-stats-scope-jump="' + card.key + '" class="clickable-stat-tile" style="text-align:left;padding:9px 10px;border-radius:12px;background:' + card.bg + ';border:1.5px solid ' + (isSel ? '#EA580C' : card.border) + ';">' +
            '<div style="font-size:11px;font-weight:800;color:' + card.titleColor + ';white-space:nowrap;">' + card.icon + ' ' + card.label + '</div>' +
            '<div style="margin-top:3px;font-size:14px;font-weight:800;color:#1C1917;">' + card.data.batches + ' <span style="font-size:11px;font-weight:600;color:#57534E;">' + card.unitWord + '</span></div>' +
            '<div style="margin-top:1px;font-size:10.5px;color:#78716C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + formatGroupValueStr(card.data.cny, card.data.jpy) + '</div>' +
          '</button>'
        );
      }).join('');
    }

    // 1A. Category Grid (Filtered by scope, clickable to jump to Pantry!)
    var visibleCatKeys = Object.keys(MP.CATEGORIES).filter(function (k) {
      return scope === 'all' || MP.CATEGORIES[k].group === scope;
    });
    var catGridHtml = visibleCatKeys.map(function (k) {
      var c = MP.CATEGORIES[k];
      var stCat = catStats[k];
      var stockText = formatUnitQuantities(stCat.stockByUnit);
      var eatenText = formatUnitQuantities(stCat.eatenByUnit);
      var avgText = Object.keys(stCat.durationByUnit).map(function (unit) {
        var duration = stCat.durationByUnit[unit];
        return '均' + Math.max(1, Math.round(duration.days / duration.quantity)) + '天/' + Utils.escapeHtml(unit);
      }).join(' · ');
      return (
        '<button type="button" data-jump-cat="' + k + '" class="clickable-stat-tile" style="text-align:left;padding:11px 12px;border-radius:14px;background:#FAFAF9;border:1px solid #E7E5E4;width:100%;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">' +
            '<span style="font-size:12.5px;font-weight:700;color:#44403C;">' + c.icon + ' ' + c.label + '</span>' +
            '<span style="font-size:11px;color:#EA580C;font-weight:600;">' + stCat.skus + '批 ▶</span>' +
          '</div>' +
          '<div style="margin-top:4px;font-size:' + (Object.keys(stCat.stockByUnit).length > 1 ? '14' : '18') + 'px;font-weight:800;color:#1C1917;overflow-wrap:anywhere;">' + Utils.escapeHtml(stockText || '无库存') + '</div>' +
          '<div style="margin-top:2px;font-size:11px;color:' + (eatenText ? '#15803D' : '#A8A29E') + ';font-weight:600;overflow-wrap:anywhere;">' +
            '累计已核销 ' + Utils.escapeHtml(eatenText || '0') + (avgText ? ' · ' + avgText : '') +
          '</div>' +
        '</button>'
      );
    }).join('');
    document.getElementById('categoryStatsGrid').innerHTML = catGridHtml;

    // 1B. Stock Health Bar (Scoped + Clickable status pills to jump to Pantry!)
    var freshBatches = 0;
    var openedBatches = 0;
    var expiringBatches = 0;
    var expiredBatches = 0;
    st.items.forEach(function (it) {
      var q = Number(it.quantity) || 0;
      if (q <= 0) return;
      if (scope !== 'all' && MP.getCategoryGroup(it.category) !== scope) return;
      var ev = Domain.evaluateItem(it);
      if (Domain.isStockOpened(it)) openedBatches += 1;
      if (ev.status === 'expired') expiredBatches += 1;
      else if (ev.status === 'expiring') expiringBatches += 1;
      else freshBatches += 1;
    });

    var totalActiveBatches = freshBatches + expiringBatches + expiredBatches;
    var healthEl = document.getElementById('stockHealthBox');
    if (totalActiveBatches === 0) {
      healthEl.innerHTML = '<div style="font-size:12px;color:#A8A29E;">当前筛选范围暂无在库批次</div>';
    } else {
      var pFresh = Math.round((freshBatches / totalActiveBatches) * 100);
      var pWarn = Math.round((expiringBatches / totalActiveBatches) * 100);
      var pExp = Math.max(0, 100 - pFresh - pWarn);
      healthEl.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;margin-bottom:7px;flex-wrap:wrap;gap:6px;">' +
          '<span style="font-weight:700;color:#44403C;">🛡️ 保质期健康度（点标签可跳转筛选）</span>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<button type="button" data-jump-health="opened" style="border:1px solid #FED7AA;background:#FFF7ED;color:#C2410C;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">🔓 已拆 ' + openedBatches + '</button>' +
            '<button type="button" data-jump-health="fresh" style="border:1px solid #BBF7D0;background:#F0FDF4;color:#15803D;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">● 充裕 ' + freshBatches + '</button>' +
            '<button type="button" data-jump-health="expiring" style="border:1px solid #FDE68A;background:#FFFBEB;color:#B45309;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">● 临期 ' + expiringBatches + '</button>' +
            (expiredBatches > 0 ? '<button type="button" data-jump-health="expired" style="border:1px solid #FECACA;background:#FEF2F2;color:#DC2626;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">● 过期 ' + expiredBatches + '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div style="width:100%;height:8px;border-radius:999px;background:#F5F5F4;overflow:hidden;display:flex;">' +
          (pFresh > 0 ? '<div style="width:' + pFresh + '%;background:#16A34A;height:100%;"></div>' : '') +
          (pWarn > 0 ? '<div style="width:' + pWarn + '%;background:#F59E0B;height:100%;"></div>' : '') +
          (pExp > 0 ? '<div style="width:' + pExp + '%;background:#DC2626;height:100%;"></div>' : '') +
        '</div>';
    }

    // 1C. Priority Feeding Queue (FEFO strictly for FOOD + SUPPLEMENTS; Medicines separated into Medical Care Notice!)
    var activeFoodAndSupp = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && MP.getCategoryGroup(it.category) !== 'med';
    });
    activeFoodAndSupp.sort(function (a, b) {
      return Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays;
    });
    var topUrgent = activeFoodAndSupp.slice(0, 5);
    var feedEl = document.getElementById('priorityFeedList');
    if (topUrgent.length === 0) {
      feedEl.innerHTML = '<div style="font-size:13px;color:#A8A29E;padding:8px 0;">暂无在库食品或营养品</div>';
    } else {
      feedEl.innerHTML = topUrgent.map(function (it, idx) {
        var ev = Domain.evaluateItem(it);
        var ci = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
        var reason = '';
        var tagColor = '#15803D';
        if (ev.status === 'expired') {
          reason = '⚠️ 已过期，请检查清理勿误喂';
          tagColor = '#DC2626';
        } else if (Domain.isStockOpened(it) && ev.openRemaining !== null && (ev.expDays === null || ev.openRemaining <= ev.expDays)) {
          var fracInfo = it.openRemainFraction ? (' · ' + Utils.formatRemainFractionText(it.openRemainFraction, it.unit)) : '';
          reason = '🔓 已拆封' + fracInfo + ' · 建议 ' + ev.openRemaining + ' 天内吃完';
          tagColor = '#EA580C';
        } else {
          reason = '未拆封 · 剩 ' + ev.expDays + ' 天到期';
          tagColor = ev.status === 'expiring' ? '#D97706' : '#57534E';
        }
        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:12px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="font-size:13px;font-weight:700;color:#1C1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (idx + 1) + '. ' + ci.icon + ' [' + Utils.escapeHtml(it.brand) + '] ' + Utils.escapeHtml(it.name) + '</div>' +
              '<div style="font-size:11px;color:' + tagColor + ';font-weight:600;margin-top:2px;">' + reason + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
              '<span style="font-size:12px;font-weight:700;color:#44403C;white-space:nowrap;">余 ' + Number(it.quantity) + Utils.escapeHtml(it.unit || '') + '</span>' +
              (ev.status !== 'expired'
                ? '<button type="button" data-priority-feed="' + Utils.escapeHtml(it.id) + '" style="padding:5px 9px;border-radius:8px;border:1px solid #FED7AA;background:#FFF7ED;color:#EA580C;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">🐾 记喂食</button>'
                : '') +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    // Separate Medicine Expiry Watch Box (only shown when med items exist in stock)
    var medWatchBox = document.getElementById('medStockWatchBox');
    var activeMeds = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && MP.getCategoryGroup(it.category) === 'med';
    });
    if (medWatchBox) {
      if (activeMeds.length === 0) {
        medWatchBox.classList.add('hidden-view');
      } else {
        activeMeds.sort(function (a, b) { return Domain.evaluateItem(a).effectiveDays - Domain.evaluateItem(b).effectiveDays; });
        medWatchBox.classList.remove('hidden-view');
        medWatchBox.innerHTML =
          '<div style="font-size:12.5px;font-weight:800;color:#14532D;margin-bottom:6px;">🩺 医药箱效期独立监控（不计入日常优先投喂）</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">' +
          activeMeds.map(function (m) {
            var ev = Domain.evaluateItem(m);
            var stTxt = ev.status === 'expired'
              ? ('⚠️ 已过期 ' + Math.abs(ev.expDays || 0) + ' 天')
              : ('效期剩 ' + (ev.expDays !== null ? ev.expDays : '—') + ' 天');
            var stCol = ev.status === 'expired' ? '#DC2626' : (ev.status === 'expiring' ? '#D97706' : '#15803D');
            return (
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:9px;background:#FFFFFF;border:1px solid #DCFCE7;font-size:12px;">' +
                '<span style="font-weight:700;color:#1C1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">[' + Utils.escapeHtml(m.brand) + '] ' + Utils.escapeHtml(m.name) + ' ×' + Number(m.quantity) + Utils.escapeHtml(m.unit || '') + '</span>' +
                '<span style="font-weight:700;color:' + stCol + ';white-space:nowrap;">' + stTxt + '</span>' +
              '</div>'
            );
          }).join('') +
          '</div>';
      }
    }

    // 1D. Future Expiry Month Timeline (Scoped)
    var scopedActive = st.items.filter(function (it) {
      return (Number(it.quantity) || 0) > 0 && (scope === 'all' || MP.getCategoryGroup(it.category) === scope);
    });
    var monthBuckets = {};
    scopedActive.forEach(function (it) {
      var ym = (it.expDate && it.expDate.length >= 7) ? it.expDate.slice(0, 7) : '未标注月份';
      if (!monthBuckets[ym]) {
        monthBuckets[ym] = { ym: ym, items: [], minDays: 99999 };
      }
      monthBuckets[ym].items.push(it);
      var dLeft = Utils.diffDaysFromToday(it.expDate);
      if (dLeft !== null && dLeft < monthBuckets[ym].minDays) {
        monthBuckets[ym].minDays = dLeft;
      }
    });
    var sortedMonths = Object.keys(monthBuckets).sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
    document.getElementById('expiryTimelineCountBadge').textContent = '涵盖 ' + sortedMonths.length + ' 个月份';
    var timelineBox = document.getElementById('expiryMonthTimelineList');
    if (sortedMonths.length === 0) {
      timelineBox.innerHTML = '<div style="font-size:13px;color:#A8A29E;padding:8px 0;">当前筛选范围暂无在库批次</div>';
    } else {
      timelineBox.innerHTML = sortedMonths.map(function (ym) {
        var bucket = monthBuckets[ym];
        var dotColor = '#16A34A';
        var tagBg = '#DCFCE7';
        var tagColor = '#15803D';
        var statusNote = '保质期充裕';
        if (bucket.minDays < 0) {
          dotColor = '#DC2626'; tagBg = '#FEE2E2'; tagColor = '#DC2626'; statusNote = '含已过期批次';
        } else if (bucket.minDays <= st.settings.warnDays) {
          dotColor = '#F59E0B'; tagBg = '#FEF3C7'; tagColor = '#B45309'; statusNote = '最快 ' + bucket.minDays + ' 天到期';
        } else if (bucket.minDays < 99999) {
          statusNote = '约 ' + bucket.minDays + ' 天后到期';
        }
        var ymTitle = ym.indexOf('-') !== -1 ? (ym.split('-')[0] + '年' + parseInt(ym.split('-')[1], 10) + '月') : ym;
        var pills = bucket.items.map(function (it) {
          var ci = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
          return (
            '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:8px;font-size:11.5px;font-weight:600;background:#FFFFFF;color:#44403C;border:1px solid #E7E5E4;">' +
              ci.icon + ' [' + Utils.escapeHtml(it.brand) + '] ' + Utils.escapeHtml(it.name) + ' ×' + Number(it.quantity) + Utils.escapeHtml(it.unit || '') +
            '</span>'
          );
        }).join('');
        return (
          '<div style="padding:10px 12px;border-radius:12px;background:#FAFAF9;border-left:4px solid ' + dotColor + ';border-top:1px solid #F5F5F4;border-right:1px solid #F5F5F4;border-bottom:1px solid #F5F5F4;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
              '<strong style="font-size:13.5px;color:#1C1917;">🗓️ ' + Utils.escapeHtml(ymTitle) + ' 到期 (' + bucket.items.length + '批)</strong>' +
              '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + tagBg + ';color:' + tagColor + ';">' + statusNote + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + pills + '</div>' +
          '</div>'
        );
      }).join('');
    }

    // ==================== SUB-VIEW 2: PALATABILITY & TOLERANCE ARCHIVE (Food vs Supp vs Med Separated!) ====================
    var uniqueProducts = Stats.aggregateUniqueProducts();
    var tierCounts = { love: 0, ok: 0, coax: 0, meh: 0, supp: 0, med: 0 };
    var evaluatedTotal = 0;
    uniqueProducts.forEach(function (prod) {
      if (!prod.palatability) return;
      evaluatedTotal += 1;
      if (prod.group === 'med') {
        tierCounts.med += 1;
      } else if (prod.group === 'supp') {
        tierCounts.supp += 1;
      } else if (tierCounts[prod.palatability] !== undefined) {
        tierCounts[prod.palatability] += 1;
      }
    });
    document.getElementById('tierTotalEvaluatedBadge').textContent = '已评 ' + evaluatedTotal + ' 款单品';

    var tierLabels = {
      love: '😍 超爱吃',
      ok:   '😋 正常吃',
      coax: '🥺 需哄吃',
      meh:  '😒 不爱吃',
      supp: '💊 营养品接受度',
      med:  '🩺 药品耐受反应'
    };
    var tabBtns = document.querySelectorAll('#palTierTabBar [data-tier-tab]');
    for (var tIdx = 0; tIdx < tabBtns.length; tIdx++) {
      var tk = tabBtns[tIdx].getAttribute('data-tier-tab');
      tabBtns[tIdx].textContent = tierLabels[tk] + ' (' + (tierCounts[tk] || 0) + ')';
      tabBtns[tIdx].classList.toggle('active', tk === st.statsTierTab);
    }

    var tierMatched = uniqueProducts.filter(function (prod) {
      if (!prod.palatability) return false;
      if (st.statsTierTab === 'med') return prod.group === 'med';
      if (st.statsTierTab === 'supp') return prod.group === 'supp';
      return prod.group === 'food' && prod.palatability === st.statsTierTab;
    });

    var tierListEl = document.getElementById('palTierCardsList');
    var tierPagerEl = document.getElementById('tierPaginationBar');
    if (tierMatched.length === 0) {
      if (tierPagerEl) tierPagerEl.classList.add('hidden-view');
      var emptyHintMap = {
        love: '还没有标记为「😍 超爱」的口粮，可在录入或编辑猫粮/湿粮/冻干/零食时点选适口性',
        ok:   '还没有标记为「😋 正常吃」的口粮记录',
        coax: '太棒了，目前没有需要哄骗才肯吃的口粮',
        meh:  '太棒了，目前还没有踩雷不吃的黑名单口粮',
        supp: '还没有记录过「💊 营养品」的适口性与接受度反馈',
        med:  '还没有记录过「🩺 药品」的给药耐受度反应'
      };
      tierListEl.innerHTML =
        '<div style="padding:22px 12px;text-align:center;background:#FAFAF9;border-radius:14px;color:#78716C;font-size:12.5px;">' +
          '🐾 ' + (emptyHintMap[st.statsTierTab] || '暂无记录') +
        '</div>';
    } else {
      var tPageSize = Number(st.tierPageSize) || 5;
      var tTotalPages = Math.max(1, Math.ceil(tierMatched.length / tPageSize));
      if (st.tierPage > tTotalPages) st.tierPage = tTotalPages;
      if (st.tierPage < 1) st.tierPage = 1;
      var pagedTierItems = tierMatched.slice((st.tierPage - 1) * tPageSize, st.tierPage * tPageSize);

      if (tierMatched.length > tPageSize) {
        tierPagerEl.classList.remove('hidden-view');
        document.getElementById('tierPageInfoText').textContent =
          '第 ' + st.tierPage + ' / ' + tTotalPages + ' 页 (共 ' + tierMatched.length + ' 款)';
        var tpPrev = document.getElementById('prevTierPageBtn');
        var tpNext = document.getElementById('nextTierPageBtn');
        tpPrev.disabled = (st.tierPage <= 1);
        tpPrev.style.opacity = st.tierPage <= 1 ? '0.45' : '1';
        tpNext.disabled = (st.tierPage >= tTotalPages);
        tpNext.style.opacity = st.tierPage >= tTotalPages ? '0.45' : '1';
      } else {
        tierPagerEl.classList.add('hidden-view');
      }

      tierListEl.innerHTML = pagedTierItems.map(function (prod) {
        var catInfo = MP.CATEGORIES[prod.category] || MP.CATEGORIES.dry;
        var palBadge = MP.getPalatabilityBadgeInfo(prod.rep);
        var coverSrc = MP.getItemCoverSrc(prod.rep);
        var stockTag = prod.inStockQty > 0
          ? '<span style="font-size:11px;font-weight:700;color:#15803D;background:#DCFCE7;padding:2px 7px;border-radius:6px;">在库 ' + prod.inStockQty + Utils.escapeHtml(prod.unit) + '</span>'
          : '<span style="font-size:11px;font-weight:700;color:#78716C;background:#E7E5E4;padding:2px 7px;border-radius:6px;">已用完/断货</span>';
        var avgTxt = prod.daysUnits > 0
          ? (' · 均 ' + Math.max(1, Math.round(prod.totalDays / prod.daysUnits)) + '天/' + Utils.escapeHtml(prod.unit))
          : '';

        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:14px;background:#FAFAF9;border:1px solid #E7E5E4;">' +
            '<img src="' + coverSrc + '" alt="' + Utils.escapeHtml(prod.name) + '" style="width:48px;height:48px;border-radius:11px;object-fit:cover;border:1px solid #E7E5E4;flex-shrink:0;background:#FFF;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
                '<span style="font-size:10.5px;font-weight:700;color:#44403C;background:#E7E5E4;padding:1px 6px;border-radius:5px;">' + catInfo.icon + ' ' + catInfo.label + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 7px;border-radius:5px;">' + Utils.escapeHtml(prod.brand) + '</span>' +
                (palBadge ? '<span style="font-size:10.5px;font-weight:700;background:' + palBadge.bg + ';color:' + palBadge.text + ';padding:1px 7px;border-radius:999px;">' + palBadge.label + '</span>' : '') +
              '</div>' +
              '<div style="font-size:14px;font-weight:800;color:#1C1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                Utils.escapeHtml(prod.name) + (prod.spec ? (' <span style="font-size:11.5px;font-weight:500;color:#78716C;">(' + Utils.escapeHtml(prod.spec) + ')</span>') : '') +
              '</div>' +
              '<div style="margin-top:3px;font-size:11px;color:#57534E;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                stockTag +
                '<span>累计已核销 ' + prod.eatenQty + Utils.escapeHtml(prod.unit) + avgTxt + '</span>' +
              '</div>' +
            '</div>' +
            '<button type="button" data-tier-restock="' + Utils.escapeHtml(prod.rep.id) + '" style="padding:6px 10px;border-radius:9px;border:1px solid #FED7AA;background:#FFF7ED;color:#9A3412;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">＋复购</button>' +
          '</div>'
        );
      }).join('');
    }

    // ==================== SUB-VIEW 3A: 30-DAY FEEDING PREFERENCES (Food Strictly Separated from Supp & Med!) ====================
    var r30 = metrics.recent30;
    document.getElementById('recent30CountBadge').textContent =
      '已记录喂食 ' + r30.food.length + ' 顿' + ((r30.supp.length + r30.med.length) > 0 ? (' · 营养/药护 ' + (r30.supp.length + r30.med.length) + ' 次') : '');

    var prefBox = document.getElementById('recent30PrefBox');
    if (r30.all.length === 0) {
      prefBox.innerHTML = '<div style="font-size:12.5px;color:#A8A29E;padding:8px 0;">近期暂无饮食记录，去底部「饮食记录」记几笔就能看到主子的饮食分析啦</div>';
    } else {
      var foodHtml = '';
      if (r30.food.length === 0) {
        foodHtml = '<div style="font-size:12px;color:#A8A29E;margin-bottom:8px;">近 30 天暂无普通食品记录</div>';
      } else {
        var favMap = {};
        var catLogCount = {};
        r30.food.forEach(function (lg) {
          var ck = lg.category || 'dry';
          catLogCount[ck] = (catLogCount[ck] || 0) + 1;
          var product = Domain.resolveLogProduct(lg);
          var fk = (product.brand || '') + ' · ' + product.name;
          if (!favMap[fk]) {
            favMap[fk] = { title: fk, category: ck, count: 0, lastDate: lg.date || '', ratings: Object.create(null) };
          }
          favMap[fk].count += 1;
          if (MP.PALATABILITY[lg.flavorPalatability]) {
            var rating = lg.flavorPalatability;
            favMap[fk].ratings[rating] = (favMap[fk].ratings[rating] || 0) + 1;
          }
          if (String(lg.date || '') > favMap[fk].lastDate) favMap[fk].lastDate = lg.date;
        });

        var topFavs = Object.keys(favMap).map(function (k) { return favMap[k]; }).sort(function (a, b) {
          return b.count - a.count;
        }).slice(0, 3);

        var catPillsHtml = ['dry', 'can', 'freeze', 'treat'].filter(function (k) { return catLogCount[k] > 0; }).map(function (k) {
          var ci = MP.CATEGORIES[k];
          var pct = Math.round((catLogCount[k] / r30.food.length) * 100);
          return '<span style="background:#FAFAF9;border:1px solid #E7E5E4;color:#44403C;padding:3px 9px;border-radius:8px;font-size:11.5px;font-weight:700;">' + ci.icon + ' ' + ci.label + ' ' + catLogCount[k] + '顿 (' + pct + '%)</span>';
        }).join('');

        var medals = ['🥇', '🥈', '🥉'];
        var topRowsHtml = topFavs.map(function (fav, idx) {
          var ci = MP.CATEGORIES[fav.category] || MP.CATEGORIES.dry;
          var ratings = Object.keys(fav.ratings).map(function (key) {
            return MP.PALATABILITY[key].label + ' ' + fav.ratings[key] + '次';
          }).join(' · ');
          return (
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#FAFAF9;border:1px solid #F5F5F4;">' +
              '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                '<span style="font-size:15px;">' + (medals[idx] || '🐾') + '</span>' +
                '<span style="font-size:11px;background:#E7E5E4;color:#44403C;padding:1px 6px;border-radius:5px;flex-shrink:0;">' + ci.icon + ci.label + '</span>' +
                '<strong style="font-size:13px;color:#1C1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Utils.escapeHtml(fav.title) + (ratings ? ' · ' + Utils.escapeHtml(ratings) : '') + '</strong>' +
              '</div>' +
              '<span style="font-size:12px;font-weight:800;color:#EA580C;white-space:nowrap;">已记录喂食 ' + fav.count + ' 顿</span>' +
            '</div>'
          );
        }).join('');

        foodHtml =
          '<div style="font-size:11.5px;font-weight:800;color:#9A3412;margin-bottom:6px;">🍽️ 普通食品结构与 TOP 3 偏好（仅统计猫粮/湿粮/冻干/零食）</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' + catPillsHtml + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">' + topRowsHtml + '</div>';
      }

      // Separate Supplement & Medicine 30-day block
      var careHtml = '';
      if (r30.supp.length > 0 || r30.med.length > 0) {
        var summarizeCare = function (arr) {
          var m = {};
          arr.forEach(function (lg) {
            var product = Domain.resolveLogProduct(lg);
            var k = '[' + (product.brand || '') + '] ' + product.name;
            m[k] = (m[k] || 0) + 1;
          });
          return Object.keys(m).map(function (k) { return Utils.escapeHtml(k) + ' ×' + m[k] + '次'; }).join(' · ');
        };
        careHtml =
          '<div style="margin-top:11px;padding-top:10px;border-top:1px dashed #E7E5E4;display:flex;flex-direction:column;gap:6px;">' +
            '<div style="font-size:11.5px;font-weight:800;color:#44403C;">💊 营养品与药品护理独立统计（不混入日常饮食占比）</div>' +
            (r30.supp.length > 0
              ? '<div style="padding:7px 10px;border-radius:9px;background:#F0F9FF;border:1px solid #BAE6FD;font-size:11.5px;color:#075985;"><strong>💊 营养品 (' + r30.supp.length + '次)：</strong>' + summarizeCare(r30.supp) + '</div>'
              : '') +
            (r30.med.length > 0
              ? '<div style="padding:7px 10px;border-radius:9px;background:#F0FDF4;border:1px solid #BBF7D0;font-size:11.5px;color:#14532D;"><strong>🩺 药品/驱虫 (' + r30.med.length + '次)：</strong>' + summarizeCare(r30.med) + '</div>'
              : '') +
          '</div>';
      }

      prefBox.innerHTML = foodHtml + careHtml;
    }

    // ==================== SUB-VIEW 3B: BRAND DEEP ARCHIVE (Filterable by Food / Supp / Med) ====================
    var bScope = st.brandScopeFilter || 'all';
    var bScopeBtns = document.querySelectorAll('#brandScopeBar [data-brand-scope]');
    for (var bsIdx = 0; bsIdx < bScopeBtns.length; bsIdx++) {
      bScopeBtns[bsIdx].classList.toggle('active', bScopeBtns[bsIdx].getAttribute('data-brand-scope') === bScope);
    }

    var brandGroups = {};
    uniqueProducts.forEach(function (prod) {
      if (bScope !== 'all' && prod.group !== bScope) return;
      var b = prod.brand;
      if (!brandGroups[b]) {
        brandGroups[b] = { products: [], activeSkus: 0, foodEatenUnits: Object.create(null), careUsedUnits: Object.create(null), spendCny: 0, spendJpy: 0 };
      }
      brandGroups[b].products.push(prod);
      if (prod.inStockQty > 0) brandGroups[b].activeSkus += 1;
      if (prod.group === 'food') {
        addUnitQuantity(brandGroups[b].foodEatenUnits, prod.unit, prod.eatenQty);
      } else {
        addUnitQuantity(brandGroups[b].careUsedUnits, prod.unit, prod.eatenQty);
      }
    });

    st.items.forEach(function (it) {
      if (it.sourceBatchId) return;
      if (bScope !== 'all' && MP.getCategoryGroup(it.category) !== bScope) return;
      var b = (it.brand || '未命名品牌').trim();
      if (!brandGroups[b]) return;
      var price = Number(it.price) || 0;
      if (price <= 0) return;
      var totalUnitsInBatch = (Number(it.quantity) || 0) + (Number(it.eatenCount) || (Number(it.quantity) <= 0 ? (Number(it.consumedCount) || Number(it.lastQuantity) || 1) : 0));
      if (it.currency === 'JPY') {
        brandGroups[b].spendJpy += price * totalUnitsInBatch;
      } else {
        brandGroups[b].spendCny += price * totalUnitsInBatch;
      }
    });

    var brandNames = Object.keys(brandGroups).sort(function (a, b) {
      return brandGroups[b].activeSkus - brandGroups[a].activeSkus || brandGroups[b].products.length - brandGroups[a].products.length;
    });

    document.getElementById('brandTotalCountBadge').textContent = '共 ' + brandNames.length + ' 个品牌';
    var brandEl = document.getElementById('brandStatsList');
    var brandPagerEl = document.getElementById('brandPaginationBar');
    if (brandNames.length === 0) {
      if (brandPagerEl) brandPagerEl.classList.add('hidden-view');
      brandEl.innerHTML = '<div style="font-size:13px;color:#A8A29E;padding:8px 0;">当前分类下暂无品牌记录</div>';
    } else {
      var bPageSize = Number(st.brandPageSize) || 5;
      var bTotalPages = Math.max(1, Math.ceil(brandNames.length / bPageSize));
      if (st.brandPage > bTotalPages) st.brandPage = bTotalPages;
      if (st.brandPage < 1) st.brandPage = 1;
      var pagedBrandNames = brandNames.slice((st.brandPage - 1) * bPageSize, st.brandPage * bPageSize);

      if (brandNames.length > 5 || bTotalPages > 1) {
        brandPagerEl.classList.remove('hidden-view');
        document.getElementById('brandPageInfoText').textContent =
          '第 ' + st.brandPage + ' / ' + bTotalPages + ' 页 (共 ' + brandNames.length + ' 个品牌)';
        var bpPrev = document.getElementById('prevBrandPageBtn');
        var bpNext = document.getElementById('nextBrandPageBtn');
        bpPrev.disabled = (st.brandPage <= 1);
        bpPrev.style.opacity = st.brandPage <= 1 ? '0.45' : '1';
        bpNext.disabled = (st.brandPage >= bTotalPages);
        bpNext.style.opacity = st.brandPage >= bTotalPages ? '0.45' : '1';
        var bSizeSel = document.getElementById('brandPageSizeSelect');
        if (bSizeSel && String(bSizeSel.value) !== String(bPageSize)) {
          bSizeSel.value = String(bPageSize);
        }
      } else {
        brandPagerEl.classList.add('hidden-view');
      }

      brandEl.innerHTML = pagedBrandNames.map(function (b) {
        var g = brandGroups[b];
        var spendStr = formatGroupValueStr(g.spendCny, g.spendJpy);
        var spendBadge = (g.spendCny > 0 || g.spendJpy > 0) ? (' · 累计购入 ' + spendStr) : '';
        var consParts = [];
        var foodConsumed = formatUnitQuantities(g.foodEatenUnits);
        var careConsumed = formatUnitQuantities(g.careUsedUnits);
        if (foodConsumed) consParts.push('累计已核销 ' + foodConsumed);
        if (careConsumed) consParts.push('营养/药品已核销 ' + careConsumed);
        var consText = consParts.length ? consParts.join(' · ') : '暂无核销归档';

        var skuPillsHtml = g.products.map(function (prod) {
          var ci = MP.CATEGORIES[prod.category] || MP.CATEGORIES.dry;
          var pInfo = MP.getPalatabilityBadgeInfo(prod.rep);
          var pillBg = pInfo ? pInfo.bg : '#FFFFFF';
          var pillColor = pInfo ? pInfo.text : '#57534E';
          var stockDot = prod.inStockQty > 0 ? (' (余' + prod.inStockQty + prod.unit + ')') : ' (已用完)';
          return (
            '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:8px;font-size:11.5px;font-weight:600;background:' + pillBg + ';color:' + pillColor + ';border:1px solid rgba(0,0,0,0.06);">' +
              ci.icon + ' ' + Utils.escapeHtml(prod.name) + Utils.escapeHtml(stockDot) +
            '</span>'
          );
        }).join('');

        return (
          '<button type="button" data-jump-brand="' + Utils.escapeHtml(b) + '" style="width:100%;text-align:left;padding:12px 14px;border-radius:14px;background:#FAFAF9;border:1px solid #E7E5E4;cursor:pointer;display:block;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<strong style="font-size:14.5px;color:#1C1917;">🏷️ ' + Utils.escapeHtml(b) + '</strong>' +
              '<span style="font-size:12px;font-weight:700;color:#EA580C;">在库 ' + g.activeSkus + ' 款 / 共 ' + g.products.length + ' 款 ▶</span>' +
            '</div>' +
            '<div style="margin-top:3px;font-size:11.5px;color:#78716C;">' +
              Utils.escapeHtml(consText + spendBadge) +
            '</div>' +
            '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">' + skuPillsHtml + '</div>' +
          '</button>'
        );
      }).join('');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
