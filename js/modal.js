/* Meow Pantry shared modal lifecycle, focus management, and keyboard accessibility */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};
  var UI = MP.UI = MP.UI || {};
  var modalReturnFocus = new WeakMap();
  var modalAccessibilityReady = false;
  var pendingConfirmFn = null;
  var pendingAlternativeFn = null;

  function getVisibleModals() {
    return Array.prototype.filter.call(document.querySelectorAll('.modal-backdrop[role="dialog"]'), function (modal) {
      return !modal.classList.contains('hidden-view');
    });
  }

  function getFocusableElements(modal) {
    return Array.prototype.filter.call(modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]):not([hidden]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ), function (el) {
      return !el.closest('.hidden-view');
    });
  }

  UI.showModal = function (modalId, preferredFocusId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modalReturnFocus.set(modal, document.activeElement);
    modal.classList.remove('hidden-view');
    document.body.classList.add('modal-open');
    var preferred = preferredFocusId ? document.getElementById(preferredFocusId) : null;
    var focusable = getFocusableElements(modal);
    var target = preferred && !preferred.disabled ? preferred : focusable[0];
    if (target) global.setTimeout(function () { target.focus(); }, 0);
  };

  UI.hideModal = function (modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('hidden-view');
    if (!getVisibleModals().length) document.body.classList.remove('modal-open');
    var returnTarget = modalReturnFocus.get(modal);
    modalReturnFocus.delete(modal);
    if (returnTarget && typeof returnTarget.focus === 'function' && document.contains(returnTarget)) {
      global.setTimeout(function () { returnTarget.focus(); }, 0);
    }
  };

  UI.initModalAccessibility = function () {
    if (modalAccessibilityReady) return;
    modalAccessibilityReady = true;
    document.addEventListener('keydown', function (event) {
      var visible = getVisibleModals();
      var modal = visible[visible.length - 1];
      if (!modal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        var closers = {
          pantryDetailBackdrop: UI.closePantryDetail,
          confirmModalBackdrop: UI.closeConfirm,
          flavorOpenModalBackdrop: UI.closeFlavorOpenModal,
          itemModalBackdrop: UI.closeItemModal,
          feedModalBackdrop: UI.closeFeedModal,
          historyModalBackdrop: UI.closeStockHistoryModal,
          photoPreviewBackdrop: UI.closeLightbox
        };
        if (closers[modal.id]) closers[modal.id]();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = getFocusableElements(modal);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  };

  UI.syncRedemptionPortion = function () {
    var stock = document.getElementById('confirmStockQuantity');
    var input = document.getElementById('confirmMealQuantity');
    var multiple = Number(stock.value) > 1;
    var visible = multiple && document.getElementById('confirmExtraCheckbox').checked;
    document.getElementById('confirmMealQuantityWrap').classList.toggle('hidden-view', !visible);
    input.max = multiple ? stock.value : '';
    input.value = '';
  };

  UI.openConfirm = function (title, message, okLabel, onConfirm, extraOpt) {
    var deleteLog = extraOpt && extraOpt.deleteLog;
    document.getElementById('confirmModalBackdrop').classList.toggle('confirm-delete-log', Boolean(deleteLog));
    document.getElementById('confirmModalBackdrop').classList.toggle('confirm-open-action', Boolean(extraOpt && extraOpt.confirmTone === 'accent'));
    if (deleteLog) {
      document.getElementById('deleteLogCategoryIcon').innerHTML = MP.Utils.getCategoryIcon(deleteLog.category);
      document.getElementById('deleteLogName').textContent = deleteLog.name;
      document.getElementById('deleteLogMeta').textContent = deleteLog.meta;
      document.getElementById('deleteLogAmount').textContent = deleteLog.amount;
      document.getElementById('deleteLogRestoreAmount').textContent = deleteLog.restore;
    }
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOkBtn').textContent = okLabel || '确定';
    document.getElementById('confirmOkBtn').disabled = false;
    var extraWrap = document.getElementById('confirmExtraOptionWrap');
    var extraChk = document.getElementById('confirmExtraCheckbox');
    var extraLbl = document.getElementById('confirmExtraLabel');
    if (extraOpt && extraOpt.label) {
      extraWrap.classList.remove('hidden-view');
      extraChk.checked = Boolean(extraOpt.defaultChecked);
      extraLbl.innerHTML = MP.Utils.iconLabel(extraOpt.icon, extraOpt.label);
    } else {
      extraWrap.classList.add('hidden-view');
      extraChk.checked = false;
    }
    var stock = document.getElementById('confirmStockQuantity');
    var redemption = extraOpt && extraOpt.redemption;
    stock.options.length = 0;
    if (redemption) {
      if (redemption.quantity > 1 && !redemption.all) stock.add(new Option('1' + redemption.unit, '1'));
      stock.add(new Option('剩余全部 ' + redemption.quantity + redemption.unit, redemption.quantity));
    }
    document.getElementById('confirmStockQuantityWrap').classList.toggle('hidden-view', !redemption || stock.options.length < 2);
    var discard = extraOpt && extraOpt.discard;
    var discardWrap = document.getElementById('confirmDiscardQuantityWrap');
    var discardInput = document.getElementById('confirmDiscardQuantity');
    discardWrap.classList.toggle('hidden-view', !discard);
    if (discard) {
      document.getElementById('confirmDiscardQuantityLabel').textContent = '丢弃数量（最多 ' +
        MP.Utils.formatQuantity(discard.quantity, discard.unit) + '）';
      discardInput.value = String(discard.quantity);
      discardInput.max = String(discard.quantity);
      discardInput.min = discard.whole ? '1' : '0.01';
      discardInput.step = discard.whole ? '1' : '0.01';
      discardInput.readOnly = Boolean(discard.fixed);
    }
    var restoreWrap = document.getElementById('confirmRestoreModeWrap');
    restoreWrap.classList.toggle('hidden-view', !(extraOpt && extraOpt.restoreMode));
    if (extraOpt && extraOpt.restoreMode) restoreWrap.querySelector('[value="merge"]').checked = true;
    var openDateWrap = document.getElementById('confirmOpenDateWrap');
    if (extraOpt && extraOpt.openDateItem) {
      openDateWrap.classList.remove('hidden-view');
      UI.prepareOpenDatePicker(openDateWrap, extraOpt.openDateItem, extraOpt.openDate || MP.Utils.getTodayStr());
    } else {
      openDateWrap.classList.add('hidden-view');
      openDateWrap.dataset.itemId = '';
    }
    UI.syncRedemptionPortion();
    pendingConfirmFn = onConfirm;
    pendingAlternativeFn = extraOpt && extraOpt.onAlternative;
    document.getElementById('confirmCancelBtn').textContent = (extraOpt && extraOpt.alternativeLabel) || '取消';
    UI.showModal('confirmModalBackdrop', (discard || (extraOpt && extraOpt.restoreMode)) ? 'confirmCancelBtn' : 'confirmOkBtn');
  };

  UI.closeConfirm = function () {
    pendingConfirmFn = null;
    pendingAlternativeFn = null;
    UI.hideModal('confirmModalBackdrop');
  };

  UI.chooseConfirmAlternative = function () {
    var alternative = pendingAlternativeFn;
    UI.closeConfirm();
    if (alternative) alternative();
  };

  UI.consumePendingConfirm = function () {
    var fn = pendingConfirmFn;
    if (!fn) return;
    var checked = document.getElementById('confirmExtraCheckbox').checked;
    var quantity = Number(document.getElementById('confirmStockQuantity').value);
    var discardWrap = document.getElementById('confirmDiscardQuantityWrap');
    if (!discardWrap.classList.contains('hidden-view')) {
      var discardInput = document.getElementById('confirmDiscardQuantity');
      quantity = Number(discardInput.value);
      if (!discardInput.checkValidity() || !Number.isFinite(quantity) || quantity <= 0) {
        UI.showToast('请填写有效的丢弃数量');
        discardInput.focus();
        return;
      }
    }
    var restoreWrap = document.getElementById('confirmRestoreModeWrap');
    if (!restoreWrap.classList.contains('hidden-view')) {
      checked = restoreWrap.querySelector('[name="confirmRestoreMode"]:checked').value === 'merge';
    }
    var mealInput = document.getElementById('confirmMealQuantity');
    var mealQuantity = checked && quantity > 1 ? Number(mealInput.value) : quantity;
    var openDateWrap = document.getElementById('confirmOpenDateWrap');
    var openDate = '';
    if (!openDateWrap.classList.contains('hidden-view')) {
      var item = MP.state.items.find(function (entry) { return entry.id === openDateWrap.dataset.itemId; });
      var result = UI.syncOpenDatePicker(openDateWrap, item);
      if (result.error) {
        openDateWrap.querySelector('[data-open-date-input]').focus();
        return;
      }
      openDate = result.date;
    }
    if (!discardWrap.classList.contains('hidden-view')) mealQuantity = quantity;
    if (checked && !document.getElementById('confirmExtraOptionWrap').classList.contains('hidden-view') &&
        quantity > 1 && (!Number.isInteger(mealQuantity) || mealQuantity < 1 || mealQuantity > quantity)) {
      UI.showToast('请填写实际补记件数，不能超过核销数量');
      mealInput.focus();
      return;
    }
    UI.closeConfirm();
    if (openDate) fn(checked, quantity, mealQuantity, openDate);
    else fn(checked, quantity, mealQuantity);
  };
})(typeof window !== 'undefined' ? window : globalThis);
