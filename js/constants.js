/* Meow Pantry Constants & Category Taxonomy (Food vs Supplement vs Medicine) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};

  MP.APP_VERSION = '3.0.0';
  MP.SCHEMA_VERSION = 3;

  // Storage keys strictly preserved for 100% backward compatibility with existing user data
  MP.STORAGE_KEYS = {
    ITEMS: 'meow_pantry_v1_data',
    SETTINGS: 'meow_pantry_v1_settings',
    LOGS: 'meow_pantry_v1_logs',
    STOCK_HISTORY: 'meow_pantry_v1_stock_history',
    LOCAL_STATE: 'meow_pantry_local_state',
    PRE_RESTORE_SNAPSHOT: 'meow_pantry_v1_pre_restore_snapshot'
  };

  MP.IDB_CONFIG = {
    NAME: 'MeowPantryLocalDB',
    VERSION: 1,
    STORE: 'kv'
  };

  MP.MAX_STOCK_HISTORY = 500;

  // Explicit `group` property cleanly separates ordinary food, supplements, and medicine!
  MP.CATEGORIES = {
    dry:    { label: '猫粮',   group: 'food', defaultUnit: '袋', defaultOpenDays: 45, defaultShelfMonths: 18 },
    can:    { label: '湿粮',   group: 'food', defaultUnit: '罐', defaultOpenDays: 3,  defaultShelfMonths: 24 },
    freeze: { label: '冻干',   group: 'food', defaultUnit: '包', defaultOpenDays: 60, defaultShelfMonths: 18 },
    treat:  { label: '零食',   group: 'food', defaultUnit: '盒', defaultOpenDays: 14, defaultShelfMonths: 18 },
    supp:   { label: '营养品', group: 'supp', defaultUnit: '瓶', defaultOpenDays: 90, defaultShelfMonths: 24 },
    med:    { label: '药品',   group: 'med',  defaultUnit: '支', defaultOpenDays: 30, defaultShelfMonths: 36 }
  };

  MP.CATEGORY_GROUPS = {
    food: { key: 'food', label: '普通食品', cats: ['dry', 'can', 'freeze', 'treat'] },
    supp: { key: 'supp', label: '营养品',   cats: ['supp'] },
    med:  { key: 'med',  label: '药品护理', cats: ['med'] }
  };

  MP.CURRENCIES = {
    CNY: { code: 'CNY', label: '人民币', prefix: 'CN¥', unitWord: '元' },
    JPY: { code: 'JPY', label: '日元',   prefix: 'JP¥', unitWord: '円' }
  };

  MP.FOOD_SUBTYPES = {
    can: { label: '包装类型', options: ['罐头', '餐盒', '餐包'], innerUnits: { '罐头': '罐', '餐盒': '杯', '餐包': '包' } },
    freeze: { label: '冻干类型', options: ['主食冻干', '零食冻干'] }
  };

  MP.NURSING_REMINDER_DAYS = {
    梳毛: 3, 剪指甲: 14, 洗耳朵: 14, 刷牙: 1, 洗澡: 30, 清理眼屎: 0, 其他: 0
  };

  MP.FEED_PORTION_PRESETS = {
    dry: ['15g', '30g', '50g'],
    freeze: ['15g', '30g', '50g'],
    treat: ['15g', '30g', '50g'],
    can: ['0.5', '0.34', '1']
  };

  MP.STOCK_WEIGHT_PRESETS = {
    dry: [400, 1500, 1800, 4500, 5400],
    treat: [30, 50, 100],
    supp: [30, 60, 100],
    med: [1, 5, 10]
  };

  MP.PALATABILITY = {
    love: { label: '超爱吃', suppLabel: '主动爱吃', medLabel: '顺利无异常', bg: 'var(--accent-soft)', text: 'var(--accent-strong)' },
    ok:   { label: '正常吃', suppLabel: '拌粮顺吃', medLabel: '顺畅好喂',   bg: 'var(--warn-soft)', text: 'var(--status-warning-text)' },
    coax: { label: '需哄吃', suppLabel: '需哄喂',   medLabel: '抗拒/流口水', bg: 'var(--info-bg)', text: 'var(--info-text)' },
    meh:  { label: '不爱吃', suppLabel: '抗拒拒食', medLabel: '软便/不适',   bg: 'var(--status-neutral-bg)', text: 'var(--text-main)' }
  };

  MP.STOCK_ACTION_META = {
    create:  { label: '新购入库', icon: 'package-plus', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'in' },
    restock: { label: '同款复购', icon: 'shopping-cart', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'in' },
    open:    { label: '拆封启用', icon: 'lock-open', bg: 'var(--accent-soft)', text: 'var(--accent-strong)', group: 'consume' },
    unopen:  { label: '取消拆封', icon: 'lock', bg: 'var(--status-neutral-bg)', text: 'var(--text-muted)', group: 'adjust' },
    partial: { label: '分顿投喂', icon: 'utensils', bg: 'var(--warn-soft)', text: 'var(--status-warning-text)', group: 'consume' },
    consume: { label: '吃完核销', icon: 'circle-check', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'consume' },
    revert:  { label: '撤回退库', icon: 'refresh-cw', bg: 'var(--purple-bg)', text: 'var(--purple-text)', group: 'adjust' },
    adjust:  { label: '手动改库存', icon: 'pencil', bg: 'var(--status-neutral-bg)', text: 'var(--text-main)', group: 'adjust' },
    delete:  { label: '删除批次', icon: 'trash-2', bg: 'var(--danger-soft)', text: 'var(--status-danger-text)', group: 'adjust' }
  };

  MP.COMMON_BRANDS = [
    '渴望 Orijen', '爱肯拿 Acana', '巅峰 ZiwiPeak', 'K9 Natural',
    '法米娜 Farmina', '百利 Instinct', '小李子 Leonardo', '鲜朗', '诚实一口', '金故',
    '红狗 RedDog', '骏宝 GimCat', '大宠爱 Revolution', '博来恩 Broadline', '海乐妙 Milprazon', '爱沃克 Advocate'
  ];

  MP.COMMON_LOCATIONS = ['真空储粮桶', '餐边柜', '储物柜', '冰箱冷藏', '零食抽屉', '医药箱'];

  MP.getCategoryGroup = function (catKey) {
    var c = MP.CATEGORIES[catKey];
    return c ? c.group : 'food';
  };

  MP.isFoodCategory = function (catKey) {
    return MP.getCategoryGroup(catKey) === 'food';
  };

  MP.getItemPalatability = function (item) {
    if (!item) return '';
    if (!item.flavors?.length) return item.palatability || '';
    var first = item.flavors[0].palatability || '';
    return item.flavors.every(function (flavor) { return (flavor.palatability || '') === first; })
      ? first : 'mixed';
  };

  MP.getPalatabilityBadgeInfo = function (item) {
    var key = MP.getItemPalatability(item);
    if (key === 'mixed') return { key: key, label: '口味分化', bg: 'var(--status-neutral-bg)', text: 'var(--status-neutral-text)' };
    if (!Object.hasOwn(MP.PALATABILITY, key)) return null;
    var p = MP.PALATABILITY[key];
    var grp = MP.getCategoryGroup(item.category);
    var lbl = grp === 'med' ? p.medLabel : (grp === 'supp' ? p.suppLabel : p.label);
    return {
      key: key,
      icon: grp === 'med' ? { love: 'circle-check', ok: 'pill', coax: 'droplet', meh: 'triangle-alert' }[key] : '',
      label: lbl,
      bg: p.bg,
      text: p.text
    };
  };

  MP.getItemCoverSrc = function (item) {
    if (item && item.imageData && typeof item.imageData === 'string' && item.imageData.length > 20) {
      return item.imageData;
    }
    var cat = (item && item.category && MP.CATEGORIES[item.category]) ? item.category : 'dry';
    var covers = MP.COVERS || {};
    return covers[cat] || covers.dry || '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
