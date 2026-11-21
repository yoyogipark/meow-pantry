/* Meow Pantry UI Renderer: Pantry Cards, Quick-Feed Bar, Daily Log, Modals & Stock Operation History Drawer */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var Utils = MP.Utils;
  var Domain = MP.Domain;
  var Stats = MP.Stats;
  var UI = MP.UI = MP.UI || {};

  var toastTimer = null;

  UI.showToast = function (msg, icon) {
    var el = document.getElementById('toastEl');
    if (!el) return;
    el.innerHTML = Utils.iconLabel(icon, msg);
    el.classList.remove('hidden-view');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden-view');
    }, 2300);
  };

  UI.purchasePackagingLabel = function (pack, unit) {
    return Utils.formatQuantity(pack.count, pack.outerUnit) + '装，' + (pack.outerUnit === unit ? '内包装' : '') +
      '共' + Utils.formatQuantity(pack.count * pack.size, unit);
  };

  UI.flavorStockText = function (item, plain, remainingView) {
    if (!item.flavors) return '';
    var overallRating = remainingView ? MP.getItemPalatability(item) : '';
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
      if (!remainingView || (flavor.palatability || '') === overallRating) return escaped;
      var badge = MP.getPalatabilityBadgeInfo({ category: item.category, palatability: flavor.palatability });
      return escaped + ' · <span class="flavor-stock-rating">' +
        (badge ? Utils.formatPalatabilityBadge(item, badge) : '未评价') + '</span>';
    }).join(' · ');
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
    window.scrollTo(0, 0);
  };

  UI.renderAll = function () {
    UI.renderSampleBanner();
    UI.syncEditModeUI();
    UI.renderHeaderProfile();
    UI.renderStatusCounts();
    UI.renderCategoryPills();
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

  UI.syncEditModeUI = function () {
    var st = MP.state;
    var chk = document.getElementById('globalEditModeToggle');
    if (chk) chk.checked = Boolean(st.editMode);
    document.getElementById('globalEditModeText').textContent = st.editMode ? '编辑中' : '编辑';
    document.body.classList.toggle('is-edit-mode', Boolean(st.editMode));
  };

  UI.renderHeaderProfile = function () {
    var settings = MP.state.settings;
    document.getElementById('headerProfileName').textContent = settings.profileName || '喵喵粮仓';
    document.getElementById('headerMascotImg').src = settings.profileAvatar || MP.COVERS?.appIcon || './icon-192.png';
  };

  // ==================== DAILY FEEDING LOG & 1-TAP QUICK FEED BAR ====================
  function feedStockMode() {
    if (document.getElementById('feedMealSlot').value !== 'care') return 'food';
    return document.getElementById('feedForm').dataset.careType === 'nursing' ? 'nursing' : 'medication';
  }

  function isFeedStockMatch(item, mode) {
    var group = MP.getCategoryGroup(item.category);
    return mode === 'food' ? group === 'food' : mode === 'medication' && (group === 'med' || group === 'supp');
  }

  function clearFeedBatchFields(mode) {
    UI.applyFeedStockSelection('');
    document.getElementById('feedCategorySelect').value = mode === 'medication' ? 'med' : 'dry';
    ['feedBrandInput', 'feedNameInput', 'feedAmountInput'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
  }

  var manualFeedDrafts = Object.create(null);
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
      var label = care ? (form.classList.contains('feed-nursing-mode') ? '护理用品' : '药品') : '喂食商品';
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
      return isFeedStockMatch(item, mode) &&
        (!item.sourceBatchId || !items.some(function (batch) { return batch.id === item.sourceBatchId; }));
    });
    var sections = mode === 'medication'
      ? [{ label: '药品', group: 'med' }, { label: '营养品', group: 'supp' }]
      : [{ label: '', group: 'food' }];
    var current = items.find(function (item) { return item.id === selectedItemId; });
    var prompt = batches.length ? '请选择仓库商品' : '暂无仓库商品';
    var safe = Utils.escapeHtml;
    var options = '<option value="">手动输入商品…</option>';
    var choices = { active: '', archived: '' };
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
    function label(item) { return displayName(item) + ' · ' + balanceLabel(item); }
    [false, true].forEach(function (archived) {
      sections.forEach(function (section) {
        var group = batches.filter(function (item) {
          return MP.getCategoryGroup(item.category) === section.group && (item.quantity <= 0) === archived;
        });
        if (!group.length) return;
        var heading = archived ? (section.label ? section.label + ' · 已核销' : '已核销') : section.label;
        var optionRows = '';
        var sectionKey = archived ? 'archived' : 'active';
        if (section.label) choices[sectionKey] += '<div class="feed-stock-group-label">' + safe(section.label) + '</div>';
        group.forEach(function (item) {
          var id = safe(item.id);
          var text = safe(label(item));
          optionRows += '<option value="' + id + '">' + text + '</option>';
          choices[sectionKey] += '<button type="button" data-feed-stock-id="' + id + '"' + (archived ? ' class="feed-stock-archived"' : '') +
            ' title="' + text + '">' + thumbnail(item) + '<span class="feed-stock-option-text">' + safe(displayName(item)) +
            '</span><span class="feed-stock-balance"> · ' + safe(balanceLabel(item)) +
            '</span><span class="feed-stock-check" aria-hidden="true">✓</span></button>';
        });
        options += heading ? '<optgroup label="' + safe(heading) + '">' + optionRows + '</optgroup>' : optionRows;
      });
    });
    // Historical records with a deduction keep the original batch reference.
    if (select.disabled && selectedItemId && !batches.some(function (item) { return item.id === selectedItemId; })) {
      options += '<option value="' + safe(selectedItemId) + '">' + safe(current ? label(current) : '原记录批次') + '</option>';
    }
    select.innerHTML = options;
    select.value = selectedItemId || '';
    if (select.selectedIndex < 0) select.value = '';
    var picker = document.getElementById('feedStockPicker');
    if (select.disabled) picker.open = false;
    var trigger = document.getElementById('feedStockPickerTrigger');
    trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.tabIndex = select.disabled ? -1 : 0;
    var selection = document.getElementById('feedStockSelection');
    trigger.classList.toggle('has-stock-selection', Boolean(current));
    if (current) {
      selection.innerHTML = thumbnail(current) + '<span class="feed-batch-copy"><strong>' + safe(displayName(current)) +
        '</strong><small>' + safe((MP.CATEGORIES[current.category]?.label || '') + ' · ' + balanceLabel(current)) +
        '</small></span>';
    } else {
      selection.textContent = selectedItemId && select.disabled ? '原记录批次' : prompt;
    }
    selection.title = current ? label(current) : selection.textContent;
    var list = document.getElementById('feedStockChoices');
    var selectedArchived = current && current.quantity <= 0;
    list.innerHTML = (choices.active ? '<div class="feed-stock-group-label">在库</div>' + choices.active : '') +
      (choices.archived ? '<details class="feed-stock-archive-group"' + (selectedArchived ? ' open' : '') +
        '><summary>已用完 / 已归档</summary>' + choices.archived + '</details>' : '') +
      '<button type="button" class="feed-stock-manual-option" data-feed-stock-id=""><span aria-hidden="true">＋</span>手动输入商品…</button>';
    list.querySelectorAll('button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.feedStockId === select.value));
    });
    picker.querySelectorAll('.feed-batch-thumb img').forEach(function (image) {
      function showFallback() {
        image.nextElementSibling.hidden = false;
        image.remove();
      }
      image.addEventListener('error', showFallback, { once: true });
      if (image.complete && !image.naturalWidth) showFallback();
    });
  };

  UI.returnToFeedStock = function () {
    var form = document.getElementById('feedForm');
    form.dataset.manualProduct = 'false';
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
    form.dataset.manualProduct = String(!item);
    if (!previous && item && wasManual) {
      manualFeedDrafts[mode] = manualFeedFields.map(function (id) { return document.getElementById(id).value; });
      manualFeedDrafts[mode].manualRating = Boolean(document.getElementById('feedFlavorPal').dataset.manual);
    }
    if (!item && previous) {
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
    if (item && item.id !== previous && mode === 'medication' && !document.getElementById('feedLogEditId').value) {
      document.getElementById('feedDeductStock').checked = true;
    }
    UI.syncMedReminderVisibility();
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
      Utils.iconLabel(meal?.icon, meal?.label || (slot === 'other' ? '原餐次' : slot));
    document.querySelectorAll('#feedMealChoices [data-meal-slot]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.mealSlot === slot));
    });
    var box = document.getElementById('medNextReminderBox');
    var fromReminder = document.getElementById('feedForm').dataset.reminderSourceId;
    var editId = document.getElementById('feedLogEditId').value;
    var editingReminder = editId && MP.state.logs.some(function (log) {
      return log.id === editId && log.category === cat && log.nextDueDate;
    });
    box.classList.toggle('hidden-view', !(cat === 'med' || slot === 'care' || (cat === 'supp' && (fromReminder || editingReminder))));
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
    var custom = care && select.value === 'custom';
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
    if (nursing) renderNursingReminders(select.value, Number(form.dataset.nursingSuggestion));
  };

  function careChipContent(label) {
    var text = Utils.escapeHtml(label);
    return '<svg class="care-chip-check" width="14" height="14" aria-hidden="true"><use href="#ui-check"></use></svg>' +
      '<span class="care-chip-copy" data-label="' + text + '"><span>' + text + '</span></span>';
  }

  function renderNursingReminders(selected, suggestion) {
    var choices = document.getElementById('feedNursingReminderChoices');
    var options = [['0', '不设'], ['7', '1周后'], ['14', '2周后'], ['30', '1个月后'], ['custom', '自定义']];
    [Number(selected), suggestion].forEach(function (days) {
      if (days > 0 && !options.some(function (option) { return option[0] === String(days); })) {
        options.splice(1, 0, [String(days), days + '天后']);
      }
    });
    var signature = JSON.stringify([options, suggestion]);
    if (choices.dataset.rendered !== signature) {
      choices.dataset.rendered = signature;
      choices.innerHTML = options.map(function (option) {
        return '<button type="button" class="care-chip" data-nursing-reminder="' + option[0] + '">' +
          careChipContent(option[1]) + (Number(option[0]) === suggestion && suggestion > 0 ? '<small>建议</small>' : '') +
          '</button>';
      }).join('');
    }
    Array.from(choices.children).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.nursingReminder === selected));
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

  UI.syncNursingNote = function () {
    var form = document.getElementById('feedForm');
    var nursing = form.classList.contains('feed-nursing-mode');
    var collapsed = nursing && !form.dataset.nursingNoteOpen && !document.getElementById('feedNoteInput').value;
    document.getElementById('feedAddNursingNote').classList.toggle('hidden-view', !collapsed);
    document.getElementById('feedNoteField').classList.toggle('hidden-view', collapsed);
  };

  UI.syncMedicationOutcome = function () {
    var select = document.getElementById('feedMedicationOutcome');
    var choices = document.getElementById('feedMedicationOutcomeChoices');
    if (!choices.childElementCount) {
      choices.innerHTML = Array.from(select.options, function (option) {
        return '<button type="button" class="care-chip" data-outcome="' + Utils.escapeHtml(option.value) + '">' +
          careChipContent(option.textContent) + '</button>';
      }).join('');
    }
    Array.from(choices.children).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.outcome === select.value));
    });
  };

  function syncCareForm(care, editing) {
    var form = document.getElementById('feedForm');
    var nursing = care && form.dataset.careType === 'nursing';
    document.getElementById('feedCareTypeGroup').classList.toggle('hidden-view', !care);
    document.querySelectorAll('[data-feed-care-type]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.feedCareType === (nursing ? 'nursing' : 'medication')));
    });
    form.classList.toggle('feed-nursing-mode', nursing);
    document.getElementById('feedNursingProjects').classList.toggle('hidden-view', !nursing);
    document.getElementById('feedNursingReminderChoices').classList.toggle('hidden-view', !nursing);
    UI.syncNursingNote();
    ['feedNameInput', 'feedAmountInput'].forEach(function (id) { document.getElementById(id).required = !nursing; });
    document.getElementById('feedMealSlotLabel').textContent = care ? '记录类型' : '餐次时段';
    document.getElementById('feedReminderTitle').textContent = nursing ? '下次护理提醒' : care ? '下次提醒' : '下次用药/驱虫提醒';
    var wasCare = form.classList.contains('feed-care-mode');
    var target = MP.state.items.find(function (item) { return item.id === document.getElementById('feedItemId').value; });
    document.getElementById('feedMedicationOutcomeLabel').textContent = /口服/.test(target?.subtype || '') ? '服药情况' : '使用情况';
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
      var unit = target?.unit || '支';
      amount.placeholder = '如：半' + unit + '、1' + unit;
    }
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel(care ? 'stethoscope' : editing ? 'pencil' : 'paw-print',
      nursing ? (editing ? '编辑护理记录' : '记录护理') : care ? (editing ? '编辑用药记录' : '记录用药') : (editing ? '编辑每日记录' : form.dataset.productEntry === 'true' ? '记录喂食' : form.dataset.dailyEntry === 'true' ? '新增记录' : '记录饮食 / 营养 / 用药'), 20);
    document.getElementById('feedPalatabilityField').classList.toggle('hidden-view', care);
    document.getElementById('feedMedicationOutcomeField').classList.toggle('hidden-view', !care || nursing);
    document.getElementById('feedNameLabel').textContent = care ? '药品名称' : '商品名';
    document.getElementById('feedNameInput').placeholder = care ? '如：大宠爱 / 福来恩 / 拜宠清' : '如 小灶猫饭';
    document.getElementById('feedBrandInput').placeholder = care ? '如：辉瑞 / 勃林格殷格翰' : '如 喵梵思';
    document.getElementById('feedStockLabel').textContent = care ? '选择药品批次（或手动输入）' : '商品批次';
    document.getElementById('saveFeedBtn').textContent = nursing ? '保存护理记录' : care ? '保存用药记录' : '保存喂食记录';
    document.getElementById('feedAmountLabel').textContent = care ? '用量' : '投喂份量';
    document.getElementById('feedNoteLabel').textContent = nursing ? '备注' : care ? '反应 / 备注' : '光盘情况 / 反应备注';
    document.getElementById('feedNoteInput').placeholder = nursing ? '如：状态是否配合、有无异常' : care ? '如：有无呕吐、精神状态' : '如：秒光盘、兑了40ml温水、便便正常';
    document.getElementById('feedBrandInput').required = !care;
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
      UI.showToast('这条记录已关联库存，无法切换类型');
      return;
    }
    form.dataset.careType = type;
    delete form.dataset.nursingReminderManual;
    form.dataset.manualProduct = 'false';
    document.getElementById('feedStockSelect').value = '';
    UI.applyFeedStockSelection('');
    document.getElementById('feedCategorySelect').value = 'med';
    ['feedBrandInput', 'feedNameInput', 'feedAmountInput', 'feedMedicationOutcome', 'feedCustomReminderDays'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    setFeedReminderDays(0);
    loadNursingFields();
    UI.syncMedReminderVisibility();
  };

  function feedFractionLabel(fraction, unit) {
    return Utils.formatRemainFractionText(fraction, unit, true).replace(/^余/, '') ||
      Utils.formatQuantity(fraction || 0, unit);
  }

  UI.syncFeedSplitCanUI = function (target) {
    var editing = Boolean(document.getElementById('feedLogEditId').value);
    var deduct = document.getElementById('feedDeductStock');
    var care = document.getElementById('feedForm').classList.contains('feed-care-mode');
    var hint = document.getElementById('feedSplitHintTag');
    var info = document.getElementById('feedSplitAutoInfo');
    var flavor = target && target.flavors && UI.getFeedFlavor(target);
    var unit = target && target.unit || '罐';
    var remaining = flavor ? flavor.openRemainFraction : target && !target.flavors && target.openRemainFraction;
    document.getElementById('feedDeductBox').classList.toggle('hidden-view', !target || editing);
    deduct.disabled = !target || editing || (!care && (
      target.quantity < 1 || (!Domain.isPackageUnit(unit) && unit !== '粒') || Boolean(flavor && flavor.quantity < 1)));
    if (deduct.disabled) deduct.checked = false;
    var weight = target ? Number(target.unit_net_weight_g) || Utils.legacyUnitWeight(target.spec, unit) : 0;
    var currentFraction = target && (flavor || target).quantity >= 1 && (!target.flavors || flavor) ? Number(remaining) || 1 : 0;
    hint.textContent = target && currentFraction > 0 && !care
      ? '剩余约 ' + (weight > 0 ? Math.round(weight * currentFraction) + 'g（' +
        Utils.formatNumber(currentFraction * 100, 1) + '%）' : feedFractionLabel(currentFraction, unit))
      : '';
    var careHelp = document.getElementById('feedCareDeductHelp');
    careHelp.classList.toggle('hidden-view', !care);
    careHelp.textContent = !target ? '选择药品批次后可扣减' : deduct.checked ? '开启后从该药品余量中扣除本次用量' : '仅记录，不影响余量';
    info.classList.toggle('hidden-view', care);
    var amount = document.getElementById('feedAmountInput');
    var dose = amount.value.trim();
    var choice = amount.dataset.doseChoice;
    var chips = Array.from(document.querySelectorAll('#feedPortionChips button:not(.hidden-view)'));
    var selected = dose && (care || !amount.dataset.automaticPortion) && (chips.find(function (button) {
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
      return /^\d+(?:\.\d+)?g$/i.test(button.dataset.portion) &&
        dose.toLowerCase().replace(/\s+/g, '').replace(/克$/, 'g') === button.dataset.portion.toLowerCase();
    }));
    document.querySelectorAll('#feedPortionChips button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button === selected));
    });
    if (care) return;
    if (!target || !deduct.checked) {
      info.textContent = '仅记录喂食，库存和开封余量保持原样';
      return;
    }
    var plan = Domain.planFeedingPortion(target, flavor, UI.parseFeedPortion(dose, target, flavor));
    info.textContent = plan.error || (weight > 0
      ? '将从本批次扣减 ' + Math.round(plan.used * weight) + 'g，预计剩余约 ' + Math.round(plan.after * weight) + 'g'
      : '将从本批次扣减 ' + feedFractionLabel(plan.used, unit) + '，预计余量 ' + feedFractionLabel(plan.after, unit));
  };

  UI.portionLabel = function (base, fraction, item, flavor) {
    var spec = item && Utils.parsePortionSpec(Utils.itemPortionSpec(item));
    if (!spec || Number(spec[1]) <= 0 || (spec[3] && spec[3] !== item.unit)) return base;
    return base + ' (约' + Utils.round2(Number(spec[1]) * fraction) + spec[2] + ')';
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
      return { valid: true, fraction: Number.isFinite(ratio) ? ratio : 0 };
    }
    text = text.replace(/\s*[（(](?:约?\s*\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升)|1\/2)[）)]$/i, '').trim();
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
    var natural = care || /^(杯|罐|包|盒|支|粒|瓶|袋)$/.test(unit);
    var presets = { '0.5': natural ? '半' + unit : '1/2',
      '0.34': natural ? '1/3' + unit : '1/3',
      '0.25': natural ? '1/4' + unit : '1/4', '1': '1' + unit };
    document.querySelectorAll('#feedPortionChips [data-package-portion]').forEach(function (button) {
      var portion = presets[button.dataset.frac];
      button.dataset.portion = portion;
      button.classList.toggle('care-chip', care);
      if (care) button.innerHTML = careChipContent(portion);
      else button.textContent = portion;
      button.classList.toggle('hidden-view', !care && !configured.includes(button.dataset.frac));
    });
    var quickChips = document.getElementById('feedPortionChips');
    var order = care ? ['0.25', '0.34', '0.5', '1'] : ['0.5', '0.34', '0.25', '1'];
    order.forEach(function (fraction) {
      quickChips.append(quickChips.querySelector('[data-frac="' + fraction + '"][data-package-portion]'));
    });
    quickChips.querySelectorAll('[data-configured-portion]').forEach(function (button) { button.remove(); });
    if (!care) configured.filter(function (preset) { return !Object.hasOwn(presets, preset); }).forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.configuredPortion = '';
      button.dataset.portion = preset;
      button.textContent = preset;
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
  }

  UI.syncFeedFlavor = function (item, historical) {
    var wrap = document.getElementById('feedFlavorFields');
    var select = document.getElementById('feedFlavorSelect');
    var hasFlavor = Boolean(historical && historical.flavorId || item && item.flavors);
    wrap.classList.toggle('hidden-view', !hasFlavor);
    select.disabled = Boolean(historical);
    wrap.classList.toggle('has-selected-flavor', Boolean(historical && hasFlavor));
    document.getElementById('openFlavorBtn').disabled = Boolean(historical);
    document.getElementById('discardFlavorBtn').disabled = Boolean(historical);
    select.innerHTML = '<option value="">请选择口味</option>';
    if (historical) {
      var palField = document.getElementById('feedFlavorPal');
      palField.value = historical.flavorPalatability || '';
      palField.dataset.manual = '1';
    }
    if (historical && hasFlavor) {
      select.add(new Option(historical.flavorName, historical.flavorId, true, true));
      var hint = document.getElementById('feedFlavorHint');
      hint.textContent = hint.title = '历史口味与库存流水关联';
    } else if (hasFlavor) {
      item.flavors.forEach(function (f) {
        select.add(new Option(f.name + ' · 余' + Utils.formatQuantity(f.quantity, item.unit), f.id));
      });
      UI.updateFeedFlavor(item);
    } else if (!historical) {
      syncFeedPalatability(item, null);
    }
  };

  UI.updateFeedFlavor = function (item) {
    var flavor = UI.getFeedFlavor(item);
    syncFeedPalatability(item, flavor);
    var discard = document.getElementById('discardFlavorBtn');
    discard.disabled = !MP.state.editMode || !flavor || flavor.quantity <= 0;
    var open = document.getElementById('openFlavorBtn');
    var openedDate = item && Domain.hasSharedSeal(item) ? item.openedDate : flavor?.openedDate;
    open.disabled = Boolean(flavor && (!MP.state.editMode || flavor.quantity <= 0 ||
      (Domain.hasSharedSeal(item) ? item.isOpened : flavor.openedDate)));
    document.getElementById('feedFlavorFields').classList.toggle('has-selected-flavor', Boolean(flavor));
    var days = Utils.diffDaysBetween(openedDate, Utils.getTodayStr());
    var hint = document.getElementById('feedFlavorHint');
    hint.textContent = !flavor ? '选好口味后，可记录这一口味开封' : days === null
      ? '如换新罐，可点右上角记录开封' : '这个口味已开封 ' + Math.max(0, days) + ' 天，如换新罐可点右上角记录';
    hint.title = hint.textContent;
  };

  function syncLastPortionChip(item, care, editing) {
    var chip = document.getElementById('chipLastPortion');
    chip.classList.toggle('care-chip', care);
    var last = Domain.getLastFedInfoForItem(item, care ? function (log) {
      return log.id !== document.getElementById('feedLogEditId').value &&
        (log.category === 'med' || log.mealSlot === 'care');
    } : undefined);
    if (!care && editing) last = null;
    chip.classList.toggle('hidden-view', !last?.amount);
    if (last?.amount) {
      chip.dataset.portion = last.amount;
      var label = last.amount;
      if (!care && ['dry', 'freeze', 'treat'].includes(item?.category)) {
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
        } else if (target.category === 'treat' || target.category === 'freeze') {
          document.getElementById('feedMealSlot').value = 'snack';
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
        defaultPortion = '15g';
      } else if (target.category === 'treat') {
        defaultPortion = '1' + target.unit;
      } else if (target.category === 'supp') {
        defaultPortion = '1份 / 5cm';
      } else if (target.category === 'med') {
        defaultPortion = '1' + (target.unit || '支');
      }

      document.getElementById('feedAmountInput').value = defaultPortion;
      document.getElementById('feedAmountInput').placeholder = '如 25g、半' + target.unit + '、1' + target.unit;
      if (target.flavors) {
        document.getElementById('feedAmountInput').value = '';
      }
      UI.syncFeedSplitCanUI(target);
    } else {
      syncLastPortionChip(null, false, false);
      UI.syncFeedSplitCanUI(null);
    }
  };

  function selectMealSlot(value) {
    document.getElementById('feedMealSlot').value = Utils.normalizeMealSlot(value);
    document.getElementById('feedMealPicker').open = false;
    document.getElementById('feedMealChoices').innerHTML = Utils.mealSlotOptions().map(function (slot) {
      return '<button type="button" data-meal-slot="' + Utils.escapeHtml(slot.id) + '">' +
        Utils.iconLabel(slot.icon, slot.label) + '</button>';
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
    var feedForm = document.getElementById('feedForm');
    delete feedForm.dataset.nursingReminderManual;
    delete feedForm.dataset.nursingNoteOpen;
    feedForm.dataset.productEntry = String(Boolean(productEntry));
    feedForm.dataset.dailyEntry = String(Boolean(dailyEntry));
    feedForm.dataset.manualProduct = 'false';
    document.getElementById('feedManualFlavor').value = '';
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel('paw-print', '记录饮食 / 营养 / 用药', 20);
    document.getElementById('feedStockSelect').disabled = false;
    document.getElementById('feedLogEditId').value = '';
    document.getElementById('feedForm').dataset.careType = 'medication';
    loadNursingFields();
    document.getElementById('feedForm').classList.remove('feed-care-mode');
    delete document.getElementById('feedAmountInput').dataset.doseChoice;
    delete document.getElementById('feedAmountInput').dataset.automaticPortion;
    document.getElementById('feedMedicationOutcome').value = '';
    document.getElementById('feedCustomReminderDays').value = '';
    document.getElementById('feedAmountInput').placeholder = '如 1/2、1/3、40g';
    delete document.getElementById('feedFlavorPal').dataset.manual;
    UI.syncFeedFlavor(null);
    syncPortionChips(null);
    var dateToUse = customDate || (MP.state.activeTab === 'daily' ? MP.state.selectedLogDate : Utils.getTodayStr());
    document.getElementById('feedDateInput').value = dateToUse;
    selectMealSlot(Utils.getCurrentMealSlot());
    document.getElementById('feedDeductStock').checked = false;
    delete document.getElementById('feedForm').dataset.reminderSourceId;
    setFeedReminderDays(0);
    document.getElementById('feedNoteInput').value = '';
    document.getElementById('feedStockPicker').open = false;

    if (itemId) {
      var requested = MP.state.items.find(function (item) { return item.id === itemId; });
      if (requested && !MP.isFoodCategory(requested.category)) selectMealSlot('care');
      UI.applyFeedStockSelection(itemId);
    } else {
      var foodBatches = MP.state.items.filter(function (it) {
        return isFeedStockMatch(it, 'food') && (!it.sourceBatchId || !MP.state.items.some(function (batch) { return batch.id === it.sourceBatchId; }));
      });
      var lastLog = MP.state.logs.filter(function (log) {
        return foodBatches.some(function (batch) { return batch.id === log.itemId; }) && !Domain.getCareType(log);
      }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0];
      var firstActive = !manualEntry && (foodBatches.find(function (item) { return item.id === lastLog?.itemId; }) ||
        foodBatches.find(function (item) { return item.quantity > 0; }) || foodBatches[0]);
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
    UI.syncAllDateDisplays();
    UI.showModal('feedModalBackdrop', productEntry || feedForm.dataset.manualProduct === 'true' ? 'closeFeedModalBtn' : 'feedStockPickerTrigger');
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
    if (nursing) setTimeout(function () {
      if (!document.getElementById('feedModalBackdrop').classList.contains('hidden-view')) {
        document.querySelector('[data-feed-care-type="nursing"]').focus();
      }
    }, 0);
  };

  UI.openEditFeedModal = function (logId) {
    var lg = MP.state.logs.find(function (x) { return x.id === logId; });
    if (!lg) return;
    manualFeedDrafts = Object.create(null);
    var feedForm = document.getElementById('feedForm');
    feedForm.dataset.nursingReminderManual = 'true';
    delete feedForm.dataset.nursingNoteOpen;
    delete feedForm.dataset.productEntry;
    delete feedForm.dataset.dailyEntry;
    feedForm.dataset.manualProduct = String(!lg.itemId);
    document.getElementById('feedManualFlavor').value = !lg.flavorId ? lg.flavorName || '' : '';
    document.getElementById('feedModalTitle').innerHTML = Utils.iconLabel('pencil', '编辑每日记录', 20);
    document.getElementById('feedLogEditId').value = lg.id;
    document.getElementById('feedForm').dataset.careType = Domain.getCareType(lg) === 'nursing' ? 'nursing' : 'medication';
    loadNursingFields(lg);
    document.getElementById('feedForm').classList.remove('feed-care-mode');
    delete document.getElementById('feedAmountInput').dataset.doseChoice;
    delete document.getElementById('feedAmountInput').dataset.automaticPortion;
    document.getElementById('feedMedicationOutcome').value = lg.medicationOutcome || '';
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
    UI.showModal('feedModalBackdrop', Domain.getCareType(lg) === 'nursing'
      ? (lg.note ? 'feedNoteInput' : 'feedAddNursingNote') : 'feedAmountInput');
  };

  UI.closeFeedModal = function () {
    UI.hideModal('feedModalBackdrop');
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
      return (
        '<div style="padding:10px 12px;border-radius:12px;background:var(--control-bg);border:1px solid var(--border-warm);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">' +
              '<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;background:' + meta.bg + ';color:' + meta.text + ';">' + Utils.iconLabel(meta.icon, meta.label) + '</span>' +
              '<span style="font-size:11px;color:var(--text-muted);">' + Utils.escapeHtml(h.timestamp) + '</span>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:800;color:var(--text-main);">' + Utils.getCategoryIcon(h.category) + ' [' + Utils.escapeHtml(h.brand) + '] ' + Utils.escapeHtml(h.name) + '</div>' +
            (h.note ? '<div style="margin-top:2px;font-size:11.5px;color:var(--text-muted);">' + Utils.escapeHtml(h.note) + '</div>' : '') +
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
    var locations = MP.state.items.map(function (item) { return (item.location || '').trim(); });
    var chips = Array.from(new Set(locations.concat(MP.COMMON_LOCATIONS))).filter(function (loc) {
      return loc && loc !== current;
    });
    var box = document.getElementById('quickLocationChips');
    box.innerHTML = chips.map(function (loc) {
      return '<button type="button" data-pick-location="' + Utils.escapeHtml(loc) + '">' + Utils.escapeHtml(loc) + '</button>';
    }).join('');
    UI.syncQuickLocationFade();
  };

  UI.syncQuickLocationFade = function () {
    var box = document.getElementById('quickLocationChips');
    box.parentElement.classList.toggle('has-more', box.scrollWidth - box.clientWidth - box.scrollLeft > 1);

  };

  UI.renderQuickBrandChips = function () {
    UI.syncLocationSuggestion();
    var existing = {};
    var merged = [];
    MP.state.items.forEach(function (it) {
      if (it.brand && it.brand.trim() && !existing[it.brand.trim()]) {
        existing[it.brand.trim()] = true;
        merged.push(it.brand.trim());
      }
    });
    MP.COMMON_BRANDS.forEach(function (b) {
      if (!existing[b]) {
        existing[b] = true;
        merged.push(b);
      }
    });
    var box = document.getElementById('quickBrandChips');
    box.innerHTML = merged.slice(0, 10).map(function (b) {
      return '<button type="button" data-pick-brand="' + Utils.escapeHtml(b) + '" style="white-space:nowrap;padding:4px 9px;border-radius:999px;border:1px solid var(--border-warm);background:var(--control-bg);color:var(--text-muted);font-size:11px;cursor:pointer;">' + Utils.escapeHtml(b) + '</button>';
    }).join('');
  };

  UI.syncModalPhotoUI = function () {
    var st = MP.state;
    var covers = MP.COVERS || {};
    document.getElementById('formPhotoPreview').src = st.formImage || covers[st.formCat] || covers.dry || '';
    document.getElementById('clearPhotoBtn').classList.toggle('hidden-view', !st.formImage);
    document.getElementById('photoCompressHint').textContent = st.formImage ? '已绑定实拍图' : '使用默认插画';
  };

  // Distinct palatability/tolerance labels for Ordinary Food vs Supplements vs Medicine!
  var subtypeDraft = {};
  var manualItemUnit = false;

  function resetSubtypeForm(item, editing) {
    subtypeDraft = {};
    manualItemUnit = Boolean(item);
    if (!item || !item.subtype) return;
    var config = MP.FOOD_SUBTYPES[item.category];
    if (config && (editing || config.options.includes(item.subtype))) {
      subtypeDraft[item.category] = item.subtype;
    }
  }

  function syncItemSubtype(catKey) {
    var config = MP.FOOD_SUBTYPES[catKey];
    var field = document.getElementById('fieldSubtype');
    var editing = Boolean(document.getElementById('fieldId').value);
    document.getElementById('itemSubtypeWrap').classList.toggle('hidden-view', !config);
    field.disabled = !config;
    field.required = Boolean(config && !editing);
    field.options.length = 0;
    if (!config) return;
    document.getElementById('itemSubtypeLabel').textContent = config.label;
    field.add(new Option(editing ? '未指定' : '请选择' + config.label, ''));
    config.options.forEach(function (option) { field.add(new Option(option, option)); });
    var value = subtypeDraft[catKey] ?? (!editing && !config.innerUnits ? config.options[0] : '');
    if (value && !config.options.includes(value)) field.add(new Option(value + '（历史）', value));
    field.value = value;
  }

  function configuredInnerUnit(category) {
    var units = MP.FOOD_SUBTYPES[category]?.innerUnits;
    var subtype = document.getElementById('fieldSubtype').value;
    return units && Object.hasOwn(units, subtype) ? units[subtype] : '';
  }

  UI.updateItemSubtype = function () {
    var catKey = MP.state.formCat;
    subtypeDraft[catKey] = document.getElementById('fieldSubtype').value;
    var item = MP.state.items.find(function (entry) { return entry.id === document.getElementById('fieldId').value; });
    if (MP.FOOD_SUBTYPES[catKey]?.innerUnits && !item?.sourceBatchId) {
      document.getElementById('fieldUnit').value = configuredInnerUnit(catKey);
    }
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
      Utils.formatNumber(Number(item.quantity) || 0) + ' 不变，请确认每' + unit.value + '净含量。' : '';
    hint.classList.toggle('hidden-view', !hint.textContent);
  };

  function findFormProduct(predicate, useEnteredWeight) {
    var product = { category: MP.state.formCat };
    [['brand', 'fieldBrand'], ['name', 'fieldName'], ['spec', 'fieldSpec'], ['unit', 'fieldUnit']].forEach(function (pair) {
      product[pair[0]] = document.getElementById(pair[1]).value.trim();
    });
    if (!product.brand || !product.name) return null;
    var weight = useEnteredWeight ? Number(document.getElementById('fieldNetWeight').value) : 0;
    if (weight > 0) product.unit_net_weight_g = weight;
    var key = Domain.getProductGroupKey(product);
    return MP.state.items.find(function (item) {
      var match = weight > 0 ? item : Object.assign({}, item, { unit_net_weight_g: null });
      return predicate(item) && Domain.getProductGroupKey(match) === key;
    });
  }

  function renderStockWeightPresets(category) {
    var weights = MP.STOCK_WEIGHT_PRESETS[category] || [];
    document.getElementById('stockWeightPresets').classList.toggle('hidden-view', !weights.length);
    document.getElementById('stockWeightPresetOptions').innerHTML = weights.map(function (grams) {
      return '<button type="button" data-preset-grams="' + grams + '" class="pill-chip">' +
        (grams >= 1000 ? Utils.formatNumber(grams / 1000) + '千克' : grams + '克') + '</button>';
    }).join('');
  }

  function syncStockWeightPresets() {
    var weight = Number(document.getElementById('fieldNetWeight').value);
    document.querySelectorAll('#stockWeightPresetOptions button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(weight === Number(button.dataset.presetGrams)));
    });
  }

  UI.syncNetWeight = function (resetValue) {
    var input = document.getElementById('fieldNetWeight');
    var category = MP.state.formCat;
    var wet = category === 'can';
    var id = document.getElementById('fieldId').value;
    var required = !id || Utils.requiresUnitWeight(category);
    var unit = document.getElementById('fieldUnit').value;
    document.getElementById('itemModalBackdrop').classList.toggle('is-editing-item', Boolean(id));
    document.getElementById('fieldNetWeightLabel').textContent = unit ? '每' + unit + '净含量' : '每件净含量';
    UI.syncUnitChangeHints();
    var subtype = document.getElementById('fieldSubtype').value;
    input.required = required;
    document.getElementById('netWeightRequired').classList.toggle('hidden-view', !required);
    document.getElementById('netWeightField').classList.remove('hidden-view');
    document.getElementById('itemPackageWeight').classList.remove('hidden-view');
    input.placeholder = wet ? (subtype === '餐包' ? '40 / 50' : '85 / 170')
      : ({ dry: '1500', freeze: '100', treat: '15', supp: '60', med: '1' })[category] || '';
    if (resetValue) {
      input.value = '';
      delete input.dataset.manualWeight;
    }
    if (id || input.dataset.manualWeight) return;
    var match = findFormProduct(function (item) { return item.unit_net_weight_g > 0; });
    input.value = match ? match.unit_net_weight_g : '';
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
    if (applyDefaults && st.formCat !== catKey) manualItemUnit = false;
    st.formCat = catKey;
    var catInfo = MP.CATEGORIES[catKey] || MP.CATEGORIES.dry;
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
      if (!openLimit.dataset.custom) openLimit.value = catKey === 'med' ? '' : String(catInfo.defaultOpenDays);
      if (!shelfValue.dataset.custom) {
        shelfValue.value = String(catInfo.defaultShelfMonths);
        shelfUnit.value = 'months';
      }
    }
    var nameExamples = { dry: '鸡肉无谷配方', can: '鸡肉主食罐', freeze: '冻干鸡胸肉', treat: '金枪鱼猫条', supp: '益生菌', med: '大宠爱外驱' };
    document.getElementById('fieldName').placeholder = '如：' + (nameExamples[catKey] || nameExamples.dry);
    var presetMonths = catKey === 'dry' ? [12, 18, 21, 24] : catKey === 'can' ? [24, 36] : [12, 24, 36];
    document.getElementById('stockShelfPresetOptions').innerHTML = presetMonths.map(function (months) {
      return '<button type="button" data-preset-months="' + months + '" class="pill-chip">' + months + '个月</button>';
    }).join('');
    UI.renderStockDateEstimate();
    syncItemSubtype(catKey);
    if (applyDefaults && MP.FOOD_SUBTYPES[catKey]?.innerUnits) {
      document.getElementById('fieldUnit').value = configuredInnerUnit(catKey);
    }
    renderStockWeightPresets(catKey);
    UI.syncModalPhotoUI();

    var palTitle = document.getElementById('palatabilityFieldTitle');
    var bLove = document.getElementById('palBtnLove');
    var bOk = document.getElementById('palBtnOk');
    var bCoax = document.getElementById('palBtnCoax');
    var bMeh = document.getElementById('palBtnMeh');
    if (catKey === 'med') {
      if (palTitle) palTitle.innerHTML = Utils.getCategoryIcon('med', 20) + ' 给药反应与耐受度记录';
      if (bLove) bLove.textContent = '无异常';
      if (bOk) bOk.textContent = '好喂';
      if (bCoax) bCoax.textContent = '抗拒';
      if (bMeh) bMeh.textContent = '不适';
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
    UI.syncModalUnitPriceHint();
  };

  var flavorRatingOptions = { '': '未测', love: '超爱', ok: '正常', coax: '需哄', meh: '不吃' };

  function flavorRatingContent(key) {
    var icon = key ? Utils.getPalatabilityIcon(key)
      : '<svg class="pal-cat-face-inline" width="16" height="16" viewBox="0 0 36 36" aria-hidden="true">' +
        '<use href="#pal-cat-base"></use><use href="#pal-cat-green-eyes"></use></svg>';
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
    var sealToggle = document.getElementById('stockPackSealToggle');
    sealToggle.checked = document.getElementById('fieldPackSeal').value === 'shared';
    sealToggle.disabled = !packaging || editing;
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
    var pack = UI.readPurchasePackaging();
    var qty = document.getElementById('fieldQty');
    var unitField = document.getElementById('fieldUnit');
    var total = pack ? pack.count * pack.size : 0;
    document.getElementById('purchasePackagingFields').classList.toggle('hidden-view', !enabled);
    document.getElementById('stockPackOptions').classList.toggle('hidden-view', !enabled);
    document.getElementById('stockInnerPackageLabel').textContent = enabled ? '内包装' : '包装';
    var unitContainer = document.getElementById('stockInnerPackage');
    var unitParent = document.getElementById(enabled ? 'stockPackGrid' : 'stockQuantityGrid');
    if (unitContainer.parentElement !== unitParent) unitParent.append(unitContainer);
    var locked = Boolean(MP.FOOD_SUBTYPES[MP.state.formCat]?.innerUnits);
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
      ? '共用一个密封包装：整批一起计算开封保鲜期。'
      : '各件独立密封：每件单独计算开封保鲜期。';
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
      unit.value = !editing && MP.FOOD_SUBTYPES[item.category]?.innerUnits ? configuredInnerUnit(item.category) : item.unit;
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

  UI.openingDateError = function (date, productionDate) {
    if (date > Utils.getTodayStr()) return '开封日期不能晚于今天';
    if (date && productionDate && date < productionDate) return '开封日期不能早于生产日期';
    return '';
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
    document.getElementById('freshUntilCol').classList.toggle('hidden-view', historical);
    document.getElementById('finishedDateColWrap').classList.toggle('hidden-view', !historical);
    var countUnit = item ? item.unit : document.getElementById('fieldUnit').value;
    document.getElementById('openedCheckboxTitle').textContent = historical ? '历史批次日期' : '已拆封 ' + Utils.formatQuantity(count, countUnit || '件');
    document.getElementById('openingSubtitle').textContent = historical ? '用于计算实际消耗天数' : '单独计算开封保鲜期';

    var date = openedInput.value;
    var limitInput = document.getElementById('fieldOpenLimit');
    var validLimit = limitInput.validity.valid ? Number(limitInput.value) : 0;
    var error = !openedInput.disabled && (UI.openingDateError(date, document.getElementById('fieldProdDate').value) ||
      (!historical && !date ? '请选择开封日期' : ''));
    openedInput.setAttribute('aria-invalid', String(Boolean(error)));
    document.getElementById('openedDateError').textContent = error || '';
    var days = count && !error ? Utils.openShelfDaysRemaining(date, validLimit) : null;
    document.getElementById('fieldFreshUntil').value = days === null ? '—' : Utils.formatCnDateText(Utils.openShelfEndDate(date, validLimit));
    var remaining = document.getElementById('openingDaysLeft');
    remaining.textContent = days === null ? '' : (days < 0 ? '已超 ' : '剩 ') + Utils.formatDays(days).text;
    remaining.classList.toggle('is-urgent', ['expired', 'urgent'].includes(Utils.formatDays(days).tone));
    UI.syncAllDateDisplays();
  };

  UI.syncStockRequiredProgress = function () {
    var weight = document.getElementById('fieldNetWeight');
    var qty = document.getElementById('fieldQty');
    var completed = [
      document.getElementById('fieldBrand').value.trim(),
      document.getElementById('fieldName').value.trim(),
      !weight.required || Number(weight.value) > 0,
      qty.validity.valid && Number(qty.value) > 0
    ].filter(Boolean).length;
    document.getElementById('requiredProgress').value = completed;
    document.getElementById('requiredProgressText').textContent = '必填 ' + completed + '/4';
  };

  UI.selectStockDateMode = function (mode) {
    var picker = document.getElementById('stockDateMode');
    var editing = Boolean(document.getElementById('fieldId').value);
    picker.dataset.mode = mode;
    picker.classList.toggle('hidden-view', editing);
    document.getElementById('stockProductionField').classList.toggle('hidden-view', !editing && mode === 'expiry');
    document.getElementById('stockExpiryField').classList.toggle('hidden-view', !editing && mode === 'production');
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
      ? (byExpiry ? '生产日期：' : '过期日期：') + derived.value : '填保质期后自动推算';
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
        document.getElementById('dateCalcHint').textContent = '已根据生产日期和保质期算出过期日期';
        UI.syncAllDateDisplays();
      }
    }
  };

  function resetFormProductionDate(value) {
    var input = document.getElementById('fieldProdDate');
    input.value = value || '';
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
    document.getElementById('modalTitle').textContent = '录入商品';
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldBrand').value = '';
    document.getElementById('fieldName').value = '';
    document.getElementById('fieldSpec').value = '';
    resetNewStockQuantity('1');
    resetFormProductionDate('');
    document.getElementById('fieldShelfValue').value = '';
    document.getElementById('fieldShelfUnit').value = 'months';
    document.getElementById('fieldExpDate').value = '';
    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldLocation').value = '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = '';
    document.getElementById('dateCalcHint').textContent = '';

    st.formImage = '';
    document.getElementById('fieldPhotoInput').value = '';
    var defaultCat = MP.CATEGORIES[st.catFilter] ? st.catFilter : 'dry';
    document.getElementById('fieldUnit').disabled = false;
    resetSubtypeForm();
    UI.syncModalCategoryUI(defaultCat, true);
    UI.syncNetWeight(true);
    setPurchasePackagingForm();
    UI.autoComputeExpDate();
    UI.syncModalCurrencyUI('CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'closeItemModalBtn');
    document.querySelector('#itemForm .stock-form-body').scrollTop = 0;
    UI.syncQuickLocationFade();
  };

  UI.openEditModal = function (id, focusId) {
    var item = MP.state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    document.getElementById('modalTitle').textContent = '编辑商品';
    document.getElementById('fieldId').value = item.id;
    document.getElementById('fieldIsRestockMode').value = '';
    document.getElementById('cloneBatchFromEditWrap').classList.remove('hidden-view');
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    document.getElementById('fieldQty').value = String(item.quantity !== undefined ? item.quantity : 1);
    resetFormProductionDate(item.prodDate);
    document.getElementById('fieldShelfValue').value = item.shelfLifeValue ? String(item.shelfLifeValue) : '';
    document.getElementById('fieldShelfUnit').value = item.shelfLifeUnit || 'months';
    document.getElementById('fieldExpDate').value = item.expDate || '';
    document.getElementById('fieldIsOpened').checked = Boolean(item.isOpened);
    document.getElementById('fieldOpenedDate').value = (item.quantity > 0 ? item.openedDate : item.archivedOpenedDate || item.openedDate) || '';
    document.getElementById('fieldFinishedDate').value = item.finishedDate || '';
    document.getElementById('fieldOpenLimit').value = item.openDaysLimit === null ? '' : String(item.openDaysLimit || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = item.batchCode || '';
    document.getElementById('fieldNotes').value = item.notes || '';
    document.getElementById('dateCalcHint').textContent = '';

    MP.state.formImage = item.imageData || '';
    document.getElementById('fieldPhotoInput').value = '';
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    setPurchasePackagingForm(item);
    UI.syncNetWeight(true);
    var netWeightInput = document.getElementById('fieldNetWeight');
    if (item.unit_net_weight_g > 0) {
      netWeightInput.value = item.unit_net_weight_g;
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
    UI.syncQuickLocationFade();
  };

  UI.openRestockModal = function (item) {
    if (!item) return;
    document.getElementById('modalTitle').textContent = '同款复购入库（新建批次）';
    document.getElementById('cloneBatchFromEditWrap').classList.add('hidden-view');
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldIsRestockMode').value = '1';
    document.getElementById('fieldBrand').value = item.brand || '';
    document.getElementById('fieldName').value = item.name || '';
    document.getElementById('fieldSpec').value = item.spec || '';
    var defaultNewQty = Number(item.lastQuantity) > 0 ? Number(item.lastQuantity) : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
    resetNewStockQuantity(String(defaultNewQty));

    var sVal = item.shelfLifeValue ? Number(item.shelfLifeValue) : ((MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultShelfMonths || 18);
    var sUnit = item.shelfLifeUnit || 'months';
    resetFormProductionDate(item.prodDate);
    UI.setProductionDatePending(Boolean(item.prodDate));
    document.getElementById('fieldShelfValue').value = String(sVal);
    document.getElementById('fieldShelfUnit').value = sUnit;
    document.getElementById('fieldExpDate').value = '';
    UI.autoComputeExpDate();
    document.getElementById('dateCalcHint').textContent = item.prodDate ? '请核对新批次的生产日期与过期日期' : '';

    document.getElementById('fieldIsOpened').checked = false;
    document.getElementById('fieldOpenedDate').value = '';
    document.getElementById('fieldFinishedDate').value = '';
    document.getElementById('fieldOpenLimit').value = item.openDaysLimit === null ? '' : String(item.openDaysLimit || (MP.CATEGORIES[item.category] || MP.CATEGORIES.dry).defaultOpenDays || 45);
    document.getElementById('fieldLocation').value = item.location || '';
    document.getElementById('fieldBatch').value = '';
    document.getElementById('fieldNotes').value = item.notes || '';

    MP.state.formImage = item.imageData || '';
    document.getElementById('fieldPhotoInput').value = '';
    resetSubtypeForm(item, Boolean(document.getElementById('fieldId').value));
    UI.syncModalCategoryUI(item.category || 'dry', false);
    setPurchasePackagingForm(item);
    UI.syncNetWeight(true);
    if (item.unit_net_weight_g > 0) document.getElementById('fieldNetWeight').value = item.unit_net_weight_g;
    UI.syncModalCurrencyUI(item.currency || MP.state.settings.defaultCurrency || 'CNY');
    UI.syncModalPalatabilityUI('');
    UI.syncOpenedFieldsVisibility();
    UI.renderQuickBrandChips();
    UI.syncAllDateDisplays();
    UI.showModal('itemModalBackdrop', 'closeItemModalBtn');
    document.querySelector('#itemForm .stock-form-body').scrollTop = 0;
    UI.syncQuickLocationFade();
    UI.showToast('已带入同款资料，请确认新批次日期与数量');
  };

  UI.closeItemModal = function () {
    UI.hideModal('itemModalBackdrop');
  };

  UI.openLightbox = function (item) {
    if (!item) return;
    document.getElementById('lightboxTitle').textContent = (item.brand || '') + ' · ' + (item.name || '');
    document.getElementById('lightboxImg').src = MP.getItemCoverSrc(item);
    document.getElementById('lightboxMeta').textContent =
      '生产日期：' + Utils.formatListDate(item.prodDate, '未填写') + ' ｜ 过期日期：' + Utils.formatListDate(item.expDate) + (item.batchCode ? (' ｜ ' + item.batchCode) : '');
    UI.showModal('photoPreviewBackdrop', 'closeLightboxBtn');
  };

  UI.closeLightbox = function () {
    UI.hideModal('photoPreviewBackdrop');
  };

})(typeof window !== 'undefined' ? window : globalThis);
