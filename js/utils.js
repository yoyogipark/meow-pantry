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

  Utils.getNowDateTimeStr = function () {
    var now = new Date();
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

  Utils.getCurrentMealSlot = function () {
    var hr = new Date().getHours();
    if (hr < 10) return '🌅 早饭';
    if (hr < 15) return '☀️ 午饭';
    if (hr < 21) return '🌙 晚饭';
    return '🍪 加餐/零食';
  };

  Utils.formatMoney = function (price, currency) {
    var num = Number(price);
    if (!isFinite(num) || num <= 0) return '';
    var cur = currency === 'JPY' ? 'JPY' : 'CNY';
    if (cur === 'JPY') {
      return Math.round(num).toLocaleString('en-US') + '円';
    }
    var fixed = Math.round(num * 100) % 100 === 0 ? String(Math.round(num)) : num.toFixed(1);
    return 'CN¥' + fixed;
  };

  Utils.parseSpecToGrams = function (specStr) {
    if (!specStr || typeof specStr !== 'string') return 0;
    var s = specStr.trim().toLowerCase();
    var mComp = s.match(/(\d+(?:\.\d+)?)\s*(kg|千克|g|克|ml|毫升)\s*[x×\*]\s*(\d+)/i);
    if (mComp) {
      var baseVal = parseFloat(mComp[1]);
      var unit = mComp[2];
      var mult = parseInt(mComp[3], 10) || 1;
      var g = (unit === 'kg' || unit === '千克') ? baseVal * 1000 : baseVal;
      return g * mult;
    }
    var mSingle = s.match(/(\d+(?:\.\d+)?)\s*(kg|千克|g|克|ml|毫升)/i);
    if (mSingle) {
      var val = parseFloat(mSingle[1]);
      var u = mSingle[2];
      return (u === 'kg' || u === '千克') ? val * 1000 : val;
    }
    return 0;
  };

  Utils.formatPer100gPrice = function (price, currency, specStr) {
    var p = Number(price);
    if (!isFinite(p) || p <= 0) return '';
    var totalGrams = Utils.parseSpecToGrams(specStr);
    if (!totalGrams || totalGrams <= 0) return '';
    var per100g = (p / totalGrams) * 100;
    if (currency === 'JPY') {
      return '≈' + Math.round(per100g).toLocaleString('en-US') + '円/100g';
    }
    var fixed = per100g >= 10 ? per100g.toFixed(1) : per100g.toFixed(2);
    return '≈¥' + fixed + '/100g';
  };

  Utils.formatRemainFractionText = function (remFrac, unitStr) {
    var r = Number(remFrac);
    if (!isFinite(r) || r <= 0.05 || r >= 0.98) return '';
    var u = unitStr || '罐';
    if (Math.abs(r - 0.5) <= 0.06) return '余1/2' + u;
    if (Math.abs(r - 0.66) <= 0.08) return '余2/3' + u;
    if (Math.abs(r - 0.33) <= 0.08) return '余1/3' + u;
    if (Math.abs(r - 0.75) <= 0.06) return '余3/4' + u;
    if (Math.abs(r - 0.25) <= 0.06) return '余1/4' + u;
    return '余' + Math.round(r * 100) + '%' + u;
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
