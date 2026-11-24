/* Meow Pantry settings, backup reminder, and storage health renderer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var UI = MP.UI = MP.UI || {};

  UI.renderSettingsView = function () {
    var forecastSettings = MP.state.settings.dailyFeedGrams;
    document.querySelectorAll('[data-daily-feed]').forEach(function (input) {
      var savedGrams = forecastSettings[input.dataset.dailyFeed] ?? 0;
      if (input !== document.activeElement && input.value !== String(savedGrams)) input.value = savedGrams;
      input.nextElementSibling.textContent = savedGrams;
    });
    var missing = MP.Forecast.compute(MP.state.items, [], {}, Utils.getTodayStr()).can.missing;
    var weightAlert = document.getElementById('settingsWeightAlert');
    weightAlert.innerHTML = MP.Stats.missingWeightNotice(missing, true);
    weightAlert.classList.toggle('hidden-view', !missing.length);
    var st = MP.state;
    var photos = st.items.flatMap(MP.getItemImages);
    var photoBytes = photos.reduce(function (total, src) { return total + src.length; }, 0);
    // Estimate Base64 photo bytes separately so normal renders do not copy all photos into another large Blob.
    var metadataJson = JSON.stringify(MP.Storage.buildBackupObject(), function (key, value) {
      return key === 'images' && Array.isArray(value) ? [] : value;
    }, 2);
    function sizeLabel(bytes) {
      return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB';
    }
    document.getElementById('backupPhotoSize').textContent = '已保存 ' + photos.length + ' 张照片（含归档），照片数据约 ' +
      sizeLabel(photoBytes) + '；预计 JSON 备份约 ' +
      sizeLabel(new Blob([metadataJson]).size + photoBytes) +
      '（含照片）。照片越多，本机存储与备份越大，请定期导出。';
    var btns = document.querySelectorAll('#warnDaysGroup [data-warn-days]');
    for (var i = 0; i < btns.length; i++) {
      var d = parseInt(btns[i].getAttribute('data-warn-days'), 10);
      btns[i].setAttribute('aria-pressed', d === st.settings.warnDays);
    }
    var curBtns = document.querySelectorAll('#defaultCurrencyGroup [data-def-currency]');
    for (var j = 0; j < curBtns.length; j++) {
      var ck = curBtns[j].getAttribute('data-def-currency');
      var isCurrencySelected = ck === (st.settings.defaultCurrency || 'CNY');
      curBtns[j].setAttribute('aria-pressed', isCurrencySelected);
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
    var badgeCount = Math.max(0, Math.floor(unsaved));
    var needBackup = badgeCount > 0;
    var backupDate = Number.isFinite(lastExport.getTime()) ? Utils.formatDateObj(lastExport) : lastBk;
    var backupTime = Number.isFinite(lastExport.getTime()) ? Utils.getNowDateTimeStr(lastExport).slice(11, 16) : '';
    var statusCard = document.getElementById('backupStatusCard');
    if (statusCard) {
      statusCard.classList.toggle('needs-backup', needBackup);
      document.getElementById('backupStatusTitle').textContent = needBackup
        ? Utils.formatNumber(badgeCount) + ' 次保存未备份' : backupDate ? '已是最新备份' : '尚无备份';
      var timeLabel = document.getElementById('backupStatusTime');
      timeLabel.textContent = backupDate
        ? '上次 ' + Utils.formatRelativeYearDate(backupDate) + (backupTime ? ' ' + backupTime : '') : '尚未备份过';
      timeLabel.title = backupDate ? '上次备份：' + backupDate + (backupTime ? ' ' + backupTime : '（时间未记录）') : '';
    }

    var dotEl = document.getElementById('backupNoticeDot');
    var topBanner = document.getElementById('unbackedBanner');
    var topBannerTxt = document.getElementById('unbackedBannerText');

    if (needBackup) {
      if (dotEl) {
        dotEl.textContent = '';
        dotEl.setAttribute('aria-label', '有尚未备份的本地更改');
        dotEl.title = '有尚未备份的本地更改';
        dotEl.classList.remove('hidden-view');
      }
      if (topBanner) {
        if (badgeCount >= 5 && st.backupBannerDismissedCount !== badgeCount) {
          topBanner.classList.remove('hidden-view');
          if (topBannerTxt) {
            topBannerTxt.textContent = Utils.formatNumber(badgeCount) + ' 次本地保存尚未备份';
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
