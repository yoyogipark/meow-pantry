/* Meow Pantry settings, backup reminder, and storage health renderer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var UI = MP.UI = MP.UI || {};

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
    var lastExport = new Date(st.settings.lastJsonExportAt);
    var exportTime = '';
    if (Number.isFinite(lastExport.getTime())) {
      exportTime = Utils.getNowDateTimeStr(lastExport);
      if (lastExport.getFullYear() === new Date().getFullYear()) exportTime = exportTime.slice(5);
    }
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
            topBannerTxt.innerHTML = exportTime
              ? ('<strong>备份提醒：</strong>自上次发起导出 (' + Utils.escapeHtml(exportTime) + ') 后已有 <strong>' + badgeCount + ' 项</strong>改动未备份')
              : ('<strong>备份提醒：</strong>已累计 <strong>' + badgeCount + ' 项</strong>数据变动未导出 JSON 备份');
          }
        } else {
          topBanner.classList.add('hidden-view');
        }
      }
    } else {
      if (dotEl) dotEl.classList.add('hidden-view');
      if (topBanner) topBanner.classList.add('hidden-view');
    }

    if (setBadge) {
      setBadge.style.background = exportTime ? '#DCFCE7' : '#F5F5F4';
      setBadge.style.color = exportTime ? '#15803D' : '#78716C';
      setBadge.textContent = exportTime ? '✓ 已备份 ' + exportTime : '未备份';
    }

    var engineLabel = (st.storageHealth.idbAvailable && st.storageHealth.lsAvailable)
      ? '双引擎同步正常 (IndexedDB + LocalStorage)'
      : (st.storageHealth.lsAvailable ? 'LocalStorage 本地存储正常' : '内存会话模式');

    document.getElementById('storageStatusText').textContent =
      engineLabel + ' · 已存 ' + activeItemsCount + ' 批商品、' + st.logs.length + ' 条饮食记录、' + st.stockHistory.length + ' 条库存流水（含 ' + customPhotos + ' 张实拍图）';
  };
})(typeof window !== 'undefined' ? window : globalThis);
