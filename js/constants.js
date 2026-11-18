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
    dry:    { label: '猫粮',   icon: '🥣', group: 'food', defaultUnit: '袋', defaultOpenDays: 45, defaultShelfMonths: 18 },
    can:    { label: '湿粮',   icon: '🥫', group: 'food', defaultUnit: '罐', defaultOpenDays: 2,  defaultShelfMonths: 24 },
    freeze: { label: '冻干',   icon: '🍗', group: 'food', defaultUnit: '包', defaultOpenDays: 60, defaultShelfMonths: 18 },
    treat:  { label: '零食',   icon: '🍮', group: 'food', defaultUnit: '盒', defaultOpenDays: 14, defaultShelfMonths: 18 },
    supp:   { label: '营养品', icon: '💊', group: 'supp', defaultUnit: '瓶', defaultOpenDays: 90, defaultShelfMonths: 24 },
    med:    { label: '药品',   icon: '🩺', group: 'med',  defaultUnit: '支', defaultOpenDays: 30, defaultShelfMonths: 36 }
  };

  MP.CATEGORY_GROUPS = {
    food: { key: 'food', label: '普通食品', icon: '🍽️', cats: ['dry', 'can', 'freeze', 'treat'] },
    supp: { key: 'supp', label: '营养品',   icon: '💊', cats: ['supp'] },
    med:  { key: 'med',  label: '药品护理', icon: '🩺', cats: ['med'] }
  };

  MP.CURRENCIES = {
    CNY: { code: 'CNY', label: '人民币', prefix: 'CN¥', unitWord: '元' },
    JPY: { code: 'JPY', label: '日元',   prefix: 'JP¥', unitWord: '円' }
  };

  MP.FOOD_SUBTYPES = {
    can: { label: '包装类型', options: ['罐头', '餐盒', '餐包'], units: ['罐', '盒', '袋'] },
    freeze: { label: '冻干类型', options: ['主食冻干', '零食冻干'] }
  };

  MP.PALATABILITY = {
    love: { label: '😍 超爱吃', suppLabel: '💊 主动爱吃', medLabel: '✅ 顺利无异常', bg: '#DCFCE7', text: '#15803D' },
    ok:   { label: '😋 正常吃', suppLabel: '😋 拌粮顺吃', medLabel: '💊 顺畅好喂',   bg: '#E0F2FE', text: '#0369A1' },
    coax: { label: '🥺 需哄吃', suppLabel: '🥺 需哄喂',   medLabel: '💦 抗拒/流口水', bg: '#FEF3C7', text: '#B45309' },
    meh:  { label: '😒 不爱吃', suppLabel: '😒 抗拒拒食', medLabel: '⚠️ 软便/不适',   bg: '#FEE2E2', text: '#B91C1C' }
  };

  MP.STOCK_ACTION_META = {
    create:  { label: '新购入库', icon: '📥', bg: '#DCFCE7', text: '#15803D', group: 'in' },
    restock: { label: '同款复购', icon: '🛒', bg: '#DCFCE7', text: '#15803D', group: 'in' },
    open:    { label: '拆封启用', icon: '🔓', bg: '#FFEDD5', text: '#C2410C', group: 'consume' },
    unopen:  { label: '取消拆封', icon: '🔒', bg: '#F5F5F4', text: '#57534E', group: 'adjust' },
    partial: { label: '分顿投喂', icon: '🥫', bg: '#FEF3C7', text: '#B45309', group: 'consume' },
    consume: { label: '吃完核销', icon: '✅', bg: '#E0F2FE', text: '#0369A1', group: 'consume' },
    revert:  { label: '撤回退库', icon: '🔄', bg: '#F3E8FF', text: '#7E22CE', group: 'adjust' },
    adjust:  { label: '手动改库存', icon: '✏️', bg: '#F5F5F4', text: '#44403C', group: 'adjust' },
    delete:  { label: '删除批次', icon: '🗑️', bg: '#FEE2E2', text: '#DC2626', group: 'adjust' }
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

  MP.getPalatabilityBadgeInfo = function (item) {
    if (!item || !item.palatability || !MP.PALATABILITY[item.palatability]) return null;
    var p = MP.PALATABILITY[item.palatability];
    var grp = MP.getCategoryGroup(item.category);
    var lbl = grp === 'med' ? p.medLabel : (grp === 'supp' ? p.suppLabel : p.label);
    return {
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
