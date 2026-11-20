/* Meow Pantry settings, backup reminder, and storage health renderer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var UI = MP.UI = MP.UI || {};

  UI.renderSettingsView = function () {
    var forecastSettings = MP.state.settings.dailyFeedGrams;
    document.querySelectorAll('[data-daily-feed]').forEach(function (input) {
      if (input !== document.activeElement) input.value = forecastSettings[input.dataset.dailyFeed] || '';
    });
    var missing = MP.Forecast.compute(MP.state.items, [], {}, Utils.getTodayStr()).can.missing;
    var weightAlert = document.getElementById('settingsWeightAlert');
    weightAlert.innerHTML = MP.Stats.missingWeightNotice(missing, true);
    weightAlert.classList.toggle('hidden-view', !missing.length);
    var st = MP.state;
    var btns = document.querySelectorAll('#warnDaysGroup [data-warn-days]');
    for (var i = 0; i < btns.length; i++) {
      var d = parseInt(btns[i].getAttribute('data-warn-days'), 10);
      btns[i].setAttribute('aria-pressed', d === st.settings.warnDays);
      btns[i].className = (d === st.settings.warnDays) ? 'ios-btn ios-btn-primary' : 'ios-btn ios-btn-secondary';
    }
    var curBtns = document.querySelectorAll('#defaultCurrencyGroup [data-def-currency]');
    for (var j = 0; j < curBtns.length; j++) {
      var ck = curBtns[j].getAttribute('data-def-currency');
      var isCurrencySelected = ck === (st.settings.defaultCurrency || 'CNY');
      curBtns[j].setAttribute('aria-pressed', isCurrencySelected);
      curBtns[j].className = isCurrencySelected
        ? 'ios-btn ios-btn-primary'
        : 'ios-btn ios-btn-secondary';
    }

    var undoWrap = document.getElementById('undoOverwriteWrap');
    var undoTimeTxt = document.getElementById('undoSnapshotTimeText');
    if (undoWrap) {
      undoWrap.classList.toggle('hidden-view', !st.storageHealth.hasPreRestoreSnapshot);
      if (undoTimeTxt && st.storageHealth.preRestoreSnapshotTime) {
        undoTimeTxt.textContent = st.storageHealth.preRestoreSnapshotTime;
      }
    }

    var unsaved = Number(st.settings.unsavedChangesCount) || 0;
    var lastBk = st.settings.lastBackupDate || '';
    var lastExport = new Date(st.settings.lastJsonExportAt || NaN);
    var exportTime = '';
    if (Number.isFinite(lastExport.getTime())) {
      exportTime = Utils.getNowDateTimeStr(lastExport);
      if (lastExport.getFullYear() === new Date().getFullYear()) exportTime = exportTime.slice(5);
    }
    var badgeCount = Math.max(0, Math.floor(unsaved));
    var needBackup = badgeCount > 0;
    var backupDate = Number.isFinite(lastExport.getTime()) ? Utils.formatDateObj(lastExport) : lastBk;
    var backupTime = Number.isFinite(lastExport.getTime()) ? Utils.getNowDateTimeStr(lastExport).slice(11, 16) : '';
    var statusCard = document.getElementById('backupStatusCard');
    if (statusCard) {
      statusCard.classList.toggle('needs-backup', needBackup);
      document.getElementById('backupStatusTitle').textContent = needBackup
        ? Utils.formatNumber(badgeCount) + ' 项未备份' : '已是最新备份';
      var timeLabel = document.getElementById('backupStatusTime');
      timeLabel.textContent = backupDate
        ? '上次 ' + Utils.formatSentenceDate(backupDate) + (backupTime ? ' ' + backupTime : '') : '尚未备份过';
      timeLabel.title = backupDate ? '上次备份：' + backupDate + (backupTime ? ' ' + backupTime : '（时间未记录）') : '';
    }

    var dotEl = document.getElementById('backupNoticeDot');
    var topBanner = document.getElementById('unbackedBanner');
    var topBannerTxt = document.getElementById('unbackedBannerText');

    if (needBackup) {
      if (dotEl) {
        dotEl.textContent = badgeCount > 99 ? '99+' : Utils.formatNumber(badgeCount);
        dotEl.setAttribute('aria-label', Utils.formatQuantity(badgeCount, '项') + '更改尚未备份');
        dotEl.classList.remove('hidden-view');
      }
      if (topBanner) {
        if (badgeCount >= 5 && st.backupBannerDismissedCount !== badgeCount) {
          topBanner.classList.remove('hidden-view');
          if (topBannerTxt) {
            topBannerTxt.innerHTML = exportTime
              ? ('<strong>备份提醒：</strong>自上次发起导出 (' + Utils.escapeHtml(exportTime) + ') 后已有 <strong>' + Utils.formatQuantity(badgeCount, '项') + '</strong>改动未备份')
              : ('<strong>备份提醒：</strong>已累计 <strong>' + Utils.formatQuantity(badgeCount, '项') + '</strong>数据变动未导出 JSON 备份');
          }
        } else {
          topBanner.classList.add('hidden-view');
        }
      }
    } else {
      if (dotEl) dotEl.classList.add('hidden-view');
      if (topBanner) topBanner.classList.add('hidden-view');
    }

    var health = st.storageHealth;
    var storageStatus = document.getElementById('storageStatusText');
    var dualEngineHealthy = health.idbAvailable && health.lsAvailable;
    storageStatus.classList.toggle('is-healthy', dualEngineHealthy);
    storageStatus.textContent = dualEngineHealthy
      ? '本地存储 · 双引擎正常'
      : health.lsAvailable ? '本地存储 · LocalStorage'
        : health.idbAvailable ? '本地存储 · IndexedDB' : '本地存储 · 仅当前会话';
  };
})(typeof window !== 'undefined' ? window : globalThis);
