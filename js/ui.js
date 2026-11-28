/* Meow Pantry UI Renderer: Pantry Cards, Quick-Feed Bar, Daily Log, Modals & Stock Operation History Drawer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats;
  var UI = MP.UI = MP.UI || {};

  var toastTimer = null;

  UI.showToast = function (msg, icon, placement, action) {
    var el = document.getElementById('toastEl');
    if (!el) return;
    el.innerHTML = Utils.iconLabel(icon, msg);
    el.classList.toggle('toast-box--action', Boolean(action));
    if (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', function () {
        button.disabled = true;
        el.classList.add('hidden-view');
        clearTimeout(toastTimer);
        action.onClick();
      }, { once: true });
      el.appendChild(button);
    }
    el.classList.toggle('toast-box--bottom', placement === 'bottom');
    el.classList.remove('hidden-view');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden-view');
    }, action ? 5000 : 2300);
  };

  UI.purchasePackagingLabel = function (pack, unit) {
    return Utils.formatQuantity(pack.count, pack.outerUnit) + '装，' + (pack.outerUnit === unit ? '内包装' : '') +
      '共' + Utils.formatQuantity(pack.count * pack.size, unit);
  };

  UI.flavorStockText = function (item, plain, remainingView) {
    if (!item.flavors) return '';
    return item.flavors.map(function (flavor) {
      var text = flavor.name + ' ' + Utils.formatQuantity(flavor.quantity, remainingView ? '' : item.unit);
      if (Number(flavor.quantity) > 0 && flavor.openedDate) {
        var rest = flavor.openRemainFraction;
        var spec = Utils.parsePortionSpec(Utils.itemPortionSpec(item));
        var left = '';
        if (rest) {
          left = spec && Number(spec[1]) > 0 && (!spec[3] || spec[3] === item.unit)
            ? '，约余' + Utils.formatQuantity(Number(spec[1]) * rest, spec[2])
            : '，余' + Utils.formatPercent(rest * 100);
        }
        text += '（1' + item.unit + '使用中' + left + '）';
      }
      if (plain) return text;
      var escaped = Utils.escapeHtml(text);
      if (remainingView && Number(flavor.quantity) <= 0) {
        escaped = '<s class="flavor-stock-finished" aria-label="' + Utils.escapeHtml(flavor.name + ' 已吃完') + '">' + escaped + '</s>';
      }
      if (!remainingView) return escaped;
      var badge = MP.getPalatabilityBadgeInfo({ category: item.category, palatability: flavor.palatability });
      var rating = badge
        ? '<span class="flavor-stock-rating" role="img" aria-label="' + Utils.escapeHtml(badge.label) +
          '" title="' + Utils.escapeHtml(badge.label) + '">' +
          '<span aria-hidden="true">' + Utils.escapeHtml(badge.emoji || MP.getPalatabilityEmoji(badge.key)) + '</span></span>'
        : '';
      return '<span class="flavor-stock-entry">' + rating + '<span class="flavor-stock-name">' + escaped + '</span>' +
        (badge ? '' : '<span class="flavor-stock-unrated">未测</span>') + '</span>';
    }).join(remainingView && !plain ? '' : ' · ');
  };

  UI.syncAllDateDisplays = function () {
    var ids = ['fieldProdDate', 'fieldExpDate', 'fieldOpenedDate', 'fieldFinishedDate', 'feedDateInput'];
    for (var i = 0; i < ids.length; i++) {
      var inp = document.getElementById(ids[i]);
      var txt = document.getElementById(ids[i] + 'Text');
      if (inp && txt) {
        txt.textContent = inp.value || '选择日期';
        txt.classList.toggle('is-placeholder', !inp.value);
      }
    }
  };

  UI.syncStaticBrandIcons = function () {
    var covers = MP.COVERS || {};
    if (covers.appIcon) {
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
    if (tabName === 'daily') UI.syncDailyQuickFeedFade();
    if (tabName === 'stats') {
      Stats.syncCareExpandability();
      Stats.syncFeedingRankExpandability();
    }
    window.scrollTo(0, 0);
  };

  UI.renderAll = function (options) {
    UI.renderSampleBanner();
    UI.renderHeaderProfile();
    UI.renderStatusCounts();
    UI.renderCategoryPills(options && options.resetMissingCategory);
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

  UI.renderHeaderProfile = function () {
    var settings = MP.state.settings;
    document.getElementById('headerProfileName').textContent = settings.profileName || '喵喵粮仓';
    document.getElementById('headerMascotImg').src = settings.profileAvatar || MP.COVERS?.appIcon || './icon-192.png';
  };

  // ==================== DAILY FEEDING LOG & 1-TAP QUICK FEED BAR ====================
  function feedStockMode() {
    if (document.getElementById('feedMealSlot').value !== 'care') return 'food';
    return document.getElementById('feedForm').dataset.careType || 'medication';
  }

  function isFeedStockMatch(item, mode) {
    var group = MP.getCategoryGroup(item.category);
    return mode === 'food' ? group === 'food' : mode === 'medication' ? group === 'med' : mode === 'supplement' && group === 'supp';
  }

  function clearFeedBatchFields(mode) {
    UI.applyFeedStockSelection('');
    document.getElementById('feedCategorySelect').value = mode === 'supplement' ? 'supp' : mode === 'medication' ? 'med' : 'dry';
    ['feedBrandInput', 'feedNameInput', 'feedAmountInput'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
  }

  var manualFeedDrafts = Object.create(null);
  var careAmountErrors = Object.create(null);
  var manualFeedFields = ['feedCategorySelect', 'feedBrandInput', 'feedNameInput', 'feedAmountInput', 'feedFlavorPal', 'feedManualFlavor'];

  function syncFeedBatchDisplay(item) {
    var form = document.getElementById('feedForm');
    var locked = form.dataset.productEntry === 'true' && item;
    var linked = Boolean(document.getElementById('feedItemId').value);
    var manual = !linked && form.dataset.manualProduct === 'true';
    var card = document.getElementById('feedProductCard');
    var esc = Utils.escapeHtml;
    var name = item ? [item.brand, item.name].filter(Boolean).join(' ') : '原记录批次';
    var category = item && MP.CATEGORIES[item.category]?.label || '';
    document.getElementById('feedStockField').classList.toggle('hidden-view', Boolean(locked) || manual);
    card.classList.toggle('hidden-view', !locked);
    form.querySelectorAll('[data-feed-manual]').forEach(function (field) {
      field.classList.toggle('hidden-view', !manual);
    });
    if (locked) {
      var cover = MP.getItemCoverSrc(item);
      var care = form.classList.contains('feed-care-mode');
      var label = care ? (form.dataset.careType === 'supplement' ? '营养品' : '药品') : '喂食商品';
      card.innerHTML = '<span class="feed-meal-label">' + label + '</span><div class="feed-locked-product">' +
        (cover ? '<img src="' + esc(cover) + '" alt="">' : Utils.getCategoryIcon(item.category)) +
        '<div class="feed-locked-copy"><strong title="' + esc(name) + '">' + esc(name) + '</strong><small>' +
        esc(category + ' · 余' + Utils.formatQuantity(item.quantity, item.unit)) + '</small></div>' +
        (care ? '<span class="feed-product-selected">已选定</span>' : Utils.uiIcon('lock', 16)) + '</div>';
    }

  }

  UI.populateFeedStockDropdown = function (selectedItemId) {
    var select = document.getElementById('feedStockSelect');
    var mode = feedStockMode();
    var items = MP.state.items;
    var batches = items.filter(function (item) {
      return item.quantity > 0 && isFeedStockMatch(item, mode) &&
        (!item.sourceBatchId || !items.some(function (batch) { return batch.id === item.sourceBatchId; }));
    });
    var requested = items.find(function (item) { return item.id === selectedItemId; });
    var sections = [{ label: '', group: mode === 'medication' ? 'med' : mode === 'supplement' ? 'supp' : 'food' }];
    var prompt = batches.length ? '请选择在库商品' : '暂无在库商品';
    var safe = Utils.escapeHtml;
    var options = '<option value="">记录未入库商品</option>' +
      (mode === 'food' ? '<option value="__unstocked__">记录自制 / 无品牌食物</option>' : '');
    var choices = '';
    function thumbnail(item) {
      var cover = MP.getItemCoverSrc(item);
      return '<span class="feed-batch-thumb" aria-hidden="true">' +
        (cover ? '<img src="' + safe(cover) + '" alt="">' : '') +
        '<span' + (cover ? ' hidden' : '') + '>' + Utils.getCategoryIcon(item.category, 20) + '</span></span>';
    }
    function displayName(item) { return [item.brand, item.name].filter(Boolean).join(' '); }
    function balanceLabel(item) {
      return item.quantity > 0 ? '余' + Utils.formatQuantity(item.quantity, item.unit) : '已核销';
    }
    function states(item) {
      if (item.quantity <= 0) return [];
      var opened = Domain.isStockOpened(item);
      var badges = [{ label: opened ? '已开封' : '未开封', tone: opened ? 'opened' : 'neutral' }];
      var status = Domain.evaluateItem(item).status;
      if (status === 'expired') badges.push({ label: '已过期', tone: 'danger' });
      else if (status === 'expiring') badges.push({ label: '临期', tone: 'warning' });
      return badges;
    }
    function balanceSummary(item) {
      return [MP.CATEGORIES[item.category]?.label, balanceLabel(item)].filter(Boolean).join(' · ');
    }
    function summary(item) {
      return [balanceSummary(item)].concat(states(item).map(function (badge) { return badge.label; })).join(' · ');
    }
    function copy(item) {
      return '<span class="feed-batch-copy"><strong>' + safe(displayName(item)) + '</strong>' +
        '<span class="feed-batch-meta"><span class="feed-batch-balance">' + safe(balanceSummary(item)) + '</span>' +
        states(item).map(function (badge) {
          return '<span class="feed-batch-status feed-batch-status--' + badge.tone + '">' + badge.label + '</span>';
        }).join('') + '</span></span>';
    }
    function batchDetail(item) {
      return [Utils.formatItemSpec(item), item.batchCode,
        item.expDate ? '到期日期 ' + Utils.formatListDate(item.expDate) : '',
        item.location].filter(Boolean).join(' · ');
    }
    function label(item) { return [displayName(item), summary(item), batchDetail(item)].filter(Boolean).join(' · '); }
    sections.forEach(function (section) {
      var group = batches.filter(function (item) {
        return MP.getCategoryGroup(item.category) === section.group;
      });
      if (!group.length) return;
      var optionRows = '';
      choices += '<div data-feed-stock-section>' +
        (section.label ? '<div class="feed-stock-group-label">' + safe(section.label) + '</div>' : '');
      group.forEach(function (item) {
        var id = safe(item.id);
        var text = safe(label(item));
        optionRows += '<option value="' + id + '">' + text + '</option>';
        var search = [label(item), item.spec].concat((item.flavors || []).map(function (flavor) { return flavor.name; })).join(' ');
        choices += '<button type="button" data-feed-stock-id="' + id + '" data-feed-stock-search="' + safe(search.toLowerCase()) + '"' +
          ' title="' + text + '">' + thumbnail(item) + copy(item) +
          '<span class="feed-stock-check" aria-hidden="true">✓</span></button>';
      });
      choices += '</div>';
      options += section.label ? '<optgroup label="' + safe(section.label) + '">' + optionRows + '</optgroup>' : optionRows;
    });
    // Keep an existing record's batch reference without offering archived batches as choices.
    if (selectedItemId && (requested || select.disabled) && !batches.some(function (item) { return item.id === selectedItemId; })) {
      options += '<option hidden value="' + safe(selectedItemId) + '">' + safe(requested ? label(requested) : '原记录批次') + '</option>';
    }
    select.innerHTML = options;
    select.value = selectedItemId || '';
    if (select.selectedIndex < 0) select.value = '';
    var current = items.find(function (item) { return item.id === select.value; });
    var picker = document.getElementById('feedStockPicker');
    if (select.disabled) picker.open = false;
    var trigger = document.getElementById('feedStockPickerTrigger');
    trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.tabIndex = select.disabled ? -1 : 0;
    var selection = document.getElementById('feedStockSelection');
    trigger.classList.toggle('has-stock-selection', Boolean(current));
    if (current) {
      selection.innerHTML = thumbnail(current) + copy(current);
    } else {
      selection.textContent = selectedItemId && select.disabled ? '原记录批次' : prompt;
    }
    selection.title = current ? label(current) : selection.textContent;
    var list = document.getElementById('feedStockChoices');
    document.getElementById('feedStockResults').innerHTML = choices;
    var manualLabel = mode === 'medication' ? '记录未入库药品' : mode === 'supplement' ? '记录未入库营养品' : '记录未入库商品';
    document.getElementById('feedStockManualChoices').innerHTML =
      '<button type="button" class="feed-stock-manual-option" data-feed-stock-id=""><span aria-hidden="true">＋</span>' +
        '<span><strong>' + manualLabel + '</strong><small>' + (mode === 'food' ? '填写品牌、品名 · 不扣库存' : '填写名称、用量 · 不扣库存') + '</small></span></button>' +
      (mode === 'food' ? '<button type="button" class="feed-stock-manual-option" data-feed-stock-id="__unstocked__"><span aria-hidden="true">＋</span>' +
        '<span><strong>记录自制 / 无品牌食物</strong><small>只填食物名 · 不扣库存</small></span></button>' : '');
    list.querySelectorAll('button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.feedStockId === select.value));
    });
    UI.filterFeedStockChoices();
    picker.querySelectorAll('.feed-batch-thumb img').forEach(function (image) {
      function showFallback() {
        image.nextElementSibling.hidden = false;
        image.remove();
      }
      image.addEventListener('error', showFallback, { once: true });
      if (image.complete && !image.naturalWidth) showFallback();
    });
  };

  UI.filterFeedStockChoices = function () {
    var query = document.getElementById('feedStockSearch').value.trim().toLowerCase();
    var list = document.getElementById('feedStockResults');
    var count = 0;
    list.querySelectorAll('[data-feed-stock-search]').forEach(function (button) {
      button.hidden = !button.dataset.feedStockSearch.includes(query);
      if (!button.hidden) count++;
    });
    list.querySelectorAll('[data-feed-stock-section]').forEach(function (section) {
      section.hidden = !section.querySelector('[data-feed-stock-search]:not([hidden])');
    });
    document.getElementById('feedStockSearchStatus').textContent = count
      ? count + ' 个在库批次'
      : query ? '暂无匹配的在库批次' : '暂无在库批次';
  };

  UI.returnToFeedStock = function () {
    var form = document.getElementById('feedForm');
    form.dataset.manualProduct = 'false';
    delete form.dataset.unstocked;
    manualFeedDrafts = Object.create(null);
    clearFeedBatchFields(feedStockMode());
    ['feedManualFlavor', 'feedFlavorPal'].forEach(function (id) { document.getElementById(id).value = ''; });
    delete document.getElementById('feedFlavorPal').dataset.manual;
    UI.syncMedReminderVisibility();
    document.getElementById('feedStockPicker').open = true;
    document.getElementById('feedStockPickerTrigger').focus();
  };

  UI.applyFeedBatchChange = function (itemId) {
    var mode = feedStockMode();
    var previous = document.getElementById('feedItemId').value;
    var item = MP.state.items.find(function (batch) { return batch.id === itemId && isFeedStockMatch(batch, mode); });
    var form = document.getElementById('feedForm');
    var wasManual = form.dataset.manualProduct === 'true';
    var unstocked = mode === 'food' && itemId === '__unstocked__';
    form.dataset.manualProduct = String(!item);
    if (!previous && item && wasManual) {
      manualFeedDrafts[mode] = manualFeedFields.map(function (id) { return document.getElementById(id).value; });
      manualFeedDrafts[mode].manualRating = Boolean(document.getElementById('feedFlavorPal').dataset.manual);
    }
    if (unstocked) {
      clearFeedBatchFields(mode);
      document.getElementById('feedCategorySelect').value = 'can';
      document.getElementById('feedDeductStock').checked = false;
    } else if (!item && previous) {
      document.getElementById('feedDeductStock').checked = false;
      clearFeedBatchFields(mode);
      var draft = manualFeedDrafts[mode];
      if (draft) {
        manualFeedFields.forEach(function (id, index) { document.getElementById(id).value = draft[index]; });
        var rating = document.getElementById('feedFlavorPal');
        if (draft.manualRating) rating.dataset.manual = '1';
        else delete rating.dataset.manual;
      }
    } else UI.applyFeedStockSelection(item?.id || '');
    form.dataset.unstocked = String(unstocked);
    if (item && item.id !== previous && (mode === 'medication' || mode === 'supplement') && !document.getElementById('feedLogEditId').value) {
      document.getElementById('feedDeductStock').checked = true;
    }
    UI.syncMedReminderVisibility();
    if (mode === 'food') UI.syncFeedSplitCanUI(item, true);
  };

  UI.syncMedReminderVisibility = function () {
    var slot = document.getElementById('feedMealSlot').value;
    var mode = feedStockMode();
    var stock = document.getElementById('feedStockSelect');
    var linkedId = document.getElementById('feedItemId').value;
    var linked = MP.state.items.find(function (item) { return item.id === linkedId; });
    if (!stock.disabled && linkedId && (!linked || !isFeedStockMatch(linked, mode))) {
      clearFeedBatchFields(mode);
      linkedId = '';
    }
    UI.populateFeedStockDropdown(linkedId);
    var cat = document.getElementById('feedCategorySelect').value;
    var meal = Utils.mealSlotOptions().find(function (option) { return option.id === slot; });
    document.getElementById('feedMealSelection').innerHTML =
      Utils.iconLabel(meal?.icon, slot === 'care' ? (mode === 'supplement' ? '营养品' : mode === 'nursing' ? '护理' : '用药') :
        meal?.label || (slot === 'other' ? '原餐次' : slot));
    document.querySelectorAll('#feedMealChoices [data-meal-slot]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.mealSlot === slot));
    });
    var box = document.getElementById('medNextReminderBox');
    var fromReminder = document.getElementById('feedForm').dataset.reminderSourceId;
    var editId = document.getElementById('feedLogEditId').value;
    var editingReminder = editId && MP.state.logs.some(function (log) {
      return log.id === editId && log.category === cat && log.nextDueDate;
    });
    box.classList.toggle('hidden-view', mode === 'supplement' ||
      !(cat === 'med' || slot === 'care' || (cat === 'supp' && (fromReminder || editingReminder))));
    syncCareForm(slot === 'care', Boolean(editId));
    UI.syncNursingOther();
    UI.syncNursingProjects();
    UI.syncFeedReminderInterval();
  };

  UI.syncFeedReminderInterval = function () {
    var form = document.getElementById('feedForm');
    var select = document.getElementById('feedNextReminderDays');
    var care = form.classList.contains('feed-care-mode');
    var nursing = form.classList.contains('feed-nursing-mode');
    var custom = care && form.dataset.careType !== 'supplement' && select.value === 'custom';
    var input = document.getElementById('feedCustomReminderDays');
    input.disabled = !custom;
    document.getElementById('feedCustomReminderDateField').classList.toggle('hidden-view', !custom);
    var date = document.getElementById('feedDateInput').value;
    var days = Number(custom ? input.value : select.value);
    var due = date && days > 0 ? Utils.addShelfLife(date, days, 'days') : '';
    var dateInput = document.getElementById('feedCustomReminderDate');
    dateInput.disabled = !custom;
    dateInput.required = custom;
    dateInput.value = custom ? due : '';
    dateInput.min = date ? Utils.addShelfLife(date, 1, 'days') : '';
    dateInput.max = date ? Utils.addShelfLife(date, 3650, 'days') : '';
    var preview = document.getElementById('feedReminderPreview');
    preview.textContent = care && due ? '将在 ' + due + ' 提醒你再次' + (nursing ? '护理' : '用药') : '';
    preview.classList.toggle('hidden-view', !preview.textContent);
    if (care) renderCareReminders(select.value, nursing, Number(form.dataset.nursingSuggestion));
  };

  function careChipContent(label) {
    var text = Utils.escapeHtml(label);
    return '<span class="care-chip-copy" data-label="' + text + '"><span>' + text + '</span></span>';
  }

  function renderCareReminders(selected, nursing, suggestion) {
    var choices = document.getElementById(nursing ? 'feedNursingReminderChoices' : 'feedMedicationReminderChoices');
    var options = nursing
      ? [['0', '不设'], ['7', '1周后'], ['14', '2周后'], ['30', '1个月后'], ['custom', '自定义']]
      : [['0', '不设'], ['30', '1个月后'], ['60', '2个月后'], ['90', '3个月后'], ['custom', '自定义']];
    [Number(selected), nursing ? suggestion : 0].forEach(function (days) {
      if (days > 0 && !options.some(function (option) { return option[0] === String(days); })) {
        options.splice(1, 0, [String(days), days + '天后']);
      }
    });
    var signature = JSON.stringify([options, suggestion]);
    var suggestionHint = document.getElementById('feedNursingSuggestion');
    var recommended = options.find(function (option) { return Number(option[0]) === suggestion && suggestion > 0; });
    suggestionHint.textContent = nursing && recommended ? '建议：' + recommended[1] + '（多项护理按最短间隔）' : '';
    suggestionHint.classList.toggle('hidden-view', !nursing || !recommended);
    if (choices.dataset.rendered !== signature) {
      choices.dataset.rendered = signature;
      choices.innerHTML = options.map(function (option) {
        return '<button type="button" class="care-chip" data-' + (nursing ? 'nursing' : 'medication') + '-reminder="' + option[0] + '">' +
          careChipContent(option[1]) + '</button>';
      }).join('');
    }
    Array.from(choices.children).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset[nursing ? 'nursingReminder' : 'medicationReminder'] === selected));
    });
  }

  UI.syncNursingProjects = function (applySuggestion) {
    var form = document.getElementById('feedForm');
    if (!form.classList.contains('feed-nursing-mode')) return;
    var selected = Array.from(form.querySelectorAll('[data-nursing-project]:checked'), function (input) { return input.value; });
    var periods = selected.map(function (name) { return MP.NURSING_REMINDER_DAYS[name]; }).filter(function (days) { return days > 0; });
    var suggestion = periods.length ? Math.min(...periods) : 0;
    form.dataset.nursingSuggestion = String(suggestion);
    if (applySuggestion && !form.dataset.nursingReminderManual) setFeedReminderDays(suggestion);
    var select = document.getElementById('feedNextReminderDays');
    if (suggestion && !Array.from(select.options).some(function (option) { return Number(option.value) === suggestion; })) {
      var option = new Option(suggestion + '天后', suggestion);
      option.dataset.legacyInterval = '1';
      option.hidden = true;
      select.add(option);
    }

    var hint = document.getElementById('feedNursingHint');
    var today = Utils.getTodayStr();
    var other = document.getElementById('feedNursingOther').value.trim();
    var past = MP.state.logs.filter(function (log) { return log.date <= today && Domain.getCareType(log) === 'nursing'; });
    var summary = selected.slice(0, 3).map(function (project) {
      var dates = past.filter(function (log) {
        if (project !== '其他') return log.careProjects?.includes(project);
        return other ? log.careProjects?.includes(other) || log.careOther === other : Boolean(log.careOther);
      }).map(function (log) { return log.date; }).sort();
      var days = Utils.diffDaysBetween(dates.at(-1), today);
      return (other && project === '其他' ? other : project) + ' ' +
        (days === null ? '还没有记录过' : days === 0 ? '今天已记录' : days + ' 天前');
    });
    hint.textContent = summary.length ? '上次' + summary.join(' · ') + (selected.length > 3 ? ' · 等 ' + selected.length + ' 项' : '') : '';
    hint.classList.toggle('hidden-view', !summary.length);
  };

  UI.renderNursingProjectChoices = function () {
    var box = document.querySelector('.feed-nursing-options');
    box.innerHTML = Object.keys(MP.NURSING_PROJECTS).map(function (project) {
      return '<label class="care-chip"><input type="checkbox" value="' + Utils.escapeHtml(project) +
        '" data-nursing-project><span class="care-chip-copy" data-label="' + Utils.escapeHtml(project) + '">' +
        Utils.uiIcon(MP.getNursingProjectIcon(project), 16) + '<span>' + Utils.escapeHtml(project) + '</span></span></label>';
    }).join('');
  };

  UI.syncFeedNote = function () {
    var form = document.getElementById('feedForm');
    var collapsed = !form.dataset.feedNoteOpen && !document.getElementById('feedNoteInput').value;
    document.getElementById('feedAddNursingNote').classList.toggle('hidden-view', !collapsed);
    document.getElementById('feedAddNursingNote').setAttribute('aria-expanded', String(!collapsed));
    document.getElementById('feedNoteField').classList.toggle('hidden-view', collapsed);
  };

  UI.syncFeedPalatabilityChoices = function () {
    var select = document.getElementById('feedFlavorPal');
    var choices = document.getElementById('feedPalatabilityChoices');
    var options = Array.from(select.options).filter(function (option) { return option.value; });
    var signature = JSON.stringify(options.map(function (option) { return [option.value, option.textContent]; }));
    if (choices.dataset.rendered !== signature) {
      choices.dataset.rendered = signature;
      choices.innerHTML = options.map(function (option) {
        var emoji = MP.getPalatabilityEmoji(option.value);
        var label = option.textContent.replace(emoji, '').trim();
        return '<button type="button" class="care-chip" data-feed-palatability="' + Utils.escapeHtml(option.value) + '">' +
          '<span class="care-chip-copy feed-rating-copy">' + Utils.getPalatabilityIcon(option.value) +
          '<span>' + Utils.escapeHtml(label) + '</span></span></button>';
      }).join('');
    }
    Array.from(choices.children).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.feedPalatability === select.value));
    });
  };

  UI.syncMedicationOutcome = function () {
    var select = document.getElementById('feedMedicationOutcome');
    var choices = document.getElementById('feedMedicationOutcomeChoices');
    if (!choices.childElementCount) {
      choices.innerHTML = Array.from(select.options).filter(function (option) { return option.value; }).map(function (option) {
        return '<button type="button" class="care-chip" data-outcome="' + Utils.escapeHtml(option.value) + '">' +
          '<span class="care-chip-copy feed-rating-copy">' + Utils.formatMedicationOutcome(option.value) + '</span></button>';
      }).join('');
    }
    Array.from(choices.children).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.outcome === select.value));
    });
  };

  function syncCareForm(care, editing) {
    var form = document.getElementById('feedForm');
    var nursing = care && form.dataset.careType === 'nursing';
    var supplement = care && form.dataset.careType === 'supplement';
    if (care) delete form.dataset.unstocked;
    var unstocked = !care && form.dataset.unstocked === 'true';
    document.getElementById('feedCareTypeGroup').classList.toggle('hidden-view', !care);
    document.querySelectorAll('[data-feed-care-type]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.feedCareType === (nursing ? 'nursing' : supplement ? 'supplement' : 'medication')));
    });
    form.classList.toggle('feed-nursing-mode', nursing);
    document.getElementById('feedNursingProjects').classList.toggle('hidden-view', !nursing);
    document.getElementById('feedNursingReminderChoices').classList.toggle('hidden-view', !nursing);
    document.getElementById('feedMedicationReminderChoices').classList.toggle('hidden-view', !care || nursing || supplement);
    if (!nursing) document.getElementById('feedNursingSuggestion').classList.add('hidden-view');
    UI.syncFeedNote();
    ['feedNameInput', 'feedAmountInput'].forEach(function (id) { document.getElementById(id).required = !nursing; });
    document.getElementById('feedMealSlotLabel').textContent = care ? '记录类型' : '餐次时段';
    document.getElementById('feedReminderTitle').textContent = nursing ? '下次护理提醒' : care ? '下次提醒' : '下次用药/驱虫提醒';
    var wasCare = form.classList.contains('feed-care-mode');
    var target = MP.state.items.find(function (item) { return item.id === document.getElementById('feedItemId').value; });
    document.getElementById('feedMedicationOutcomeLabel').textContent = '使用情况';
    UI.syncMedicationOutcome();
    var amount = document.getElementById('feedAmountInput');
    var deduct = document.getElementById('feedDeductStock');
    form.classList.toggle('feed-care-mode', care);
    if (care && !wasCare) {
      amount.dataset.foodPlaceholder = amount.placeholder;
      form.dataset.foodDeduct = String(deduct.checked);
      deduct.checked = Boolean(target && !editing);
    } else if (!care && wasCare) {
      amount.placeholder = amount.dataset.foodPlaceholder || '如 1/2、1/3、40g';
      deduct.checked = form.dataset.foodDeduct === 'true';
      if (document.getElementById('feedNextReminderDays').value === 'custom') setFeedReminderDays(0);
    }
    if (care) {
      amount.placeholder = supplement ? '如 1勺、2粒' : '如 1/2支、1支';
    }
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel(nursing ? 'clipboard-check' : supplement ? 'bottle' : care ? 'pill' : editing ? 'pencil' : 'paw-print',
      nursing ? (editing ? '编辑护理记录' : '记录护理') : supplement ? (editing ? '编辑营养品记录' : '记录营养品') :
        care ? (editing ? '编辑用药记录' : '记录用药') : (editing ? '编辑每日记录' : '记录喂食'), 20);
    document.getElementById('feedPalatabilityField').classList.toggle('hidden-view', care);
    Array.from(document.getElementById('feedFlavorPal').options).forEach(function (option) {
      var badge = MP.getPalatabilityBadgeInfo({
        category: target?.category || document.getElementById('feedCategorySelect').value,
        palatability: option.value
      });
      option.textContent = badge ? MP.getPalatabilityEmoji(option.value) + ' ' + badge.label : '未评价';
    });
    UI.syncFeedPalatabilityChoices();
    document.getElementById('feedMedicationOutcomeField').classList.toggle('hidden-view', !care || nursing);
    document.getElementById('feedMedicationUsageModeWrap').classList.toggle('hidden-view', !care || nursing || supplement);
    document.getElementById('feedManualTitle').textContent = unstocked ? '记录自制 / 无品牌食物' :
      care ? (supplement ? '记录未入库营养品' : '记录未入库药品') : '记录未入库商品';
    document.getElementById('feedManualBrandField').classList.toggle('hidden-view', unstocked);
    document.getElementById('feedCategoryField').classList.toggle('hidden-view', care);
    document.getElementById('feedCategorySelect').querySelector('[value="med"]').disabled = unstocked;
    document.getElementById('feedNameLabel').textContent = care ? (supplement ? '营养品名称' : '药品名称') : unstocked ? '食物名称' : '商品名';
    document.getElementById('feedNameInput').placeholder = supplement ? '填写营养品名称' : care ? '如：大宠爱 / 福来恩 / 拜宠清' : unstocked ? '如 自制鸡肉鲜食' : '如 小灶猫饭';
    document.getElementById('feedBrandInput').placeholder = care ? '如：辉瑞 / 勃林格殷格翰' : '如 喵梵思';
    document.getElementById('feedStockLabel').textContent = '商品批次';
    document.getElementById('saveFeedBtn').textContent = nursing ? '保存护理记录' : supplement ? '保存营养品记录' : care ? '保存用药记录' : '保存喂食记录';
    document.getElementById('feedAmountLabel').textContent = care ? '用量' : '投喂份量';
    document.getElementById('feedNoteLabel').textContent = '备注';
    document.getElementById('feedNoteInput').placeholder = nursing ? '如：状态是否配合、有无异常' : care ? '如：有无呕吐、精神状态' : '如：秒光盘、兑了40ml温水、便便正常';
    document.getElementById('feedBrandInput').required = !care && !unstocked;
    document.querySelectorAll('[data-care-interval]').forEach(function (option) {
      option.hidden = !care || (!nursing && option.value !== 'custom' && !option.selected);
    });
    document.querySelectorAll('[data-nursing-interval]').forEach(function (option) { option.hidden = !nursing; });
    document.querySelectorAll('[data-medication-interval]').forEach(function (option) {
      option.hidden = nursing || (care && Number(option.value) > 90 && !option.selected);
    });
    var reminder = document.getElementById('feedNextReminderDays');
    ['30', '60', '90'].forEach(function (value) {
      var option = reminder.querySelector('[value="' + value + '"]');
      if (!option.dataset.originalLabel) option.dataset.originalLabel = option.textContent;
      option.textContent = care && !nursing ? Number(value) / 30 + '个月后' : option.dataset.originalLabel;
    });
    syncFeedBatchDisplay(target);
    syncPortionChips(target, care);
    syncLastPortionChip(target, care, editing);
    UI.syncFeedSplitCanUI(target);
  };

  UI.syncNursingOther = function () {
    var checked = document.querySelector('[data-nursing-project][value="其他"]').checked;
    document.getElementById('feedNursingOtherField').classList.toggle('hidden-view', !checked);
    var other = document.getElementById('feedNursingOther');
    other.required = checked && document.getElementById('feedForm').classList.contains('feed-nursing-mode');
  };

  function loadNursingFields(log) {
    var projects = log?.careProjects || [];
    var choices = Array.from(document.querySelectorAll('[data-nursing-project]'));
    var other = log?.careOther || projects.filter(function (value) {
      return !choices.some(function (choice) { return choice.value === value; });
    }).join('、');
    choices.forEach(function (choice) {
      choice.checked = choice.value === '其他' ? Boolean(other) : projects.includes(choice.value);
    });
    document.getElementById('feedNursingOther').value = other;
    UI.syncNursingOther();
  }

  UI.changeFeedCareType = function (type) {
    var form = document.getElementById('feedForm');
    if (form.dataset.careType === type) return;
    if (document.getElementById('feedStockSelect').disabled) {
      if (document.getElementById('feedLogEditId').value) {
        UI.showToast('这条记录已关联库存，无法切换类型');
        return;
      }
      document.getElementById('feedStockSelect').disabled = false;
      form.dataset.productEntry = 'false';
    }
    var error = document.getElementById('feedAmountError');
    careAmountErrors[form.dataset.careType] = error.classList.contains('hidden-view') ? '' : error.textContent;
    form.dataset.careType = type;
    manualFeedDrafts = Object.create(null);
    delete form.dataset.nursingReminderManual;
    form.dataset.manualProduct = 'false';
    document.getElementById('feedStockSelect').value = '';
    UI.applyFeedStockSelection('');
    document.getElementById('feedCategorySelect').value = type === 'supplement' ? 'supp' : 'med';
    document.getElementById('feedStockSearch').value = '';
    ['feedBrandInput', 'feedNameInput', 'feedAmountInput', 'feedManualFlavor', 'feedMedicationOutcome', 'feedCustomReminderDays'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    setFeedReminderDays(0);
    loadNursingFields();
    UI.syncMedReminderVisibility();
    var savedError = careAmountErrors[type] || '';
    document.getElementById('feedAmountInput').setCustomValidity(savedError);
    UI.showFeedAmountError(savedError);
  };

  function feedFractionLabel(fraction, unit) {
    return Utils.formatRemainFractionText(fraction, unit, true).replace(/^余/, '') ||
      Utils.formatQuantity(fraction || 0, unit);
  }

  function feedPortionDetail(item, fraction) {
    if (UI.usesStickPortions(item)) return feedFractionLabel(fraction, item.unit);
    var usageUnit = UI.feedUsageUnit(item);
    if (usageUnit && Number(item.feedUsagePerItem) > 0) {
      return Utils.formatNumber(Number(item.feedUsagePerItem) * fraction, 3) + usageUnit;
    }
    var spec = Utils.parsePortionSpec(Utils.itemPortionSpec(item));
    if (spec && Number(spec[1]) > 0 && (!spec[3] || spec[3] === item.unit)) {
      return Utils.formatNumber(Number(spec[1]) * fraction, 3) + spec[2];
    }
    return Utils.formatNumber(fraction, 3) + (item.unit || '件');
  }

  UI.syncFeedSplitCanUI = function (target, amountChanged) {
    var editing = Boolean(document.getElementById('feedLogEditId').value);
    var deduct = document.getElementById('feedDeductStock');
    var care = document.getElementById('feedForm').classList.contains('feed-care-mode');
    var hint = document.getElementById('feedSplitHintTag');
    var info = document.getElementById('feedSplitAutoInfo');
    var flavor = target && target.flavors && UI.getFeedFlavor(target);
    var unit = target && target.unit || '件';
    var remaining = flavor ? flavor.openRemainFraction : target && !target.flavors && target.openRemainFraction;
    document.getElementById('feedDeductBox').classList.toggle('hidden-view', !target || editing);
    var weight = target ? Number(target.unit_net_weight_g) || Utils.legacyUnitWeight(target.spec, unit) : 0;
    var currentFraction = target && (flavor || target).quantity >= 1 && (!target.flavors || flavor) ? Number(remaining) || 1 : 0;
    var stickPortions = !care && UI.usesStickPortions(target);
    hint.textContent = stickPortions && currentFraction > 0
      ? '剩余 ' + Utils.formatQuantity(currentFraction, unit) +
        (weight > 0 ? '约' + Utils.formatNumber(weight * currentFraction, 3) + 'g' : '') +
        '（' + Utils.formatNumber(currentFraction * 100, 1) + '%）'
      : target && currentFraction > 0 && !care
      ? '剩余约 ' + (weight > 0 ? Math.round(weight * currentFraction) + 'g（' +
        Utils.formatNumber(currentFraction * 100, 1) + '%）' : feedFractionLabel(currentFraction, unit))
      : '';
    var careHelp = document.getElementById('feedCareDeductHelp');
    careHelp.classList.toggle('hidden-view', !care);
    info.classList.toggle('hidden-view', care);
    var amount = document.getElementById('feedAmountInput');
    var dose = amount.value.trim();
    amount.dataset.lastDeductionAmount = amount.value;
    var portion = target ? UI.parseFeedPortion(dose, target, flavor) : null;
    var convertible = Boolean(dose && portion && (portion.finish ||
      (portion.valid && Number.isFinite(portion.fraction) && portion.fraction > 0)));
    UI.syncFeedAutoOpen(target);
    var openingBox = document.getElementById('feedAutoOpenBox');
    var openingToggle = document.getElementById('feedAutoOpen');
    var openingVisible = !openingBox.classList.contains('hidden-view');
    var rollover = openingBox.dataset.rollover === 'true';
    if ((deduct.checked || (amountChanged && !care && document.getElementById('feedDateInput').value === Utils.getTodayStr())) &&
        openingVisible && !openingToggle.disabled &&
        (rollover || (portion && !Number.isSafeInteger(portion.fraction)))) openingToggle.checked = true;
    var sealedOnly = openingVisible && !rollover && !openingToggle.checked;
    var plan = convertible ? Domain.planFeedingPortion(target, flavor, portion, { sealedOnly: sealedOnly }) : null;
    var pendingUnit = target && UI.feedUsageUnit(target);
    var reason = !target ? (care ? '选择' + (document.getElementById('feedForm').dataset.careType === 'supplement' ? '营养品' : '药品') + '批次后可扣减' : '请选择库存商品')
      : editing ? '' : target.flavors && !flavor ? '请先选择实际喂食的口味'
      : !dose ? '请填写份量或选择快捷份量'
      : !convertible ? (pendingUnit && pendingUnit !== target.unit && dose.endsWith(pendingUnit) && !(Number(target.feedUsagePerItem) > 0)
        ? '份量无法换算，请先填写每' + unit + '的' + pendingUnit + '数；不会扣减库存'
        : '份量无法换算，不会扣减库存')
      : plan.error || (rollover && !openingToggle.checked ? '请先打开开封开关，再扣减库存。' : '');
    deduct.disabled = !target || editing || Boolean(reason);
    if (deduct.disabled) deduct.checked = false;
    else if (!care && amountChanged && document.getElementById('feedDateInput').value === Utils.getTodayStr()) deduct.checked = true;
    var choice = amount.dataset.doseChoice;
    var chips = Array.from(document.querySelectorAll('#feedPortionChips button:not(.hidden-view)'));
    chips.forEach(function (button) {
      if (!stickPortions || editing) { button.disabled = false; return; }
      var value = UI.parseFeedPortion(button.dataset.portion, target, flavor);
      button.disabled = Boolean(target.flavors && !flavor) || !value.valid || !(value.fraction > 0) ||
        Boolean(Domain.planFeedingPortion(target, flavor, value).error);
    });
    var portionError = stickPortions && !editing && dose && (!target.flavors || flavor) &&
      (!convertible ? '请输入有效份量，如半支、1支；克数需填写每支净含量后才能换算。'
        : Number((flavor || target).quantity) > 0 ? plan?.error || '' : '');
    amount.setCustomValidity(portionError || '');
    UI.showFeedAmountError(portionError || '');
    var selected = dose && (care || stickPortions || !amount.dataset.automaticPortion) && (chips.find(function (button) {
      return choice && (button.id || button.dataset.portion) === choice;
    }) || chips.find(function (button) {
      if (!button.dataset.portion) return false;
      if (dose.toLowerCase() === button.dataset.portion.toLowerCase()) return true;
      if (button.hasAttribute('data-package-portion') && !care &&
          (dose === button.dataset.frac || (button.dataset.frac === '0.34' && dose === '1/3'))) return true;
      if (button.hasAttribute('data-package-portion') && target) {
        var fraction = button.dataset.frac === '0.34' ? 1 / 3 : Number(button.dataset.frac);
        return dose === UI.portionLabel(button.dataset.portion, fraction, target, flavor) ||
          (UI.parseFeedPortion(dose, target, flavor).valid && Math.abs(UI.parseFeedPortion(dose, target, flavor).fraction - fraction) < 1e-6);
      }
      if (stickPortions && convertible) {
        var chipPortion = UI.parseFeedPortion(button.dataset.portion, target, flavor);
        return chipPortion.valid && Math.abs(portion.fraction - chipPortion.fraction) < 1e-6;
      }
      return /^\d+(?:\.\d+)?g$/i.test(button.dataset.portion) &&
        dose.toLowerCase().replace(/\s+/g, '').replace(/克$/, 'g') === button.dataset.portion.toLowerCase();
    }));
    document.querySelectorAll('#feedPortionChips button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button === selected));
    });
    var message;
    if (reason) message = reason;
    else if (!target || !deduct.checked) message = '仅记录喂食，库存和开封余量保持原样';
    else if (plan.rollover) {
      message = '上一' + unit + '剩 ' + feedPortionDetail(target, plan.previous) + ' 将用完，再开新' + unit +
        '扣 ' + feedPortionDetail(target, plan.nextUsed);
    } else {
      var opening = openingVisible && !openingToggle.disabled && openingToggle.checked;
      var opened = flavor ? (Domain.hasSharedSeal(target) ? target.isOpened : Boolean(flavor.openedDate)) : target.isOpened;
      var prefix = flavor ? '【' + flavor.name + '】' : '';
      var usedText = Utils.formatNumber(plan.used, 3) + ' ' + unit;
      var usageUnit = UI.feedUsageUnit(target);
      if (usageUnit && usageUnit !== unit && dose.endsWith(usageUnit)) {
        usedText = dose + '（约' + Utils.formatNumber(plan.used, 3) + unit + '）';
      }
      var before = (flavor || target).quantity - 1 + (Number((flavor || target).openRemainFraction) || 1);
      message = stickPortions && plan.sealedUnits > 1 ? '将从' + prefix + '在库扣 ' + usedText +
        '（余 ' + Utils.formatNumber(before, 3) + ' ' + unit + ' → ' + Utils.formatNumber(before - plan.used, 3) + ' ' + unit + '）'
        : opening ? '将从新开封的这份扣 ' + usedText
        : opened ? '将从' + prefix + '开封余量扣 ' + usedText + '（余 ' + Utils.formatNumber(before, 3) + ' ' + unit +
          ' → ' + Utils.formatNumber(before - plan.used, 3) + ' ' + unit + '）'
        : '将从' + prefix + '在库扣 ' + usedText;
    }
    info.textContent = message;
    careHelp.textContent = message;
  };

  UI.portionLabel = function (base, fraction, item, flavor) {
    var spec = item && Utils.parsePortionSpec(Utils.itemPortionSpec(item));
    if (!spec || Number(spec[1]) <= 0 || (spec[3] && spec[3] !== item.unit)) return base;
    return base + ' (约' + Utils.round2(Number(spec[1]) * fraction) + spec[2] + ')';
  };

  UI.feedUsageUnit = function (item) {
    if (!item) return '';
    return item.feedUsageUnit || MP.ITEM_FORM_RULES[item.category]?.[item.subtype]?.feedUnit || '';
  };

  UI.usesStickPortions = function (item) {
    return Boolean(item && item.category === 'treat' && item.unit === '支');
  };

  UI.showFeedAmountError = function (message) {
    var input = document.getElementById('feedAmountInput');
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    var error = document.getElementById('feedAmountError');
    error.textContent = message;
    error.classList.toggle('hidden-view', !message);
  };

  UI.parseFeedPortion = function (amount, item, flavor) {
    var text = String(amount || '').trim();
    if (/^(吃完|用完)$/.test(text)) return { finish: true };
    if (item?.category === 'med' && /^(ml|毫升)$/i.test(item.unit)) {
      var dose = /^(\d+(?:\.\d+)?)\s*(?:ml|毫升)$/i.exec(text);
      if (dose && Number(dose[1]) > 0) return { valid: true, fraction: Number(dose[1]) };
      text = text.replace(/(?:ml|毫升)$/i, item.unit);
    }
    var mass = /^(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升)$/i.exec(text);
    if (mass && Number(mass[1]) > 0) {
      var spec = item && Utils.parsePortionSpec(Utils.itemPortionSpec(item));
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
      if (!ratio && item && UI.feedUsageUnit(item) === mass[2] && Number(item.feedUsagePerItem) > 0) {
        ratio = Number(mass[1]) / Number(item.feedUsagePerItem);
      }
      return { valid: true, fraction: Number.isFinite(ratio) ? ratio : 0 };
    }
    text = text.replace(/\s*[（(](?:约?\s*\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升)|1\/2)[）)]$/i, '').trim();
    var usageUnit = UI.feedUsageUnit(item);
    if (usageUnit && item && usageUnit !== item.unit && text.endsWith(usageUnit)) {
      var useText = text.slice(0, -usageUnit.length).trim();
      var useParts = /^(\d+)\s*\/\s*(\d+)$/.exec(useText);
      var used = useText === '半' ? 0.5 : useParts ? Number(useParts[1]) / Number(useParts[2])
        : /^\d+(?:\.\d+)?$/.test(useText) ? Number(useText) : 0;
      var ratioPerItem = Number(item.feedUsagePerItem);
      return { valid: Number.isFinite(used) && used > 0,
        fraction: ratioPerItem > 0 ? used / ratioPerItem : 0 };
    }
    var unit = item && item.unit;
    var hasUnit = Boolean(unit && text.endsWith(unit));
    if (hasUnit) text = text.slice(0, -unit.length).trim();
    if (text === '半') return { valid: true, fraction: 0.5 };
    var parts = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
    var fraction = parts ? Number(parts[1]) / Number(parts[2])
      : (hasUnit && /^\d+(?:\.\d+)?整?$/.test(text) ? Number(text.replace(/整$/, '')) : 0);
    return { valid: Number.isFinite(fraction) && fraction > 0, fraction: fraction };
  };

  function syncPortionChips(item, care) {
    var unit = item?.unit || (care ? '支' : '');
    var category = item?.category || document.getElementById('feedCategorySelect').value;
    var configured = MP.FEED_PORTION_PRESETS[category] || MP.FEED_PORTION_PRESETS.dry;
    var usageUnit = UI.feedUsageUnit(item);
    var customChoices = !care && item && (
      (category === 'treat' && Boolean(item.subtype)) ||
      (category === 'freeze' && Boolean(item.subtype)));
    if (customChoices) configured = usageUnit === 'g' ? MP.FEED_PORTION_PRESETS.dry : [];
    var stickPortions = !care && UI.usesStickPortions(item);
    if (stickPortions) configured = ['半支', '1支', '2支'];
    if (category === 'supp') configured = [];
    if (!care && document.getElementById('feedForm').dataset.unstocked === 'true') configured = [];
    var natural = care || /^(杯|罐|包|盒|支|粒|瓶|袋)$/.test(unit);
    var medStick = care && category === 'med' && unit === '支';
    var presets = { '0.5': medStick ? '1/2支' : natural ? '半' + unit : '1/2',
      '0.34': natural ? '1/3' + unit : '1/3',
      '0.25': natural ? '1/4' + unit : '1/4', '1': '1' + unit };
    document.querySelectorAll('#feedPortionChips [data-package-portion]').forEach(function (button) {
      var portion = presets[button.dataset.frac];
      button.dataset.portion = portion;
      button.classList.toggle('care-chip', care);
      if (care) button.innerHTML = careChipContent(portion);
      else button.textContent = portion;
      var hidden = care ? !item || category === 'supp' || !['0.5', '1'].includes(button.dataset.frac)
        : !configured.includes(button.dataset.frac);
      button.classList.toggle('hidden-view', hidden);
    });
    var quickChips = document.getElementById('feedPortionChips');
    var order = ['0.25', '0.34', '0.5', '1'];
    order.forEach(function (fraction) {
      quickChips.append(quickChips.querySelector('[data-frac="' + fraction + '"][data-package-portion]'));
    });
    quickChips.querySelectorAll('[data-configured-portion]').forEach(function (button) { button.remove(); });
    var careChoices = [];
    if (care && !item) careChoices = ['1份', '2份'];
    else if (care && category === 'med') careChoices = ['2' + unit];
    else if (care && category === 'supp') {
      if (item.subtype === '粉剂' || usageUnit === '勺') careChoices = ['半勺', '1勺', '2勺'];
      else if (item.subtype === '液体' || usageUnit === 'ml' || /^(ml|毫升)$/i.test(unit)) careChoices = ['1ml', '2ml', '1泵'];
      else if (['片剂', '胶囊'].includes(item.subtype) || ['片', '粒'].includes(unit)) {
        var doseUnit = ['片', '粒'].includes(usageUnit) ? usageUnit : ['片', '粒'].includes(unit) ? unit : '粒';
        careChoices = ['1' + doseUnit, '2' + doseUnit];
      } else careChoices = ['1份', '2份'];
    }
    careChoices.forEach(function (portion) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'care-chip';
      button.dataset.configuredPortion = '';
      button.dataset.carePortion = '';
      button.dataset.portion = portion;
      button.innerHTML = careChipContent(portion);
      quickChips.append(button);
    });
    if (!care) configured.filter(function (preset) { return !Object.hasOwn(presets, preset); }).forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.configuredPortion = '';
      button.dataset.portion = preset;
      button.textContent = preset;
      quickChips.append(button);
    });
    if (!stickPortions && customChoices && usageUnit && usageUnit !== 'g' && usageUnit !== 'ml') ['半' + usageUnit, '1' + usageUnit].forEach(function (portion) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.configuredPortion = '';
      button.dataset.portion = portion;
      button.textContent = portion;
      quickChips.append(button);
    });
  }

  UI.getFeedFlavor = function (item) {
    return Domain.findFlavor(item, document.getElementById('feedFlavorSelect').value);
  };

  function syncFeedPalatability(item, flavor) {
    var field = document.getElementById('feedFlavorPal');
    if (!field.dataset.manual) {
      field.value = (item?.flavors ? flavor?.palatability : item?.palatability) || '';
    }
    UI.syncFeedPalatabilityChoices();
  }

  UI.syncFeedFlavor = function (item, historical) {
    var wrap = document.getElementById('feedFlavorFields');
    var select = document.getElementById('feedFlavorSelect');
    var hasFlavor = Boolean(historical && historical.flavorId || item && item.flavors);
    wrap.classList.toggle('hidden-view', !hasFlavor);
    select.disabled = Boolean(historical);
    select.required = hasFlavor && !historical;
    wrap.classList.toggle('has-selected-flavor', Boolean(historical && hasFlavor));
    select.innerHTML = '<option value="">请选择口味</option>';
    if (historical) {
      var palField = document.getElementById('feedFlavorPal');
      palField.value = historical.flavorPalatability || '';
      palField.dataset.manual = '1';
      UI.syncFeedPalatabilityChoices();
    }
    if (historical && hasFlavor) {
      select.add(new Option(historical.flavorName, historical.flavorId, true, true));
    } else if (hasFlavor) {
      item.flavors.forEach(function (f) {
        var expiredOpen = Domain.stockExpiryEntries(item).some(function (entry) {
          return entry.flavor === f && entry.opened && entry.evaluation.openRemaining !== null && entry.evaluation.openRemaining < 0;
        });
        var quantity = UI.usesStickPortions(item) && f.quantity > 0
          ? f.quantity - 1 + (Number(f.openRemainFraction) || 1) : f.quantity;
        select.add(new Option(f.name + ' · 余' + Utils.formatQuantity(quantity, item.unit) +
          (expiredOpen ? ' · 开封已过期，请先处理' : ''), f.id));
      });
      UI.updateFeedFlavor(item);
    } else if (!historical) {
      syncFeedPalatability(item, null);
    }
  };

  UI.updateFeedFlavor = function (item) {
    var flavor = UI.getFeedFlavor(item);
    syncFeedPalatability(item, flavor);
    var amount = document.getElementById('feedAmountInput');
    var defaulted = Boolean(UI.usesStickPortions(item) && flavor && (!amount.value.trim() || amount.dataset.automaticPortion));
    if (defaulted) {
      amount.value = flavor.quantity > 0 ? feedFractionLabel(Number(flavor.openRemainFraction) || 1, item.unit) : '';
      amount.dataset.automaticPortion = '1';
    }
    document.getElementById('feedFlavorFields').classList.toggle('has-selected-flavor', Boolean(flavor));
    UI.syncFeedAutoOpen(item);
    syncLastPortionChip(item, document.getElementById('feedForm').classList.contains('feed-care-mode'),
      Boolean(document.getElementById('feedLogEditId').value));
    return defaulted;
  };

  function syncLastPortionChip(item, care, editing) {
    var chip = document.getElementById('chipLastPortion');
    chip.classList.toggle('care-chip', care);
    var flavor = item && item.flavors ? UI.getFeedFlavor(item) : null;
    var last = Domain.getLastFedInfoForItem(item, function (log) {
      return (!item.flavors || (flavor && log.flavorId === flavor.id)) &&
        (!care || (log.id !== document.getElementById('feedLogEditId').value &&
          (log.category === 'med' || log.mealSlot === 'care')));
    });
    if (!care && editing) last = null;
    chip.classList.toggle('hidden-view', !last?.amount);
    if (last?.amount) {
      chip.dataset.portion = last.amount;
      var label = last.amount;
      if (!care && !UI.usesStickPortions(item) && ['dry', 'freeze', 'treat'].includes(item?.category)) {
        var weight = Number(item.unit_net_weight_g) || Utils.legacyUnitWeight(item.spec, item.unit);
        var fraction = UI.parseFeedPortion(last.amount, item).fraction;
        if (weight > 0 && fraction > 0) label = Utils.formatNumber(weight * fraction, 1) + 'g';
      }
      chip.innerHTML = care ? careChipContent('上次用量：' + last.amount) :
        Utils.iconLabel('zap', item?.category === 'can' ? '上次' : '上次 ' + label);
    }
  }

  UI.applyFeedStockSelection = function (itemId) {
    var amount = document.getElementById('feedAmountInput');
    delete amount.dataset.doseChoice;
    delete amount.dataset.automaticPortion;
    if (itemId) amount.dataset.automaticPortion = '1';
    var target = MP.state.items.find(function (it) { return it.id === itemId; }) || null;
    document.getElementById('feedItemId').value = target ? target.id : '';
    UI.syncFeedFlavor(target);
    syncPortionChips(target);
    if (target) {
      document.getElementById('feedCategorySelect').value = target.category || 'dry';
      if (!document.getElementById('feedLogEditId').value) {
        if (target.category === 'med') {
          document.getElementById('feedMealSlot').value = 'care';
        } else if (!document.getElementById('feedForm').dataset.mealSlotManual && MP.isFoodCategory(target.category)) {
          document.getElementById('feedMealSlot').value =
            target.category === 'treat' || target.category === 'freeze' ? 'snack' : Utils.getCurrentMealSlot();
        }
      }
      document.getElementById('feedBrandInput').value = target.brand || '';
      document.getElementById('feedNameInput').value = target.name || '';

      var lastFed = Domain.getLastFedInfoForItem(target);
      syncLastPortionChip(target, false, false);

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
        defaultPortion = target.subtype === '零食冻干' && UI.feedUsageUnit(target) === '块' ? '1块' : '15g';
      } else if (target.category === 'treat') {
        defaultPortion = '1' + (UI.feedUsageUnit(target) || target.unit);
      } else if (target.category === 'supp') {
        defaultPortion = '';
      } else if (target.category === 'med') {
        defaultPortion = '1' + (target.unit || '支');
      }
      if (UI.usesStickPortions(target)) defaultPortion = feedFractionLabel(curRemFrac || 1, target.unit);

      document.getElementById('feedAmountInput').value = defaultPortion;
      document.getElementById('feedAmountInput').placeholder = UI.usesStickPortions(target)
        ? '如 半支、1支、2支' : '如 25g、半' + target.unit + '、1' + target.unit;
      if (target.flavors) {
        document.getElementById('feedAmountInput').value = '';
      }
      UI.syncFeedSplitCanUI(target);
    } else {
      syncLastPortionChip(null, false, false);
      UI.syncFeedSplitCanUI(null);
    }
    UI.syncFeedAutoOpen(target);
  };

  UI.syncFeedAutoOpen = function (item) {
    var box = document.getElementById('feedAutoOpenBox');
    var toggle = document.getElementById('feedAutoOpen');
    var link = document.getElementById('feedReopenLink');
    var flavor = item && item.flavors ? UI.getFeedFlavor(item) : null;
    var stock = flavor || item;
    var eligible = Boolean(item && Number(item.openDaysLimit) > 0 && !(item.category === 'med' && item.unit === '支') &&
      !document.getElementById('feedLogEditId').value &&
      (!item.flavors || flavor) && Number(item.quantity) > 0 && Number(stock.quantity) > 0);
    var key = eligible ? item.id + ':' + (flavor?.id || '') : '';
    if (box.dataset.itemId !== key) {
      box.dataset.itemId = key;
      delete box.dataset.rollover;
      toggle.checked = true;
    }
    var opened = eligible && (flavor ? (Domain.hasSharedSeal(item) ? item.isOpened : Boolean(flavor.openedDate)) : item.isOpened);
    var portion = eligible ? UI.parseFeedPortion(document.getElementById('feedAmountInput').value, item, flavor) : null;
    var remaining = opened && Number(stock.openRemainFraction);
    var needsNext = Boolean(remaining > 0 && portion?.valid && portion.fraction - remaining > 1e-12);
    if (needsNext && box.dataset.rollover !== 'true') toggle.checked = true;
    box.dataset.rollover = String(needsNext);
    var plan = needsNext ? Domain.planFeedingPortion(item, flavor, portion) : null;
    link.textContent = item?.unit ? '换新' + item.unit + '了？记录开封' : '换新的了？记录开封';
    link.classList.toggle('hidden-view', !opened || needsNext);
    box.classList.toggle('hidden-view', !eligible || (opened && !needsNext));
    toggle.disabled = Boolean(plan?.error);
    document.getElementById('feedAutoOpenHelp').textContent = needsNext
      ? plan.error || '上一' + (item.unit || '件') + '还剩 ' + feedPortionDetail(item, remaining) + '，将先用完再开新的'
      : '这批还没开封，记录后开始保鲜倒计时';
    var date = document.getElementById('feedDateInput').value;
    var dateLabel = date === Utils.getTodayStr() ? '今天' : Utils.normalizeDateStr(date) ? date.slice(5) : '所选日期';
    document.getElementById('feedAutoOpenTitle').textContent =
      '同时记为' + (dateLabel === '今天' ? '今天' : ' ' + dateLabel + ' ') + '开封' + (flavor ? '（' + flavor.name + '）' : '');
  };

  function selectMealSlot(value) {
    document.getElementById('feedMealSlot').value = Utils.normalizeMealSlot(value);
    document.getElementById('feedMealPicker').open = false;
    document.getElementById('feedMealChoices').innerHTML = Utils.mealSlotOptions().map(function (slot) {
      return '<button type="button" data-meal-slot="' + Utils.escapeHtml(slot.id) + '">' +
        Utils.iconLabel(slot.icon, slot.id === 'care' ? '用药·营养·护理' : slot.label) + '</button>';
    }).join('');
  }

  UI.feedButtonContent = function (label) {
    return '<svg class="btn-feed__icon" width="16" height="16" aria-hidden="true"><use href="#feed-paw"></use></svg><span>' + Utils.escapeHtml(label || '记喂食') + '</span>';
  };

  function setFeedReminderDays(days) {
    var select = document.getElementById('feedNextReminderDays');
    select.querySelectorAll('[data-legacy-interval]').forEach(function (option) { option.remove(); });
    if (days > 0 && !Array.from(select.options).some(function (option) { return Number(option.value) === days; })) {
      var option = new Option(days + '天后', days);
      option.dataset.legacyInterval = '1';
      select.add(option);
    }
    select.value = String(days || 0);
  }

  UI.openFeedModal = function (itemId, customDate, manualEntry, productEntry, dailyEntry) {
    manualFeedDrafts = Object.create(null);
    careAmountErrors = Object.create(null);
    var feedForm = document.getElementById('feedForm');
    delete feedForm.dataset.nursingReminderManual;
    delete feedForm.dataset.feedNoteOpen;
    feedForm.dataset.productEntry = String(Boolean(productEntry));
    feedForm.dataset.dailyEntry = String(Boolean(dailyEntry));
    feedForm.dataset.manualProduct = 'false';
    delete feedForm.dataset.unstocked;
    delete feedForm.dataset.mealSlotManual;
    document.getElementById('feedStockSearch').value = '';
    document.getElementById('feedManualFlavor').value = '';
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel('paw-print', '记录喂食', 20);
    document.getElementById('feedStockSelect').disabled = false;
    document.getElementById('feedLogEditId').value = '';
    document.getElementById('feedForm').dataset.careType = 'medication';
    loadNursingFields();
    document.getElementById('feedForm').classList.remove('feed-care-mode');
    delete document.getElementById('feedAmountInput').dataset.doseChoice;
    delete document.getElementById('feedAmountInput').dataset.automaticPortion;
    document.getElementById('feedMedicationOutcome').value = '';
    document.getElementById('feedMedicationUsageMode').value = '';
    document.getElementById('feedCustomReminderDays').value = '';
    document.getElementById('feedAmountInput').placeholder = '如 1/2、1/3、40g';
    delete document.getElementById('feedFlavorPal').dataset.manual;
    UI.syncFeedFlavor(null);
    syncPortionChips(null);
    var dateToUse = customDate || (MP.state.activeTab === 'daily' ? MP.state.selectedLogDate : Utils.getTodayStr());
    document.getElementById('feedDateInput').value = dateToUse;
    selectMealSlot(Utils.getCurrentMealSlot());
    document.getElementById('feedDeductStock').checked = false;
    document.getElementById('feedAutoOpen').checked = true;
    document.getElementById('feedAutoOpenBox').dataset.itemId = '';
    delete document.getElementById('feedForm').dataset.reminderSourceId;
    setFeedReminderDays(0);
    document.getElementById('feedNoteInput').value = '';
    document.getElementById('feedStockPicker').open = false;

    if (itemId) {
      var requested = MP.state.items.find(function (item) { return item.id === itemId; });
      if (requested && !MP.isFoodCategory(requested.category)) selectMealSlot('care');
      if (requested && requested.category === 'supp') feedForm.dataset.careType = 'supplement';
      UI.applyFeedStockSelection(itemId);
    } else {
      var foodBatches = MP.state.items.filter(function (it) {
        return it.quantity > 0 && isFeedStockMatch(it, 'food') && (!it.sourceBatchId || !MP.state.items.some(function (batch) { return batch.id === it.sourceBatchId; }));
      });
      var lastLog = MP.state.logs.filter(function (log) {
        return foodBatches.some(function (batch) { return batch.id === log.itemId; }) && !Domain.getCareType(log);
      }).sort(function (a, b) {
        return String(b.date).localeCompare(String(a.date)) || String(b.time || '').localeCompare(String(a.time || ''));
      })[0];
      var firstActive = !manualEntry && (foodBatches.find(function (item) { return item.id === lastLog?.itemId; }) ||
        foodBatches[0]);
      if (firstActive) {
        UI.applyFeedStockSelection(firstActive.id);
      } else {
        feedForm.dataset.manualProduct = 'true';
        document.getElementById('feedItemId').value = '';
        document.getElementById('feedBrandInput').value = '';
        document.getElementById('feedNameInput').value = '';
        document.getElementById('feedAmountInput').value = manualEntry ? '' : '40g';
        if (manualEntry) document.getElementById('feedCategorySelect').value = 'dry';
        UI.syncFeedSplitCanUI(null);
      }
    }
    if (productEntry && document.getElementById('feedItemId').value) document.getElementById('feedStockSelect').disabled = true;
    UI.syncMedReminderVisibility();
    if (!feedForm.classList.contains('feed-care-mode')) {
      UI.syncFeedSplitCanUI(MP.state.items.find(function (item) { return item.id === document.getElementById('feedItemId').value; }), true);
    }
    UI.syncAllDateDisplays();
    document.querySelector('.feed-form-fields').scrollTop = 0;
    document.querySelector('.feed-form-sheet').scrollTop = 0;
    UI.showModal('feedModalBackdrop', 'closeFeedModalBtn');
  };

  UI.openFeedFromReminder = function (log) {
    var item = MP.state.items.find(function (batch) { return batch.id === log.itemId; });
    var nursing = Domain.getCareType(log) === 'nursing';
    UI.openFeedModal(!nursing && item ? item.id : '', Utils.getTodayStr(), nursing || !item);
    if (nursing) {
      document.getElementById('feedForm').dataset.careType = 'nursing';
      document.getElementById('feedForm').dataset.nursingReminderManual = 'true';
      selectMealSlot('care');
      loadNursingFields(log);
    } else if (log.category === 'supp') {
      document.getElementById('feedForm').dataset.careType = 'supplement';
    }
    document.getElementById('feedForm').dataset.reminderSourceId = log.id;
    document.getElementById('feedCategorySelect').value = log.category;
    selectMealSlot('care');
    if (!item) {
      document.getElementById('feedBrandInput').value = log.brand;
      document.getElementById('feedNameInput').value = log.name;
    }
    document.getElementById('feedAmountInput').value = log.amount || '';
    setFeedReminderDays(log.reminderDays || Math.max(0, Utils.diffDaysBetween(log.date, log.nextDueDate)));
    UI.syncMedReminderVisibility();
  };

  UI.openEditFeedModal = function (logId) {
    var lg = MP.state.logs.find(function (x) { return x.id === logId; });
    if (!lg) return;
    manualFeedDrafts = Object.create(null);
    careAmountErrors = Object.create(null);
    var feedForm = document.getElementById('feedForm');
    feedForm.dataset.nursingReminderManual = 'true';
    delete feedForm.dataset.feedNoteOpen;
    delete feedForm.dataset.productEntry;
    delete feedForm.dataset.dailyEntry;
    feedForm.dataset.manualProduct = String(!lg.itemId);
    feedForm.dataset.unstocked = String(lg.unstocked === true && !lg.itemId);
    document.getElementById('feedManualFlavor').value = !lg.flavorId ? lg.flavorName || '' : '';
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel('pencil', '编辑每日记录', 20);
    document.getElementById('feedLogEditId').value = lg.id;
    document.getElementById('feedForm').dataset.careType = Domain.getCareType(lg) === 'nursing' ? 'nursing' :
      lg.category === 'supp' ? 'supplement' : 'medication';
    loadNursingFields(lg);
    document.getElementById('feedForm').classList.remove('feed-care-mode');
    delete document.getElementById('feedAmountInput').dataset.doseChoice;
    delete document.getElementById('feedAmountInput').dataset.automaticPortion;
    document.getElementById('feedMedicationOutcome').value = lg.medicationOutcome || '';
    document.getElementById('feedMedicationUsageMode').value = lg.medicationUsageMode || '';
    document.getElementById('feedCustomReminderDays').value = '';
    document.getElementById('feedDateInput').value = lg.date || Utils.getTodayStr();
    var linkedBatch = MP.state.items.find(function (item) { return item.id === lg.itemId; });
    selectMealSlot(linkedBatch && !MP.isFoodCategory(linkedBatch.category) ? 'care' : lg.mealSlot);
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
    delete document.getElementById('feedForm').dataset.reminderSourceId;
    setFeedReminderDays(lg.reminderDays);
    document.getElementById('feedDeductStock').checked = false;
    document.getElementById('feedDeductBox').classList.add('hidden-view');
    UI.syncMedReminderVisibility();
    UI.syncAllDateDisplays();
    document.querySelector('.feed-form-fields').scrollTop = 0;
    document.querySelector('.feed-form-sheet').scrollTop = 0;
    UI.showModal('feedModalBackdrop', 'closeFeedModalBtn');
  };

  UI.closeFeedModal = function () {
    UI.hideModal('feedModalBackdrop');
  };

  UI.openFlavorOpenModal = function (item) {
    var modal = document.getElementById('flavorOpenModalBackdrop');
    var list = document.getElementById('flavorOpenOptions');
    var shared = Domain.hasSharedSeal(item);
    var flavors = (item.flavors || []).filter(function (flavor) {
      return Number(flavor.quantity) > 0 && (shared ? !item.isOpened : !flavor.openedDate);
    });
    modal.dataset.itemId = item.id;
    list.innerHTML = flavors.map(function (flavor) {
      return '<label class="flavor-open-option"><input type="radio" name="menuOpenFlavor" value="' +
        Utils.escapeHtml(flavor.id) + '"><span><strong>' + Utils.escapeHtml(flavor.name) +
        '</strong><small>剩余 ' + Utils.escapeHtml(Utils.formatQuantity(flavor.quantity, item.unit || '件')) +
        '</small></span></label>';
    }).join('');
    UI.prepareOpenDatePicker(document.getElementById('flavorOpenDatePicker'), item, Utils.getTodayStr());
    document.getElementById('confirmFlavorOpenBtn').disabled = true;
    UI.showModal('flavorOpenModalBackdrop');
  };

  UI.closeFlavorOpenModal = function () {
    var modal = document.getElementById('flavorOpenModalBackdrop');
    modal.dataset.itemId = '';
    UI.hideModal('flavorOpenModalBackdrop');
  };

  // ==================== STOCK OPERATION HISTORY MODAL ====================
  UI.openStockHistoryModal = function (filterItemId, byProduct) {
    var st = MP.state;
    st.historyItemFilter = filterItemId || '';
    var item = byProduct && st.items.find(function (entry) { return entry.id === filterItemId; });
    st.historyProductFilter = item ? Domain.getProductGroupKey(item) : '';
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
      titleEl.innerHTML = Utils.iconLabel('scroll-text', refItem ? (st.historyProductFilter ? refItem.name + ' · 流水' : '流水 · ' + refItem.brand + ' ' + refItem.name) : '单品库存操作流水', 20);
      if (clearItemBtn) {
        clearItemBtn.textContent = st.historyProductFilter ? '查看全部流水' : '查看全部商品';
        clearItemBtn.classList.remove('hidden-view');
      }
    } else {
      titleEl.innerHTML = Utils.iconLabel('scroll-text', '库存操作历史流水', 20);
      if (clearItemBtn) clearItemBtn.classList.add('hidden-view');
    }

    var tBtns = document.querySelectorAll('#historyTypeFilterBar [data-hist-type]');
    for (var i = 0; i < tBtns.length; i++) {
      var tk = tBtns[i].getAttribute('data-hist-type');
      tBtns[i].classList.toggle('active', tk === st.historyTypeFilter);
    }

    var q = (st.historySearchQuery || '').trim().toLowerCase();
    var productIds = st.historyProductFilter ? new Set(st.items.filter(function (item) {
      return Domain.getProductGroupKey(item) === st.historyProductFilter;
    }).flatMap(function (item) { return [item.id, item.sourceBatchId].filter(Boolean); })) : null;
    var matched = st.stockHistory.filter(function (h) {
      if (productIds ? !productIds.has(h.itemId) : st.historyItemFilter && h.itemId !== st.historyItemFilter) return false;
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
    document.getElementById('historyCountBadge').textContent = '共 ' + Utils.formatQuantity(matched.length, '条记录');
    document.getElementById('historyRetentionNotice').textContent = '全部库存流水最多保留 ' +
      Utils.formatNumber(MP.MAX_STOCK_HISTORY) + ' 条，历史可能不完整，日用品估算仅供参考。';

    if (matched.length === 0) {
      if (pagerEl) pagerEl.classList.add('hidden-view');
      listEl.innerHTML =
        '<div style="padding:28px 12px;text-align:center;background:var(--control-bg);border-radius:14px;color:var(--text-muted);font-size:13px;">' +
          Utils.uiIcon('inbox', 20) + '暂无匹配的库存变动流水（后续入库、拆封、分顿投喂、核销吃完或撤回退库都会自动记录在这里）' +
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
      document.getElementById('historyPageInfo').textContent = '第 ' + Utils.formatNumber(st.historyPage) + ' / ' + Utils.formatQuantity(hPages, '页');
      document.getElementById('prevHistoryPageBtn').disabled = (st.historyPage <= 1);
      document.getElementById('nextHistoryPageBtn').disabled = (st.historyPage >= hPages);
    } else {
      pagerEl.classList.add('hidden-view');
    }

    listEl.innerHTML = sliced.map(function (h) {
      var meta = MP.STOCK_ACTION_META[h.action] || MP.STOCK_ACTION_META.adjust;
      var timestamp = h.timestamp;
      if (/^\d{4}-\d{2}-\d{2}/.test(timestamp) && timestamp.slice(0, 4) === Utils.getTodayStr().slice(0, 4)) {
        timestamp = timestamp.slice(5);
      }
      return (
        '<div style="padding:10px 12px;border-radius:12px;background:var(--control-bg);border:1px solid var(--border-warm);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
              '<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;background:' + meta.bg + ';color:' + meta.text + ';">' + Utils.iconLabel(meta.icon, meta.label) + '</span>' +
              '<span style="font-size:11px;color:var(--text-muted);">' + Utils.escapeHtml(timestamp) + '</span>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:800;color:var(--text-main);">' + Utils.getCategoryIcon(h.category) + ' [' + Utils.escapeHtml(h.brand) + '] ' + Utils.escapeHtml(h.name) + '</div>' +
            (h.note ? '<div style="margin-top:2px;font-size:11.5px;color:var(--text-muted);">' + Utils.escapeHtml(Utils.formatStockHistoryNote(h.action, h.note)) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="font-size:12.5px;font-weight:800;color:' + meta.text + ';">' + Utils.escapeHtml(h.deltaText || '—') + '</div>' +
            '<div style="margin-top:2px;font-size:11px;color:var(--text-muted);">' + Utils.formatNumber(h.beforeQty) + ' → ' + Utils.escapeHtml(Utils.formatQuantity(h.afterQty, h.unit)) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  };

  // ==================== ITEM ADD / EDIT / RESTOCK MODAL ====================
  UI.renderQuickLocationChips = function () {
    var current = document.getElementById('fieldLocation').value.trim();
    var supplies = MP.state.formCat === 'supplies';
    var locations = MP.state.items.filter(function (item) {
      return !supplies || item.category === 'supplies';
    }).map(function (item) { return (item.location || '').trim(); });
    var chips = Array.from(new Set(locations.concat(supplies ? [] : MP.COMMON_LOCATIONS))).filter(function (loc) {
      return loc && loc !== current;
    });
    var box = document.getElementById('quickLocationChips');
    box.innerHTML = chips.map(function (loc) {
      return '<button type="button" data-pick-location="' + Utils.escapeHtml(loc) + '">' + Utils.escapeHtml(loc) + '</button>';
    }).join('');
    box.parentElement.classList.toggle('hidden-view', supplies && !chips.length);
    UI.syncQuickLocationFade();
  };

  UI.syncQuickLocationFade = function () {
    var box = document.getElementById('quickLocationChips');
    box.parentElement.classList.toggle('has-more', box.scrollWidth - box.clientWidth - box.scrollLeft > 1);

  };

  UI.renderQuickBrandChips = function () {
    UI.syncLocationSuggestion();
    var current = document.getElementById('fieldBrand').value.trim();
    var existing = {};
    var merged = [];
    MP.state.items.forEach(function (it) {
      if (MP.state.formCat === 'supplies' && it.category !== 'supplies') return;
      if (it.brand && it.brand.trim() && !existing[it.brand.trim()]) {
        existing[it.brand.trim()] = true;
        merged.push(it.brand.trim());
      }
    });
    (MP.state.formCat === 'supplies' ? [] : MP.COMMON_BRANDS).forEach(function (b) {
      if (!existing[b]) {
        existing[b] = true;
        merged.push(b);
      }
    });
    var box = document.getElementById('quickBrandChips');
    var visibleBrands = merged.filter(function (brand) { return brand !== current; }).slice(0, 10);
    box.innerHTML = visibleBrands.map(function (b) {
      return '<button type="button" data-pick-brand="' + Utils.escapeHtml(b) + '" style="white-space:nowrap;padding:4px 9px;border-radius:999px;border:1px solid var(--border-warm);background:var(--control-bg);color:var(--text-muted);font-size:11px;cursor:pointer;">' + Utils.escapeHtml(b) + '</button>';
    }).join('');
    box.classList.toggle('hidden-view', !visibleBrands.length);
    UI.syncQuickBrandFade();
  };

  UI.syncQuickBrandFade = function () {
    var box = document.getElementById('quickBrandChips');
    box.parentElement.classList.toggle('has-more', box.scrollWidth - box.clientWidth - box.scrollLeft > 1);
  };

  UI.scrollModalCategoryIntoView = function () {
    var strip = document.getElementById('modalCatSelector');
    var selected = document.querySelector('#modalCatSelector [data-form-cat].active');
    if (!strip || !selected) return;
    var left = selected.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    var target = left + selected.offsetWidth / 2 - strip.clientWidth / 2;
    target = Math.max(0, Math.min(target, Math.max(0, strip.scrollWidth - strip.clientWidth)));
    if (typeof strip.scrollTo === 'function') strip.scrollTo({ left: target, behavior: 'auto' });
    else strip.scrollLeft = target;
    UI.syncModalCategoryFade();
  };

  UI.syncModalCategoryFade = function () {
    var strip = document.getElementById('modalCatSelector');
    strip.parentElement.classList.toggle('has-before', strip.scrollLeft > 1);
    strip.parentElement.classList.toggle('has-more', strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1);
  };

  UI.resetFormPhotos = function (images) {
    MP.state.photoUploadToken++;
    MP.state.photoUploadPending = false;
    MP.state.formImages = (images || []).slice();
    UI.syncModalPhotoUI();
  };

  UI.itemPhotoCountBadge = function (item) {
    var count = MP.getItemImages(item).length;
    return count > 1 ? '<span class="item-photo-count" aria-label="' + count + ' 张照片">' +
      Utils.uiIcon('camera') + '<span>' + count + '</span></span>' : '';
  };

  UI.syncModalPhotoUI = function () {
    var st = MP.state;
    var images = st.formImages;
    var disabled = st.photoUploadPending ? ' disabled' : '';
    document.getElementById('formPhotoPreview').src = MP.getItemCoverSrc({ category: st.formCat, images: images });
    document.getElementById('formPhotoCount').textContent = images.length + '/' + MP.MAX_ITEM_IMAGES;
    document.getElementById('formPhotoThumbs').innerHTML = images.map(function (src, index) {
      return '<div class="stock-photo-thumb' + (index === 0 ? ' is-cover' : '') + '">' +
        '<button type="button" data-photo-cover="' + index + '" aria-label="' +
        (index === 0 ? '当前封面，第 1 张照片' : '将第 ' + (index + 1) + ' 张照片设为封面') +
        '" aria-pressed="' + (index === 0) + '"' + disabled + '><img src="' + Utils.escapeHtml(src) + '" alt="商品照片 ' + (index + 1) + '">' +
        (index === 0 ? '<span class="stock-photo-cover-label">封面</span>' : '') + '</button>' +
        '<button type="button" class="stock-photo-remove" data-photo-remove="' + index +
        '" aria-label="删除第 ' + (index + 1) + ' 张照片"' + disabled + '>✕</button></div>';
    }).join('');
    document.getElementById('pickPhotoBtn').disabled = st.photoUploadPending || images.length >= MP.MAX_ITEM_IMAGES;
    document.getElementById('saveItemBtn').disabled = st.photoUploadPending;
    document.getElementById('photoCompressHint').textContent = st.photoUploadPending ? '正在压缩照片，请稍候…' :
      images.length ? '首张为封面 · 点击缩略图可更换' : '使用默认插画';
  };

  // Distinct palatability/tolerance labels for Ordinary Food vs Supplements vs Medicine!
  var subtypeDraft = {};
  var manualItemUnit = false;
  var usageDrafts = {};
  var usageDraftKey = null;
  var itemFormSource = null;

  function resetSubtypeForm(item, editing) {
    subtypeDraft = {};
    usageDrafts = {};
    usageDraftKey = null;
    itemFormSource = item || null;
    manualItemUnit = Boolean(item);
    if (!item || !item.subtype) return;
    if (MP.FOOD_SUBTYPES[item.category]) subtypeDraft[item.category] = item.subtype;
  }

  function syncItemSubtype(catKey) {
    var config = MP.FOOD_SUBTYPES[catKey];
    var field = document.getElementById('fieldSubtype');
    var custom = document.getElementById('fieldSubtypeCustom');
    var editing = Boolean(document.getElementById('fieldId').value);
    document.getElementById('itemSubtypeWrap').classList.toggle('hidden-view', !config || Boolean(config.hidden));
    field.disabled = !config;
    field.required = Boolean(config && !config.optional && !editing);
    field.options.length = 0;
    custom.classList.add('hidden-view');
    custom.disabled = true;
    if (!config) return;
    document.getElementById('itemSubtypeLabel').textContent = config.label;
    field.add(new Option(editing ? '未指定' : '请选择' + config.label, ''));
    config.options.forEach(function (option) { field.add(new Option(option, option)); });
    if (config.custom) field.add(new Option('自定义…', '__custom__'));
    var value = subtypeDraft[catKey] ?? (!editing && !config.innerUnits && !config.optional ? config.options[0] : '');
    if (value && !config.options.includes(value)) {
      if (config.custom) {
        custom.value = value;
        value = '__custom__';
      } else field.add(new Option(value + '（历史）', value));
    }
    field.value = value;
    custom.classList.toggle('hidden-view', value !== '__custom__');
    custom.disabled = value !== '__custom__';
  }

  var formEffectTags = [];
  UI.resetFormEffectTags = function (item) {
    formEffectTags = item && Array.isArray(item.effectTags) ? item.effectTags.slice() : [];
    document.getElementById('fieldEffectCustom').value = '';
    document.getElementById('stockEffectCustom').classList.add('hidden-view');
    document.getElementById('fieldSpec').dataset.noteMigrated = String(Boolean(item && item.legacySpecInNotes));
  };
  UI.getFormEffectTags = function () { return formEffectTags.slice(); };
  UI.renderFormEffectTags = function () {
    var config = MP.EFFECT_TAG_PRESETS[MP.state.formCat];
    var subtype = document.getElementById('fieldSubtype').value;
    var presets = config ? (config[subtype] || config.default) : [];
    var container = document.getElementById('stockEffectTags');
    container.replaceChildren();
    Array.from(new Set(presets.concat(formEffectTags))).forEach(function (tag) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill-chip';
      button.dataset.effectTag = tag;
      button.setAttribute('aria-pressed', String(formEffectTags.includes(tag)));
      button.textContent = tag;
      container.appendChild(button);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'pill-chip';
    add.dataset.effectCustom = '1';
    add.textContent = '+ 自定义';
    container.appendChild(add);
  };
  UI.toggleFormEffectTag = function (tag) {
    var index = formEffectTags.indexOf(tag);
    if (index < 0) formEffectTags.push(tag);
    else formEffectTags.splice(index, 1);
    UI.renderFormEffectTags();
  };
  UI.addFormEffectTag = function () {
    var input = document.getElementById('fieldEffectCustom');
    var tag = input.value.trim();
    if (!tag) { UI.showToast('请输入功效标签'); input.focus(); return; }
    if (!formEffectTags.includes(tag)) formEffectTags.push(tag);
    input.value = '';
    document.getElementById('stockEffectCustom').classList.add('hidden-view');
    UI.renderFormEffectTags();
  };

  UI.syncItemUsageConfig = function () {
    var category = MP.state.formCat;
    var subtype = document.getElementById('fieldSubtype').value;
    var key = category + ':' + subtype;
    var unitField = document.getElementById('fieldUsageUnit');
    var amount = document.getElementById('fieldUsagePerItem');
    var changed = usageDraftKey !== key;
    if (changed) {
      if (usageDraftKey !== null) {
        usageDrafts[usageDraftKey] = { unit: unitField.value, amount: amount.value };
        var saved = usageDrafts[key] || { unit: '', amount: '' };
        unitField.value = saved.unit;
        amount.value = saved.amount;
      }
      usageDraftKey = key;
    }

    var rule = MP.ITEM_FORM_RULES[category]?.[subtype] || {};
    var fixedUnit = rule.feedUnit || '';
    var liquid = Boolean(rule.selectLiquidUnit);
    var stockUnit = document.getElementById('fieldUnit').value || '件';
    var legacyStick = category === 'treat' && fixedUnit === '支' && itemFormSource?.unit !== '支' &&
      itemFormSource && itemFormSource.category === category && itemFormSource.subtype === subtype;
    var conflictingRatio = Boolean(amount.value && unitField.value === stockUnit && Number(amount.value) !== 1);
    var hidden = ['dry', 'can', 'supplies'].includes(category) ||
      (rule.conversionLayout === 'none' && !legacyStick && !conflictingRatio) ||
      (!subtype && !unitField.value && !amount.value);
    var legacyUnit = Boolean(unitField.value && ((fixedUnit && unitField.value !== fixedUnit) ||
      (liquid && !['滴', 'ml'].includes(unitField.value))));
    var inline = rule.conversionLayout === 'inline' || Boolean(legacyStick) || conflictingRatio;
    var details = document.getElementById('stockUsageConfig');
    if (changed) details.open = false;
    details.classList.toggle('hidden-view', hidden);
    details.classList.toggle('stock-usage-inline', inline);
    document.getElementById('stockUsageSummary').classList.toggle('hidden-view', inline);
    if (inline) details.open = true;
    if (fixedUnit && !legacyUnit) unitField.value = fixedUnit;
    Array.from(unitField.options).forEach(function (option) {
      option.hidden = Boolean(liquid && option.value && !['滴', 'ml', unitField.value].includes(option.value));
    });
    unitField.options[0].textContent = liquid ? '请选择滴或毫升' : '使用默认单位';
    unitField.dataset.syncedUnit = unitField.value;
    document.getElementById('stockUsageUnitField').classList.toggle('hidden-view', Boolean(fixedUnit && !legacyUnit));
    var usageUnit = unitField.value;
    document.getElementById('stockUsageStatus').textContent =
      usageUnit && Number(amount.value) > 0 ? '每' + stockUnit + ' ' + amount.value + ' ' + usageUnit : '未设置';
    document.getElementById('stockUsageAmountLabel').textContent =
      '每' + stockUnit + '含几' + (usageUnit || '个使用单位');
    document.getElementById('stockUsageHelp').textContent = legacyUnit
      ? '沿用原有换算单位；如需更改，请确认换算数量。'
      : conflictingRatio ? '库存单位与投喂单位相同，请清空换算数量或改为 1。'
      : legacyStick ? '旧商品按' + itemFormSource.unit + '入库，可核对原有换算数量。'
      : rule.help ? rule.help
      : usageUnit && usageUnit === stockUnit
        ? '库存单位与投喂单位相同，按 1 ' + stockUnit + '计算，无需填写。'
        : '未填写换算时仅记录，不按该单位扣库存。';
  };

  function configuredInnerUnit(category) {
    var units = MP.FOOD_SUBTYPES[category]?.innerUnits;
    var subtype = document.getElementById('fieldSubtype').value;
    return units && Object.hasOwn(units, subtype) ? units[subtype] : '';
  }

  UI.syncItemUnits = function (resetUnit) {
    var category = MP.state.formCat;
    var subtype = document.getElementById('fieldSubtype').value;
    var rule = MP.ITEM_FORM_RULES[category]?.[subtype] || {};
    var field = document.getElementById('fieldUnit');
    var current = field.value;
    var enabled = document.getElementById('fieldPackagingEnabled').checked;
    var outer = document.getElementById('fieldPackOuterUnit').value;
    var units = (rule.units || MP.ITEM_FORM_DEFAULTS.units).filter(function (unit) {
      return !enabled || unit !== outer;
    });
    var editing = Boolean(document.getElementById('fieldId').value);
    var original = itemFormSource && itemFormSource.category === category &&
      (editing || subtype === itemFormSource.subtype) && current === itemFormSource.unit;
    var selected = resetUnit ? (rule.defaultUnit || MP.CATEGORIES[category].defaultUnit) : current;
    var unchangedDuplicate = editing && itemFormSource?.purchasePackaging?.outerUnit === selected;
    var mayKeep = (editing || original) && (!enabled || selected !== outer || unchangedDuplicate);
    if (selected && !units.includes(selected) && mayKeep && !resetUnit) {
      units.push(selected);
    }
    if (!units.includes(selected)) selected = units[0] || '';
    field.replaceChildren();
    units.forEach(function (unit) {
      var historical = !((rule.units || MP.ITEM_FORM_DEFAULTS.units).includes(unit)) || (enabled && unit === outer);
      var option = new Option(unit + (historical ? '（历史）' : ''), unit);
      if (historical) option.dataset.historicalUnit = 'true';
      field.add(option);
    });
    field.value = selected;
    if (category === 'can' && !subtype && !itemFormSource) field.value = '';
    if (field.value !== current) {
      document.getElementById('fieldNetWeightLabel').textContent = category === 'supplies'
        ? '每份规格' : (field.value ? '每' + field.value + '净含量' : '每件净含量');
    }
  };

  UI.updateItemSubtype = function () {
    var catKey = MP.state.formCat;
    var field = document.getElementById('fieldSubtype');
    var custom = document.getElementById('fieldSubtypeCustom');
    custom.classList.toggle('hidden-view', field.value !== '__custom__');
    custom.disabled = field.value !== '__custom__';
    subtypeDraft[catKey] = field.value === '__custom__' ? custom.value.trim() : field.value;
    UI.syncItemUnits(!document.getElementById('fieldId').value);
    UI.syncItemUsageConfig();
    UI.renderFormEffectTags();
    UI.syncNetWeightUnitOptions();
    UI.syncNetWeight();
    renderStockWeightPresets(MP.state.formCat);
    UI.syncStockRequiredProgress();
  };

  UI.markItemUnitManual = function () {
    manualItemUnit = true;
    UI.syncUnitChangeHints();
  };

  UI.syncUnitChangeHints = function () {
    var unit = document.getElementById('fieldUnit');
    var id = document.getElementById('fieldId').value;
    var item = id && MP.state.items.find(function (entry) { return entry.id === id; });
    var changed = Boolean(item && !item.sourceBatchId && unit.value && unit.value !== item.unit);
    var hint = document.getElementById('unitChangeHint');
    hint.textContent = changed ? '单位已由 ' + item.unit + ' 改为 ' + unit.value + '：数量 ' +
      Utils.formatNumber(Number(item.quantity) || 0) + ' 不变，请确认' +
      (item.category === 'supplies' ? '每份规格。' : '每' + unit.value + '净含量。') : '';
    hint.classList.toggle('hidden-view', !hint.textContent);
  };

  function findFormProduct(predicate, useEnteredWeight) {
    var product = { category: MP.state.formCat };
    [['brand', 'fieldBrand'], ['name', 'fieldName'], ['spec', 'fieldSpec'], ['unit', 'fieldUnit']].forEach(function (pair) {
      product[pair[0]] = document.getElementById(pair[1]).value.trim();
    });
    if (!product.brand || !product.name) return null;
    var weight = useEnteredWeight ? Number(document.getElementById('fieldNetWeight').value) : 0;
    if (weight > 0 && (MP.state.formCat === 'supplies' ||
        (['supp', 'med'].includes(MP.state.formCat) && document.getElementById('fieldNetWeightUnit').value === '毫升'))) {
      product.unit_spec_value = weight;
      product.unit_spec_unit = document.getElementById('fieldNetWeightUnit').value;
    } else if (weight > 0) product.unit_net_weight_g = MP.state.formCat === 'med' &&
      document.getElementById('fieldNetWeightUnit').value === '毫克' ? weight / 1000 : weight;
    var key = Domain.getProductGroupKey(product);
    var matches = MP.state.items.filter(function (item) {
      var match = weight > 0 ? item : Object.assign({}, item, {
        unit_net_weight_g: null, unit_spec_value: null, unit_spec_unit: ''
      });
      return predicate(item) && Domain.getProductGroupKey(match) === key;
    });
    if (!weight && ['supplies', 'supp', 'med'].includes(MP.state.formCat) && matches.some(function (item) {
      return Domain.getProductGroupKey(item) !== Domain.getProductGroupKey(matches[0]);
    })) return null;
    return matches[0] || null;
  }

  function renderStockWeightPresets(category) {
    if (category === 'supplies') {
      var unitSelect = document.getElementById('fieldNetWeightUnit');
      var currentUnit = unitSelect.value;
      unitSelect.replaceChildren.apply(unitSelect, MP.SUPPLY_SPEC_UNITS.map(function (unit) {
        return new Option(unit, unit);
      }));
      unitSelect.value = MP.SUPPLY_SPEC_UNITS.includes(currentUnit) ? currentUnit : '克';
      delete unitSelect.dataset.legacyUnit;
      document.getElementById('stockWeightPresetLabel').textContent = '常用单位';
      document.getElementById('stockWeightPresets').classList.remove('hidden-view');
      document.getElementById('stockWeightPresetOptions').innerHTML = MP.SUPPLY_SPEC_UNITS.map(function (unit) {
        return '<button type="button" data-spec-unit="' + unit + '" class="pill-chip">' + unit + '</button>';
      }).join('');
      return;
    }
    document.getElementById('stockWeightPresetLabel').textContent = '常用规格';
    if (['supp', 'med'].includes(category) && document.getElementById('fieldNetWeightUnit').value !== '克') {
      document.getElementById('stockWeightPresets').classList.add('hidden-view');
      document.getElementById('stockWeightPresetOptions').replaceChildren();
      return;
    }
    var weights = MP.STOCK_WEIGHT_PRESETS[category] || [];
    document.getElementById('stockWeightPresets').classList.toggle('hidden-view', !weights.length);
    document.getElementById('stockWeightPresetOptions').innerHTML = weights.map(function (grams) {
      return '<button type="button" data-preset-grams="' + grams + '" class="pill-chip">' +
        (grams >= 1000 ? Utils.formatNumber(grams / 1000) + '千克' : grams + '克') + '</button>';
    }).join('');
  }

  UI.refreshNetWeightPresets = function () {
    renderStockWeightPresets(MP.state.formCat);
  };

  UI.syncNetWeightUnitOptions = function () {
    var category = MP.state.formCat;
    if (!['supp', 'med'].includes(category)) return;
    var select = document.getElementById('fieldNetWeightUnit');
    var previous = select.value;
    var units = category === 'med' ? ['克', '毫升', '毫克'] : ['克', '毫升'];
    var desired = select.dataset.manualSpecUnit && units.includes(previous) ? previous :
      ((category === 'supp' && document.getElementById('fieldSubtype').value === '液体') ||
       (category === 'med' && document.getElementById('fieldSubtype').value === '滴剂/液体') ? '毫升' : '克');
    if (previous && units.includes(previous) && previous !== desired &&
        document.getElementById('fieldNetWeight').value) {
      document.getElementById('fieldNetWeight').value = '';
      UI.showToast('规格单位已更改，请重新填写净含量');
    }
    select.replaceChildren.apply(select, units.map(function (unit) { return new Option(unit, unit); }));
    select.value = desired;
  };

  function setSupplySpecUnit(unit) {
    var select = document.getElementById('fieldNetWeightUnit');
    var value = unit || '克';
    var legacy = !MP.SUPPLY_SPEC_UNITS.includes(value);
    if (legacy) select.add(new Option(value + '（旧单位，请选择容量单位）', value));
    select.value = value;
    select.dataset.legacyUnit = legacy ? '1' : '';
    return legacy;
  }

  function syncStockWeightPresets() {
    var weight = Number(document.getElementById('fieldNetWeight').value);
    document.querySelectorAll('#stockWeightPresetOptions button').forEach(function (button) {
      var active = button.dataset.specUnit
        ? button.dataset.specUnit === document.getElementById('fieldNetWeightUnit').value
        : weight === Number(button.dataset.presetGrams);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  UI.syncNetWeight = function (resetValue) {
    var input = document.getElementById('fieldNetWeight');
    var category = MP.state.formCat;
    var wet = category === 'can';
    var supplies = category === 'supplies';
    var specChoice = supplies || ['supp', 'med'].includes(category);
    var id = document.getElementById('fieldId').value;
    var required = Utils.requiresUnitWeight(category) || (!id && category === 'med');
    var unit = document.getElementById('fieldUnit').value;
    document.getElementById('netWeightUnit').textContent = MP.ITEM_FORM_DEFAULTS.netWeightUnit;
    document.getElementById('itemModalBackdrop').classList.toggle('is-editing-item', Boolean(id));
    document.getElementById('fieldNetWeightLabel').textContent = supplies ? '每份规格' : (unit ? '每' + unit + '净含量' : '每件净含量');
    document.getElementById('netWeightUnit').classList.toggle('hidden-view', specChoice);
    document.getElementById('fieldNetWeightUnit').classList.toggle('hidden-view', !specChoice);
    UI.syncUnitChangeHints();
    var subtype = document.getElementById('fieldSubtype').value;
    input.required = required;
    document.getElementById('netWeightRequired').classList.toggle('hidden-view', !required);
    document.getElementById('netWeightField').classList.remove('hidden-view');
    document.getElementById('itemPackageWeight').classList.remove('hidden-view');
    input.placeholder = wet ? (subtype === '餐包' ? '40 / 50' : '85 / 170')
      : ({ dry: '1500', freeze: '100', treat: '15', supp: '60', med: '1', supplies: '6' })[category] || '';
    if (resetValue) {
      input.value = '';
      delete input.dataset.manualWeight;
      delete document.getElementById('fieldNetWeightUnit').dataset.manualSpecUnit;
    }
    if (id || input.dataset.manualWeight) return;
    var specUnit = document.getElementById('fieldNetWeightUnit');
    var match = findFormProduct(function (item) {
      return (supplies || (specChoice && specUnit.value === '毫升'))
        ? Number(item.unit_spec_value) > 0 && MP.SUPPLY_SPEC_UNITS.includes(item.unit_spec_unit) &&
          (!specUnit.dataset.manualSpecUnit || specUnit.value === item.unit_spec_unit)
        : item.unit_net_weight_g > 0;
    });
    input.value = match ? ((supplies || (specChoice && specUnit.value === '毫升')) ? match.unit_spec_value :
      (category === 'med' && specUnit.value === '毫克' ? match.unit_net_weight_g * 1000 : match.unit_net_weight_g)) : '';
    if (supplies && match && !specUnit.dataset.manualSpecUnit) specUnit.value = match.unit_spec_unit;
    if (supplies) syncStockWeightPresets();
  };

  UI.setProductionDatePending = function (pending) {
    var input = document.getElementById('fieldProdDate');
    input.closest('.ios-date-wrap').classList.toggle('stock-form-date-pending', pending);
    document.getElementById('productionDatePending').classList.toggle('hidden-view', !pending);
  };

  UI.confirmProductionDate = function () {
    document.getElementById('fieldProdDate').dataset.confirmed = '1';
    UI.setProductionDatePending(false);
  };

  UI.suggestProductionDate = function () {
    var input = document.getElementById('fieldProdDate');
    var expiry = document.getElementById('fieldExpDate');
    if (MP.state.formCat === 'supplies') {
      if (!document.getElementById('fieldId').value) {
        input.value = '';
        expiry.value = '';
      }
      UI.syncAllDateDisplays();
      return;
    }
    if (document.getElementById('fieldId').value || document.getElementById('stockDateMode').dataset.mode === 'expiry' || input.dataset.confirmed ||
        (expiry.value && expiry.value !== expiry.dataset.computed)) return;
    var match = findFormProduct(function (item) { return Boolean(item.prodDate); }, true);
    input.value = match ? match.prodDate : '';
    UI.setProductionDatePending(Boolean(input.value));
    if (input.value) UI.autoComputeExpDate();
    else if (expiry.value === expiry.dataset.computed) expiry.value = '';
    UI.renderStockDateEstimate();
    UI.syncAllDateDisplays();
  };

  UI.findSimilarLocation = function (location) {
    if (location.length < 2) return '';
    var existing = MP.state.items.map(function (item) { return (item.location || '').trim(); }).filter(Boolean);
    if (existing.includes(location)) return '';
    return existing.find(function (value) {
      var difference = Math.abs(location.length - value.length);
      return difference <= 2 && Math.min(location.length, value.length) >= 2 &&
        (value.includes(location) || location.includes(value));
    }) || '';
  };

  UI.syncLocationSuggestion = function () {
    UI.renderQuickLocationChips();
    var location = document.getElementById('fieldLocation').value.trim();
    var hint = document.getElementById('locationSuggestion');
    hint.replaceChildren();
    var similar = UI.findSimilarLocation(location);
    if (!similar) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'stock-form-link';
    button.dataset.pickLocation = similar;
    button.textContent = '使用「' + similar + '」';
    hint.append('相似位置：', button);
  };

  UI.syncModalCategoryUI = function (catKey, applyDefaults) {
    var st = MP.state;
    if (applyDefaults && st.formCat !== catKey) {
      manualItemUnit = false;
      delete document.getElementById('fieldNetWeightUnit').dataset.manualSpecUnit;
    }
    st.formCat = catKey;
    var catInfo = MP.CATEGORIES[catKey] || MP.CATEGORIES.dry;
    var supplies = catKey === 'supplies';
    var form = document.getElementById('itemForm');
    form.classList.toggle('stock-form-supplies', supplies);
    var dates = document.getElementById('stockFormDates');
    var more = document.getElementById('stockFormMore');
    var moreBody = more.querySelector('.stock-form-more-body');
    if (supplies && dates.parentElement !== moreBody) moreBody.prepend(dates);
    if (!supplies && dates.parentElement === moreBody) more.before(dates);
    document.getElementById('stockDateRequired').classList.toggle('hidden-view', supplies);
    document.getElementById('stockDateHint').classList.toggle('hidden-view', supplies);
    document.getElementById('stockDateHeading').classList.remove('hidden-view');
    document.getElementById('shelfPresetsBar').classList.remove('hidden-view');
    document.getElementById('openLimitColWrap').classList.remove('hidden-view');
    document.getElementById('stockPackagingSupplementField').classList.toggle('hidden-view', !supplies);
    document.getElementById('stockEffectTagsField').classList.toggle('hidden-view', supplies);
    document.getElementById('fieldSpecLabel').textContent = supplies ? '款式补充' : '包装补充';
    document.getElementById('fieldSpec').placeholder = supplies ? '如：无香 / 绿茶香' : '如：每袋独立密封';
    document.getElementById('fieldSpecHelp').textContent = supplies
      ? '款式不同请分别填写；同款请保持一致。' : '补充包装版本或密封方式。';
    document.getElementById('fieldNotes').placeholder = supplies
      ? '如：吸水性好、粉尘少、需要搭配垃圾袋'
      : '如：需兑温水骗水、换粮7日过渡用...';
    document.querySelector('#stockPurchasePackaging > .purchase-packaging-toggle').classList.toggle('hidden-view', supplies);
    if (supplies) {
      document.getElementById('fieldPackagingEnabled').checked = false;
      document.getElementById('stockFormMore').querySelector('.stock-form-more-hint').textContent = '日期 · 位置 · 渠道 · 备注';
    } else {
      document.getElementById('stockFormMore').querySelector('.stock-form-more-hint').textContent = '适口性 · 位置 · 渠道 · 备注';
    }
    var btns = document.querySelectorAll('#modalCatSelector [data-form-cat]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-form-cat') === catKey);
    }
    if (applyDefaults) {
      var unitField = document.getElementById('fieldUnit');
      if (!manualItemUnit && !MP.FOOD_SUBTYPES[catKey]?.innerUnits) unitField.value = catInfo.defaultUnit;
      var openLimit = document.getElementById('fieldOpenLimit');
      var shelfValue = document.getElementById('fieldShelfValue');
      var shelfUnit = document.getElementById('fieldShelfUnit');
      if (!openLimit.dataset.custom) openLimit.value = catKey === 'med' || supplies ? '' : String(catInfo.defaultOpenDays);
      if (!shelfValue.dataset.custom) {
        shelfValue.value = supplies ? '' : String(catInfo.defaultShelfMonths);
        shelfUnit.value = 'months';
      }
      if (supplies) {
        resetFormProductionDate('');
        document.getElementById('fieldExpDate').value = '';
        document.getElementById('fieldExpDate').dataset.lastValid = '';
      }
    }
    var nameExamples = { dry: '鸡肉无谷配方', can: '鸡肉主食罐', freeze: '冻干鸡胸肉', treat: '金枪鱼猫条', supp: '益生菌', med: '大宠爱外驱', supplies: '豆腐猫砂 / 宠物湿巾' };
    document.getElementById('fieldName').placeholder = '如：' + (nameExamples[catKey] || nameExamples.dry);
    var presetMonths = catKey === 'dry' ? [12, 18, 21, 24] : catKey === 'can' ? [24, 36] : [12, 24, 36];
    document.getElementById('stockShelfPresetOptions').innerHTML = presetMonths.map(function (months) {
      return '<button type="button" data-preset-months="' + months + '" class="pill-chip">' + months + '个月</button>';
    }).join('');
    UI.selectStockDateMode(document.getElementById('stockDateMode').dataset.mode || 'production');
    UI.renderStockDateEstimate();
    syncItemSubtype(catKey);
    UI.renderFormEffectTags();
    UI.syncItemUnits(Boolean(applyDefaults));
    UI.syncItemUsageConfig();
    UI.syncNetWeightUnitOptions();
    renderStockWeightPresets(catKey);
    var palatabilityField = document.getElementById('palatabilityFieldWrap');
    palatabilityField.classList.toggle('hidden-view', supplies);
    palatabilityField.toggleAttribute('hidden', supplies);
    if (supplies) document.getElementById('stockFlavorRatingSection').classList.add('hidden-view');
    UI.syncModalPhotoUI();

    var palTitle = document.getElementById('palatabilityFieldTitle');
    var bLove = document.getElementById('palBtnLove');
    var bOk = document.getElementById('palBtnOk');
    var bCoax = document.getElementById('palBtnCoax');
    var bMeh = document.getElementById('palBtnMeh');
    if (catKey === 'med') {
      if (palTitle) palTitle.innerHTML = Utils.getCategoryIcon('med', 20) + ' 给药反应与耐受度记录';
      if (bLove) bLove.innerHTML = Utils.formatMedicationOutcome('smooth');
      if (bOk) bOk.innerHTML = Utils.formatMedicationOutcome('coaxed');
      if (bCoax) bCoax.innerHTML = Utils.formatMedicationOutcome('resisted');
      if (bMeh) bMeh.innerHTML = Utils.formatMedicationOutcome('vomited');
    } else if (catKey === 'supp') {
      if (palTitle) palTitle.innerHTML = Utils.getCategoryIcon('supp', 20) + ' 营养品接受度反馈';
      if (bLove) bLove.innerHTML = Utils.getPalatabilityIcon('love') + ' 主动吃';
      if (bOk) bOk.innerHTML = Utils.getPalatabilityIcon('ok') + ' 拌粮吃';
      if (bCoax) bCoax.innerHTML = Utils.getPalatabilityIcon('coax') + ' 需哄喂';
      if (bMeh) bMeh.innerHTML = Utils.getPalatabilityIcon('meh') + ' 拒食';
    } else {
      if (palTitle) palTitle.textContent = '猫咪适口性';
      if (bLove) bLove.innerHTML = Utils.getPalatabilityIcon('love') + ' 超爱';
      if (bOk) bOk.innerHTML = Utils.getPalatabilityIcon('ok') + ' 正常';
      if (bCoax) bCoax.innerHTML = Utils.getPalatabilityIcon('coax') + ' 需哄';
      if (bMeh) bMeh.innerHTML = Utils.getPalatabilityIcon('meh') + ' 不吃';
    }
    UI.syncPurchasePackaging();
    UI.syncModalUnitPriceHint();
  };

  var flavorRatingOptions = { '': '未测', love: '超爱', ok: '正常', coax: '需哄', meh: '不吃' };

  function flavorRatingContent(key) {
    var icon = key ? Utils.getPalatabilityIcon(key)
      : Utils.getPalatabilityIcon('unrated');
    return icon + '<span>' + flavorRatingOptions[key] + '</span>';
  }

  var flavorRowSequence = 0;
  var flavorRatingFields = new WeakMap();
  var flavorColors = ['--flavor-orange', '--flavor-green', '--flavor-blue', '--flavor-purple', '--flavor-gold'];

  function flavorNamedColor(name) {
    if (/蓝莓|蓝|blue/i.test(name)) return '--flavor-blue';
    if (/紫|purple/i.test(name)) return '--flavor-purple';
    if (/草莓|红|red/i.test(name)) return '--status-danger-progress';
    if (/绿|green/i.test(name)) return '--flavor-green';
    if (/黄|金色|yellow/i.test(name)) return '--flavor-gold';
    if (/橙|orange/i.test(name)) return '--flavor-orange';
    return '';
  }

  UI.addFlavorRow = function (flavor, editing, pack, locked) {
    var entry = flavor || {};
    var opened = Boolean(entry.openedDate && entry.quantity > 0);
    var row = document.createElement('div');
    row.className = 'flavor-row';
    var id = entry.id;
    while (!id || (!entry.id && flavorRows().some(function (existing) { return existing.dataset.flavorId === id; }))) {
      id = 'flavor-' + (++flavorRowSequence);
    }
    row.dataset.flavorId = id;
    row.dataset.legacySpec = entry.spec || '';
    var initial = editing ? entry.quantity - Number(opened) : entry.perPack * pack?.count || 0;
    var percent = opened ? Utils.round2((entry.openRemainFraction || 1) * 100) : 0;
    row.dataset.initialCount = initial;
    row.dataset.initialPercent = percent;
    if (editing) {
      row.dataset.capacity = entry.perPack * pack.count;
      row.dataset.packSize = pack.size;
    }
    row.innerHTML =
      '<i class="flavor-dot" aria-hidden="true"></i>' +
      '<div class="flavor-name-field">' +
        '<input class="ios-input stock-flavor-name" data-flavor-name aria-label="口味名称" placeholder="口味名称">' +
        (editing ? '<span class="stock-flavor-name" data-flavor-name-display></span>' : '<button type="button" class="stock-flavor-name" data-flavor-name-display></button>') +
      '</div>' +
      '<div class="flavor-quantity">' + (editing ? '<span>余</span>' : '') + '<div class="flavor-stepper">' +
        '<button type="button" data-flavor-step="-1" aria-label="减少一件">−</button>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-flavor-count aria-label="口味数量">' +
        '<button type="button" data-flavor-step="1" aria-label="增加一件">+</button></div></div>' +
      (editing ? (opened && !locked ? '<button type="button" data-flavor-open aria-expanded="false">已开封</button>' : '') :
        '<button type="button" data-remove-flavor aria-label="删除口味">×</button>') +
      (editing ? '<small class="flavor-ratio">原始配比：每包装 ' + entry.perPack + '</small>' : '') +
      '<small data-flavor-changed class="hidden-view"></small>' +
      (opened && editing && !locked ? '<label data-flavor-open-panel class="hidden-view">已开封单件余量（%，填0表示移除该件）' +
        '<input class="ios-input" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-flavor-percent></label>' : '');
    row.querySelector('[data-flavor-name]').value = entry.name || '';
    row.querySelector('[data-flavor-name]').readOnly = Boolean(editing);
    UI.setFlavorNameEditing(row, !entry.name && !editing);
    row.querySelector('[data-flavor-count]').value = initial;
    var ratingLabel = document.createElement('div');
    ratingLabel.className = 'flavor-rating-field';
    ratingLabel.innerHTML = '<span class="flavor-rating-caption"><i class="flavor-dot" aria-hidden="true"></i>' +
      '<span class="stock-flavor-name" data-flavor-rating-name></span></span><input type="hidden" data-flavor-pal>' +
      '<details class="flavor-rating-picker"><summary></summary><div class="flavor-rating-options" role="group" aria-label="适口性选项">' +
      Object.keys(flavorRatingOptions).map(function (key) {
        return '<button type="button" data-flavor-rate="' + key + '">' + flavorRatingContent(key) + '</button>';
      }).join('') + '</div></details>';
    var rating = ratingLabel.querySelector('[data-flavor-pal]');
    var picker = ratingLabel.querySelector('details');
    var selectRating = function (key) {
      rating.value = Object.hasOwn(flavorRatingOptions, key) ? key : '';
      var summary = picker.querySelector('summary');
      summary.innerHTML = flavorRatingContent(rating.value);
      var name = ratingLabel.querySelector('[data-flavor-rating-name]').textContent;
      if (name) summary.setAttribute('aria-label', name + '适口性：' + flavorRatingOptions[rating.value]);
      picker.querySelectorAll('button').forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.dataset.flavorRate === rating.value));
      });
    };
    picker.addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-flavor-rate]');
      if (!button) return;
      selectRating(button.dataset.flavorRate);
      picker.open = false;
      picker.querySelector('summary').focus();
    });
    picker.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !picker.open) return;
      ev.stopPropagation();
      picker.open = false;
      picker.querySelector('summary').focus();
    });
    selectRating(entry.palatability || '');
    flavorRatingFields.set(row, rating);
    document.getElementById('stockFlavorRatings').append(ratingLabel);
    var percentField = row.querySelector('[data-flavor-percent]');
    if (percentField) percentField.value = percent;
    if (locked) row.querySelectorAll('button, [data-flavor-count]').forEach(function (control) { control.disabled = true; });
    document.getElementById('flavorRows').appendChild(row);
    return row;
  };

  UI.setFlavorNameEditing = function (row, editing) {
    var input = row.querySelector('[data-flavor-name]');
    var display = row.querySelector('[data-flavor-name-display]');
    input.classList.toggle('hidden-view', !editing);
    display.classList.toggle('hidden-view', editing);
    var name = input.value.trim() || '口味名称';
    display.textContent = name;
    display.title = name;
    if (display.tagName === 'BUTTON') display.setAttribute('aria-label', '编辑口味名称 ' + name);
  };

  function flavorRows() {
    return Array.from(document.querySelectorAll('#flavorRows .flavor-row'));
  }

  UI.readFlavorRows = function (pack) {
    return flavorRows().map(function (row) {
      var quantity = Number(row.querySelector('[data-flavor-count]').value);
      return { id: row.dataset.flavorId, name: row.querySelector('[data-flavor-name]').value,
        perPack: quantity / pack.count, quantity: quantity, spec: row.dataset.legacySpec,
        palatability: flavorRatingFields.get(row).value };
    }).filter(function (row) { return row.quantity > 0; });
  };

  UI.readEditedFlavorRatings = function (flavors) {
    var ratings = new Map(flavorRows().map(function (row) {
      return [row.dataset.flavorId, flavorRatingFields.get(row).value];
    }));
    return flavors.map(function (flavor) {
      return Object.assign({}, flavor, { palatability: ratings.get(flavor.id) ?? flavor.palatability });
    });
  };

  UI.invalidFlavorCount = function () {
    return Array.from(document.querySelectorAll('#flavorRows [data-flavor-count]:enabled')).find(function (input) {
      return !input.validity.valid || !Number.isSafeInteger(Number(input.value));
    });
  };

  function flavorDraft(row) {
    var count = Number(row.querySelector('[data-flavor-count]').value);
    var field = row.querySelector('[data-flavor-percent]');
    var percent = field ? (field.value === '' || !field.validity.valid ? NaN : Number(field.value)) : Number(row.dataset.initialPercent);
    return { id: row.dataset.flavorId, whole: count, percent: percent,
      changed: count !== Number(row.dataset.initialCount) || percent !== Number(row.dataset.initialPercent) };
  }

  UI.readFlavorAdjustments = function () {
    return flavorRows().map(flavorDraft).filter(function (draft) { return draft.changed; });
  };

  UI.changeFlavorCount = function (row, amount) {
    var output = row.querySelector('[data-flavor-count]');
    var draft = flavorDraft(row);
    var max = row.dataset.capacity ? Math.min(
      Number(row.dataset.capacity) - Number(draft.percent > 0),
      Math.max(Number(row.dataset.packSize), Number(row.dataset.initialCount))
    ) : Number.MAX_SAFE_INTEGER;
    var count = Number.isSafeInteger(draft.whole) ? draft.whole : 0;
    output.value = Math.min(max, Math.max(0, count + amount));
    UI.syncFlavorForm();
  };

  UI.distributeFlavors = function () {
    var pack = UI.readPurchasePackaging();
    var counts = flavorRows().map(function (row) { return row.querySelector('[data-flavor-count]'); });
    var named = counts.filter(function (input) {
      return input.closest('.flavor-row').querySelector('[data-flavor-name]').value.trim();
    });
    if (!pack || !named.length) return;
    counts.forEach(function (input) { input.value = 0; });
    var total = pack.size * pack.count;
    var share = Math.floor(total / named.length);
    named.forEach(function (input, index) {
      input.value = share + (index === named.length - 1 ? total % named.length : 0);
    });
    UI.syncFlavorForm();
  };

  function renderFlavorSuggestions() {
    var counts = new Map();
    MP.state.items.forEach(function (item) {
      if (!item.isSample && !item.sourceBatchId) (item.flavors || []).forEach(function (flavor) {
        counts.set(flavor.name, (counts.get(flavor.name) || 0) + 1);
      });
    });
    var names = Array.from(counts.keys()).sort(function (a, b) { return counts.get(b) - counts.get(a); }).slice(0, 5);
    if (!names.length) names = ['鸡肉', '鸭肉', '牛肉', '三文鱼', '兔肉'];
    document.getElementById('flavorSuggestions').innerHTML = names.map(function (name) {
      return '<button type="button" class="pill-chip" data-suggest-flavor="' + Utils.escapeHtml(name) + '"><span>＋ ' + Utils.escapeHtml(name) + '</span></button>';
    }).join('') + '<button type="button" class="pill-chip" id="addFlavorBtn"><span>＋ 自定义口味</span></button>';
  }

  UI.syncFlavorForm = function () {
    var packaging = document.getElementById('fieldPackagingEnabled').checked;
    var editing = Boolean(document.getElementById('fieldId').value);
    var toggle = document.getElementById('fieldMixedFlavors');
    var fields = document.getElementById('flavorRows');
    if (!packaging && !editing) toggle.checked = false;
    var enabled = packaging && toggle.checked;
    if (!enabled && !editing) fields.replaceChildren();
    toggle.disabled = !packaging || editing;
    var sealMode = document.getElementById('stockPackSealMode');
    var selectedSeal = document.getElementById('fieldPackSeal').value;
    Array.from(sealMode.querySelectorAll('[data-pack-seal]')).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.packSeal === selectedSeal));
      button.disabled = !packaging || editing;
    });
    document.getElementById('stockFormNameLabel').textContent = enabled ? '品名 / 系列' : '品名 / 口味配方';
    document.getElementById('flavorFields').classList.toggle('hidden-view', !enabled);
    document.getElementById('palatabilityGroup').parentElement.classList.toggle('hidden-view', enabled);
    document.getElementById('flavorSuggestions').classList.toggle('hidden-view', editing);
    var distributeEven = document.querySelector('[data-flavor-distribute="even"]');
    distributeEven.classList.toggle('hidden-view', editing);
    var pack = UI.readPurchasePackaging();
    var message = '';
    var allocation = '';
    var saveLabel = editing ? '保存' : '保存记录';
    var progress = document.getElementById('flavorProgress');
    progress.replaceChildren();
    progress.classList.toggle('hidden-view', editing || !enabled || !pack);
    var rows = flavorRows();
    var names = rows.map(function (row) { return row.querySelector('[data-flavor-name]').value.trim(); });
    var colorHints = names.map(flavorNamedColor);
    var selectedNames = new Set(names.map(function (name) { return name.toLowerCase(); }));
    distributeEven.disabled = !pack || !selectedNames.size || (selectedNames.size === 1 && selectedNames.has(''));
    document.querySelectorAll('#flavorSuggestions [data-suggest-flavor]').forEach(function (button) {
      button.classList.toggle('hidden-view', selectedNames.has(button.dataset.suggestFlavor.toLowerCase()));
    });
    var ratingGroup = document.getElementById('stockFlavorRatings');
    var ratingLabels = new Set();
    var colors = [];
    var lastColorToken = '';
    rows.forEach(function (row, i) {
      var candidates = flavorColors.slice(i % flavorColors.length).concat(flavorColors.slice(0, i % flavorColors.length));
      var token = colorHints[i] || candidates.find(function (candidate) {
        return candidate !== lastColorToken && candidate !== colorHints[i + 1];
      });
      var color = 'var(' + token + ')';
      if (colors[i - 1] === color) color = 'color-mix(in srgb, ' + color + ' 65%, var(--text-main))';
      colors.push(color);
      lastColorToken = token;
      row.style.setProperty('--flavor-color', color);
      var label = flavorRatingFields.get(row).parentElement;
      var name = names[i] || '口味 ' + (i + 1);
      label.querySelector('[data-flavor-rating-name]').textContent = name;
      var summary = label.querySelector('summary');
      summary.setAttribute('aria-label', name + '适口性：' + flavorRatingOptions[flavorRatingFields.get(row).value]);
      label.style.setProperty('--flavor-color', color);
      ratingLabels.add(label);
    });
    Array.from(ratingGroup.children).forEach(function (label) {
      if (!ratingLabels.has(label)) label.remove();
    });
    document.getElementById('stockFlavorRatingSection').classList.toggle('hidden-view', !enabled);
    var changes = editing && enabled ? UI.readFlavorAdjustments() : [];
    document.getElementById('flavorReasonWrap').classList.toggle('hidden-view', !changes.length);
    var overAllocated = false;
    if (enabled && editing) {
      message = '原始配比保留，盘点差异可按口味调整。';
      if (changes.length) saveLabel = '保存并记录库存调整';
      rows.forEach(function (row) {
        var draft = flavorDraft(row);
        var mark = row.querySelector('[data-flavor-changed]');
        mark.classList.toggle('hidden-view', !draft.changed);
        mark.textContent = draft.whole !== Number(row.dataset.initialCount)
          ? '已改 ' + row.dataset.initialCount + '→' + draft.whole
          : '已改余量 ' + row.dataset.initialPercent + '%→' + (Number.isFinite(draft.percent) ? draft.percent + '%' : '待填写');
      });
    } else if (enabled && pack) {
      var allocations = UI.readFlavorRows(pack);
      var allocated = allocations.reduce(function (sum, row) { return sum + row.quantity; }, 0);
      var total = pack.size * pack.count;
      var diff = total - allocated;
      overAllocated = diff < 0;
      var unit = document.getElementById('fieldUnit').value;
      if (UI.invalidFlavorCount()) {
        allocation = 'incomplete';
        message = '请输入有效的整数件数。';
      } else if (diff > 0) {
        allocation = 'pending';
        message = '已分配 ' + allocated + '/' + total + ' ' + unit + ' · 还差 ' + diff + ' ' + unit;
      } else if (diff < 0) {
        allocation = 'incomplete';
        message = '已超出 ' + (-diff) + ' ' + unit;
      } else if (Domain.validateFlavors(allocations, pack, total, false)) {
        allocation = 'complete';
        message = '已分配 ' + total + '/' + total + ' ' + unit + ' ✓';
      } else {
        allocation = 'incomplete';
        message = allocations.some(function (row) { return !Number.isInteger(row.perPack); })
          ? '各口味件数须能整除购买数量。' : '请核对口味名称，至少填写两种不同口味。';
      }
      // Limit DOM size for unusually large wholesale batches.
      var cellCount = Math.min(total, 200);
      progress.classList.toggle('is-dense', cellCount > 100);
      var boundaries = [];
      var tally = 0;
      rows.forEach(function (row, i) {
        tally += Number(row.querySelector('[data-flavor-count]').value);
        boundaries.push({ until: tally, color: colors[i] });
      });
      for (var c = 0, cursor = 0; c < cellCount; c++) {
        var position = c * total / cellCount;
        while (cursor < boundaries.length && position >= boundaries[cursor].until) cursor++;
        var cell = document.createElement('span');
        if (boundaries[cursor]) cell.style.backgroundColor = boundaries[cursor].color;
        progress.appendChild(cell);
      }
    }
    if (!editing) rows.forEach(function (row) {
      row.querySelector('[data-flavor-step="1"]').disabled = overAllocated;
    });
    var summary = document.getElementById('flavorSummary');
    if (summary.textContent !== message) summary.textContent = message;
    summary.dataset.allocation = allocation;
    document.getElementById('saveItemBtn').textContent = saveLabel;
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

  UI.syncPurchasePackaging = function () {
    var enabled = document.getElementById('fieldPackagingEnabled').checked;
    var editing = Boolean(document.getElementById('fieldId').value);
    UI.syncItemUnits(false);
    var pack = UI.readPurchasePackaging();
    var qty = document.getElementById('fieldQty');
    var unitField = document.getElementById('fieldUnit');
    var total = pack ? pack.count * pack.size : 0;
    document.getElementById('purchasePackagingFields').classList.toggle('hidden-view', !enabled);
    document.getElementById('stockPackOptions').classList.toggle('hidden-view', !enabled);
    document.getElementById('stockInnerPackageLabel').textContent = enabled ? '内包装' : '包装';
    var locked = Boolean(MP.FOOD_SUBTYPES[MP.state.formCat]?.innerUnits &&
      !document.getElementById('fieldSubtype').value && !itemFormSource);
    var unitDisplay = document.getElementById('stockLockedUnit');
    unitDisplay.value = unitField.value || '—';
    unitDisplay.classList.toggle('hidden-view', !locked);
    unitField.classList.toggle('hidden-view', locked);
    document.getElementById('stockQuantityUnit').textContent = unitField.value;
    document.getElementById('stockPackSizeUnit').textContent = unitField.value;
    document.getElementById('stockPackSizeLabel').textContent = '每' + document.getElementById('fieldPackOuterUnit').value + '件数';
    document.getElementById('fieldQtyLabel').textContent = editing ? '剩余数量' : '入库数量';
    qty.readOnly = enabled && (!editing || Boolean(document.getElementById('fieldMixedFlavors').checked));
    document.getElementById('stockQuantityRequired').classList.toggle('hidden-view', qty.readOnly);
    qty.step = enabled ? '1' : '0.01';
    var item = editing && MP.state.items.find(function (entry) { return entry.id === document.getElementById('fieldId').value; });
    unitField.disabled = locked || Boolean(item && item.sourceBatchId);
    UI.syncItemUsageConfig();
    UI.syncUnitChangeHints();
    ['fieldPackCount', 'fieldPackOuterUnit', 'fieldPackSize'].forEach(function (id) {
      document.getElementById(id).disabled = !enabled || editing;
    });
    if (qty.readOnly && !editing) {
      if (qty.dataset.manualQuantity === undefined) qty.dataset.manualQuantity = qty.value;
      qty.value = total || '';
    } else if (!editing && qty.dataset.manualQuantity !== undefined) {
      qty.value = qty.dataset.manualQuantity;
      delete qty.dataset.manualQuantity;
    }
    var preview = '';
    if (enabled) {
      preview = pack ? '' : (document.getElementById('fieldPackSeal').value === 'shared'
          ? '每个共用密封包装单独录入一批，购买数量填 1。'
          : '请输入有效的整包装数量，并选择内包装单位。');

    }
    document.getElementById('purchasePackagingPreview').textContent = preview;
    document.getElementById('packSealHelp').textContent = document.getElementById('fieldPackSeal').value === 'shared'
      ? '整盒一起计算保鲜期'
      : '每件单独计算保鲜期';
    UI.syncFlavorForm();
    UI.syncOpenedFieldsVisibility();
    UI.syncStockRequiredProgress();
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
    document.getElementById('stockFlavorRatings').replaceChildren();
    var count = document.getElementById('fieldPackCount');
    var outer = document.getElementById('fieldPackOuterUnit');
    var size = document.getElementById('fieldPackSize');
    count.value = pack ? pack.count : 1;
    outer.querySelectorAll('[data-legacy-unit]').forEach(function (option) { option.remove(); });
    if (pack && !Array.from(outer.options).some(function (option) { return option.value === pack.outerUnit; })) {
      var legacy = new Option(pack.outerUnit, pack.outerUnit);
      legacy.dataset.legacyUnit = 'true';
      outer.add(legacy);
    }
    outer.value = pack ? pack.outerUnit : '盒';
    if (outer.selectedIndex < 0) outer.value = '盒';
    size.value = pack ? pack.size : 8;
    count.disabled = outer.disabled = size.disabled = editing || !pack;
    var unit = document.getElementById('fieldUnit');
    unit.querySelectorAll('[data-historical-unit]').forEach(function (option) { option.remove(); });
    if (item) {
      if (!Array.from(unit.options).some(function (option) { return option.value === item.unit; })) {
        var historicalUnit = new Option(item.unit, item.unit);
        historicalUnit.dataset.historicalUnit = 'true';
        unit.add(historicalUnit);
      }
      unit.value = item.unit;
    } else {
      var category = MP.state.formCat;
      unit.value = MP.FOOD_SUBTYPES[category]?.innerUnits ? configuredInnerUnit(category)
        : (MP.CATEGORIES[category] || MP.CATEGORIES.dry).defaultUnit;
    }
    if (item && item.flavors) item.flavors.forEach(function (flavor) {
      UI.addFlavorRow(flavor, editing, pack, Boolean(item.sourceBatchId));
    });
    document.getElementById('adjustFlavorReason').value = '';
    renderFlavorSuggestions();
    var price = item && item.price;
    var qty = document.getElementById('fieldQty');
    delete qty.dataset.manualQuantity;
    var priceInput = document.getElementById('fieldPrice');
    var basis = UI.itemPriceQuantity(pack, qty.value);
    var total = price * basis;
    priceInput.value = price ? String(item.currency === 'JPY' ? Math.round(total) : Utils.round2(total)) : '';
    priceInput.dataset.initialTotal = priceInput.value;
    priceInput.dataset.initialBasis = basis;
    UI.syncPurchasePackaging();
  }

  UI.syncModalCurrencyUI = function (curCode) {
    var cur = curCode === 'JPY' ? 'JPY' : 'CNY';
    MP.state.formCurrency = cur;
    document.getElementById('priceCurrencyUnit').value = cur;
    var priceInput = document.getElementById('fieldPrice');
    priceInput.step = cur === 'JPY' ? '1' : '0.01';
    priceInput.placeholder = cur === 'JPY' ? '380' : '0.00';
    UI.syncModalUnitPriceHint();
  };

  UI.itemPriceQuantity = function (pack, quantity) {
    return pack ? pack.count * pack.size : (Number(quantity) > 0 ? Number(quantity) : 1);
  };

  UI.syncModalUnitPriceHint = function () {
    UI.syncPurchasePackaging();
    syncStockWeightPresets();
    var hint = document.getElementById('modalUnitPriceHint');
    var price = Number(document.getElementById('fieldPrice').value);
    var pack = UI.readPurchasePackaging();
    var qty = Number(document.getElementById('fieldQty').value);
    if (!(price > 0) || !document.getElementById('fieldUnit').value ||
        (!pack && (!(qty > 0) || document.getElementById('fieldPackagingEnabled').checked))) {
      hint.textContent = '';
      return;
    }
    var unitPrice = price / UI.itemPriceQuantity(pack, qty);
    var currency = MP.state.formCurrency;
    var unit = document.getElementById('fieldUnit').value;
    var displayPrice = currency === 'JPY' ? Utils.formatMoney(unitPrice, currency)
      : unitPrice.toLocaleString('en-US', { style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol' });
    hint.textContent = '单' + unit + '约 ' + displayPrice;
  };

  UI.syncModalPalatabilityUI = function (palKey) {
    MP.state.formPal = palKey || '';
    var btns = document.querySelectorAll('#palatabilityGroup [data-pal]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-pal') === MP.state.formPal);
    }
  };

  UI.openingDateError = function (date) {
    date = Utils.normalizeDateStr(date);
    if (!date) return '请选择开封日期';
    if (date > Utils.getTodayStr()) return '开封日期不能晚于今天';
    return '';
  };

  UI.syncOpenDatePicker = function (root, item) {
    var input = root.querySelector('[data-open-date-input]');
    var date = Utils.normalizeDateStr(input.value);
    input.max = Utils.getTodayStr();
    input.min = '';
    var error = UI.openingDateError(date);
    input.setAttribute('aria-invalid', String(Boolean(error)));
    root.querySelector('[data-open-date-error]').textContent = error;
    root.querySelectorAll('[data-open-date-offset]').forEach(function (button) {
      button.classList.toggle('active', date === Utils.shiftDaysFromToday(Number(button.dataset.openDateOffset)));
    });
    var production = Utils.normalizeDateStr(item && item.prodDate);
    var earlyProduction = !error && production && date < production;
    var limit = Number(item && item.openDaysLimit) || 0;
    var expired = !error && limit > 0 && Utils.openShelfDaysRemaining(date, limit) < 0;
    var warning = root.querySelector('[data-open-date-warning]');
    warning.textContent = [earlyProduction ? '早于生产日期，请确认' : '', expired ? '按这个日期，开封保鲜期已过期' : ''].filter(Boolean).join(' · ');
    warning.classList.toggle('hidden-view', !earlyProduction && !expired);
    if (root.id === 'confirmOpenDateWrap') document.getElementById('confirmOkBtn').disabled = Boolean(error);
    var message = document.getElementById(root.dataset.messageId);
    if (message && date) {
      var when = date === Utils.getTodayStr() ? '今天（' + Utils.formatCnDateText(date) + '）' : Utils.formatCnDateText(date);
      message.textContent = '将记为' + when + '开封' + (limit > 0
        ? '，并按这个日期计算保鲜倒计时。' : '；未设置开封保鲜期，不计算保鲜倒计时。');
    }
    return { date: date, error: error };
  };

  UI.prepareOpenDatePicker = function (root, item, date) {
    root.dataset.itemId = item.id;
    root.querySelector('[data-open-date-input]').value = Utils.normalizeDateStr(date) || Utils.getTodayStr();
    return UI.syncOpenDatePicker(root, item);
  };

  UI.syncOpenedFieldsVisibility = function () {
    var id = document.getElementById('fieldId').value;
    var item = id && MP.state.items.find(function (entry) { return entry.id === id; });
    var historical = Boolean(id) && Number(document.getElementById('fieldQty').value) <= 0;
    var mixed = document.getElementById('fieldPackagingEnabled').checked &&
      document.getElementById('fieldMixedFlavors').checked;
    var toggle = document.getElementById('fieldIsOpened');
    var independentFlavors = mixed && item && item.flavors && !Domain.hasSharedSeal(item);
    var flavorDates = independentFlavors ? item.flavors.filter(function (flavor) {
      return flavor.quantity > 0 && flavor.openedDate;
    }).map(function (flavor) { return flavor.openedDate; }).sort() : [];
    var count = historical ? 0 : independentFlavors ? flavorDates.length : Number(toggle.checked && !(!id && mixed));
    var openedInput = document.getElementById('fieldOpenedDate');
    if (independentFlavors && !historical) openedInput.value = flavorDates[0] || '';
    if (historical && !document.getElementById('fieldFinishedDate').value) {
      document.getElementById('fieldFinishedDate').value = Utils.getTodayStr();
    }
    var showCard = Boolean(id) && (!mixed || historical || count > 0);
    document.getElementById('batchOpeningCard').classList.toggle('hidden-view', !showCard);
    toggle.disabled = !showCard || historical || mixed;
    toggle.classList.toggle('hidden-view', historical);
    toggle.setAttribute('aria-checked', String(count > 0));
    openedInput.disabled = !showCard || (!historical && (!count || mixed));
    document.getElementById('openedExtraFields').classList.toggle('hidden-view', !historical && !count);
    var limitInput = document.getElementById('fieldOpenLimit');
    var validLimit = limitInput.validity.valid ? Number(limitInput.value) : 0;
    document.getElementById('freshUntilCol').classList.toggle('hidden-view', historical || (item && item.category === 'supplies' && !(validLimit > 0)));
    document.getElementById('finishedDateColWrap').classList.toggle('hidden-view', !historical);
    var countUnit = item ? item.unit : document.getElementById('fieldUnit').value;
    document.getElementById('openedCheckboxTitle').textContent = historical ? '历史批次日期' : '已开封 ' + Utils.formatQuantity(count, countUnit || '件');
    document.getElementById('openingSubtitle').textContent = historical ? '用于计算实际消耗天数'
      : item && item.category === 'supplies' && !(validLimit > 0) ? '记录开始使用日期' : '单独计算开封保鲜期';

    var date = openedInput.value;
    var error = !openedInput.disabled && UI.openingDateError(date);
    openedInput.setAttribute('aria-invalid', String(Boolean(error)));
    document.getElementById('openedDateError').textContent = error || '';
    var productionDate = Utils.normalizeDateStr(document.getElementById('fieldProdDate').value);
    document.getElementById('openedDateWarning').textContent = !error && date && productionDate && date < productionDate ? '早于生产日期，请确认' : '';
    var days = count && !error ? Utils.openShelfDaysRemaining(date, validLimit) : null;
    document.getElementById('fieldFreshUntil').value = days === null ? '—' : Utils.formatCnDateText(Utils.openShelfEndDate(date, validLimit));
    var remaining = document.getElementById('openingDaysLeft');
    remaining.textContent = days === null ? '' : Utils.formatExpiryShort(days, true);
    remaining.classList.toggle('is-urgent', ['expired', 'urgent'].includes(Utils.formatDays(days).tone));
    UI.syncAllDateDisplays();
  };

  UI.syncStockRequiredProgress = function () {
    var weight = document.getElementById('fieldNetWeight');
    var qty = document.getElementById('fieldQty');
    var checks = [
      document.getElementById('fieldBrand').value.trim(),
      document.getElementById('fieldName').value.trim(),
      qty.validity.valid && Number(qty.value) > 0 &&
        (!document.getElementById('fieldPackagingEnabled').checked || Boolean(UI.readPurchasePackaging()))
    ];
    var subtypeConfig = MP.FOOD_SUBTYPES[MP.state.formCat];
    var subtype = document.getElementById('fieldSubtype').value;
    if (subtypeConfig && ((!subtypeConfig.optional && !subtypeConfig.hidden) || subtype === '__custom__')) {
      checks.push(subtype && (subtype !== '__custom__' || document.getElementById('fieldSubtypeCustom').value.trim()));
    }
    if (weight.required) checks.push(weight.validity.valid && Number(weight.value) > 0);
    if (MP.state.formCat !== 'supplies') {
      var prod = document.getElementById('fieldProdDate').value;
      var exp = document.getElementById('fieldExpDate').value;
      checks.push(Boolean(exp && (!prod || exp >= prod)));
    }
    document.getElementById('stockDateMissing').classList.toggle('hidden-view',
      MP.state.formCat === 'supplies' || checks[checks.length - 1]);
    var completed = checks.filter(Boolean).length;
    document.getElementById('requiredProgress').max = checks.length;
    document.getElementById('requiredProgress').value = completed;
    document.getElementById('requiredProgressText').textContent = '必填 ' + completed + '/' + checks.length;
    document.getElementById('stockNameSpecHint').classList.toggle('hidden-view',
      !/\d+(?:\.\d+)?\s*(?:ml|毫升|升|kg|千克|g|克)(?![a-z])/i.test(document.getElementById('fieldName').value));
  };

  UI.selectStockDateMode = function (mode) {
    var picker = document.getElementById('stockDateMode');
    var editing = Boolean(document.getElementById('fieldId').value);
    var singleDateField = !editing || MP.state.formCat === 'supplies';
    picker.dataset.mode = mode;
    picker.classList.toggle('hidden-view', editing && MP.state.formCat !== 'supplies');
    document.getElementById('stockProductionField').classList.toggle('hidden-view', singleDateField && mode === 'expiry');
    document.getElementById('stockExpiryField').classList.toggle('hidden-view', singleDateField && mode === 'production');
    picker.querySelectorAll('button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.stockDate === mode));
    });
    UI.renderStockDateEstimate();
  };

  UI.renderStockDateEstimate = function () {
    var production = document.getElementById('fieldProdDate');
    var expiry = document.getElementById('fieldExpDate');
    var byExpiry = document.getElementById('stockDateMode').dataset.mode === 'expiry';
    var estimate = document.getElementById('stockDateEstimate');
    var source = byExpiry ? expiry : production;
    var derived = byExpiry ? production : expiry;
    var shelf = document.getElementById('fieldShelfValue');
    var hasEstimate = Boolean(source.value && shelf.validity.valid && Number(shelf.value) > 0 && derived.value);
    estimate.classList.toggle('hidden-view', Boolean(document.getElementById('fieldId').value));
    document.getElementById('stockDateEstimateBadge').classList.toggle('hidden-view', !hasEstimate);
    document.getElementById('stockDateEstimateText').textContent = hasEstimate
      ? (byExpiry ? '生产日期：' : '到期日期：') + derived.value : '填保质期后自动推算';
    estimate.classList.toggle('is-expired', Boolean(hasEstimate && !byExpiry && expiry.value < Utils.getTodayStr()));
    var unit = document.getElementById('fieldShelfUnit').value;
    var value = shelf.value;
    document.querySelectorAll('[data-preset-months]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(unit === 'months' && button.dataset.presetMonths === value));
    });
  };

  UI.autoComputeExpDate = function () {
    var prod = document.getElementById('fieldProdDate').value;
    var val = document.getElementById('fieldShelfValue').value;
    var unit = document.getElementById('fieldShelfUnit').value;
    if (!document.getElementById('fieldId').value) {
      var production = document.getElementById('fieldProdDate');
      var expiry = document.getElementById('fieldExpDate');
      var byExpiry = document.getElementById('stockDateMode').dataset.mode === 'expiry';
      var target = byExpiry ? production : expiry;
      var computedDate = byExpiry ? Utils.subtractShelfLife(expiry.value, val, unit) : Utils.addShelfLife(prod, val, unit);
      target.value = computedDate || '';
      target.dataset.computed = target.value;
      UI.renderStockDateEstimate();
      UI.syncOpenedFieldsVisibility();
      return;
    }
    if (prod && val) {
      var computed = Utils.addShelfLife(prod, val, unit);
      if (computed) {
        var expiry = document.getElementById('fieldExpDate');
        expiry.value = computed;
        expiry.dataset.computed = computed;
        document.getElementById('dateCalcHint').textContent = '已根据生产日期和保质期算出到期日期';
        UI.syncAllDateDisplays();
      }
    }
  };

  function resetFormProductionDate(value) {
    var input = document.getElementById('fieldProdDate');
    input.value = value || '';
    input.dataset.lastValid = input.value;
    delete input.dataset.confirmed;
    delete input.dataset.computed;
    delete document.getElementById('fieldExpDate').dataset.computed;
    delete document.getElementById('fieldShelfValue').dataset.custom;
    delete document.getElementById('fieldOpenLimit').dataset.custom;
    document.getElementById('stockFormMore').open = false;
    document.querySelectorAll('#itemForm .is-invalid').forEach(function (field) {
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
    });
    UI.selectStockDateMode('production');
    UI.setProductionDatePending(false);
  }

  function resetNewStockQuantity(value) {
    document.getElementById('fieldPackagingEnabled').checked = false;
    var qty = document.getElementById('fieldQty');
    delete qty.dataset.manualQuantity;
    qty.value = value;
  }

  UI.openAddModal = function () {
    var st = MP.state;
    document.getElementById('fieldUsageUnit').value = '';
    document.getElementById('fieldUsagePerItem').value = '';
    document.getElementById('fieldSubtypeCustom').value = '';
    document.getElementById('stockUsageConfig').open = false;
    document.getElementById('modalTitle').textContent = '录入商品';
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('itemForm').classList.remove('validation-attempted');
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldBrand').value = '';
    document.getElementById('fieldName').value = '';
    document.getElementById('fieldSpec').value = '';
    UI.resetFormEffectTags();
    resetNewStockQuantity('1');
    resetFormProductionDate('');
    document.getElementById('fieldShelfValue').value = '';
    document.getElementById('fieldShelfUnit').value = 'months';
    document.getElementById('fieldExpDate').value = '';
    document.getElementById('fieldExpDate').dataset.lastValid = '';
    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldLocation').value = '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = '';
    document.getElementById('dateCalcHint').textContent = '';

    UI.resetFormPhotos([]);
    document.getElementById('fieldPhotoInput').value = '';
    var defaultCat = MP.CATEGORIES[st.catFilter] ? st.catFilter : 'dry';
    document.getElementById('fieldUnit').disabled = false;
    resetSubtypeForm();
    UI.syncModalCategoryUI(defaultCat, true);
    if (defaultCat === 'supplies') setSupplySpecUnit('克');
    UI.syncNetWeight(true);
    setPurchasePackagingForm();
    UI.syncItemUsageConfig();
    UI.autoComputeExpDate();
    UI.syncModalCurrencyUI('CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'closeItemModalBtn');
    UI.scrollModalCategoryIntoView();
    UI.syncStockRequiredProgress();
    UI.syncQuickBrandFade();
    document.querySelector('#itemForm .stock-form-body').scrollTop = 0;
    UI.syncQuickLocationFade();
  };

  UI.openEditModal = function (id, focusId) {
    var item = MP.state.items.find(function (x) { return x.id === id; });
    if (!item) return;
    document.getElementById('fieldUsageUnit').value = item.feedUsageUnit || '';
    document.getElementById('fieldUsagePerItem').value = item.feedUsagePerItem || '';
    document.getElementById('stockUsageConfig').open = false;

    document.getElementById('modalTitle').textContent = '编辑商品';
    document.getElementById('fieldId').value = item.id;
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('itemForm').classList.remove('validation-attempted');
    document.getElementById('cloneBatchFromEditWrap').classList.remove('hidden-view');
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    UI.resetFormEffectTags(item);
    document.getElementById('fieldQty').value = String(item.quantity !== undefined ? item.quantity : 1);
    resetFormProductionDate(item.prodDate);
    document.getElementById('fieldShelfValue').value = item.shelfLifeValue ? String(item.shelfLifeValue) : '';
    document.getElementById('fieldShelfUnit').value = item.shelfLifeUnit || 'months';
    document.getElementById('fieldExpDate').value = item.expDate || '';
    document.getElementById('fieldExpDate').dataset.lastValid = document.getElementById('fieldExpDate').value;
    document.getElementById('fieldIsOpened').checked = Boolean(item.isOpened);
    document.getElementById('fieldOpenedDate').value = (item.quantity > 0 ? item.openedDate : item.archivedOpenedDate || item.openedDate) || '';
    document.getElementById('fieldFinishedDate').value = item.finishedDate || '';
    document.getElementById('fieldOpenLimit').value = item.openDaysLimit === null ? '' : String(item.openDaysLimit || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = item.batchCode || '';
    document.getElementById('fieldNotes').value = item.notes || '';
    document.getElementById('dateCalcHint').textContent = '';

    UI.resetFormPhotos(MP.getItemImages(item));
    document.getElementById('fieldPhotoInput').value = '';
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    setPurchasePackagingForm(item);
    UI.syncItemUsageConfig();
    UI.syncNetWeight(true);
    var netWeightInput = document.getElementById('fieldNetWeight');
    if (item.unit_net_weight_g > 0) {
      netWeightInput.value = item.unit_net_weight_g;
    }
    if (['supp', 'med'].includes(item.category)) {
      document.getElementById('fieldNetWeightUnit').value = item.unit_spec_unit === '毫升' || (item.category === 'med' && item.unit_spec_unit === '毫克') ? item.unit_spec_unit : '克';
      netWeightInput.value = item.unit_spec_unit === '毫升' || (item.category === 'med' && item.unit_spec_unit === '毫克') ? item.unit_spec_value : (item.unit_net_weight_g || '');
      UI.refreshNetWeightPresets();
    }
    var legacySupplySpecUnit = false;
    if (item.category === 'supplies') {
      netWeightInput.value = item.unit_spec_value || '';
      legacySupplySpecUnit = setSupplySpecUnit(item.unit_spec_unit || '克');
      syncStockWeightPresets();
    }
    UI.syncModalCurrencyUI(item.currency || 'CNY');
    UI.syncModalPalatabilityUI(item.palatability || '');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.renderStockDateEstimate();
    if (focusId && document.getElementById(focusId)?.closest('#stockFormMore')) {
      document.getElementById('stockFormMore').open = true;
    }
    UI.showModal('itemModalBackdrop', focusId || 'fieldBrand');
    UI.scrollModalCategoryIntoView();
    UI.syncStockRequiredProgress();
    UI.syncQuickBrandFade();
    if (legacySupplySpecUnit) UI.showToast('旧规格单位不再适用，请选择容量单位');
    UI.syncQuickLocationFade();
  };

  UI.openRestockModal = function (item) {
    if (!item) return;
    document.getElementById('fieldUsageUnit').value = item.feedUsageUnit || '';
    document.getElementById('fieldUsagePerItem').value = item.feedUsagePerItem || '';
    document.getElementById('stockUsageConfig').open = false;
    document.getElementById('modalTitle').textContent = '同款复购入库（新建批次）';
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '1';
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    UI.resetFormEffectTags(item);
    var defaultNewQty = Number(item.lastQuantity) > 0 ? Number(item.lastQuantity) : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
    resetNewStockQuantity(String(defaultNewQty));

    var sVal = item.shelfLifeValue ? Number(item.shelfLifeValue) :
      (item.category === 'supplies' ? '' : ((MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultShelfMonths || 18));
    var sUnit = item.shelfLifeUnit || 'months';
    resetFormProductionDate(item.prodDate);
    UI.setProductionDatePending(Boolean(item.prodDate));
    document.getElementById('fieldShelfValue').value = String(sVal);
    document.getElementById('fieldShelfUnit').value = sUnit;
    document.getElementById('fieldExpDate').value = '';
    document.getElementById('fieldExpDate').dataset.lastValid = '';
    UI.autoComputeExpDate();
    document.getElementById('dateCalcHint').textContent = item.prodDate ? '请核对新批次的生产日期与到期日期' : '';

    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldOpenLimit').value = item.openDaysLimit === null ? '' : String(item.openDaysLimit || (MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultOpenDays || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = item.notes || '';

    UI.resetFormPhotos(MP.getItemImages(item));
    document.getElementById('fieldPhotoInput').value = '';
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    setPurchasePackagingForm(item);
    UI.syncItemUsageConfig();
    UI.syncNetWeight(true);
    if (item.unit_net_weight_g > 0) document.getElementById('fieldNetWeight').value = item.unit_net_weight_g;
    if (['supp', 'med'].includes(item.category)) {
      document.getElementById('fieldNetWeightUnit').value = item.unit_spec_unit === '毫升' || (item.category === 'med' && item.unit_spec_unit === '毫克') ? item.unit_spec_unit : '克';
      document.getElementById('fieldNetWeight').value = item.unit_spec_unit === '毫升' || (item.category === 'med' && item.unit_spec_unit === '毫克') ? item.unit_spec_value : (item.unit_net_weight_g || '');
      UI.refreshNetWeightPresets();
    }
    var legacyRestockSpecUnit = false;
    if (item.category === 'supplies') {
      document.getElementById('fieldNetWeight').value = item.unit_spec_value || '';
      legacyRestockSpecUnit = setSupplySpecUnit(item.unit_spec_unit || '克');
      syncStockWeightPresets();
    }
    UI.syncModalCurrencyUI(item.currency || MP.state.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'closeItemModalBtn');
    UI.scrollModalCategoryIntoView();
    UI.syncStockRequiredProgress();
    UI.syncQuickBrandFade();
    if (legacyRestockSpecUnit) UI.showToast('旧规格单位不再适用，请选择容量单位');
    document.querySelector('#itemForm .stock-form-body').scrollTop = 0;
    UI.syncQuickLocationFade();
    UI.showToast('已带入同款资料，请确认新批次日期与数量');
  };

  UI.closeItemModal = function () {
    UI.resetFormPhotos([]);
    UI.hideModal('itemModalBackdrop');
  };

  UI.syncLightboxPosition = function (index) {
    var slides = document.getElementById('lightboxGallery').children;
    if (!slides.length) return;
    index = Math.max(0, Math.min(slides.length - 1, index));
    document.querySelectorAll('#lightboxDots button').forEach(function (button, i) {
      button.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    document.getElementById('lightboxPosition').textContent = (index + 1) + ' / ' + slides.length;
  };

  UI.openLightbox = function (item) {
    if (!item) return;
    var images = MP.getItemImages(item);
    if (!images.length) images = [MP.getItemCoverSrc(item)];
    var gallery = document.getElementById('lightboxGallery');
    document.getElementById('lightboxTitle').textContent = (item.brand || '') + ' · ' + (item.name || '');
    gallery.innerHTML = images.map(function (src, index) {
      return '<div class="lightbox-slide" role="group" aria-label="第 ' + (index + 1) + ' 张，共 ' + images.length +
        ' 张"><img src="' + Utils.escapeHtml(src) + '" alt="' + Utils.escapeHtml(item.name || '商品') +
        '，照片 ' + (index + 1) + '"></div>';
    }).join('');
    gallery.scrollLeft = 0;
    var dots = document.getElementById('lightboxDots');
    dots.innerHTML = images.map(function (_, index) {
      return '<button type="button" data-photo-index="' + index + '" aria-label="查看第 ' + (index + 1) +
        ' 张照片" aria-current="' + (index === 0) + '"><span></span></button>';
    }).join('');
    dots.classList.toggle('hidden-view', images.length < 2);
    document.getElementById('lightboxPosition').classList.toggle('hidden-view', images.length < 2);
    UI.syncLightboxPosition(0);
    document.getElementById('lightboxMeta').textContent =
      '生产日期：' + Utils.formatListDate(item.prodDate, '未填写') + ' ｜ 到期日期：' + Utils.formatListDate(item.expDate) + (item.batchCode ? (' ｜ 购入渠道：' + item.batchCode) : '');
    UI.showModal('photoPreviewBackdrop', 'closeLightboxBtn');
  };

  UI.closeLightbox = function () {
    UI.hideModal('photoPreviewBackdrop');
    document.getElementById('lightboxGallery').replaceChildren();
    document.getElementById('lightboxDots').replaceChildren();
  };

})(typeof window !== 'undefined' ? window : globalThis);
