/* Meow Pantry Pure Utilities: Strict Date Math (DST & Leap-Year Safe), Spec/Price Parsers, HTML Escape */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils = {};

  Utils.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  var categoryIconPaths = {
    dry: '<path d="M3 11h18"/><path d="M4 11c0 5 3.5 8 8 8s8-3 8-8"/><path d="M8 21h8"/>' +
      '<g stroke-width="1.6"><circle cx="6.9" cy="9" r="0.8"/><circle cx="10.3" cy="9" r="0.8"/>' +
      '<circle cx="13.7" cy="9" r="0.8"/><circle cx="17.1" cy="9" r="0.8"/><circle cx="8.6" cy="6.1" r="0.8"/>' +
      '<circle cx="12" cy="6.1" r="0.8"/><circle cx="15.4" cy="6.1" r="0.8"/></g>',
    can: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>' +
      '<path class="category-icon-chicken" stroke-width="1.5" d="M8.5 12.5C8.5 11.2 9.3 10.5 10.3 10.5S12 11.2 12 12.2C12 13 12.7 13.5 13.5 13.5C14.5 13.5 15.3 13 16 12C16.3 14 16 16 15 17C14 18.3 12 18.7 10.8 18C9.3 17.2 8.8 15.5 8.8 14.2C8.8 13.5 8.5 13.2 8.5 12.5Z"/><path class="category-icon-beak" stroke-width="1.5" d="m8.5 11.8-1.6.8 1.6.7"/>',
    freeze: '<path d="M10.5 7l6 3.5v7l-6 3.5-6-3.5v-7z"/><path d="M4.5 10.5l6 3.5 6-3.5"/>' +
      '<path d="M10.5 14v7"/><path d="M19.5 2v5M17 4.5h5"/><path d="M3.5 3.5v3M2 5h3"/>',
    treat: '<rect x="2.5" y="7.5" width="19" height="9" rx="1.5"/><path d="M5.5 7.5v9"/>' +
      '<path d="M8.5 12c2-2.6 5.4-2.8 7.8 0-2.4 2.8-5.8 2.6-7.8 0z"/><path d="M16.3 12l2.5-2v4z"/>',
    supp: '<rect x="9" y="3" width="6" height="3" rx="1"/><path d="M8 8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/>' +
      '<path d="M12 12v4"/><path d="M10 14h4"/>',
    med: '<g transform="translate(12 12) scale(.88) translate(-12 -12)">' +
      '<path d="M4.5 12.5l8-8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1-7-7"/><path d="M8.5 8.5l7 7"/></g>',
    other: '<path d="M12 12.5c-2.5 0-5 2.2-5 4.6 0 1.6 1.3 2.4 2.7 2.4 1 0 1.5-.4 2.3-.4s1.3.4 2.3.4c1.4 0 2.7-.8 2.7-2.4 0-2.4-2.5-4.6-5-4.6z"/>' +
      '<circle cx="5.5" cy="11" r="1.5"/><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="18.5" cy="11" r="1.5"/>'
  };

  Utils.getCategoryIcon = function (category, size) {
    var key = Object.hasOwn(categoryIconPaths, category) ? category : 'other';
    var pixels = size === 20 || size === 40 ? size : 28;
    return '<svg class="record-category-icon record-category-icon--' + key + '" width="' + pixels + '" height="' + pixels + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      categoryIconPaths[key] + '</svg>';
  };

  Utils.uiIcon = function (name, size) {
    if (!name) return '';
    var pixels = [20, 24].includes(size) ? size : 16;
    var id = name === 'paw-print' ? 'feed-paw' : 'ui-' + name;
    return '<svg class="ui-icon" width="' + pixels + '" height="' + pixels +
      '" aria-hidden="true"><use href="#' + Utils.escapeHtml(id) + '"></use></svg>';
  };

  Utils.iconLabel = function (name, label, size) {
    return Utils.uiIcon(name, size) + Utils.escapeHtml(label);
  };

  Utils.getPalatabilityIcon = function (key, size) {
    if (!['love', 'ok', 'coax', 'meh'].includes(key)) return '';
    var pixels = size === 32 ? 32 : 16;
    return '<svg class="pal-cat-face-inline" width="' + pixels + '" height="' + pixels +
      '" viewBox="0 0 36 36" aria-hidden="true"><use href="#pal-cat-' + key + '"></use></svg>';
  };

  Utils.formatPalatabilityBadge = function (item, badge) {
    if (badge.key === 'mixed') return Utils.escapeHtml(badge.label);
    if (MP.getCategoryGroup(item.category) === 'med') return Utils.iconLabel(badge.icon, badge.label);
    return Utils.getPalatabilityIcon(badge.key) + ' ' + Utils.escapeHtml(badge.label);
  };

  Utils.round2 = function (num) {
    var n = Number(num);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  };

  Utils.getTodayStr = function () {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  };

  Utils.getNowDateTimeStr = function (date) {
    var now = date || new Date();
    var y = now.getFullYear();
    var mo = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    var h = String(now.getHours()).padStart(2, '0');
    var mi = String(now.getMinutes()).padStart(2, '0');
    return y + '-' + mo + '-' + d + ' ' + h + ':' + mi;
  };

  // Strict local date parser anchored at 12:00:00 noon to avoid DST 23h/25h rounding drift
  // Also rejects impossible calendar dates like "2026-02-31" instead of rolling into March!
  Utils.parseLocalDate = function (str) {
    if (!str || typeof str !== 'string') return null;
    var clean = str.trim();
    var mMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!mMatch) return null;
    var y = parseInt(mMatch[1], 10);
    var m = parseInt(mMatch[2], 10) - 1;
    var d = parseInt(mMatch[3], 10);
    if (y < 1990 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
    var dt = new Date(y, m, d, 12, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) {
      return null;
    }
    return dt;
  };

  Utils.normalizeDateStr = function (str) {
    var dt = Utils.parseLocalDate(str);
    return dt ? Utils.formatDateObj(dt) : '';
  };

  Utils.formatDateObj = function (dt) {
    if (!dt || isNaN(dt.getTime())) return '';
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  };

  Utils.addShelfLife = function (dateStr, val, unit) {
    var dt = Utils.parseLocalDate(dateStr);
    var num = parseInt(val, 10);
    if (!dt || isNaN(num) || num <= 0) return '';
    if (unit === 'days') {
      dt.setDate(dt.getDate() + num);
    } else {
      var origDay = dt.getDate();
      dt.setMonth(dt.getMonth() + num);
      // Clamp month-end overflow (e.g., Jan 31 + 1 month -> Feb 28/29; Leap Feb 29 + 12 months -> Feb 28)
      if (dt.getDate() !== origDay) {
        dt.setDate(0);
      }
    }
    return Utils.formatDateObj(dt);
  };

  Utils.subtractShelfLife = function (expStr, val, unit) {
    var dt = Utils.parseLocalDate(expStr);
    var num = parseInt(val, 10);
    if (!dt || isNaN(num) || num <= 0) return '';
    if (unit === 'days') {
      dt.setDate(dt.getDate() - num);
    } else {
      var origDay = dt.getDate();
      dt.setMonth(dt.getMonth() - num);
      if (dt.getDate() !== origDay) {
        dt.setDate(0);
      }
    }
    return Utils.formatDateObj(dt);
  };

  Utils.diffDaysBetween = function (fromDateStr, toDateStr) {
    var dFrom = Utils.parseLocalDate(fromDateStr);
    var dTo = Utils.parseLocalDate(toDateStr);
    if (!dFrom || !dTo) return null;
    return Math.round((dTo.getTime() - dFrom.getTime()) / 86400000);
  };

  Utils.diffDaysFromToday = function (targetDateStr, refTodayStr) {
    return Utils.diffDaysBetween(refTodayStr || Utils.getTodayStr(), targetDateStr);
  };

  Utils.openShelfEndDate = function (openedDate, limit) {
    return openedDate && limit > 0 ? Utils.addShelfLife(openedDate, limit, 'days') : '';
  };

  Utils.openShelfDaysRemaining = function (openedDate, limit, today) {
    return Utils.diffDaysFromToday(Utils.openShelfEndDate(openedDate, limit), today);
  };

  Utils.shiftDaysFromDate = function (baseDateStr, offsetDays) {
    var d = Utils.parseLocalDate(baseDateStr || Utils.getTodayStr());
    if (!d) return '';
    d.setDate(d.getDate() + (Number(offsetDays) || 0));
    return Utils.formatDateObj(d);
  };

  Utils.shiftDaysFromToday = function (offsetDays) {
    return Utils.shiftDaysFromDate(Utils.getTodayStr(), offsetDays);
  };

  Utils.formatCnDateText = function (dateStr) {
    if (!dateStr) return '未选择';
    var norm = Utils.normalizeDateStr(dateStr);
    if (!norm) return String(dateStr);
    var parts = norm.split('-');
    return parts[0] + '年' + parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
  };

  Utils.calcConsumeDays = function (openStr, finishStr) {
    var diff = Utils.diffDaysBetween(openStr, finishStr);
    if (diff === null || diff < 0) return null;
    return diff === 0 ? 1 : diff;
  };

  Utils.getWeekdayName = function (dateStr) {
    var dt = Utils.parseLocalDate(dateStr);
    if (!dt) return '';
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return names[dt.getDay()];
  };

  var mealSlots = [
    { id: 'breakfast', label: '早饭', display: '早上', icon: 'sunrise', legacy: ['早饭', '🌅 早饭'] },
    { id: 'lunch', label: '午饭', display: '中午', icon: 'sun', legacy: ['午饭', '☀️ 午饭'] },
    { id: 'dinner', label: '晚饭', display: '晚上', icon: 'moon', legacy: ['晚饭', '🌙 晚饭'] },
    { id: 'snack', label: '加餐/零食', display: '零食加餐', icon: 'cookie', legacy: ['加餐/零食', '🍪 加餐/零食'] },
    { id: 'care', label: '用药/护理', display: '用药／护理', icon: 'stethoscope', legacy: ['用药/护理', '🩺 用药/护理'] },
    { id: 'other', label: '其他', display: '其他', icon: '', legacy: ['其他', '投喂', '🍽️ 投喂'] }
  ];

  Utils.normalizeMealSlot = function (value) {
    var text = String(value || '').trim();
    var legacy = text.replace(/\uFE0F/g, '').replace(/\s/g, '');
    var slot = mealSlots.find(function (entry) {
      return entry.id === text || entry.legacy.some(function (alias) {
        return alias.replace(/\uFE0F/g, '').replace(/\s/g, '') === legacy;
      });
    });
    return slot ? slot.id : (text || 'other');
  };

  Utils.formatMealSlot = function (value) {
    var id = Utils.normalizeMealSlot(value);
    var slot = mealSlots.find(function (entry) { return entry.id === id; });
    return slot ? slot.label : id;
  };

  Utils.formatMealSlotDisplay = function (value) {
    var id = Utils.normalizeMealSlot(value);
    var slot = mealSlots.find(function (entry) { return entry.id === id; });
    return slot ? slot.display : id;
  };

  Utils.mealSlotOptions = function () {
    return mealSlots.filter(function (slot) { return slot.id !== 'other'; }).map(function (slot) {
      return { id: slot.id, label: slot.display, icon: slot.icon };
    });
  };

  Utils.getCurrentMealSlot = function () {
    var hr = new Date().getHours();
    if (hr < 10) return 'breakfast';
    if (hr < 15) return 'lunch';
    if (hr < 21) return 'dinner';
    return 'snack';
  };

  Utils.formatNumber = function (value, digits) {
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits });
  };

  Utils.formatQuantity = function (value, unit) {
    return Utils.formatNumber(value, /^(克|g)$/i.test(unit) ? 0 : undefined) + (unit || '');
  };

  Utils.paginateList = function (entries, state, pageKey, pager) {
    var size = state[pageKey + 'Size'];
    if (![5, 10, 20, 50].includes(size)) size = 5;
    var totalPages = Math.max(1, Math.ceil(entries.length / size));
    var page = Math.min(totalPages, Math.max(1, state[pageKey]));
    state[pageKey] = page;
    pager.classList.toggle('hidden-view', entries.length === 0);
    var count = pager.querySelector('.list-pagination-count');
    count.textContent = page + ' / ' + totalPages;
    count.classList.toggle('hidden-view', totalPages === 1);
    pager.querySelector('.list-pagination-buttons').classList.toggle('hidden-view', totalPages === 1);
    pager.querySelector('select').value = size;
    var buttons = pager.querySelectorAll('button');
    buttons[0].disabled = page === 1;
    buttons[1].disabled = page === totalPages;
    return entries.slice((page - 1) * size, page * size);
  };

  Utils.formatPercent = function (value) {
    return Number.isFinite(value)
      ? value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
  };

  Utils.formatDays = function (days) {
    if (!Number.isFinite(days)) return { text: '—', tone: 'unknown' };
    var rounded = Math.round(days);
    var tone = days < 0 ? 'expired' : rounded <= 3 ? 'urgent' : rounded <= 14 ? 'warning' : 'fresh';
    return { text: Utils.formatQuantity(Math.abs(rounded), '天'), tone: tone };
  };

  Utils.formatListDate = function (value, fallback) {
    return Utils.normalizeDateStr(value) || (fallback || '—');
  };

  Utils.formatRelativeYearDate = function (value, today) {
    var date = Utils.parseLocalDate(value);
    if (!date) return '';
    var current = Utils.parseLocalDate(today) || new Date();
    return (date.getFullYear() === current.getFullYear() ? '' : date.getFullYear() + '年') +
      (date.getMonth() + 1) + '月' + date.getDate() + '日';
  };

  Utils.formatSentenceDate = function (value) {
    var date = Utils.parseLocalDate(value);
    return date ? (date.getMonth() + 1) + '月' + date.getDate() + '日' : '—';
  };

  Utils.formatMonthLabel = function (value) {
    var match = /^(\d{4})-(\d{2})$/.exec(value);
    return match ? match[1] + '年' + Number(match[2]) + '月' : value;
  };

  Utils.formatMoney = function (price, currency, perUnit) {
    var num = Number(price);
    if (!Number.isFinite(num) || num <= 0) return '';
    var yen = currency === 'JPY';
    var digits = yen ? 0 : 2;
    var amount = num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return amount + (yen ? '円' : '元') + (perUnit ? '/' + perUnit : '');
  };

  Utils.parsePortionSpec = function (specStr) {
    return /^(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升)(?:\s*\/\s*(.+))?$/i.exec(
      String(specStr || '').trim()
    );
  };

  Utils.requiresUnitWeight = function (category) {
    return category === 'dry' || category === 'can' || category === 'freeze';
  };

  Utils.legacyUnitWeight = function (spec, unit) {
    var match = Utils.parsePortionSpec(spec);
    if (!match || (match[3] && match[3] !== unit) || /^(ml|毫升)$/i.test(match[2])) return 0;
    return Number(match[1]) * (/^(kg|千克)$/i.test(match[2]) ? 1000 : 1);
  };

  Utils.itemPortionSpec = function (item) {
    var weight = Number(item.unit_net_weight_g);
    return Number.isFinite(weight) && weight > 0 ? weight.toFixed(10).replace(/\.?0+$/, '') + 'g' : '';
  };

  Utils.formatItemSpec = function (item) {
    var weight = Number(item.unit_net_weight_g);
    var note = String(item.spec || '').trim();
    if (!(weight > 0)) return note;
    var spec = weight >= 1000
      ? Utils.formatQuantity(weight / 1000, 'kg')
      : Utils.formatNumber(weight) + 'g';
    return note && Utils.legacyUnitWeight(note, item.unit) !== weight ? spec + ' · ' + note : spec;
  };

  Utils.formatPer100gPrice = function (price, currency, unitWeightGrams) {
    var p = Number(price);
    if (!isFinite(p) || p <= 0) return '';
    var totalGrams = Number(unitWeightGrams);
    if (!totalGrams || totalGrams <= 0) return '';
    var per100g = (p / totalGrams) * 100;
    return '≈' + Utils.formatMoney(per100g, currency, '100g');
  };

  Utils.formatRemainFractionText = function (remFrac, unitStr, display) {
    var r = Number(remFrac);
    if (!isFinite(r) || r <= 0 || r >= 1) return '';
    var u = unitStr || '罐';
    if (Math.abs(r - 0.5) <= 0.005) return '余1/2' + u;
    if (Math.abs(r - 2 / 3) <= 0.005) return '余2/3' + u;
    if (Math.abs(r - 1 / 3) <= 0.005) return '余1/3' + u;
    if (Math.abs(r - 0.75) <= 0.005) return '余3/4' + u;
    if (Math.abs(r - 0.25) <= 0.005) return '余1/4' + u;
    return '余' + (display ? Utils.formatPercent(r * 100) : (r < 0.0001 ? '不足0.01' : Utils.round2(r * 100)) + '%') + u;
  };

  Utils.computePortionGramLabel = function (baseLabel, frac, specStr) {
    if (!specStr || !frac || frac <= 0 || frac >= 1) return baseLabel;
    var m = String(specStr).trim().match(/^(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)$/i);
    if (!m) return baseLabel;
    var totalG = parseFloat(m[1]);
    var unitG = m[2];
    if (!totalG || totalG <= 0) return baseLabel;
    var partG = Math.round(totalG * frac);
    return baseLabel + ' (约' + partG + unitG + ')';
  };

  Utils.compressImageFile = function (file, callback) {
    if (!file) { callback(null); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var maxSide = 480;
        var w = img.width || 480;
        var h = img.height || 480;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.max(1, Math.round((h * maxSide) / w));
            w = maxSide;
          } else {
            w = Math.max(1, Math.round((w * maxSide) / h));
            h = maxSide;
          }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        var approxKb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
        callback({ dataUrl: dataUrl, kb: approxKb });
      };
      img.onerror = function () { callback(null); };
      img.src = String(ev.target.result || '');
    };
    reader.onerror = function () { callback(null); };
    reader.readAsDataURL(file);
  };
})(typeof window !== 'undefined' ? window : globalThis);
