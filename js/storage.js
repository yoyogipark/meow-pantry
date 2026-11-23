/* Meow Pantry Dual Storage Engine (Singleton IndexedDB + LocalStorage + Timestamp Sync + Validated Backup/Restore) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Storage = MP.Storage = {};

  var dbInstance = null;
  var dbOpeningCallbacks = null;

  Storage.openIDB = function (callback) {
    if (dbInstance) {
      callback(dbInstance);
      return;
    }
    if (dbOpeningCallbacks) {
      dbOpeningCallbacks.push(callback);
      return;
    }
    try {
      if (!global.indexedDB) {
        MP.state.storageHealth.idbAvailable = false;
        callback(null);
        return;
      }
      dbOpeningCallbacks = [callback];
      var req = global.indexedDB.open(MP.IDB_CONFIG.NAME, MP.IDB_CONFIG.VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(MP.IDB_CONFIG.STORE)) {
          db.createObjectStore(MP.IDB_CONFIG.STORE);
        }
      };
      req.onsuccess = function (ev) {
        dbInstance = ev.target.result;
        MP.state.storageHealth.idbAvailable = true;
        dbInstance.onversionchange = function () {
          try { dbInstance.close(); } catch (e) {}
          dbInstance = null;
        };
        dbInstance.onclose = function () {
          dbInstance = null;
        };
        var cbs = dbOpeningCallbacks || [];
        dbOpeningCallbacks = null;
        for (var i = 0; i < cbs.length; i++) cbs[i](dbInstance);
      };
      req.onerror = function () {
        MP.state.storageHealth.idbAvailable = false;
        var cbs = dbOpeningCallbacks || [];
        dbOpeningCallbacks = null;
        for (var i = 0; i < cbs.length; i++) cbs[i](null);
      };
      req.onblocked = function () {
        var cbs = dbOpeningCallbacks || [];
        dbOpeningCallbacks = null;
        for (var i = 0; i < cbs.length; i++) cbs[i](null);
      };
    } catch (err) {
      MP.state.storageHealth.idbAvailable = false;
      dbOpeningCallbacks = null;
      callback(null);
    }
  };

  Storage.applyLoadedSettings = function (pSet, target) {
    if (!pSet || typeof pSet !== 'object') return;
    var st = target || MP.state;
    if (typeof pSet.profileName === 'string') st.settings.profileName = pSet.profileName.trim().slice(0, 24);
    if (typeof pSet.profileAvatar === 'string' && (pSet.profileAvatar === '' ||
        /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(pSet.profileAvatar))) {
      st.settings.profileAvatar = pSet.profileAvatar;
    }
    if (typeof pSet.warnDays === 'number' && pSet.warnDays > 0) st.settings.warnDays = pSet.warnDays;
    if (pSet.defaultCurrency === 'JPY' || pSet.defaultCurrency === 'CNY') {
      st.settings.defaultCurrency = pSet.defaultCurrency;
    }
    if (pSet.dailyFeedGrams && typeof pSet.dailyFeedGrams === 'object') {
      st.settings.dailyFeedGrams = {};
      ['dry', 'freeze', 'can'].forEach(function (category) {
        var storedGrams = pSet.dailyFeedGrams[category];
        var grams = storedGrams == null || storedGrams === '' ? NaN : Number(storedGrams);
        st.settings.dailyFeedGrams[category] = Number.isFinite(grams) && grams >= 0 ? grams : null;
      });
    }
    if (typeof pSet.pantryPageSize === 'number') {
      st.pantryPageSize = [5, 10, 20, 50].includes(pSet.pantryPageSize) ? pSet.pantryPageSize : 5;
      st.settings.pantryPageSize = st.pantryPageSize;
    }
    if (pSet.pantryDisplayMode === 'compact' || pSet.pantryDisplayMode === 'card') {
      st.pantryDisplayMode = pSet.pantryDisplayMode;
      st.settings.pantryDisplayMode = pSet.pantryDisplayMode;
    }
    ['pantryStatusHintSeen', 'pantryHistoryHintSeen'].forEach(function (key) {
      if (pSet[key] === true) st.settings[key] = true;
    });
    if (typeof pSet.lastBackupDate === 'string') {
      st.settings.lastBackupDate = pSet.lastBackupDate;
    }
    if (typeof pSet.unsavedChangesCount === 'number' && pSet.unsavedChangesCount >= 0) {
      st.settings.unsavedChangesCount = pSet.unsavedChangesCount;
    }
    if (typeof pSet.lastSavedAt === 'number' && pSet.lastSavedAt > 0) {
      st.settings.lastSavedAt = pSet.lastSavedAt;
    }
    st.settings.schemaVersion = MP.SCHEMA_VERSION;
    // Strip legacy unused keys if any existed
    delete st.settings.darkMode;
    delete st.settings.showImages;
  };

  function showStorageWriteWarning(message) {
    var warning = global.document && global.document.getElementById('storageWriteWarning');
    if (!warning) return;
    warning.textContent = message || '';
    warning.classList.toggle('hidden-view', !message);
  }

  var committedRevision = 0;

  function newerLocalState(revision) {
    try {
      var snapshot = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.LOCAL_STATE));
      var legacy = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.SETTINGS));
      return [snapshot && snapshot.settings, legacy].some(function (settings) {
        return settings && settings.lastSavedAt > revision;
      });
    } catch (error) { return false; }
  }

  Storage.saveToStorage = function (isSilentInit, onComplete) {
    if (pendingSmartMerge) {
      var merge = pendingSmartMerge;
      pendingSmartMerge = null;
      if (merge.transaction) {
        try { merge.transaction.abort(); } catch (error) { /* Transaction already finished. */ }
      }
    }
    var st = MP.state;
    if (!isSilentInit) {
      st.settings.unsavedChangesCount = (Number(st.settings.unsavedChangesCount) || 0) + 1;
    }
    var nowTs = Date.now();
    // Ensure strictly monotonic timestamp even if two saves occur in the same millisecond
    if (nowTs <= (st.settings.lastSavedAt || 0)) {
      nowTs = (st.settings.lastSavedAt || 0) + 1;
    }
    st.settings.lastSavedAt = nowTs;
    st.settings.schemaVersion = MP.SCHEMA_VERSION;

    var itemsPayload = JSON.stringify(st.items);
    var logsPayload = JSON.stringify(st.logs);
    var histPayload = JSON.stringify(st.stockHistory);
    var saveSettings = Object.assign({}, st.settings, { lsSlimMode: false });
    var fullSettingsPayload = JSON.stringify(saveSettings);

    function saveLocal() {
      var items = safeJsonParse(itemsPayload);
      function writeLocalState(rows, slimMode) {
        global.localStorage.setItem(MP.STORAGE_KEYS.LOCAL_STATE, JSON.stringify({
          items: rows, logs: safeJsonParse(logsPayload), stockHistory: safeJsonParse(histPayload),
          settings: Object.assign({}, saveSettings, { lsSlimMode: slimMode })
        }));
        committedRevision = Math.max(committedRevision, nowTs);
      }
      try {
        writeLocalState(items, false);
        st.storageHealth.lsAvailable = true;
        return true;
      } catch (quotaErr) {
        items.forEach(function (item) { delete item.imageData; });
        try {
          writeLocalState(items, true);
          st.storageHealth.lsAvailable = true;
        } catch (error) { st.storageHealth.lsAvailable = false; }
        return false;
      }
    }

    function finish(idbComplete, conflict) {
      if (conflict) st.storageHealth.writeConflict = true;
      var localComplete = !conflict && !newerLocalState(committedRevision) && saveLocal();
      if (idbComplete) committedRevision = Math.max(committedRevision, nowTs);
      var ok = !conflict && (localComplete || idbComplete);
      if (st.settings.lastSavedAt === nowTs) {
        showStorageWriteWarning(conflict ? '其他页面已保存更新，本页修改未写入。请先导出备份保留本页修改，再刷新页面。' :
          (ok ? '' : '本地保存未完成，刷新前请导出 JSON 备份。当前修改或图片可能只在本次会话中可用。'));
      }
      if (typeof onComplete === 'function') onComplete(ok);
    }

    if (st.storageHealth.writeConflict || newerLocalState(committedRevision)) { finish(false, true); return; }

    Storage.openIDB(function (db) {
      if (!db) {
        finish(false, newerLocalState(committedRevision));
        return;
      }
      try {
        var tx = db.transaction(MP.IDB_CONFIG.STORE, 'readwrite');
        var store = tx.objectStore(MP.IDB_CONFIG.STORE);
        var conflict = false;
        var settingsRequest = store.get(MP.STORAGE_KEYS.SETTINGS);
        settingsRequest.onsuccess = function () {
          var saved = safeJsonParse(settingsRequest.result);
          conflict = st.storageHealth.writeConflict || (saved && saved.lastSavedAt > committedRevision) || newerLocalState(committedRevision);
          if (conflict) { tx.abort(); return; }
          store.put(itemsPayload, MP.STORAGE_KEYS.ITEMS);
          store.put(fullSettingsPayload, MP.STORAGE_KEYS.SETTINGS);
          store.put(logsPayload, MP.STORAGE_KEYS.LOGS);
          store.put(histPayload, MP.STORAGE_KEYS.STOCK_HISTORY);
        };
        tx.oncomplete = function () {
          finish(true);
        };
        tx.onabort = function () {
          finish(false, conflict || newerLocalState(committedRevision));
        };
      } catch (txErr) {
        finish(false);
      }
    });
  };

  function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // Rehydrate imageData from IDB items when LocalStorage had newer data saved in 5MB slim mode
  function rehydrateImagesFromIdb(primaryItems, idbItems) {
    if (!Array.isArray(primaryItems) || !Array.isArray(idbItems)) return primaryItems;
    var imgMap = {};
    for (var i = 0; i < idbItems.length; i++) {
      var x = idbItems[i];
      if (x && x.id && x.imageData) imgMap[x.id] = x.imageData;
    }
    for (var j = 0; j < primaryItems.length; j++) {
      var p = primaryItems[j];
      if (p && !p.imageData && imgMap[p.id]) {
        p.imageData = imgMap[p.id];
      }
    }
    return primaryItems;
  }

  function newestRestoreSnapshot(indexed, local) {
    function snapshotTime(snapshot) {
      return Number(snapshot.savedAtMs) || Date.parse(String(snapshot.savedAt || '').replace(' ', 'T')) || 0;
    }
    if (!indexed || !Array.isArray(indexed.items)) indexed = null;
    if (!local || !Array.isArray(local.items)) local = null;
    if (!indexed || !local) return indexed || local;
    return snapshotTime(local) > snapshotTime(indexed) ? local : indexed;
  }

  Storage.loadFromStorage = function (done) {
    var st = MP.state;
    var lsItems = null;
    var lsSettings = null;
    var lsLogs = null;
    var lsHist = null;
    var lsSnap = null;

    try {
      lsItems = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.ITEMS));
      lsSettings = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.SETTINGS));
      lsLogs = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.LOGS));
      lsHist = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.STOCK_HISTORY));
      var localState = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.LOCAL_STATE));
      if (localState && Array.isArray(localState.items) && Array.isArray(localState.logs) &&
          Array.isArray(localState.stockHistory) && localState.settings &&
          localState.settings.lastSavedAt >= ((lsSettings && lsSettings.lastSavedAt) || 0)) {
        lsItems = localState.items;
        lsLogs = localState.logs;
        lsHist = localState.stockHistory;
        lsSettings = localState.settings;
      }
      lsSnap = safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT));
      st.storageHealth.lsAvailable = true;
    } catch (e) {
      st.storageHealth.lsAvailable = false;
    }

    function finalizeLoad(chosenItems, chosenLogs, chosenHist, chosenSettings, snapObj) {
      st.storageHealth.writeConflict = false;
      committedRevision = (chosenSettings && Number(chosenSettings.lastSavedAt)) || 0;
      if (snapObj && Array.isArray(snapObj.items)) {
        st.storageHealth.hasPreRestoreSnapshot = true;
        st.storageHealth.preRestoreSnapshotTime = snapObj.savedAt || '';
      } else {
        st.storageHealth.hasPreRestoreSnapshot = false;
        st.storageHealth.preRestoreSnapshotTime = '';
      }

      if (Array.isArray(chosenItems)) {
        st.items = Domain.reconcileBatches(chosenItems);
        var hasAnySample = st.items.some(function (x) { return Boolean(x.isSample); });
        var rawLogs = Array.isArray(chosenLogs) ? chosenLogs : (hasAnySample ? Domain.buildSampleLogs() : []);
        st.logs = rawLogs.map(Domain.sanitizeLog).filter(Boolean);
        var rawHist = Array.isArray(chosenHist) ? chosenHist : [];
        st.stockHistory = rawHist.map(Domain.sanitizeStockHistoryEntry).filter(Boolean).slice(0, MP.MAX_STOCK_HISTORY);
        Storage.applyLoadedSettings(chosenSettings);
        var exportedAt = chosenSettings && chosenSettings.lastJsonExportAt;
        st.settings.lastJsonExportAt = typeof exportedAt === 'string' && Number.isFinite(Date.parse(exportedAt))
          ? exportedAt : '';
        var migratedWeight = chosenItems.some(function (item) {
          return item && (item.category === 'dry' || item.category === 'freeze') &&
            !(Number(item.unit_net_weight_g) > 0) &&
            Utils.legacyUnitWeight(item.spec, item.unit || MP.CATEGORIES[item.category].defaultUnit) > 0;
        });
        var migratedSpec = chosenItems.some(function (item) {
          return item && item.category !== 'supplies' && String(item.spec || '').trim() && !item.legacySpecInNotes;
        });
        if (migratedWeight || migratedSpec) Storage.saveToStorage(true);
      } else {
        // Brand-new user first visit: initialize sample items & logs without touching any existing records
        st.items = Domain.buildSampleItems();
        st.logs = Domain.buildSampleLogs();
        st.stockHistory = [];
        Storage.saveToStorage(true);
      }
      if (typeof done === 'function') done();
    }

    Storage.openIDB(function (db) {
      if (!db) {
        finalizeLoad(lsItems, lsLogs, lsHist, lsSettings, lsSnap);
        return;
      }
      try {
        var tx = db.transaction(MP.IDB_CONFIG.STORE, 'readonly');
        var store = tx.objectStore(MP.IDB_CONFIG.STORE);
        var reqItems = store.get(MP.STORAGE_KEYS.ITEMS);
        var reqSet = store.get(MP.STORAGE_KEYS.SETTINGS);
        var reqLogs = store.get(MP.STORAGE_KEYS.LOGS);
        var reqHist = store.get(MP.STORAGE_KEYS.STOCK_HISTORY);
        var reqSnap = store.get(MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT);

        tx.oncomplete = function () {
          var idbItems = safeJsonParse(reqItems.result);
          var idbSet = safeJsonParse(reqSet.result);
          var idbLogs = safeJsonParse(reqLogs.result);
          var idbHist = safeJsonParse(reqHist.result);
          var idbSnap = newestRestoreSnapshot(safeJsonParse(reqSnap.result), lsSnap);

          var idbTs = (idbSet && typeof idbSet.lastSavedAt === 'number') ? idbSet.lastSavedAt : 0;
          var lsTs = (lsSettings && typeof lsSettings.lastSavedAt === 'number') ? lsSettings.lastSavedAt : 0;

          // Timestamp-aware dual-engine conflict resolution:
          // Prefer whichever store has a newer valid write timestamp; if equal (or v1/v2 legacy without lastSavedAt), prefer IDB for full photos!
          if (Array.isArray(lsItems) && Array.isArray(idbItems)) {
            if (lsTs > idbTs) {
              var mergedLsItems = lsSettings && lsSettings.lsSlimMode
                ? rehydrateImagesFromIdb(lsItems, idbItems)
                : lsItems;
              finalizeLoad(
                mergedLsItems,
                Array.isArray(lsLogs) ? lsLogs : idbLogs,
                Array.isArray(lsHist) ? lsHist : idbHist,
                lsSettings,
                idbSnap
              );
              // Heal IndexedDB asynchronously with the newer state
              Storage.saveToStorage(true);
              return;
            }
            finalizeLoad(
              idbItems,
              Array.isArray(idbLogs) ? idbLogs : lsLogs,
              Array.isArray(idbHist) ? idbHist : lsHist,
              idbSet || lsSettings,
              idbSnap
            );
            return;
          }

          if (Array.isArray(idbItems)) {
            finalizeLoad(idbItems, idbLogs || lsLogs, idbHist || lsHist, idbSet || lsSettings, idbSnap);
          } else {
            finalizeLoad(lsItems, lsLogs, lsHist, lsSettings, idbSnap);
          }
        };

        tx.onerror = function () {
          finalizeLoad(lsItems, lsLogs, lsHist, lsSettings, lsSnap);
        };
      } catch (err) {
        finalizeLoad(lsItems, lsLogs, lsHist, lsSettings, lsSnap);
      }
    });
  };

  // ==================== SAFETY SNAPSHOT BEFORE FULL OVERWRITE RESTORE ====================
  Storage.savePreRestoreSnapshot = function (callback) {
    var st = MP.state;
    var snapObj = {
      savedAt: Utils.getNowDateTimeStr(),
      savedAtMs: Date.now(),
      settings: Object.assign({}, st.settings),
      items: st.items.slice(),
      logs: st.logs.slice(),
      stockHistory: st.stockHistory.slice()
    };
    var rawSnap = JSON.stringify(snapObj);
    var localSaved = false;
    function finish(ok) {
      if (ok) {
        st.storageHealth.hasPreRestoreSnapshot = true;
        st.storageHealth.preRestoreSnapshotTime = snapObj.savedAt;
      } else {
        showStorageWriteWarning('保护快照保存失败，已取消覆盖操作。');
      }
      if (typeof callback === 'function') callback(ok);
    }

    try {
      global.localStorage.setItem(MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT, rawSnap);
      localSaved = true;
    } catch (e) {
      // Ignore if localStorage 5MB is full; IndexedDB below will store full snapshot
    }

    Storage.openIDB(function (db) {
      if (!db) {
        finish(localSaved);
        return;
      }
      try {
        var tx = db.transaction(MP.IDB_CONFIG.STORE, 'readwrite');
        tx.objectStore(MP.IDB_CONFIG.STORE).put(rawSnap, MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT);
        tx.oncomplete = function () {
          finish(true);
        };
        tx.onabort = function () {
          finish(localSaved);
        };
      } catch (err) {
        finish(localSaved);
      }
    });
  };

  Storage.restorePreRestoreSnapshot = function (callback) {
    function applySnap(snap) {
      if (!snap || !Array.isArray(snap.items)) {
        if (typeof callback === 'function') callback(false);
        return;
      }
      var settings = { settings: Object.assign({}, MP.state.settings) };
      Storage.applyLoadedSettings(snap.settings, settings);
      settings.settings.unsavedChangesCount = (Number(settings.settings.unsavedChangesCount) || 0) + 1;
      commitBackupState({
        items: Domain.reconcileBatches(snap.items),
        logs: Array.isArray(snap.logs) ? snap.logs.map(Domain.sanitizeLog).filter(Boolean) : [],
        stockHistory: Array.isArray(snap.stockHistory)
          ? snap.stockHistory.map(Domain.sanitizeStockHistoryEntry).filter(Boolean) : [],
        settings: settings.settings
      }, function (ok) {
        if (typeof callback === 'function') callback(ok, !ok);
      });
    }

    function readLocalSnapshot() {
      try {
        return safeJsonParse(global.localStorage.getItem(MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT));
      } catch (err) {
        return null;
      }
    }

    function restoreLocalSnapshot() {
      applySnap(readLocalSnapshot());
    }

    Storage.openIDB(function (db) {
      if (!db) {
        restoreLocalSnapshot();
        return;
      }
      try {
        var tx = db.transaction(MP.IDB_CONFIG.STORE, 'readonly');
        var req = tx.objectStore(MP.IDB_CONFIG.STORE).get(MP.STORAGE_KEYS.PRE_RESTORE_SNAPSHOT);
        tx.oncomplete = function () {
          applySnap(newestRestoreSnapshot(safeJsonParse(req.result), readLocalSnapshot()));
        };
        tx.onabort = restoreLocalSnapshot;
      } catch (err) {
        restoreLocalSnapshot();
      }
    });
  };

  // ==================== BACKUP VALIDATION, IMPORT & EXPORT ====================
  Storage.validateAndParseBackup = function (rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { ok: false, error: '备份文件内容为空' };
    }
    var parsed = safeJsonParse(rawText.replace(/^\uFEFF/, '').trim());
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'JSON 格式解析失败，请确认选择的是 .json 备份文件' };
    }

    var rawItems = null;
    var rawLogs = [];
    var rawHist = [];
    var rawSettings = null;

    if (Array.isArray(parsed)) {
      // Legacy v1 array backup
      rawItems = parsed;
    } else if (Array.isArray(parsed.items)) {
      // v2 / v3 structured backup
      rawItems = parsed.items;
      rawLogs = Array.isArray(parsed.logs) ? parsed.logs : [];
      rawHist = Array.isArray(parsed.stockHistory) ? parsed.stockHistory : [];
      rawSettings = (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : null;
    } else {
      return { ok: false, error: '未检测到有效的粮仓 items 数据结构，无法导入' };
    }

    var batchIds = new Map();
    for (var item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.effectTags !== undefined && (!Array.isArray(item.effectTags) ||
          item.effectTags.some(function (tag) { return typeof tag !== 'string' || !tag.trim(); }))) {
        return { ok: false, error: '备份中存在无效的功效标签' };
      }
      if (item.feedUsageUnit && !MP.FEED_USAGE_UNITS.includes(item.feedUsageUnit)) {
        return { ok: false, error: '备份中存在无效的投喂单位' };
      }
      if (item.feedUsagePerItem != null && (!item.feedUsageUnit || !Number.isFinite(Number(item.feedUsagePerItem)) || Number(item.feedUsagePerItem) <= 0)) {
        return { ok: false, error: '备份中存在无效的投喂单位换算' };
      }
      if (item.feedUsagePerItem != null && ((item.feedUsageUnit === item.unit && Number(item.feedUsagePerItem) !== 1) ||
          (item.feedUsageUnit === 'g' && Number(item.unit_net_weight_g) > 0 &&
           Math.abs(Number(item.feedUsagePerItem) - Number(item.unit_net_weight_g)) > 1e-9))) {
        return { ok: false, error: '备份中的投喂单位换算与库存规格不一致' };
      }
      if (item.purchasePackaging && !Domain.validatePackaging(item.purchasePackaging, String(item.unit || '').trim())) {
        return { ok: false, error: '备份中存在无效的购买包装，请检查数量、单位和密封方式' };
      }
      if (item.flavors && !Domain.validateFlavors(item.flavors, item.purchasePackaging, Number(item.quantity), false)) {
        return { ok: false, error: '备份中存在无效的口味配比或剩余库存' };
      }
      if (item.id && !batchIds.has(item.id)) batchIds.set(item.id, item);
    }
    for (var log of rawLogs) {
      if (!log || typeof log !== 'object') continue;
      if (log.portionChange && !Domain.validatePortionReceipt(log)) {
        return { ok: false, error: '备份中存在无效的分顿扣减凭据' };
      }
      if (!log.flavorId) continue;
      var batch = batchIds.get(log.itemId);
      if (!Domain.validateFlavorLog(log) || (batch && !Domain.findFlavor(batch, log.flavorId))) {
        return { ok: false, error: '备份中存在无效的喂食口味或库存回退关联' };
      }
    }

    // Full restore still reads legacy backups without IDs. Smart merge cannot deduplicate them.
    var unstableIds = [rawItems, rawLogs, rawHist].some(function (records) {
      var ids = new Set();
      return records.some(function (record) {
        if (!record || typeof record !== 'object' || record.isSample) return false;
        var id = typeof record.id === 'string' ? record.id.trim() : '';
        if (!id || ids.has(id)) return true;
        ids.add(id);
        return false;
      });
    });
    var validItems = Domain.reconcileBatches(rawItems);
    var validLogs = rawLogs.map(Domain.sanitizeLog).filter(Boolean);
    var validHist = rawHist.map(Domain.sanitizeStockHistoryEntry).filter(Boolean);
    var validById = new Map(validItems.map(function (item) { return [item.id, item]; }));
    var missingDeductionTargets = validLogs.filter(function (log) {
      return hasDeduction(log) && !validById.has(log.itemId);
    }).length;
    var detachedArchives = validItems.filter(function (item) {
      return item.sourceBatchId && !validById.has(item.sourceBatchId);
    }).length;
    if (validLogs.some(function (log) {
      var item = validById.get(log.itemId);
      return item && log.portionChange && item.flavors;
    })) return { ok: false, error: '备份中的分顿扣减凭据指向了混合口味批次' };

    return {
      ok: true,
      version: parsed.version || 1,
      unstableIds: unstableIds,
      missingDeductionTargets: missingDeductionTargets,
      detachedArchives: detachedArchives,
      items: validItems,
      logs: validLogs,
      stockHistory: validHist,
      settings: rawSettings
    };
  };

  function deductionSignature(log) {
    return JSON.stringify([log.itemId, log.flavorId || '', log.deductedUnit || 0,
      log.deductedFrac || 0, log.flavorChange || null, log.portionChange || null]);
  }

  function hasDeduction(log) {
    return Boolean(log.deductedUnit || log.deductedFrac || log.flavorChange || log.portionChange);
  }

  function stockSignature(item) {
    return JSON.stringify([item.quantity, item.unit, item.feedUsageUnit || '', item.feedUsagePerItem || null, item.isOpened, item.openedDate, item.openRemainFraction,
      item.eatenCount, item.consumedCount, item.finishedDate, item.purchasePackaging || null,
      item.portionRevision || '', (item.flavors || []).map(function (flavor) {
        return [flavor.id, flavor.perPack, flavor.quantity, flavor.openedDate, flavor.openRemainFraction, flavor.revision];
      }).sort()]);
  }

  function planSmartMerge(backup) {
    if (backup.unstableIds) {
      return { error: '智能合并已取消：备份包含缺少 ID 或 ID 重复的记录，无法安全去重。本地数据未更改。' };
    }
    var st = MP.state;
    var items = st.items.filter(function (item) { return !item.isSample; });
    var logs = st.logs.filter(function (log) { return !log.isSample; });
    var history = st.stockHistory.filter(function (entry) { return !entry.isSample; });
    var incomingItems = backup.items.filter(function (item) { return !item.isSample; });
    var incomingLogs = backup.logs.filter(function (log) { return !log.isSample; });
    var incomingHistory = backup.stockHistory.filter(function (entry) { return !entry.isSample; });
    var batchId = function (item) { return item.sourceBatchId || item.id; };
    var localBatches = new Set(items.map(batchId));
    var importedBatches = new Set(incomingItems.map(batchId));
    var localItems = new Map(items.map(function (item) { return [item.id, item]; }));
    var localLogs = new Map(logs.map(function (log) { return [log.id, log]; }));
    var localHistory = new Map(history.map(function (entry) { return [entry.id, entry]; }));
    var incomingEvidence = new Set(incomingHistory.map(function (entry) { return entry.id; })
      .concat(incomingLogs.filter(hasDeduction).map(function (log) { return log.id; })));
    var localEvidence = new Set(history.concat(logs.filter(hasDeduction)).filter(function (record) {
      return !incomingEvidence.has(record.id);
    }).map(function (record) { return record.itemId; }));
    var touchedLocally = new Set(history.concat(logs).map(function (record) { return record.itemId; }));
    var conflict = function (id) {
      var item = localItems.get(id) || incomingItems.find(function (entry) { return entry.id === id; });
      return { error: '智能合并已取消：' + (item ? '「' + item.name + '」' : '批次 ' + (id || '未知')) +
        '的库存与流水无法安全合并，本地数据未更改。' };
    };

    // Shared batches keep the local snapshot only when incoming stock evidence is already known.
    for (var item of incomingItems) {
      var id = batchId(item);
      if (!localBatches.has(id)) {
        if (touchedLocally.has(id) || localItems.has(item.id)) return conflict(id);
        items.push(item);
      } else {
        var local = localItems.get(item.id);
        if ((!local || stockSignature(local) !== stockSignature(item)) &&
            (backup.version < 2 || !localEvidence.has(id))) return conflict(id);
      }
    }
    for (var log of incomingLogs) {
      var oldLog = localLogs.get(log.id);
      if (oldLog) {
        if (deductionSignature(oldLog) !== deductionSignature(log)) return conflict(log.itemId);
      } else {
        if (hasDeduction(log) && (!log.itemId || localBatches.has(log.itemId) ||
            (!importedBatches.has(log.itemId) && touchedLocally.has(log.itemId)))) return conflict(log.itemId);
        logs.push(log);
        localLogs.set(log.id, log);
      }
    }
    for (var entry of incomingHistory) {
      var oldEntry = localHistory.get(entry.id);
      if (oldEntry) {
        if (JSON.stringify(oldEntry) !== JSON.stringify(entry)) return conflict(entry.itemId);
      } else {
        if (localBatches.has(entry.itemId) || (!importedBatches.has(entry.itemId) &&
            touchedLocally.has(entry.itemId))) return conflict(entry.itemId);
        history.push(entry);
        localHistory.set(entry.id, entry);
      }
    }
    if (history.length > MP.MAX_STOCK_HISTORY) {
      return { error: '智能合并已取消：合并后的库存流水超过保留上限，本地数据未更改。' };
    }
    logs.sort(function (a, b) { return b.date.localeCompare(a.date); });
    history.sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); });
    return { items: Domain.reconcileBatches(items), logs: logs, stockHistory: history };
  }

  var pendingSmartMerge = null;

  function commitBackupState(plan, done) {
    if (plan.error) { done(false, plan.error); return; }
    if (pendingSmartMerge) { done(false, '正在恢复备份，请稍后再试。'); return; }
    var st = MP.state;
    var operation = { transaction: null };
    pendingSmartMerge = operation;
    function finish(ok) {
      if (pendingSmartMerge === operation) pendingSmartMerge = null;
      done(ok, ok ? '' : '无法完整保存恢复结果，本地数据未更改。');
    }
    Storage.openIDB(function (db) {
      if (pendingSmartMerge !== operation || !db) { finish(false); return; }
      var changed = JSON.stringify([plan.items, plan.logs, plan.stockHistory]) !==
        JSON.stringify([st.items, st.logs, st.stockHistory]);
      var mergeSettings = Object.assign({}, st.settings, {
        unsavedChangesCount: (Number(st.settings.unsavedChangesCount) || 0) + (changed ? 1 : 0)
      });
      var settings = Object.assign({}, plan.settings || mergeSettings, {
        lastSavedAt: Math.max(Date.now(), (st.settings.lastSavedAt || 0) + 1),
        schemaVersion: MP.SCHEMA_VERSION, lsSlimMode: false
      });
      try {
        var tx = db.transaction(MP.IDB_CONFIG.STORE, 'readwrite');
        operation.transaction = tx;
        tx.onabort = function () { finish(false); };
        tx.oncomplete = function () {
          if (pendingSmartMerge !== operation) { finish(false); return; }
          st.items = plan.items;
          st.logs = plan.logs;
          st.stockHistory = plan.stockHistory;
          st.settings = settings;
          committedRevision = settings.lastSavedAt;
          st.storageHealth.writeConflict = false;
          Storage.applyLoadedSettings(settings);
          showStorageWriteWarning('');
          finish(true);
        };
        var store = tx.objectStore(MP.IDB_CONFIG.STORE);
        var currentSettings = store.get(MP.STORAGE_KEYS.SETTINGS);
        currentSettings.onsuccess = function () {
          var saved = safeJsonParse(currentSettings.result);
          if (st.storageHealth.writeConflict || (saved && saved.lastSavedAt > committedRevision) ||
              newerLocalState(committedRevision)) { tx.abort(); return; }
          try {
            store.put(JSON.stringify(plan.items), MP.STORAGE_KEYS.ITEMS);
            store.put(JSON.stringify(plan.logs), MP.STORAGE_KEYS.LOGS);
            store.put(JSON.stringify(plan.stockHistory), MP.STORAGE_KEYS.STOCK_HISTORY);
            store.put(JSON.stringify(settings), MP.STORAGE_KEYS.SETTINGS);
          } catch (error) { tx.abort(); }
        };
      } catch (error) {
        if (operation.transaction) operation.transaction.abort();
        else finish(false);
      }
    });
  }

  Storage.applyBackupData = function (validated, useSmartMerge, onDone) {
    var st = MP.state;
    var incomingItems = validated.items || [];
    var incomingLogs = validated.logs || [];
    var incomingHist = validated.stockHistory || [];

    if (useSmartMerge) {
      commitBackupState(planSmartMerge(validated), onDone || function () {});
    } else {
      var beforeSnapshotRevision = st.settings.lastSavedAt;
      // Save automatic pre-restore snapshot before full overwrite so user never loses local data accidentally!
      Storage.savePreRestoreSnapshot(function (ok) {
        if (!ok) {
          if (typeof onDone === 'function') onDone(false);
          return;
        }
        if (st.settings.lastSavedAt !== beforeSnapshotRevision) {
          if (typeof onDone === 'function') onDone(false, '保存保护快照期间数据发生了变更，请重新发起恢复。');
          return;
        }
        var settings = { settings: Object.assign({}, st.settings) };
        Storage.applyLoadedSettings(validated.settings, settings);
        settings.settings.lastBackupDate = Utils.getTodayStr();
        settings.settings.unsavedChangesCount = 0;
        commitBackupState({
          items: Domain.reconcileBatches(incomingItems),
          logs: incomingLogs,
          stockHistory: incomingHist.slice(0, MP.MAX_STOCK_HISTORY),
          settings: settings.settings
        }, onDone || function () {});
      });
    }
  };

  Storage.buildBackupObject = function (date) {
    var st = MP.state;
    var settings = Object.assign({}, st.settings);
    // The last export attempt belongs to this device, not to the portable backup.
    delete settings.lastJsonExportAt;
    return {
      app: '喵喵粮仓',
      version: 3,
      schemaVersion: MP.SCHEMA_VERSION,
      exportedAt: (date || new Date()).toISOString(),
      settings: settings,
      items: st.items,
      logs: st.logs,
      stockHistory: st.stockHistory
    };
  };

  Storage.triggerFileDownload = function (filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var clickEvent;
    a.href = url;
    a.download = filename;
    a.addEventListener('click', function (event) { clickEvent = event; }, { once: true });
    try {
      document.body.appendChild(a);
      a.click();
      return Boolean(clickEvent && !clickEvent.defaultPrevented);
    } finally {
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    }
  };

  Storage.exportJsonBackup = function (onAfter) {
    var st = MP.state;
    var now = new Date();
    var localTime = Utils.getNowDateTimeStr(now);
    var name = 'meow-pantry-backup-' + localTime.replace(/[-:]/g, '').replace(' ', '-') +
      String(now.getSeconds()).padStart(2, '0');
    try {
      if (st.settings.lastJsonExportAt &&
          Math.floor(Date.parse(st.settings.lastJsonExportAt) / 1000) === Math.floor(now.getTime() / 1000)) {
        name += '-' + global.crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0');
      }
      var backupObj = Storage.buildBackupObject(now);
      backupObj.settings.lastBackupDate = localTime.slice(0, 10);
      backupObj.settings.unsavedChangesCount = 0;
      if (!Storage.triggerFileDownload(name + '.json', JSON.stringify(backupObj, null, 2), 'application/json;charset=utf-8')) {
        if (typeof onAfter === 'function') onAfter(false);
        return;
      }
    } catch (error) {
      if (typeof onAfter === 'function') onAfter(false);
      return;
    }

    // A download request is observable. Saving the file in Safari's system UI is not.
    st.settings.lastJsonExportAt = now.toISOString();
    st.settings.lastBackupDate = localTime.slice(0, 10);
    st.settings.unsavedChangesCount = 0;
    Storage.saveToStorage(true);
    if (typeof onAfter === 'function') onAfter(true);
  };

  function rowsToCsv(rows) {
    return '\uFEFF' + rows.map(function (r) {
      return r.map(function (cell) {
        var s = String(cell === null || cell === undefined ? '' : cell).replace(/"/g, '""');
        return '"' + s + '"';
      }).join(',');
    }).join('\r\n');
  }

  Storage.exportItemsCsv = function () {
    var headers = ['属性分组', '分类', '品牌', '品名/口味', '规格', '在库数量', '累计已核销', '单位', '币种', '单价', '生产日期', '保质期', '过期日期', '剩余天数', '是否开封', '开封日期', '拆封余量', '适口性/耐受度', '存放位置', '渠道/批次', '备注', '各口味库存'];
    var rows = [headers];
    MP.state.items.forEach(function (it) {
      if (it.sourceBatchId && (Number(it.quantity) || 0) <= 0) return; // avoid duplicating shadow row already counted on active batch's eatenCount
      var ev = Domain.evaluateItem(it);
      var catInfo = MP.CATEGORIES[it.category] || MP.CATEGORIES.dry;
      var grpInfo = MP.CATEGORY_GROUPS[catInfo.group] || MP.CATEGORY_GROUPS.food;
      var shelfStr = it.shelfLifeValue ? (it.shelfLifeValue + (it.shelfLifeUnit === 'days' ? '天' : '个月')) : '';
      var palObj = MP.getPalatabilityBadgeInfo(it);
      var palStr = it.flavors && it.flavors.length ? it.flavors.map(function (flavor) {
        var badge = MP.getPalatabilityBadgeInfo({ category: it.category, palatability: flavor.palatability });
        return flavor.name + '：' + (badge ? badge.label : '未测');
      }).join('；') : palObj ? palObj.label : '';
      var openedFlavors = (it.flavors || []).filter(function (flavor) {
        return flavor.quantity > 0 && flavor.openedDate;
      });
      var eatenQty = (Number(it.quantity) || 0) > 0 ? (Number(it.eatenCount) || 0) : (Number(it.consumedCount) || Number(it.lastQuantity) || 1);
      rows.push([
        grpInfo.label,
        catInfo.label,
        it.brand || '',
        it.name || '',
        Utils.formatItemSpec(it),
        String(it.quantity),
        String(eatenQty),
        it.unit || '',
        it.currency === 'JPY' ? '日元(JPY)' : '人民币(CNY)',
        it.price ? String(it.price) : '',
        it.prodDate || '',
        shelfStr,
        it.expDate || '',
        ev.expDays !== null ? String(ev.expDays) : '',
        Domain.isStockOpened(it) ? '已开封' : '未开封',
        openedFlavors.length ? openedFlavors.map(function (flavor) { return flavor.name + '：' + flavor.openedDate; }).join('；')
          : it.openedDate || it.archivedOpenedDate || '',
        openedFlavors.length ? openedFlavors.filter(function (flavor) { return flavor.openRemainFraction > 0; })
          .map(function (flavor) { return flavor.name + '：' + Utils.formatRemainFractionText(flavor.openRemainFraction, it.unit); }).join('；')
          : it.openRemainFraction ? Utils.formatRemainFractionText(it.openRemainFraction, it.unit) : '',
        palStr,
        it.location || '',
        it.batchCode || '',
        it.notes || '',
        (it.flavors || []).map(function (flavor) {
          return flavor.name + '：' + Utils.formatQuantity(flavor.quantity, it.unit || '件');
        }).join('；')
      ]);
    });
    Storage.triggerFileDownload('猫咪粮仓盘点表_' + Utils.getTodayStr() + '.csv', rowsToCsv(rows), 'text/csv;charset=utf-8');
  };

  Storage.exportLogsCsv = function () {
    var headers = ['喂食日期', '星期', '餐次时段', '属性分组', '分类', '品牌', '品名/口味', '投喂份量', '下次提醒日', '备注'];
    var rows = [headers];
    var sorted = MP.state.logs.slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    sorted.forEach(function (lg) {
      var product = Domain.resolveLogProduct(lg);
      var catInfo = MP.CATEGORIES[lg.category] || MP.CATEGORIES.dry;
      var grpInfo = MP.CATEGORY_GROUPS[catInfo.group] || MP.CATEGORY_GROUPS.food;
      rows.push([
        lg.date || '',
        Utils.getWeekdayName(lg.date || ''),
        Utils.formatMealSlot(lg.mealSlot),
        grpInfo.label,
        catInfo.label,
        product.brand || '',
        product.name || '',
        lg.amount || '',
        lg.nextDueDate || '',
        lg.note || ''
      ]);
    });
    Storage.triggerFileDownload('猫咪每日记录_' + Utils.getTodayStr() + '.csv', rowsToCsv(rows), 'text/csv;charset=utf-8');
  };

  Storage.exportStockHistoryCsv = function () {
    var headers = ['变动时间', '操作类型', '分类', '品牌', '品名', '数量变化', '变动前余量', '变动后余量', '单位', '说明备注'];
    var rows = [headers];
    MP.state.stockHistory.forEach(function (h) {
      var actMeta = MP.STOCK_ACTION_META[h.action] || MP.STOCK_ACTION_META.adjust;
      var catInfo = MP.CATEGORIES[h.category] || MP.CATEGORIES.dry;
      rows.push([
        h.timestamp || h.date || '',
        actMeta.label,
        catInfo.label,
        h.brand || '',
        h.name || '',
        h.deltaText || '',
        String(h.beforeQty),
        String(h.afterQty),
        h.unit || '',
        h.note || ''
      ]);
    });
    Storage.triggerFileDownload('猫咪粮仓库存变动流水_' + Utils.getTodayStr() + '.csv', rowsToCsv(rows), 'text/csv;charset=utf-8');
  };
})(typeof window !== 'undefined' ? window : globalThis);
