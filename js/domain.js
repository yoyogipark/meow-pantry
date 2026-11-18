/* Meow Pantry Core Domain Model: State, Schema Migration, Stock/Batch/Split-Can Engine & Stock History */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain = {};

  Domain.createDefaultSettings = function () {
    return {
      schemaVersion: MP.SCHEMA_VERSION,
      warnDays: 60,
      defaultCurrency: 'CNY',
      pantryPageSize: 6,
      pantryDisplayMode: 'card',
      lastBackupDate: '',
      unsavedChangesCount: 0,
      lastSavedAt: 0
    };
  };

  var state = MP.state = {
    items: [],
    logs: [],
    stockHistory: [],
    selectedLogDate: Utils.getTodayStr(),
    settings: Domain.createDefaultSettings(),
    storageHealth: {
      idbAvailable: false,
      lsAvailable: true,
      hasPreRestoreSnapshot: false,
      preRestoreSnapshotTime: ''
    },
    activeTab: 'pantry',
    statusFilter: 'in_stock', // 'in_stock' | 'expiring' | 'expired' | 'empty'
    attrFilter: 'all',        // 'all' | 'opened' | 'fresh' | 'pal_love' | 'group_food' | 'group_care'
    catFilter: 'all',
    brandFilter: 'all',
    sortBy: 'exp_asc',
    searchQuery: '',
    editMode: false,          // Default read-only browse mode to prevent accidental edits
    pantryDisplayMode: 'card', // 'card' | 'compact'
    pantryPage: 1,
    pantryPageSize: 6,
    dailyViewMode: 'day',     // 'day' | 'all'
    statsSubTab: 'stock',     // 'stock' | 'pal' | 'brand'
    statsScopeFilter: 'all',  // 'all' | 'food' | 'supp' | 'med'
    statsTierTab: 'love',     // 'love' | 'ok' | 'coax' | 'meh' | 'supp' | 'med'
    tierPage: 1,
    tierPageSize: 5,
    brandScopeFilter: 'all',  // 'all' | 'food' | 'supp' | 'med'
    brandPage: 1,
    brandPageSize: 5,
    logSearchQuery: '',
    logCatFilter: 'all',
    logMonthFilter: 'all',
    logPage: 1,
    logPageSize: 7,
    historyTypeFilter: 'all', // 'all' | 'in' | 'consume' | 'adjust'
    historyItemFilter: '',    // itemId or ''
    historySearchQuery: '',
    historyPage: 1,
    historyPageSize: 15,
    backupBannerDismissedCount: -1,
    formCat: 'dry',
    formPal: '',
    formImage: '',
    formCurrency: 'CNY'
  };

  // ==================== SCHEMA SANITIZERS & MIGRATORS (NON-DESTRUCTIVE) ====================
  // Only units with an unambiguous package meaning enter the headline total.
  Domain.isPackageUnit = function (unit) {
    return /^(袋|罐|包|盒|箱|支|瓶|件|桶|杯|听|袋装)$/.test(unit);
  };

  Domain.canCorrectStockUnit = function (item, unit) {
    var countingUnit = /^(盒|杯|罐|袋|包|支|粒|瓶|件|听|袋装)$/;
    return Boolean(item && !item.sourceBatchId && item.unit !== unit &&
      countingUnit.test(item.unit) && countingUnit.test(unit) && Number.isSafeInteger(item.quantity));
  };

  Domain.correctStockUnit = function (item, unit) {
    if (!Domain.canCorrectStockUnit(item, unit)) return false;
    var previousUnit = item.unit;
    item.unit = unit;
    state.items.forEach(function (archive) {
      if (archive.sourceBatchId === item.id && archive.quantity === 0) archive.unit = unit;
    });
    Domain.appendStockHistory({
      action: 'adjust', itemId: item.id, category: item.category, brand: item.brand,
      name: item.name, unit: unit, beforeQty: item.quantity, afterQty: item.quantity,
      deltaText: previousUnit + ' → ' + unit, note: '更正库存计数单位，件数不变', isSample: item.isSample, preservePortionRevision: true
    });
    return true;
  };

  Domain.validatePackaging = function (raw, innerUnit) {
    // 组 and 提 remain valid for existing records and imported backups.
    if (!raw || !/^(盒|袋|桶|箱|组|提)$/.test(raw.outerUnit)) return null;
    if (!Domain.isPackageUnit(innerUnit) && innerUnit !== '粒') return null;
    var count = Number(raw.count);
    var size = Number(raw.size);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(size) ||
        size < 1 || !Number.isSafeInteger(count * size)) return null;
    var result = { count: count, outerUnit: raw.outerUnit, size: size };
    if (raw.seal && raw.seal !== 'independent' && raw.seal !== 'shared') return null;
    if (raw.seal === 'shared') {
      if (count !== 1) return null;
      result.seal = 'shared';
    }
    return result;
  };

  Domain.summarizeStockQuantity = function (items) {
    var summary = { pieces: 0, units: Object.create(null), otherUnits: Object.create(null) };
    items.forEach(function (it) {
      var qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;
      var unit = it.unit || '件';
      if (Domain.hasSharedSeal(it)) {
        var shared = summary.units[it.purchasePackaging.outerUnit] ||
          (summary.units[it.purchasePackaging.outerUnit] = { sealed: 0, opened: 0 });
        shared[it.isOpened ? 'opened' : 'sealed'] += 1;
        summary.pieces += 1;
        summary.otherUnits[unit] = Utils.round2((summary.otherUnits[unit] || 0) + qty);
        return;
      }
      if ((it.purchasePackaging || Domain.isPackageUnit(unit)) && (Number.isInteger(qty) || it.isOpened)) {
        var entry = summary.units[unit] || (summary.units[unit] = { sealed: 0, opened: 0 });
        var opened = it.flavors ? it.flavors.filter(function (f) { return f.quantity > 0 && f.openedDate; }).length : (it.isOpened ? 1 : 0);
        entry.opened += opened;
        var pieces = Math.ceil(qty);
        entry.sealed += pieces - opened;
        summary.pieces += pieces;
      } else {
        summary.otherUnits[unit] = Utils.round2((summary.otherUnits[unit] || 0) + qty);
      }
    });
    return summary;
  };

  Domain.hasSharedSeal = function (item) {
    return Boolean(item.purchasePackaging && item.purchasePackaging.seal === 'shared');
  };

  Domain.validateFlavors = function (rows, pack, quantity, isArchive) {
    if (!pack || !Array.isArray(rows) || rows.length < 2) return null;
    var ids = new Set();
    var names = new Set();
    var allocated = 0;
    var remaining = 0;
    var flavors = [];
    for (var row of rows) {
      if (!row || typeof row !== 'object') return null;
      var id = typeof row.id === 'string' ? row.id.trim() : '';
      var name = typeof row.name === 'string' ? row.name.trim() : '';
      var nameKey = name.toLowerCase();
      var perPack = Number(row.perPack);
      var qty = isArchive ? 0 : Number(row.quantity);
      var fraction = Number(row.openRemainFraction || 0);
      if (!id || !name || (fraction > 0 && !Utils.normalizeDateStr(row.openedDate)) || ids.has(id) || names.has(nameKey) || !Number.isSafeInteger(perPack) || perPack <= 0 ||
          !Number.isSafeInteger(qty) || qty < 0 || qty > perPack * pack.count ||
          !Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return null;
      ids.add(id);
      names.add(nameKey);
      allocated += perPack;
      remaining += qty;
      flavors.push({
        id: id, name: name, perPack: perPack, quantity: qty,
        spec: String(row.spec || '').trim(),
        palatability: Object.prototype.hasOwnProperty.call(MP.PALATABILITY, row.palatability) ? row.palatability : '',
        openedDate: qty > 0 ? Utils.normalizeDateStr(row.openedDate) : '',
        openRemainFraction: qty > 0 ? fraction : 0,
        revision: typeof row.revision === 'string' ? row.revision : ''
      });
    }
    return allocated === pack.size && remaining === quantity ? flavors : null;
  };

  Domain.findFlavor = function (item, flavorId) {
    return item && item.flavors && item.flavors.find(function (flavor) { return flavor.id === flavorId; });
  };

  Domain.isStockOpened = function (item) {
    return item.isOpened || Boolean(item.flavors && item.flavors.some(function (flavor) {
      return flavor.quantity > 0 && flavor.openedDate;
    }));
  };

  Domain.validateFlavorLog = function (log) {
    if (typeof log.flavorId !== 'string' || !log.flavorId.trim() ||
        typeof log.flavorName !== 'string' || !log.flavorName.trim() ||
        typeof log.itemId !== 'string' || !log.itemId.trim()) return false;
    var change = log.flavorChange;
    if (!change) return !Number(log.deductedUnit) && !Number(log.deductedFrac);
    var before = change.before;
    return Boolean(before && typeof change.revision === 'string' && change.revision &&
      (change.units === 0 || change.units === 1) && Number(log.deductedUnit) === change.units &&
      Number.isFinite(change.fraction) && change.fraction > 0 && change.fraction <= 1 &&
      Number.isFinite(before.fraction) && before.fraction >= 0 && before.fraction < 1 &&
      typeof before.revision === 'string' &&
      (before.openedDate === '' || Utils.normalizeDateStr(before.openedDate) === before.openedDate) &&
      (before.sharedOpenedDate === '' || Utils.normalizeDateStr(before.sharedOpenedDate) === before.sharedOpenedDate));
  };

  Domain.resolveLogProduct = function (log) {
    var item;
    if (log.itemId) {
      item = state.items.find(function (entry) { return entry.id === log.itemId; });
      if (!item) {
        // Only use an archive with an explicit, unambiguous link to the original batch.
        var archives = state.items.filter(function (entry) {
          return entry.sourceBatchId === log.itemId && entry.quantity === 0;
        });
        if (archives.length === 1) item = archives[0];
      }
    }
    var product = item || log;
    return {
      brand: product.brand,
      category: product.category,
      subtype: product.subtype || '',
      name: product.name + (log.flavorName ? ' · ' + log.flavorName : '')
    };
  };

  Domain.sanitizeItem = function (raw, fallbackIdx) {
    if (!raw || typeof raw !== 'object') return null;
    var cat = (raw.category && MP.CATEGORIES[raw.category]) ? raw.category : 'dry';
    var defCat = MP.CATEGORIES[cat];
    var qty = Utils.round2(Math.max(0, Number(raw.quantity) || 0));
    var isOpened = qty > 0 ? Boolean(raw.isOpened) : false;
    var remFrac = Number(raw.openRemainFraction) || 0;
    if (!isOpened || remFrac <= 0 || remFrac >= 1) remFrac = 0;

    // Preserve any extra user fields via shallow clone first
    var clean = Object.assign({}, raw);
    clean.id = (typeof raw.id === 'string' && raw.id.trim())
      ? raw.id.trim()
      : ('item_migrated_' + Date.now() + '_' + (fallbackIdx || 0));
    clean.category = cat;
    clean.brand = String(raw.brand === undefined || raw.brand === null ? '' : raw.brand).trim() || '未命名品牌';
    clean.name = String(raw.name === undefined || raw.name === null ? '' : raw.name).trim() || '未命名单品';
    clean.spec = String(raw.spec || '').trim();
    clean.quantity = qty;
    clean.unit = String(raw.unit || defCat.defaultUnit).trim() || defCat.defaultUnit;
    if (MP.FOOD_SUBTYPES[clean.category] && typeof raw.subtype === 'string' && raw.subtype.trim()) {
      clean.subtype = raw.subtype.trim();
    } else delete clean.subtype;
    var purchasePackaging = Domain.validatePackaging(raw.purchasePackaging, clean.unit);
    if (purchasePackaging) clean.purchasePackaging = purchasePackaging;
    else delete clean.purchasePackaging;
    var flavors = Domain.validateFlavors(raw.flavors, purchasePackaging, qty, Boolean(raw.sourceBatchId) && qty === 0);
    if (flavors) clean.flavors = flavors;
    else delete clean.flavors;
    clean.price = Math.max(0, Number(raw.price) || 0);
    clean.currency = raw.currency === 'JPY' ? 'JPY' : 'CNY';
    clean.prodDate = Utils.normalizeDateStr(raw.prodDate);
    clean.shelfLifeValue = (raw.shelfLifeValue !== '' && raw.shelfLifeValue !== null && raw.shelfLifeValue !== undefined && Number(raw.shelfLifeValue) > 0)
      ? Math.round(Number(raw.shelfLifeValue))
      : '';
    clean.shelfLifeUnit = raw.shelfLifeUnit === 'days' ? 'days' : 'months';
    clean.expDate = Utils.normalizeDateStr(raw.expDate) || (clean.prodDate && clean.shelfLifeValue ? Utils.addShelfLife(clean.prodDate, clean.shelfLifeValue, clean.shelfLifeUnit) : '');
    clean.isOpened = isOpened;
    clean.openedDate = Utils.normalizeDateStr(raw.openedDate);
    clean.archivedOpenedDate = Utils.normalizeDateStr(raw.archivedOpenedDate) || (qty <= 0 ? clean.openedDate : '');
    clean.finishedDate = qty <= 0 ? Utils.normalizeDateStr(raw.finishedDate) : '';
    clean.openDaysLimit = Math.max(1, parseInt(raw.openDaysLimit, 10) || defCat.defaultOpenDays || 45);
    clean.openRemainFraction = remFrac;
    clean.palatability = (raw.palatability && MP.PALATABILITY[raw.palatability]) ? raw.palatability : '';
    clean.location = String(raw.location || '').trim();
    clean.batchCode = String(raw.batchCode || '').trim();
    clean.notes = String(raw.notes || '').trim();
    clean.imageData = typeof raw.imageData === 'string' ? raw.imageData : '';
    clean.isSample = Boolean(raw.isSample);
    clean.eatenCount = Utils.round2(Math.max(0, Number(raw.eatenCount) || 0));
    clean.consumedCount = Utils.round2(Math.max(0, Number(raw.consumedCount) || 0));
    clean.lastQuantity = Utils.round2(Math.max(0, Number(raw.lastQuantity) || 0));
    clean.lastEatenDate = Utils.normalizeDateStr(raw.lastEatenDate);
    clean.sourceBatchId = typeof raw.sourceBatchId === 'string' ? raw.sourceBatchId : '';
    return clean;
  };

  Domain.sanitizeLog = function (raw, fallbackIdx) {
    if (!raw || typeof raw !== 'object') return null;
    var cat = (raw.category && MP.CATEGORIES[raw.category]) ? raw.category : 'dry';
    var clean = Object.assign({}, raw);
    clean.id = (typeof raw.id === 'string' && raw.id.trim())
      ? raw.id.trim()
      : ('log_migrated_' + Date.now() + '_' + (fallbackIdx || 0));
    clean.date = Utils.normalizeDateStr(raw.date) || Utils.getTodayStr();
    clean.mealSlot = String(raw.mealSlot || '🍽️ 投喂').trim();
    clean.itemId = typeof raw.itemId === 'string' ? raw.itemId : '';
    clean.category = cat;
    clean.brand = String(raw.brand || '').trim() || '未命名';
    clean.name = String(raw.name || '').trim() || '未命名';
    clean.amount = String(raw.amount || '1份').trim();
    clean.note = String(raw.note || '').trim();
    clean.reminderDays = Math.max(0, parseInt(raw.reminderDays, 10) || 0);
    clean.nextDueDate = Utils.normalizeDateStr(raw.nextDueDate);
    clean.reminderDone = Boolean(raw.reminderDone);
    clean.deductedUnit = Utils.round2(Math.max(0, Number(raw.deductedUnit) || 0));
    clean.deductedFrac = Math.max(0, Number(raw.deductedFrac) || 0);
    clean.isSample = Boolean(raw.isSample);
    return clean;
  };

  Domain.sanitizeStockHistoryEntry = function (raw, fallbackIdx) {
    if (!raw || typeof raw !== 'object') return null;
    var action = (raw.action && MP.STOCK_ACTION_META[raw.action]) ? raw.action : 'adjust';
    var cat = (raw.category && MP.CATEGORIES[raw.category]) ? raw.category : 'dry';
    return {
      id: (typeof raw.id === 'string' && raw.id.trim())
        ? raw.id.trim()
        : ('hist_' + Date.now() + '_' + (fallbackIdx || 0)),
      timestamp: typeof raw.timestamp === 'string' && raw.timestamp ? raw.timestamp : Utils.getNowDateTimeStr(),
      date: Utils.normalizeDateStr(raw.date) || String(raw.timestamp || '').slice(0, 10) || Utils.getTodayStr(),
      action: action,
      itemId: typeof raw.itemId === 'string' ? raw.itemId : '',
      category: cat,
      brand: String(raw.brand || '').trim(),
      name: String(raw.name || '').trim(),
      unit: String(raw.unit || '件').trim(),
      deltaText: String(raw.deltaText || '').trim(),
      beforeQty: Utils.round2(Math.max(0, Number(raw.beforeQty) || 0)),
      afterQty: Utils.round2(Math.max(0, Number(raw.afterQty) || 0)),
      note: String(raw.note || '').trim(),
      isSample: Boolean(raw.isSample)
    };
  };

  // Ensure unique IDs and consistent metadata between active batches and their linked empty_<id> shadow records
  Domain.reconcileBatches = function (itemsArr) {
    if (!Array.isArray(itemsArr)) return [];
    var seenIds = {};
    var cleaned = [];
    for (var i = 0; i < itemsArr.length; i++) {
      var s = Domain.sanitizeItem(itemsArr[i], i);
      if (!s) continue;
      if (seenIds[s.id]) {
        s.id = s.id + '_dup' + i;
      }
      seenIds[s.id] = s;
      cleaned.push(s);
    }

    // Sync linked empty_<id> shadow records with their parent active batch metadata
    for (var j = 0; j < cleaned.length; j++) {
      var rec = cleaned[j];
      if (rec.sourceBatchId && rec.quantity <= 0) {
        var parent = seenIds[rec.sourceBatchId];
        if (parent && parent.quantity > 0) {
          Domain.copySharedMetadataToArchive(parent, rec);
          if (parent.eatenCount > 0) {
            rec.consumedCount = parent.eatenCount;
            rec.lastQuantity = parent.eatenCount;
          }
        } else if (parent && parent.quantity <= 0) {
          // Parent already reached 0; avoid duplicate shadow record
          rec._dropDuplicateShadow = true;
        }
      }
    }
    return cleaned.filter(function (x) { return !x._dropDuplicateShadow; });
  };

  Domain.copySharedMetadataToArchive = function (activeItem, archiveItem) {
    if (!activeItem || !archiveItem) return;
    archiveItem.category = activeItem.category;
    archiveItem.brand = activeItem.brand;
    archiveItem.name = activeItem.name;
    archiveItem.spec = activeItem.spec;
    if (activeItem.subtype) archiveItem.subtype = activeItem.subtype;
    else delete archiveItem.subtype;
    archiveItem.unit = activeItem.unit;
    archiveItem.price = activeItem.price;
    if (activeItem.flavors) archiveItem.flavors = Domain.validateFlavors(activeItem.flavors, activeItem.purchasePackaging, 0, true);
    else delete archiveItem.flavors;
    if (activeItem.purchasePackaging) archiveItem.purchasePackaging = Object.assign({}, activeItem.purchasePackaging);
    else delete archiveItem.purchasePackaging;
    archiveItem.currency = activeItem.currency;
    archiveItem.prodDate = activeItem.prodDate;
    archiveItem.shelfLifeValue = activeItem.shelfLifeValue;
    archiveItem.shelfLifeUnit = activeItem.shelfLifeUnit;
    archiveItem.expDate = activeItem.expDate;
    archiveItem.palatability = activeItem.palatability;
    archiveItem.location = activeItem.location;
    archiveItem.batchCode = activeItem.batchCode;
    if (activeItem.imageData) {
      archiveItem.imageData = activeItem.imageData;
    }
  };

  Domain.syncLinkedArchiveForActiveItem = function (activeItem) {
    if (!activeItem) return;
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (it.id !== activeItem.id && it.sourceBatchId === activeItem.id && (Number(it.quantity) || 0) <= 0) {
        Domain.copySharedMetadataToArchive(activeItem, it);
      }
    }
  };

  // ==================== STOCK OPERATION HISTORY LEDGER ====================
  Domain.appendStockHistory = function (entry) {
    if (!entry) return;
    var record = Domain.sanitizeStockHistoryEntry({
      id: 'hist_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      timestamp: entry.timestamp || Utils.getNowDateTimeStr(),
      date: entry.date || Utils.getTodayStr(),
      action: entry.action || 'adjust',
      itemId: entry.itemId || '',
      category: entry.category || 'dry',
      brand: entry.brand || '',
      name: entry.name || '',
      unit: entry.unit || '件',
      deltaText: entry.deltaText || '',
      beforeQty: entry.beforeQty !== undefined ? entry.beforeQty : 0,
      afterQty: entry.afterQty !== undefined ? entry.afterQty : 0,
      note: entry.note || '',
      isSample: Boolean(entry.isSample)
    });
    state.stockHistory.unshift(record);
    if (!entry.preservePortionRevision) {
      var batch = state.items.find(function (item) { return item.id === record.itemId; });
      if (batch && !batch.flavors) batch.portionRevision = record.id;
    }
    if (state.stockHistory.length > MP.MAX_STOCK_HISTORY) {
      state.stockHistory.length = MP.MAX_STOCK_HISTORY;
    }
    return record;
  };

  // ==================== MULTI-UNIT CONSUMPTION, SPLIT-CAN & REVERT ENGINE ====================
  Domain.isSingleServingUnit = function (item) {
    if (!item) return false;
    var u = item.unit || '';
    var c = item.category || '';
    if (c === 'dry' || c === 'freeze' || c === 'supp') return false;
    if (u === '袋' || u === '包' || u === '盒' || u === '瓶') return false;
    return true;
  };

  Domain.recordConsumedUnits = function (target, amountConsumed, customDateStr, historyNote, adjustment) {
    if (!target) return 0;
    var curQty = Utils.round2(Number(target.quantity) || 0);
    if (curQty <= 0) return 0;
    var used = Math.min(curQty, Number(amountConsumed) > 0 ? Utils.round2(Number(amountConsumed)) : 1);
    if (used <= 0) return 0;
    var nextRem = Math.max(0, Utils.round2(curQty - used));
    var opDate = Utils.normalizeDateStr(customDateStr) || Utils.getTodayStr();
    var unitOpenedDate = target.openedDate || target.archivedOpenedDate || opDate;

    target.eatenCount = Utils.round2((Number(target.eatenCount) || 0) + used);
    if (!adjustment) target.lastEatenDate = opDate;
    if (unitOpenedDate && !target.archivedOpenedDate) {
      target.archivedOpenedDate = unitOpenedDate;
    }

    var linkedArchive = null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id !== target.id && state.items[i].sourceBatchId === target.id && (Number(state.items[i].quantity) || 0) <= 0) {
        linkedArchive = state.items[i];
        break;
      }
    }

    if (nextRem > 0) {
      target.quantity = nextRem;
      if (!Domain.hasSharedSeal(target)) {
        target.isOpened = false;
        target.openedDate = '';
        target.openRemainFraction = 0;
      }
      if (linkedArchive) {
        Domain.copySharedMetadataToArchive(target, linkedArchive);
        linkedArchive.consumedCount = target.eatenCount;
        linkedArchive.lastQuantity = target.eatenCount;
        linkedArchive.finishedDate = opDate;
        if (unitOpenedDate && !linkedArchive.archivedOpenedDate) {
          linkedArchive.archivedOpenedDate = unitOpenedDate;
        }
      } else {
        var archiveCopy = Domain.sanitizeItem(Object.assign({}, target, {
          id: 'empty_' + target.id,
          sourceBatchId: target.id,
          quantity: 0,
          consumedCount: target.eatenCount,
          lastQuantity: target.eatenCount,
          archivedOpenedDate: unitOpenedDate,
          finishedDate: opDate,
          isOpened: false,
          openedDate: unitOpenedDate,
          openRemainFraction: 0
        }));
        state.items.push(archiveCopy);
      }
    } else {
      var finalOpenDate = unitOpenedDate || (linkedArchive && (linkedArchive.archivedOpenedDate || linkedArchive.openedDate)) || opDate;
      if (linkedArchive) {
        state.items = state.items.filter(function (x) { return x.id !== linkedArchive.id; });
      }
      target.lastQuantity = target.eatenCount;
      target.consumedCount = target.eatenCount;
      target.archivedOpenedDate = finalOpenDate;
      target.openedDate = finalOpenDate;
      target.finishedDate = opDate;
      target.quantity = 0;
      target.isOpened = false;
      target.openRemainFraction = 0;
    }

    Domain.appendStockHistory({
      date: opDate,
      action: adjustment ? 'adjust' : 'consume',
      itemId: target.id,
      category: target.category,
      brand: target.brand,
      name: target.name,
      unit: target.unit || '件',
      deltaText: '-' + used + (target.unit || '件'),
      beforeQty: curQty,
      afterQty: nextRem,
      note: historyNote || (nextRem > 0 ? ('核销 ' + used + (target.unit || '件') + '，余 ' + nextRem + (target.unit || '件')) : '本批次已全部核销归档'),
      isSample: Boolean(target.isSample)
    });
    return used;
  };

  // Fixed bug: properly clears finishedDate & recreates empty_<id> shadow archive if restoring final unit of a multi-unit batch!
  Domain.revertConsumedFromLog = function (lg, adjustmentNote) {
    if (!lg || !lg.itemId) return false;
    if (lg.flavorId) return revertFlavorFeeding(lg);
    if (lg.portionChange) return revertBatchPortion(lg);
    var target = state.items.find(function (x) { return x.id === lg.itemId; });
    if (!target) return false;
    var dUnit = Number(lg.deductedUnit) || 0;
    var dFrac = Number(lg.deductedFrac) || 0;
    var uLabel = target.unit || '件';

    if (dUnit > 0) {
      var beforeQ = Utils.round2(Number(target.quantity) || 0);
      var wasFinishedBatch = (beforeQ <= 0);
      var restorePartial = dFrac > 0 && dFrac < 0.98;
      if (restorePartial && beforeQ > 0 && target.isOpened) return false;
      var restoredQ = Utils.round2(beforeQ + dUnit);
      target.quantity = restoredQ;
      target.eatenCount = Math.max(0, Utils.round2((Number(target.eatenCount) || 0) - dUnit));
      target.finishedDate = '';
      if (wasFinishedBatch) {
        target.consumedCount = 0;
      }

      if (restorePartial) {
        target.isOpened = true;
        target.openRemainFraction = Utils.round2(dFrac);
        if (!target.openedDate) {
          target.openedDate = lg.date || target.archivedOpenedDate || Utils.getTodayStr();
        }
      } else if (!target.isOpened || wasFinishedBatch) {
        target.isOpened = false;
        target.openRemainFraction = 0;
        target.openedDate = '';
      }

      var linkedArc = state.items.find(function (x) { return x.sourceBatchId === target.id && (Number(x.quantity) || 0) <= 0; });
      if (target.eatenCount <= 0) {
        if (linkedArc) {
          state.items = state.items.filter(function (x) { return x.id !== linkedArc.id; });
        }
      } else {
        if (linkedArc) {
          linkedArc.consumedCount = target.eatenCount;
          linkedArc.lastQuantity = target.eatenCount;
        } else if (wasFinishedBatch) {
          // Recreate shadow archive for the earlier eaten units so they aren't lost from "已吃完"!
          var recreatedArc = Domain.sanitizeItem(Object.assign({}, target, {
            id: 'empty_' + target.id,
            sourceBatchId: target.id,
            quantity: 0,
            consumedCount: target.eatenCount,
            lastQuantity: target.eatenCount,
            archivedOpenedDate: target.archivedOpenedDate || Utils.getTodayStr(),
            finishedDate: target.lastEatenDate || Utils.getTodayStr(),
            isOpened: false,
            openedDate: target.archivedOpenedDate || '',
            openRemainFraction: 0
          }));
          state.items.push(recreatedArc);
        }
      }

      Domain.appendStockHistory({
        date: Utils.getTodayStr(),
        action: adjustmentNote ? 'adjust' : 'revert',
        itemId: target.id,
        category: target.category,
        brand: target.brand,
        name: target.name,
        unit: uLabel,
        deltaText: '+' + dUnit + uLabel + (target.openRemainFraction > 0 ? ('(' + Utils.formatRemainFractionText(target.openRemainFraction, uLabel) + ')') : ''),
        beforeQty: beforeQ,
        afterQty: restoredQ,
        note: adjustmentNote || ('删除饮食记录并退回库存（原记录 ' + (lg.date || '') + ' ' + (lg.amount || '') + '）')
      });
      return true;
    }

    if (dFrac > 0) {
      var curRem = (target.isOpened && Number(target.openRemainFraction) > 0) ? Number(target.openRemainFraction) : 0;
      // A fractional deduction can only be returned to a package still open.
      if (curRem <= 0 || Number(target.quantity) <= 0) return false;
      var restoredRem = Utils.round2(curRem + dFrac);
      if (restoredRem > 1) return false;
      if (restoredRem === 1) {
        target.isOpened = false;
        target.openedDate = '';
        target.openRemainFraction = 0;
      } else {
        target.isOpened = true;
        target.openRemainFraction = restoredRem;
      }
      Domain.appendStockHistory({
        date: Utils.getTodayStr(),
        action: 'revert',
        itemId: target.id,
        category: target.category,
        brand: target.brand,
        name: target.name,
        unit: uLabel,
        deltaText: target.isOpened ? Utils.formatRemainFractionText(target.openRemainFraction, uLabel) : '恢复整' + uLabel + '未拆',
        beforeQty: target.quantity,
        afterQty: target.quantity,
        note: '撤回分顿喂食记录，恢复拆封余量'
      });
      return true;
    }
    return false;
  };

  function nextFlavorRevision() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function flavorHistory(item, flavor, action, date, text) {
    Domain.appendStockHistory({
      date: date, action: action, itemId: item.id, category: item.category,
      brand: item.brand, name: item.name, unit: item.unit,
      beforeQty: item.quantity, afterQty: item.quantity,
      deltaText: text, note: '口味：' + flavor.name, isSample: item.isSample
    });
  }

  Domain.adjustFlavorStock = function (item, flavor, whole, percent, reason) {
    if (!item || item.sourceBatchId || !flavor || !item.flavors || !item.flavors.includes(flavor) ||
        !Number.isSafeInteger(whole) || whole < 0 || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
        (percent > 0 && !flavor.openedDate)) return false;
    var opened = percent > 0;
    var qty = whole + Number(opened);
    if (qty > flavor.perPack * item.purchasePackaging.count) return false;
    var fraction = opened && percent < 100 ? percent / 100 : 0;
    var previousPercent = flavor.openedDate ? Utils.round2((flavor.openRemainFraction || 1) * 100) : 0;
    var delta = qty - flavor.quantity;
    if (!delta && previousPercent === percent) return false;

    var note = '口味：' + flavor.name + ' · ' + flavor.quantity + ' → ' + qty + item.unit +
      ' · 开封单件余量 ' + previousPercent + '% → ' + percent + '%' + (reason ? ' · ' + reason : '');
    if (delta > 0 && !Domain.revertConsumedFromLog({ itemId: item.id, deductedUnit: delta }, note)) return false;
    flavor.quantity = qty;
    flavor.openRemainFraction = fraction;
    if (!opened) flavor.openedDate = '';
    flavor.revision = nextFlavorRevision();

    if (delta < 0) {
      Domain.recordConsumedUnits(item, -delta, Utils.getTodayStr(), note, true);
    } else if (!delta) {
      Domain.appendStockHistory({
        action: 'adjust', itemId: item.id, category: item.category, brand: item.brand, name: item.name,
        unit: item.unit, beforeQty: item.quantity, afterQty: item.quantity,
        deltaText: '开封单件余量 ' + previousPercent + '% → ' + percent + '%', note: note, isSample: item.isSample
      });
    }
    return true;
  };

  Domain.openFlavor = function (item, flavor, date) {
    var shared = Domain.hasSharedSeal(item);
    if (!flavor || flavor.quantity <= 0 || (shared ? item.isOpened : flavor.openedDate)) return false;
    if (shared) {
      item.isOpened = true;
      item.openedDate = date;
      item.flavors.forEach(function (entry) { entry.revision = nextFlavorRevision(); });
    } else {
      flavor.openedDate = date;
      flavor.revision = nextFlavorRevision();
    }
    flavorHistory(item, flavor, 'open', date, shared ? '开封共用密封包装' : '拆封 1' + item.unit);
    return true;
  };

  Domain.planFeedingPortion = function (item, flavor, portion) {
    if (item.flavors && !flavor) return { error: '请先选择实际喂食的口味。' };
    if (item.quantity < 1 || (flavor && flavor.quantity < 1)) return { error: '当前库存不足，无法扣减。' };
    var unit = item.unit || '件';
    if (!Domain.isPackageUnit(unit) && unit !== '粒') {
      return { error: '无法确认该商品的单件单位，请仅记录喂食或单独调整库存。' };
    }
    var remaining = (flavor || item).openRemainFraction || 1;
    var used = portion.finish ? remaining : portion.fraction;
    if (!Number.isFinite(used) || used <= 0) return { error: '无法换算份量，请输入如「1' + unit + '」或「半' + unit + '」。' };
    if (used - remaining > 1e-12) return { error: '份量超过当前单件余量，无法扣减。' };
    var after = remaining - used;
    if (after <= 1e-12) after = 0;
    if (after === remaining) return { error: '份量太小，无法安全更新余量。' };
    return { used: after === 0 ? remaining : used, after: after };
  };

  Domain.feedBatchPortion = function (item, plan, date, amount) {
    var before = {
      revision: item.portionRevision || '', opened: Boolean(item.isOpened),
      openedDate: item.openedDate || '', fraction: item.openRemainFraction || 0
    };
    var units = 0;
    if (!plan.after) {
      units = Domain.recordConsumedUnits(item, 1, date, '记喂食（' + amount + '），核销 1' + item.unit);
      item.openRemainFraction = 0;
    } else {
      item.isOpened = true;
      item.openedDate = item.openedDate || date;
      item.openRemainFraction = plan.after;
      item.lastEatenDate = date;
      Domain.appendStockHistory({
        date: date, action: 'partial', itemId: item.id, category: item.category,
        brand: item.brand, name: item.name, unit: item.unit,
        deltaText: Utils.formatRemainFractionText(plan.after, item.unit),
        beforeQty: item.quantity, afterQty: item.quantity, note: '分顿投喂 ' + amount
      });
    }
    return { units: units, fraction: plan.used, before: before, revision: item.portionRevision };
  };

  Domain.validatePortionReceipt = function (log) {
    var change = log.portionChange;
    var before = change && change.before;
    return Boolean(log.itemId && !log.flavorId && before &&
      typeof change.revision === 'string' && change.revision && typeof before.revision === 'string' &&
      typeof before.opened === 'boolean' && typeof before.openedDate === 'string' &&
      (before.openedDate === '' || Utils.normalizeDateStr(before.openedDate) === before.openedDate) &&
      Number.isFinite(before.fraction) && before.fraction >= 0 && before.fraction < 1 &&
      (before.opened || !before.fraction) && (change.units === 0 || change.units === 1) &&
      change.units === Number(log.deductedUnit) && Number.isFinite(change.fraction) &&
      change.fraction > 0 && change.fraction <= 1 && change.fraction === Number(log.deductedFrac));
  };

  function revertBatchPortion(log) {
    var item = state.items.find(function (batch) { return batch.id === log.itemId; });
    var change = log.portionChange;
    var before = change.before;
    if (!item || item.flavors || !Domain.validatePortionReceipt(log) || item.portionRevision !== change.revision) return false;
    if (change.units) {
      if (!Domain.revertConsumedFromLog(Object.assign({}, log, { portionChange: null, deductedFrac: 0 }))) return false;
    } else {
      Domain.appendStockHistory({
        action: 'revert', itemId: item.id, category: item.category, brand: item.brand, name: item.name,
        unit: item.unit, beforeQty: item.quantity, afterQty: item.quantity, note: '撤销分顿喂食，恢复开封状态及余量',
        deltaText: before.fraction ? Utils.formatRemainFractionText(before.fraction, item.unit) : '恢复整件'
      });
    }
    item.isOpened = before.opened;
    item.openedDate = before.openedDate;
    item.openRemainFraction = before.fraction;
    item.portionRevision = before.revision;
    return true;
  }

  Domain.feedFlavor = function (item, flavor, fraction, finish, date, inventoryOnly) {
    if (!flavor) return null;
    var plan = Domain.planFeedingPortion(item, flavor, { fraction: fraction, finish: finish });
    if (plan.error) return null;
    var used = plan.used;
    var after = plan.after;
    var before = {
      revision: flavor.revision, openedDate: flavor.openedDate,
      fraction: flavor.openRemainFraction, sharedOpenedDate: item.isOpened ? item.openedDate : ''
    };
    var shared = Domain.hasSharedSeal(item);
    if (shared && !item.isOpened) {
      item.isOpened = true;
      item.openedDate = date;
    }
    flavor.revision = nextFlavorRevision();
    flavor.openRemainFraction = after;
    flavor.openedDate = after > 0 ? flavor.openedDate || date : '';
    if (after <= 0) {
      flavor.quantity -= 1;
      Domain.recordConsumedUnits(item, 1, date, (inventoryOnly ? '仅核销 1' : '喂食并用完 1') + item.unit + ' · ' + flavor.name);
    } else {
      item.lastEatenDate = date;
      flavorHistory(item, flavor, 'partial', date, '单件剩余 ' + Utils.round2(after * 100) + '%');
    }
    return { revision: flavor.revision, before: before, units: after <= 0 ? 1 : 0, fraction: used };
  };

  function revertFlavorFeeding(log) {
    var item = state.items.find(function (entry) { return entry.id === log.itemId; });
    var flavor = Domain.findFlavor(item, log.flavorId);
    var change = log.flavorChange;
    if (!flavor || !change || !Domain.validateFlavorLog(log) || flavor.revision !== change.revision) return false;
    var before = change.before;
    if (change.units) {
      if (flavor.quantity >= flavor.perPack * item.purchasePackaging.count) return false;
      if (!Domain.revertConsumedFromLog(Object.assign({}, log, {
        flavorId: '', amount: log.amount + ' · ' + flavor.name, deductedUnit: 1, deductedFrac: 0
      }))) return false;
      flavor.quantity += 1;
    } else {
      flavorHistory(item, flavor, 'revert', Utils.getTodayStr(), '恢复该口味的开封余量');
    }
    flavor.revision = before.revision;
    flavor.openedDate = before.openedDate;
    flavor.openRemainFraction = before.fraction;
    if (Domain.hasSharedSeal(item)) {
      var otherUse = item.flavors.some(function (entry) {
        return entry !== flavor && (entry.openedDate || entry.quantity < entry.perPack * item.purchasePackaging.count);
      });
      item.openedDate = before.sharedOpenedDate || (otherUse ? item.openedDate || log.date : '');
      item.isOpened = Boolean(item.openedDate);
    }
    return true;
  }

  // ==================== EXPIRY & FRESHNESS EVALUATION ====================
  Domain.evaluateItem = function (item, refTodayStr) {
    var expDays = Utils.diffDaysFromToday(item.expDate, refTodayStr);
    var openRemaining = null;
    if (item.isOpened && item.openedDate && item.openDaysLimit > 0) {
      var openEndStr = Utils.addShelfLife(item.openedDate, item.openDaysLimit, 'days');
      openRemaining = Utils.diffDaysFromToday(openEndStr, refTodayStr);
    }

    if (item.flavors && !Domain.hasSharedSeal(item)) {
      item.flavors.forEach(function (flavor) {
        if (!flavor.openedDate || flavor.quantity <= 0) return;
        var end = Utils.addShelfLife(flavor.openedDate, item.openDaysLimit, 'days');
        var days = Utils.diffDaysFromToday(end, refTodayStr);
        if (days !== null && (openRemaining === null || days < openRemaining)) openRemaining = days;
      });
    }

    var effectiveDays = expDays;
    if (openRemaining !== null && (effectiveDays === null || openRemaining < effectiveDays)) {
      effectiveDays = openRemaining;
    }

    var qty = Number(item.quantity) || 0;
    var warnThreshold = Number(state.settings.warnDays) || 60;
    var status = 'fresh'; // 'empty' | 'expired' | 'expiring' | 'fresh'
    if (qty <= 0) {
      status = 'empty';
    } else if ((expDays !== null && expDays < 0) || (openRemaining !== null && openRemaining < 0)) {
      status = 'expired';
    } else if (
      (expDays !== null && expDays <= warnThreshold) ||
      (openRemaining !== null && openRemaining <= Math.min(10, warnThreshold))
    ) {
      status = 'expiring';
    }

    var pctRemaining = 100;
    if (item.prodDate && item.expDate) {
      var totalDays = Utils.diffDaysBetween(item.prodDate, item.expDate);
      if (totalDays !== null && totalDays > 0) {
        pctRemaining = Math.max(0, Math.min(100, Math.round(((expDays || 0) / totalDays) * 100)));
      }
    } else if (expDays !== null) {
      pctRemaining = expDays < 0 ? 0 : Math.min(100, Math.round((expDays / 365) * 100));
    }

    return {
      expDays: expDays,
      openRemaining: openRemaining,
      effectiveDays: effectiveDays === null ? 99999 : effectiveDays,
      status: status,
      pctRemaining: pctRemaining,
      group: MP.getCategoryGroup(item.category)
    };
  };

  // ==================== PRODUCT GROUPING & FEEDING LOG HELPERS ====================
  Domain.getProductGroupKey = function (it) {
    if (!it) return '';
    var c = String(it.category || 'dry').trim().toLowerCase();
    var b = String(it.brand || '').trim().toLowerCase();
    var n = String(it.name || '').trim().toLowerCase();
    var s = String(it.spec || '').trim().toLowerCase();
    var u = String(it.unit || '件').trim().toLowerCase();
    return c + '||' + b + '||' + n + '||' + s + '||' + u;
  };

  Domain.groupEmptyItemsByProduct = function (emptyItems) {
    var map = {};
    var groups = [];
    emptyItems.forEach(function (it) {
      var key = Domain.getProductGroupKey(it);
      var batchUsed = Number(it.consumedCount) || Number(it.lastQuantity) || 1;
      if (!map[key]) {
        map[key] = {
          groupKey: key,
          latestItem: it,
          totalConsumed: 0,
          batches: []
        };
        groups.push(map[key]);
      }
      map[key].totalConsumed = Utils.round2(map[key].totalConsumed + batchUsed);
      map[key].batches.push(it);
      var curRep = map[key].latestItem;
      if ((!curRep.imageData && it.imageData) || String(it.finishedDate || it.prodDate || '') > String(curRep.finishedDate || curRep.prodDate || '')) {
        map[key].latestItem = it;
      }
    });
    groups.forEach(function (g) {
      g.batches.sort(function (a, b) {
        return String(b.finishedDate || b.prodDate || '').localeCompare(String(a.finishedDate || a.prodDate || ''));
      });
    });
    return groups;
  };

  Domain.appendFeedingLog = function (entry) {
    var record = Domain.sanitizeLog({
      id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      date: entry.date || Utils.getTodayStr(),
      mealSlot: entry.mealSlot || Utils.getCurrentMealSlot(),
      itemId: entry.itemId || '',
      category: entry.category || 'dry',
      subtype: entry.subtype || undefined,
      brand: entry.brand || '',
      name: entry.name || '',
      amount: entry.amount || '1份',
      note: entry.note || '',
      nextDueDate: entry.nextDueDate || '',
      reminderDays: entry.reminderDays || 0,
      reminderDone: false,
      deductedUnit: Number(entry.deductedUnit) || 0,
      deductedFrac: Number(entry.deductedFrac) || 0,
      flavorId: entry.flavorId || undefined,
      flavorName: entry.flavorName || undefined,
      flavorPalatability: entry.flavorPalatability || undefined,
      flavorChange: entry.flavorChange || undefined,
      portionChange: entry.portionChange || undefined,
      isSample: Boolean(entry.isSample)
    });
    state.logs.unshift(record);
    return record;
  };

  // Smart Quick-Feed helper: find the user's last fed portion & date for an item
  Domain.getLastFedInfoForItem = function (item) {
    if (!item || !state.logs.length) return null;
    var bNorm = String(item.brand || '').trim().toLowerCase();
    var nNorm = String(item.name || '').trim().toLowerCase();
    var best = null;
    for (var i = 0; i < state.logs.length; i++) {
      var lg = state.logs[i];
      var matchById = (lg.itemId && lg.itemId === item.id);
      var matchByName = (!lg.itemId && String(lg.brand || '').trim().toLowerCase() === bNorm && String(lg.name || '').trim().toLowerCase() === nNorm);
      if (matchById || matchByName) {
        if (!best || String(lg.date || '') > String(best.date || '')) {
          best = lg;
        }
      }
    }
    return best;
  };

  // ==================== INITIAL DEMO DATA (FIRST LAUNCH ONLY) ====================
  Domain.buildSampleItems = function () {
    var p1 = Utils.shiftDaysFromToday(-160);
    var e1 = Utils.addShelfLife(p1, 18, 'months');
    var p2 = Utils.shiftDaysFromToday(-695);
    var e2 = Utils.addShelfLife(p2, 24, 'months');
    var p3 = Utils.shiftDaysFromToday(-90);
    var e3 = Utils.addShelfLife(p3, 18, 'months');
    var p4 = Utils.shiftDaysFromToday(-560);
    var e4 = Utils.addShelfLife(p4, 18, 'months');

    return [
      Domain.sanitizeItem({
        id: 'sample_1',
        category: 'dry',
        brand: '渴望 Orijen',
        name: '无谷鸡肉全期猫粮',
        spec: '5.4kg',
        quantity: 1,
        unit: '袋',
        price: 629,
        currency: 'CNY',
        prodDate: p1,
        shelfLifeValue: 18,
        shelfLifeUnit: 'months',
        expDate: e1,
        isOpened: true,
        openedDate: Utils.shiftDaysFromToday(-18),
        openDaysLimit: 45,
        palatability: 'love',
        location: '真空储粮桶',
        batchCode: '天猫国际自营',
        notes: '目前主力干粮，早晚各35g',
        isSample: true
      }),
      Domain.sanitizeItem({
        id: 'sample_2',
        category: 'can',
        brand: '巅峰 ZiwiPeak',
        name: '新西兰马鲛鱼羊肉主食罐',
        spec: '170g',
        quantity: 6,
        unit: '罐',
        price: 26.5,
        currency: 'CNY',
        prodDate: p2,
        shelfLifeValue: 24,
        shelfLifeUnit: 'months',
        expDate: e2,
        isOpened: false,
        openedDate: '',
        openDaysLimit: 2,
        palatability: 'love',
        location: '餐边柜第2层',
        batchCode: '双11囤货',
        notes: '一罐分两顿吃，记得兑温水骗水',
        isSample: true
      }),
      Domain.sanitizeItem({
        id: 'sample_3',
        category: 'freeze',
        brand: 'K9 Natural',
        name: '鸡肉羊心主食冻干',
        spec: '320g',
        quantity: 2,
        unit: '包',
        price: 218,
        currency: 'CNY',
        prodDate: p3,
        shelfLifeValue: 18,
        shelfLifeUnit: 'months',
        expDate: e3,
        isOpened: false,
        openedDate: '',
        openDaysLimit: 60,
        palatability: 'ok',
        location: '储物柜上层',
        batchCode: '旗舰店购入',
        notes: '捏碎做罐头伴侣',
        isSample: true
      }),
      Domain.sanitizeItem({
        id: 'sample_4',
        category: 'treat',
        brand: '汪汪喵星球',
        name: '三文鱼纯肉猫条',
        spec: '15g×6支',
        quantity: 1,
        unit: '盒',
        price: 19.9,
        currency: 'CNY',
        prodDate: p4,
        shelfLifeValue: 18,
        shelfLifeUnit: 'months',
        expDate: e4,
        isOpened: false,
        openedDate: '',
        openDaysLimit: 14,
        palatability: 'meh',
        location: '零食抽屉',
        batchCode: '赠品小样',
        notes: '角落翻出来的过期赠品演示（开启编辑可删除）',
        isSample: true
      })
    ];
  };

  Domain.buildSampleLogs = function () {
    var today = Utils.getTodayStr();
    var yest = Utils.shiftDaysFromToday(-1);
    return [
      Domain.sanitizeLog({
        id: 'log_sample_1',
        date: today,
        mealSlot: '🌅 早饭',
        itemId: 'sample_1',
        category: 'dry',
        brand: '渴望 Orijen',
        name: '无谷鸡肉全期猫粮',
        amount: '35g',
        note: '秒光盘，精神很好',
        isSample: true
      }),
      Domain.sanitizeLog({
        id: 'log_sample_2',
        date: today,
        mealSlot: '🌙 晚饭',
        itemId: 'sample_2',
        category: 'can',
        brand: '巅峰 ZiwiPeak',
        name: '新西兰马鲛鱼羊肉主食罐',
        amount: '半罐 (约85g)',
        note: '兑了40ml温水全部喝完',
        isSample: true
      }),
      Domain.sanitizeLog({
        id: 'log_sample_3',
        date: yest,
        mealSlot: '🌅 早饭',
        itemId: 'sample_1',
        category: 'dry',
        brand: '渴望 Orijen',
        name: '无谷鸡肉全期猫粮',
        amount: '40g',
        note: '日常早粮',
        isSample: true
      }),
      Domain.sanitizeLog({
        id: 'log_sample_4',
        date: yest,
        mealSlot: '🍪 加餐/零食',
        itemId: 'sample_3',
        category: 'freeze',
        brand: 'K9 Natural',
        name: '鸡肉羊心主食冻干',
        amount: '15g冻干',
        note: '骗水伴侣',
        isSample: true
      })
    ];
  };
})(typeof window !== 'undefined' ? window : globalThis);
