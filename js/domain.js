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
      dailyFeedGrams: { dry: 50, freeze: 10, can: 80 },
      pantryPageSize: 5,
      compactPantryPageSize: 20,
      pantryDisplayMode: 'card',
      pantryStatusHintSeen: false,
      pantryHistoryHintSeen: false,
      lastBackupDate: '',
      lastJsonExportAt: '',
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
    statusFilter: 'in_stock', // 'all' | 'in_stock' | 'expiring' | 'expired' | 'empty'
    pantryHealthFilter: '',   // Temporary constraint from the analysis page.
    catFilter: 'all',
    brandFilter: 'all',
    sortBy: 'exp_asc',
    supplySortBy: 'supply_days_asc',
    searchQuery: '',
    pantryDisplayMode: 'card', // 'card' | 'compact'
    pantryPage: 1,
    pantryPageSize: 5,
    statsSubTab: 'stock',     // 'stock' | 'pal' | 'brand'
    statsScopeFilter: 'all',  // 'all' | 'food' | 'supp' | 'med'
    statsTierTab: 'love',     // 'love' | 'ok' | 'coax' | 'meh' | 'supp' | 'med'
    tierPage: 1,
    tierPageSize: 5,
    brandScopeFilter: 'all',  // 'all' | 'food' | 'supp' | 'med' | 'supplies'
    brandPage: 1,
    brandPageSize: 5,
    historyTypeFilter: 'all', // 'all' | 'in' | 'consume' | 'adjust'
    historyItemFilter: '',    // itemId or ''
    historySearchQuery: '',
    historyPage: 1,
    historyPageSize: 15,
    backupBannerDismissedCount: -1,
    formCat: 'dry',
    formPal: '',
    formImages: [],
    photoUploadToken: 0,
    photoUploadPending: false,
    formCurrency: 'CNY'
  };

  // ==================== SCHEMA SANITIZERS & MIGRATORS (NON-DESTRUCTIVE) ====================
  // Only units with an unambiguous package meaning enter the headline total.
  Domain.isPackageUnit = function (unit) {
    return /^(袋|罐|包|盒|箱|支|瓶|件|桶|杯|听|袋装)$/.test(unit);
  };

  Domain.canCorrectStockUnit = function (item, unit) {
    var countingUnit = /^(盒|杯|罐|袋|包|支|粒|片|瓶|件|听|袋装)$/;
    return Boolean(item && !item.sourceBatchId && item.unit !== unit &&
      countingUnit.test(item.unit) && countingUnit.test(unit) && Number.isSafeInteger(item.quantity) &&
      (!item.purchasePackaging || item.purchasePackaging.outerUnit !== unit));
  };

  Domain.stockUnitCorrectionError = function (item, unit) {
    var countingUnit = /^(盒|杯|罐|袋|包|支|粒|片|瓶|件|听|袋装)$/;
    if (!item || item.sourceBatchId) return '归档记录不能更正单位。';
    if (!countingUnit.test(item.unit) || !countingUnit.test(unit)) return '该单位暂不支持更正。';
    if (!Number.isSafeInteger(item.quantity)) return '当前剩余数量不是整数，无法仅更正计数单位。';
    if (item.purchasePackaging && item.purchasePackaging.outerUnit === unit) return '内包装不能与外包装相同。';
    return '';
  };

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  Domain.rewriteStockUnitDelta = function (text, previousUnit, unit) {
    var value = String(text || '');
    var old = escapeRegExp(previousUnit);
    var quantity = '([+-]\\d+(?:\\.\\d+)?)';
    var fraction = '(余(?:1\\/2|2\\/3|1\\/3|3\\/4|1\\/4|不足0\\.01|\\d+(?:\\.\\d+)?%))';
    var match = new RegExp('^' + quantity + old + '$').exec(value);
    if (match) return match[1] + unit;
    match = new RegExp('^' + quantity + old + '\\(' + fraction + old + '\\)$').exec(value);
    if (match) return match[1] + unit + '(' + match[2] + unit + ')';
    match = new RegExp('^' + fraction + old + '$').exec(value);
    if (match) return match[1] + unit;
    if (value === '拆封 1' + previousUnit) return '拆封 1' + unit;
    if (value === '恢复整' + previousUnit) return '恢复整' + unit;
    if (value === '恢复整' + previousUnit + '未拆') return '恢复整' + unit + '未拆';
    var correction = /^(盒|杯|罐|袋|包|支|粒|片|瓶|件|听|袋装) → (盒|杯|罐|袋|包|支|粒|片|瓶|件|听|袋装)$/.exec(value);
    if (correction && correction[2] === previousUnit && correction[1] !== unit) return correction[1] + ' → ' + unit;
    return value;
  };

  Domain.syncStockUnitCorrection = function (item, previousUnit) {
    if (!item || !previousUnit || item.unit === previousUnit) return false;
    var unit = item.unit;
    state.items.forEach(function (archive) {
      if (archive.sourceBatchId === item.id && archive.quantity === 0) archive.unit = unit;
    });
    state.stockHistory.forEach(function (entry) {
      if (entry.itemId !== item.id) return;
      entry.unit = unit;
      entry.deltaText = Domain.rewriteStockUnitDelta(entry.deltaText, previousUnit, unit);
    });
    state.logs.forEach(function (log) {
      if (log.itemId === item.id) log.productUnit = unit;
    });
    Domain.appendStockHistory({
      action: 'adjust', itemId: item.id, category: item.category, brand: item.brand,
      name: item.name, unit: unit, beforeQty: item.quantity, afterQty: item.quantity,
      deltaText: '内包装单位由 ' + previousUnit + ' 更正为 ' + unit,
      note: '仅更正单位，数量不变', isSample: item.isSample, preservePortionRevision: true
    });
    return true;
  };

  Domain.validatePackaging = function (raw, innerUnit) {
    // 组 and 提 remain valid for existing records and imported backups.
    if (!raw || !/^(盒|袋|桶|箱|包|组|提)$/.test(raw.outerUnit)) return null;
    if (!Domain.isPackageUnit(innerUnit) && innerUnit !== '粒' && innerUnit !== '片') return null;
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
      Number.isSafeInteger(change.units) && change.units >= 0 && Number(log.deductedUnit) === change.units &&
      validPortionChange(change) &&
      Number.isFinite(before.fraction) && before.fraction >= 0 && before.fraction < 1 &&
      typeof before.revision === 'string' &&
      (before.openedDate === '' || Utils.normalizeDateStr(before.openedDate) === before.openedDate) &&
      (before.sharedOpenedDate === '' || Utils.normalizeDateStr(before.sharedOpenedDate) === before.sharedOpenedDate));
  };

  Domain.resolveLogProduct = function (log, forRanking) {
    if (Domain.getCareType(log) === 'nursing') {
      return { brand: '', category: log.category, name: Domain.nursingLabel(log) };
    }
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
    if (forRanking) {
      if (item) return item;
      if (log.productUnit) {
        return { brand: log.brand, name: log.name, category: log.category, spec: log.productSpec, unit: log.productUnit, unit_net_weight_g: log.productUnitWeightGrams };
      }
      return log;
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
    var netWeight = Number(raw.unit_net_weight_g);
    if (!(netWeight > 0) && (cat === 'dry' || cat === 'freeze')) {
      netWeight = Utils.legacyUnitWeight(clean.spec, clean.unit);
    }
    clean.unit_net_weight_g = Number.isFinite(netWeight) && netWeight > 0 ? netWeight : null;
    clean.feedUsageUnit = MP.FEED_USAGE_UNITS.includes(raw.feedUsageUnit) ? raw.feedUsageUnit : '';
    var usagePerItem = Number(raw.feedUsagePerItem);
    clean.feedUsagePerItem = clean.feedUsageUnit && Number.isFinite(usagePerItem) && usagePerItem > 0 ? usagePerItem : null;
    var specValue = Number(raw.unit_spec_value);
    if (specValue > 0 && ((cat === 'supplies' && MP.SUPPLY_SPEC_UNITS.concat(MP.LEGACY_SUPPLY_SPEC_UNITS || []).includes(raw.unit_spec_unit)) ||
        (['supp', 'med'].includes(cat) && raw.unit_spec_unit === '毫升'))) {
      clean.unit_spec_value = specValue;
      clean.unit_spec_unit = raw.unit_spec_unit;
    } else {
      delete clean.unit_spec_value;
      delete clean.unit_spec_unit;
    }
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
    clean.openDaysLimit = raw.openDaysLimit === null || (cat === 'supplies' && (raw.openDaysLimit === '' || raw.openDaysLimit === undefined))
      ? null : Math.max(1, parseInt(raw.openDaysLimit, 10) || defCat.defaultOpenDays || 45);
    clean.openRemainFraction = remFrac;
    var legacyPalatability = Object.hasOwn(MP.PALATABILITY, raw.palatability) ? raw.palatability : '';
    if (flavors) {
      flavors.forEach(function (flavor) {
        if (!flavor.palatability) flavor.palatability = legacyPalatability;
      });
      delete clean.palatability;
    } else {
      clean.palatability = legacyPalatability;
    }
    clean.location = String(raw.location || '').trim();
    clean.batchCode = String(raw.batchCode || '').trim();
    clean.notes = String(raw.notes || '').trim();
    clean.effectTags = Array.isArray(raw.effectTags) ? Array.from(new Set(raw.effectTags
      .filter(function (tag) { return typeof tag === 'string'; })
      .map(function (tag) { return tag.trim(); }).filter(Boolean))) : [];
    clean.legacySpecInNotes = Boolean(raw.legacySpecInNotes);
    if (cat !== 'supplies' && clean.spec && !clean.legacySpecInNotes) {
      var legacyNote = '包装补充：' + clean.spec;
      if (!clean.notes.includes(legacyNote)) clean.notes += (clean.notes ? '；' : '') + legacyNote;
      clean.legacySpecInNotes = true;
    }
    clean.images = MP.getItemImages(raw);
    delete clean.imageData;
    delete clean.image;
    clean.isSample = Boolean(raw.isSample);
    clean.eatenCount = Utils.round2(Math.max(0, Number(raw.eatenCount) || 0));
    clean.discardedCount = Utils.round2(Math.max(0, Number(raw.discardedCount) || 0));
    clean.consumedCount = Utils.round2(Math.max(0, Number(raw.consumedCount) || 0));
    clean.lastQuantity = Utils.round2(Math.max(0, Number(raw.lastQuantity) || 0));
    clean.lastEatenDate = Utils.normalizeDateStr(raw.lastEatenDate);
    clean.sourceBatchId = typeof raw.sourceBatchId === 'string' ? raw.sourceBatchId : '';
    return clean;
  };

  Domain.getCareType = function (log) {
    if (log.careType === 'nursing' || log.careType === 'medication') return log.careType;
    if (Utils.normalizeMealSlot(log.mealSlot) !== 'care') return log.category === 'med' ? 'medication' : '';
    var name = String(log.name || '').trim();
    var amount = String(log.amount || '').trim();
    return log.itemId || (name && name !== '未命名') || amount ? 'medication' : 'nursing';
  };

  Domain.nursingLabel = function (log) {
    return log.careProjects?.join('、') || '护理';
  };

  Domain.sanitizeLog = function (raw, fallbackIdx) {
    if (!raw || typeof raw !== 'object') return null;
    var cat = (raw.category && MP.CATEGORIES[raw.category]) ? raw.category : 'dry';
    var clean = Object.assign({}, raw);
    clean.id = (typeof raw.id === 'string' && raw.id.trim())
      ? raw.id.trim()
      : ('log_migrated_' + Date.now() + '_' + (fallbackIdx || 0));
    clean.date = Utils.normalizeDateStr(raw.date) || Utils.getTodayStr();
    clean.mealSlot = Utils.normalizeMealSlot(raw.mealSlot);
    var careType = Domain.getCareType(raw);
    if (clean.mealSlot === 'care') clean.careType = careType;
    if (careType === 'nursing') {
      clean.careProjects = Array.isArray(raw.careProjects) ? Array.from(new Set(raw.careProjects
        .filter(function (name) { return typeof name === 'string'; })
        .map(function (name) { return name.trim(); }).filter(Boolean))) : [];
      clean.careOther = typeof raw.careOther === 'string' ? raw.careOther.trim() : '';
    }
    clean.itemId = typeof raw.itemId === 'string' ? raw.itemId : '';
    clean.category = cat;
    if (!(clean.productUnitWeightGrams > 0) && (cat === 'dry' || cat === 'freeze')) {
      clean.productUnitWeightGrams = Utils.legacyUnitWeight(clean.productSpec, clean.productUnit) || undefined;
    }
    if (raw.unstocked === true && !clean.itemId && !careType) clean.unstocked = true;
    else delete clean.unstocked;
    clean.brand = String(raw.brand || '').trim() || (clean.unstocked ? '' : '未命名');
    clean.name = String(raw.name || '').trim() || '未命名';
    clean.amount = String(raw.amount || (careType === 'nursing' ? '' : '1份')).trim();
    clean.note = String(raw.note || '').trim();
    clean.medicationOutcome = Domain.normalizeMedicationOutcome(raw.medicationOutcome);
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
      ...(Utils.normalizeDateStr(raw.openingDate) ? { openingDate: Utils.normalizeDateStr(raw.openingDate) } : {}),
      ...(cat === 'supplies' && ((raw.supplyEvent === 'opening_changed' && ['open', 'unopen', 'adjust'].includes(action)) ||
        (raw.supplyEvent === 'history_dates_changed' && action === 'adjust')) ? { supplyEvent: raw.supplyEvent } : {}),
      ...(Number.isFinite(raw.unitWeightGrams) && raw.unitWeightGrams > 0 ? { unitWeightGrams: raw.unitWeightGrams } : {}),
      ...(action === 'revert' && typeof raw.revertsHistoryId === 'string' && raw.revertsHistoryId
        ? { revertsHistoryId: raw.revertsHistoryId } : {}),
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
    archiveItem.discardedCount = activeItem.discardedCount || 0;
    archiveItem.category = activeItem.category;
    archiveItem.brand = activeItem.brand;
    archiveItem.name = activeItem.name;
    archiveItem.spec = activeItem.spec;
    archiveItem.effectTags = (activeItem.effectTags || []).slice();
    archiveItem.unit_net_weight_g = activeItem.unit_net_weight_g;
    archiveItem.feedUsageUnit = activeItem.feedUsageUnit;
    archiveItem.feedUsagePerItem = activeItem.feedUsagePerItem;
    archiveItem.unit_spec_value = activeItem.unit_spec_value;
    archiveItem.unit_spec_unit = activeItem.unit_spec_unit;
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
    if (activeItem.flavors) delete archiveItem.palatability;
    else archiveItem.palatability = activeItem.palatability;
    archiveItem.location = activeItem.location;
    archiveItem.batchCode = activeItem.batchCode;
    archiveItem.images = MP.getItemImages(activeItem);
    delete archiveItem.imageData;
    delete archiveItem.image;
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
    var item = state.items.find(function (batch) { return batch.id === entry.itemId; });
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
      openingDate: entry.openingDate,
      supplyEvent: entry.supplyEvent,
      unitWeightGrams: entry.action === 'consume' && item && MP.Forecast ? MP.Forecast.unitGrams(item) : 0,
      revertsHistoryId: entry.revertsHistoryId,
      isSample: Boolean(entry.isSample || (item && item.isSample))
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
    var unitOpenedDate = target.openedDate || target.archivedOpenedDate || (adjustment === 'discard' ? '' : opDate);

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
      var finalOpenDate = unitOpenedDate || (linkedArchive && (linkedArchive.archivedOpenedDate || linkedArchive.openedDate)) ||
        (adjustment === 'discard' ? '' : opDate);
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
      action: adjustment === 'discard' ? 'discard' : adjustment ? 'adjust' : 'consume',
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
        revertsHistoryId: lg.consumeHistoryId,
        itemId: target.id,
        category: target.category,
        brand: target.brand,
        name: target.name,
        unit: uLabel,
        deltaText: '+' + dUnit + uLabel + (target.openRemainFraction > 0 ? ('(' + Utils.formatRemainFractionText(target.openRemainFraction, uLabel) + ')') : ''),
        beforeQty: beforeQ,
        afterQty: restoredQ,
        note: adjustmentNote || ('删除每日记录并退回库存（原记录 ' + (lg.date || '') + ' ' + (lg.amount || '') + '）')
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

  Domain.canDeductDoseUnit = function (unit) { return /^(片|ml|毫升)$/i.test(unit); };

  function validPortionChange(change) {
    var before = change.before;
    if (!before || !Number.isFinite(change.fraction) || change.fraction <= 0) return false;
    if (change.fraction <= 1 && (change.units <= 1 || change.fraction === 1)) return true;
    if (before.fraction <= 0 || change.fraction <= before.fraction || change.fraction > before.fraction + 1 + 1e-12) return false;
    return change.units === 1 || (change.units === 2 && Math.abs(change.fraction - before.fraction - 1) <= 1e-12);
  }

  Domain.planFeedingPortion = function (item, flavor, portion, options) {
    if (item.flavors && !flavor) return { error: '请先选择实际喂食的口味。' };
    if (item.quantity < 1 || (flavor && flavor.quantity < 1)) return { error: '当前库存不足，无法扣减。' };
    var unit = item.unit || '件';
    if (!Domain.isPackageUnit(unit) && unit !== '粒' && !(item.category === 'med' && Domain.canDeductDoseUnit(unit))) {
      return { error: '无法确认该商品的单件单位，请仅记录喂食或单独调整库存。' };
    }
    if (options && options.sealedOnly) {
      var units = portion.fraction;
      if (!Number.isSafeInteger(units) || units < 1) return { error: '部分份量需要先记录开封。' };
      var stock = flavor || item;
      var opened = flavor ? (Domain.hasSharedSeal(item) ? item.isOpened : Boolean(flavor.openedDate)) : item.isOpened;
      var available = Number(stock.quantity) - (opened ? 1 : 0);
      if (units > available) return { error: '未开封库存不足，无法扣减。' };
      return { used: units, after: 0, sealedUnits: units };
    }
    var stock = flavor || item;
    var remaining = stock.openRemainFraction || 1;
    var used = portion.finish ? remaining : portion.fraction;
    if (!Number.isFinite(used) || used <= 0) return { error: '无法换算份量，请输入如「1' + unit + '」或「半' + unit + '」。' };
    if ((item.category === 'treat' || item.category === 'med') && unit === '支' && remaining === 1 && Number.isSafeInteger(used) && used > 1) {
      if (used > Number(stock.quantity)) return { error: '所选口味或批次库存不足，请调整份量。' };
      return { used: used, after: 0, sealedUnits: used, consumeOpened: true };
    }
    if (used - remaining > 1e-12) {
      var isOpened = flavor ? (Domain.hasSharedSeal(item) ? item.isOpened : Boolean(flavor.openedDate)) : item.isOpened;
      if (!isOpened || !(stock.openRemainFraction > 0)) return { error: '本次份量超过单件容量，请调整份量。' };
      if (Number(stock.quantity) < 2) return { error: '没有足够的新' + unit + '可扣，请调整份量或补充库存。' };
      var nextUsed = used - remaining;
      if (nextUsed > 1 + 1e-12) return { error: '本次份量超过旧余量和一' + unit + '，请分次记录。' };
      var nextAfter = 1 - nextUsed;
      if (nextAfter <= 1e-12) nextAfter = 0;
      return { used: used, after: nextAfter, rollover: true, previous: remaining, nextUsed: nextUsed, units: nextAfter ? 1 : 2 };
    }
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
    if (plan.rollover) {
      units = Domain.recordConsumedUnits(item, plan.units, date, '记喂食（' + amount + '），用完旧' + item.unit + '并开启新' + item.unit);
      if (plan.after) {
        item.isOpened = true;
        item.openedDate = date;
        item.openRemainFraction = plan.after;
      }
      return { units: units, fraction: plan.used, before: before, revision: item.portionRevision };
    }
    if (plan.sealedUnits) {
      units = Domain.recordConsumedUnits(item, plan.sealedUnits, date, '记喂食（' + amount + '），核销 ' + plan.sealedUnits + item.unit);
      if (!plan.consumeOpened) {
        item.isOpened = before.opened;
        item.openedDate = before.openedDate;
        item.openRemainFraction = before.fraction;
      }
      return { units: units, fraction: 1, before: before, revision: item.portionRevision };
    }
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
      (before.opened || !before.fraction) && Number.isSafeInteger(change.units) && change.units >= 0 &&
      change.units === Number(log.deductedUnit) && validPortionChange(change) &&
      change.fraction === Number(log.deductedFrac));
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
        deltaText: before.fraction ? Utils.formatRemainFractionText(before.fraction, item.unit) : '恢复整' + item.unit
      });
    }
    item.isOpened = before.opened;
    item.openedDate = before.openedDate;
    item.openRemainFraction = before.fraction;
    item.portionRevision = before.revision;
    return true;
  }

  Domain.feedFlavor = function (item, flavor, fraction, finish, date, inventoryOnly, sealedOnly, preparedPlan) {
    if (!flavor) return null;
    var plan = preparedPlan || Domain.planFeedingPortion(item, flavor, { fraction: fraction, finish: finish }, { sealedOnly: sealedOnly });
    if (plan.error) return null;
    var used = plan.used;
    var after = plan.after;
    var before = {
      revision: flavor.revision, openedDate: flavor.openedDate,
      fraction: flavor.openRemainFraction, sharedOpenedDate: item.isOpened ? item.openedDate : ''
    };
    var shared = Domain.hasSharedSeal(item);
    if (plan.rollover) {
      flavor.revision = nextFlavorRevision();
      flavor.quantity -= plan.units;
      Domain.recordConsumedUnits(item, plan.units, date, '喂食并用完旧' + item.unit + '，开启新' + item.unit + ' · ' + flavor.name);
      flavor.openRemainFraction = plan.after;
      flavor.openedDate = plan.after ? date : '';
      if (shared && item.quantity > 0) {
        item.isOpened = true;
        item.openedDate = before.sharedOpenedDate;
      }
      return { revision: flavor.revision, before: before, units: plan.units, fraction: used };
    }
    if (plan.sealedUnits) {
      flavor.revision = nextFlavorRevision();
      flavor.quantity -= plan.sealedUnits;
      if (plan.consumeOpened) {
        flavor.openedDate = '';
        flavor.openRemainFraction = 0;
      }
      Domain.recordConsumedUnits(item, plan.sealedUnits, date, '喂食并核销 ' + plan.sealedUnits + item.unit + ' · ' + flavor.name);
      return { revision: flavor.revision, before: before, units: plan.sealedUnits, fraction: 1 };
    }
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
      if (flavor.quantity + change.units > flavor.perPack * item.purchasePackaging.count) return false;
      if (!Domain.revertConsumedFromLog(Object.assign({}, log, {
        flavorId: '', amount: log.amount + ' · ' + flavor.name, deductedUnit: change.units, deductedFrac: 0
      }))) return false;
      flavor.quantity += change.units;
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
      openRemaining = Utils.openShelfDaysRemaining(item.openedDate, item.openDaysLimit, refTodayStr);
    }

    if (item.flavors && !Domain.hasSharedSeal(item)) {
      item.flavors.forEach(function (flavor) {
        if (!flavor.openedDate || flavor.quantity <= 0) return;
        var days = Utils.openShelfDaysRemaining(flavor.openedDate, item.openDaysLimit, refTodayStr);
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

  Domain.stockExpiryEntries = function (item, refTodayStr) {
    var quantity = Number(item.quantity) || 0;
    if (quantity <= 0) return [];
    var shared = Domain.hasSharedSeal(item);
    var entries = [];
    function add(flavor, count, opened, openedDate) {
      if (!(count > 0)) return;
      var piece = Object.assign({}, item, {
        quantity: count, flavors: null, isOpened: opened, openedDate: openedDate || ''
      });
      entries.push({
        item: item, flavor: flavor, quantity: count, opened: opened,
        evaluation: Domain.evaluateItem(piece, refTodayStr)
      });
    }
    if (item.flavors && item.flavors.length) {
      var unknownOpening = !shared && item.isOpened && !item.flavors.some(function (flavor) {
        return flavor.quantity > 0 && flavor.openedDate;
      });
      item.flavors.forEach(function (flavor) {
        var count = Number(flavor.quantity) || 0;
        if (shared || unknownOpening) {
          add(flavor, count, item.isOpened, item.openedDate);
        } else if (flavor.openedDate && count > 0) {
          add(flavor, 1, true, flavor.openedDate);
          add(flavor, count - 1, false, '');
        } else {
          add(flavor, count, false, '');
        }
      });
    } else if (!shared && item.isOpened && (item.purchasePackaging || Domain.isPackageUnit(item.unit))) {
      add(null, Math.min(1, quantity), true, item.openedDate);
      add(null, quantity - 1, false, '');
    } else {
      add(null, quantity, Boolean(item.isOpened), item.openedDate);
    }
    return entries;
  };

  Domain.discardExpiredStock = function (item, flavorId, opened, amount, refTodayStr) {
    if (!item || !state.items.includes(item)) return { error: '库存批次已不存在，请刷新后重试。' };
    var shared = Domain.hasSharedSeal(item);
    var flavor = flavorId ? Domain.findFlavor(item, flavorId) : null;
    if (!shared && item.flavors && (!flavor || (item.isOpened && !item.flavors.some(function (entry) {
      return entry.quantity > 0 && entry.openedDate;
    })))) return { error: '无法确认开封口味，请先在库存中核对。' };
    var entries = Domain.stockExpiryEntries(item, refTodayStr);
    var entry = shared ? entries.find(function (row) { return row.evaluation.status === 'expired'; })
      : entries.find(function (row) { return row.flavor === flavor && row.opened === opened && row.evaluation.status === 'expired'; });
    if (!entry || (shared && entries.some(function (row) { return row.evaluation.status !== 'expired'; }))) {
      return { error: '库存或效期已变化，请刷新后重试。' };
    }
    var max = shared ? Number(item.quantity) : entry.quantity;
    var quantity = Number(amount);
    var wholeUnits = shared || flavor || (Number.isInteger(max) && (item.purchasePackaging || Domain.isPackageUnit(item.unit)));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > max || Utils.round2(quantity) !== quantity ||
        (wholeUnits && !Number.isInteger(quantity)) || ((shared || opened) && quantity !== max)) {
      return { error: '丢弃数量无效，请重新选择。' };
    }
    var previousOpen = { isOpened: item.isOpened, openedDate: item.openedDate, fraction: item.openRemainFraction };
    if (shared && item.flavors) {
      item.flavors.forEach(function (row) {
        row.quantity = 0;
        row.openedDate = '';
        row.openRemainFraction = 0;
        row.revision = nextFlavorRevision();
      });
    } else if (flavor) {
      flavor.quantity -= quantity;
      if (opened) {
        flavor.openedDate = '';
        flavor.openRemainFraction = 0;
      }
      flavor.revision = nextFlavorRevision();
    }
    var note = '过期丢弃' + (shared ? ' · 共用密封整盒' : flavor ? ' · 口味：' + flavor.name : '') +
      (opened ? ' · 已开封' : ' · 未开封');
    item.discardedCount = Utils.round2((Number(item.discardedCount) || 0) + quantity);
    Domain.recordConsumedUnits(item, quantity, refTodayStr || Utils.getTodayStr(), note, 'discard');
    if (!shared && !opened && item.quantity > 0 && previousOpen.isOpened) {
      item.isOpened = previousOpen.isOpened;
      item.openedDate = previousOpen.openedDate;
      item.openRemainFraction = previousOpen.fraction;
    }
    return { quantity: quantity };
  };

  Domain.summarizeStockDetailStatuses = function (items, refTodayStr) {
    var today = refTodayStr || Utils.getTodayStr();
    var totals = Object.create(null);
    items.forEach(function (item) {
      var packages = Domain.summarizeStockQuantity([item]).units;
      var unit = Object.keys(packages)[0];
      if (!unit) return;

      var count = packages[unit];
      var total = totals[unit] || (totals[unit] = { expiring: 0, expired: 0, unknown: 0, openingUnknown: false });
      var piece = { quantity: 1, expDate: item.expDate, openDaysLimit: item.openDaysLimit };
      var sealedStatus = Domain.evaluateItem(piece, today).status;
      var shared = Domain.hasSharedSeal(item);
      var opened = !shared && item.flavors
        ? item.flavors.filter(function (flavor) { return flavor.quantity > 0 && flavor.openedDate; })
        : (item.isOpened ? [item] : []);
      var openingUnknown = count.sealed < 0 ||
        (item.isOpened && !opened.length) ||
        (shared && !item.isOpened && Domain.isStockOpened(item));
      if (openingUnknown) {
        total.openingUnknown = true;
        total[sealedStatus === 'expired' ? 'expired' : 'unknown'] += count.sealed + count.opened;
        return;
      }

      if (sealedStatus === 'expiring' || sealedStatus === 'expired') {
        total[sealedStatus] += count.sealed;
      }
      piece.isOpened = true;
      for (var entry of opened) {
        piece.openedDate = entry.openedDate;
        var evaluated = Domain.evaluateItem(piece, today);
        if (evaluated.status === 'expired') total.expired += 1;
        else if (evaluated.openRemaining === null) total.unknown += 1;
        else if (evaluated.status === 'expiring') total.expiring += 1;
      }
    });
    return totals;
  };

  // ==================== PRODUCT GROUPING & FEEDING LOG HELPERS ====================
  function supplySpecGroup(value, unit) {
    var number = Number(value);
    if (!(number > 0)) return '';
    if (!Number.isFinite(number)) return String(number) + String(unit || '');
    var shift = unit === '千克' || unit === '升' ? 3 : 0;
    var baseUnit = unit === '千克' ? '克' : unit === '升' ? '毫升' : String(unit || '');
    // Shift the decimal exponent instead of multiplying, avoiding floating-point rounding in grouping keys.
    var parts = String(number).toLowerCase().split('e');
    var decimal = parts[0].split('.');
    var digits = (decimal[0] + (decimal[1] || '')).replace(/^0+/, '');
    var exponent = Number(parts[1] || 0) - (decimal[1] || '').length + shift;
    var trailing = digits.match(/0+$/);
    if (trailing) {
      digits = digits.slice(0, -trailing[0].length);
      exponent += trailing[0].length;
    }
    return digits + 'e' + exponent + baseUnit;
  }

  Domain.getProductGroupKey = function (it) {
    if (!it) return '';
    var c = String(it.category || 'dry').trim().toLowerCase();
    var b = String(it.brand || '').trim().toLowerCase();
    var n = String(it.name || '').trim().toLowerCase();
    var weight = Number(it.unit_net_weight_g);
    var u = String(it.unit || '件').trim().toLowerCase();
    var textSpec = String(it.spec || '').trim().toLowerCase();
    if (c === 'supplies') {
      var supplySpec = supplySpecGroup(it.unit_spec_value, it.unit_spec_unit) || supplySpecGroup(weight, '克');
      return JSON.stringify([c, b, n, supplySpec, u, textSpec]);
    }
    var s = weight > 0 ? weight + 'g' : Number(it.unit_spec_value) > 0 && it.unit_spec_unit === '毫升'
      ? Number(it.unit_spec_value) + 'ml' : textSpec;
    return c + '||' + b + '||' + n + '||' + s + '||' + u;
  };

  Domain.getSampleItemIds = function (items) {
    var sampleIds = new Set((items || []).filter(function (item) { return item.isSample; }).map(function (item) { return item.id; }));
    (items || []).forEach(function (item) {
      if (item.sourceBatchId && Number(item.quantity) <= 0 && sampleIds.has(item.sourceBatchId)) sampleIds.add(item.id);
    });
    return sampleIds;
  };

  Domain.getSupplyUsageEstimates = function (items, stockHistory) {
    var supplies = (items || []).filter(function (item) { return item.category === 'supplies'; });
    var itemKeys = new Map(supplies.map(function (item) { return [item.id, Domain.getProductGroupKey(item)]; }));
    var sampleIds = Domain.getSampleItemIds(items);
    var groups = new Map();
    supplies.filter(function (item) { return Number(item.quantity) > 0; }).forEach(function (item) {
      var key = Domain.getProductGroupKey(item);
      var group = groups.get(key) || {
        key: key, item: item, quantity: 0, unit: item.unit || '件', dates: [], arrivalDatesByItem: new Map(),
        usageDurations: [], openedCount: 0, currentOpenDate: '', usedCount: 0, discardedCount: 0, missingOpenDate: false, sampleCount: 0
      };
      if (sampleIds.has(item.id)) {
        group.sampleCount += 1;
      } else {
        if (!group.quantity) group.item = item;
        group.quantity = Utils.round2(group.quantity + (Number(item.quantity) || 0));
        group.usedCount = Utils.round2(group.usedCount + (Number(item.eatenCount) || 0));
        group.discardedCount = Utils.round2(group.discardedCount + (Number(item.discardedCount) || 0));
        if (item.isOpened) {
          group.openedCount += 1;
          if (!item.openedDate) group.missingOpenDate = true;
          else if (!group.currentOpenDate || item.openedDate < group.currentOpenDate) group.currentOpenDate = item.openedDate;
          group.item = item;
        }
      }
      groups.set(key, group);
    });
    var eventsByItem = new Map();
    (stockHistory || []).forEach(function (entry, index) {
      if (entry.category !== 'supplies' || !['create', 'restock', 'open', 'unopen', 'adjust', 'discard', 'consume', 'revert'].includes(entry.action)) return;
      var key = itemKeys.get(entry.itemId);
      if (!key || !groups.has(key)) return;
      var date = Utils.normalizeDateStr(entry.date);
      if (!date) return;
      if (['create', 'restock'].includes(entry.action)) {
        var group = groups.get(key);
        group.dates.push(date);
        var previous = group.arrivalDatesByItem.get(entry.itemId) || '';
        if (date > previous) group.arrivalDatesByItem.set(entry.itemId, date);
      }
      if (entry.isSample || sampleIds.has(entry.itemId)) return;
      var events = eventsByItem.get(entry.itemId) || [];
      events.push({ entry: entry, date: date, timestamp: entry.timestamp || date, index: index });
      eventsByItem.set(entry.itemId, events);
    });
    eventsByItem.forEach(function (events, itemId) {
      var key = itemKeys.get(itemId);
      var group = groups.get(key);
      var openDate = '';
      var samples = [];
      events.sort(function (a, b) { return a.timestamp.localeCompare(b.timestamp) || b.index - a.index; });
      events.forEach(function (event) {
        var entry = event.entry;
        var note = String(entry.note || '');
        var match = !entry.supplyEvent && note.match(/(?:→ 已开封 |入库时已开封 )(\d{4}-\d{2}-\d{2})/);
        var recordedOpening = Utils.normalizeDateStr(entry.openingDate) || (match && Utils.normalizeDateStr(match[1])) || '';
        if (entry.action === 'create' || entry.action === 'restock') {
          openDate = recordedOpening;
        } else if (entry.action === 'open') {
          openDate = recordedOpening || (entry.supplyEvent === 'opening_changed' || entry.deltaText === '开封状态变更' ? '' : event.date);
        } else if (entry.action === 'unopen') {
          openDate = '';
        } else if (entry.action === 'adjust') {
          if (entry.supplyEvent === 'opening_changed' || (!entry.supplyEvent && entry.deltaText === '开封状态变更')) openDate = recordedOpening;
          else if (entry.supplyEvent === 'history_dates_changed' || (!entry.supplyEvent && entry.deltaText === '历史批次日期变更')) samples = [];
          else if (Number(entry.beforeQty) !== Number(entry.afterQty)) openDate = '';
        } else if (entry.action === 'discard') {
          if (note.includes(' · 已开封')) openDate = '';
        } else if (entry.action === 'consume') {
          var used = Utils.round2(Number(entry.beforeQty) - Number(entry.afterQty));
          var days = openDate && Utils.diffDaysBetween(openDate, event.date);
          if (openDate && used === 1 && days !== null && days >= 0) {
            samples.push({ id: entry.id, days: days });
          }
          openDate = '';
        } else if (entry.action === 'revert') {
          var revertedIndex = entry.revertsHistoryId
            ? samples.findIndex(function (sample) { return sample.id === entry.revertsHistoryId; })
            : samples.length - 1;
          if (revertedIndex >= 0) samples.splice(revertedIndex, 1);
          openDate = '';
        }
      });
      samples.forEach(function (sample) { group.usageDurations.push(sample.days); });
    });
    return Array.from(groups.values(), function (group) {
      group.dates.sort();
      group.latestArrivalDate = group.dates.at(-1) || '';
      group.averageCycleDays = group.usageDurations.length
        ? group.usageDurations.reduce(function (sum, days) { return sum + days; }, 0) / group.usageDurations.length
        : null;
      var usedDays = group.currentOpenDate ? Math.max(0, Utils.diffDaysBetween(group.currentOpenDate, Utils.getTodayStr())) : 0;
      group.currentUsedDays = usedDays;
      var unopened = Math.max(0, group.quantity - group.openedCount);
      group.remainingDays = !group.quantity || group.averageCycleDays === null || group.openedCount > 1 || group.missingOpenDate || group.quantity < group.openedCount ? null : Math.max(0, Math.round(
        (group.openedCount ? Math.max(group.averageCycleDays - usedDays, 0) : 0) + unopened * group.averageCycleDays
      ));
      return group;
    });
  };

  Domain.getSupplyBatchEstimate = function (item, group) {
    var opened = Boolean(item.isOpened);
    var quantity = Number(item.quantity) || 0;
    var usedDays = opened && item.openedDate ? Math.max(0, Utils.diffDaysBetween(item.openedDate, Utils.getTodayStr())) : 0;
    var average = group && !item.isSample ? group.averageCycleDays : null;
    var remaining = average === null || (opened && (!item.openedDate || quantity < 1)) ? null : Math.max(0, Math.round(
      (opened ? Math.max(average - usedDays, 0) : 0) + Math.max(0, quantity - Number(opened)) * average
    ));
    return {
      item: item, quantity: quantity, unit: item.unit || '件', openedCount: Number(opened),
      usedCount: Number(item.eatenCount) || 0, discardedCount: Number(item.discardedCount) || 0, currentUsedDays: usedDays,
      averageCycleDays: average, remainingDays: remaining,
      latestArrivalDate: group ? group.arrivalDatesByItem.get(item.id) || '' : ''
    };
  };

  Domain.groupEmptyItemsByProduct = function (emptyItems) {
    var map = {};
    var groups = [];
    emptyItems.forEach(function (it) {
      var key = Domain.getProductGroupKey(it);
      var batchUsed = it.manualFeedArchive === true ? 0 : Number(it.consumedCount) || Number(it.lastQuantity) || 1;
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
      if ((!MP.getItemImages(curRep).length && MP.getItemImages(it).length) || String(it.finishedDate || it.prodDate || '') > String(curRep.finishedDate || curRep.prodDate || '')) {
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
    var product = Domain.resolveLogProduct(entry, true);
    var linkedItem = state.items.find(function (item) { return item.id === entry.itemId; });
    var record = Domain.sanitizeLog({
      id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      date: entry.date || Utils.getTodayStr(),
      mealSlot: entry.mealSlot || Utils.getCurrentMealSlot(),
      itemId: entry.itemId || '',
      unstocked: entry.unstocked,
      category: entry.category || 'dry',
      subtype: entry.subtype || undefined,
      brand: entry.brand || '',
      name: entry.name || '',
      productSpec: entry.productSpec || product.spec || undefined,
      productUnitWeightGrams: entry.productUnitWeightGrams || product.unit_net_weight_g || undefined,
      productUnit: product.unit || undefined,
      productFeedUsageUnit: product.feedUsageUnit || undefined,
      productFeedUsagePerItem: product.feedUsagePerItem || undefined,
      amount: entry.amount,
      careType: entry.careType,
      careProjects: entry.careProjects,
      careOther: entry.careOther,
      note: entry.note || '',
      nextDueDate: entry.nextDueDate || '',
      reminderDays: entry.reminderDays || 0,
      reminderDone: false,
      deductedUnit: Number(entry.deductedUnit) || 0,
      deductedFrac: Number(entry.deductedFrac) || 0,
      flavorId: entry.flavorId || undefined,
      flavorName: entry.flavorName || undefined,
      flavorPalatability: entry.flavorPalatability || undefined,
      medicationOutcome: Domain.normalizeMedicationOutcome(entry.medicationOutcome),
      flavorChange: entry.flavorChange || undefined,
      portionChange: entry.portionChange || undefined,
      consumeHistoryId: entry.consumeHistoryId || undefined,
      isSample: Boolean(entry.isSample || (linkedItem && linkedItem.isSample))
    });
    state.logs.unshift(record);
    return record;
  };

  // Smart Quick-Feed helper: find the user's last fed portion & date for an item
  Domain.normalizeMedicationOutcome = function (value) {
    return ['smooth', 'coaxed', 'resisted', 'vomited'].includes(value) ? value : undefined;
  };

  Domain.getLastFedInfoForItem = function (item, acceptsLog) {
    if (!item || !state.logs.length) return null;
    var bNorm = String(item.brand || '').trim().toLowerCase();
    var nNorm = String(item.name || '').trim().toLowerCase();
    var best = null;
    for (var i = 0; i < state.logs.length; i++) {
      var lg = state.logs[i];
      if (acceptsLog && !acceptsLog(lg)) continue;
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
        unit_net_weight_g: 170,
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
        mealSlot: 'breakfast',
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
        mealSlot: 'dinner',
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
        mealSlot: 'breakfast',
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
        mealSlot: 'snack',
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
