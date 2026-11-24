/* Meow Pantry Constants & Category Taxonomy (Food vs Supplement vs Medicine) */
(function (global) {
  'use strict';
  var MP = global.MeowPantry = global.MeowPantry || {};

  MP.APP_VERSION = '3.0.0';
  MP.SCHEMA_VERSION = 4;
  MP.MAX_ITEM_IMAGES = 6;

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
    med:    { label: '药品',   group: 'med',  defaultUnit: '支', defaultOpenDays: 30, defaultShelfMonths: 36 },
    supplies: { label: '日用品', group: 'supplies', defaultUnit: '袋', defaultOpenDays: 90, defaultShelfMonths: null }
  };

  MP.CATEGORY_GROUPS = {
    food: { key: 'food', label: '普通食品', cats: ['dry', 'can', 'freeze', 'treat'] },
    supp: { key: 'supp', label: '营养品',   cats: ['supp'] },
    med:  { key: 'med',  label: '药品护理', cats: ['med'] },
    supplies: { key: 'supplies', label: '日用品', cats: ['supplies'] }
  };

  MP.CURRENCIES = {
    CNY: { code: 'CNY', label: '人民币', prefix: 'CN¥', unitWord: '元' },
    JPY: { code: 'JPY', label: '日元',   prefix: 'JP¥', unitWord: '円' }
  };

  MP.FOOD_SUBTYPES = {
    can: { label: '包装类型', options: ['罐头', '餐盒', '餐包'], innerUnits: { '罐头': '罐', '餐盒': '杯', '餐包': '包' } },
    freeze: { label: '冻干类型', options: ['主食冻干', '零食冻干', '冻干粉末'] },
    dry: { label: '商品形态', options: [], optional: true, hidden: true },
    treat: { label: '商品形态', options: ['猫条', '肉干', '饼干', '洁齿', '奶制品', '其他'], optional: true },
    supp: { label: '商品形态', options: ['粉剂', '膏剂', '液体', '片剂', '胶囊'], optional: true },
    med: { label: '药品形态', options: ['片剂', '胶囊', '膏剂', '滴剂/液体'], custom: true, optional: true },
    supplies: { label: '日用品类型', options: ['猫砂', '清洁用品', '一次性用品', '配件耗材'], optional: true }
  };

  // Single source of truth for nursing projects used by the form and daily details.
  MP.NURSING_PROJECTS = {
    梳毛: { icon: 'brush', reminderDays: 3 },
    剪指甲: { icon: 'scissors', reminderDays: 14 },
    洗耳朵: { icon: 'ear', reminderDays: 14 },
    刷牙: { icon: 'sparkles', reminderDays: 1 },
    洗澡: { icon: 'bath', reminderDays: 30 },
    其他: { icon: 'clipboard-check', reminderDays: 0 }
  };

  MP.NURSING_REMINDER_DAYS = Object.fromEntries(Object.entries(MP.NURSING_PROJECTS).map(function (entry) {
    return [entry[0], entry[1].reminderDays];
  }));

  MP.getNursingProjectIcon = function (project) {
    return (MP.NURSING_PROJECTS[project] || MP.NURSING_PROJECTS.其他).icon;
  };

  MP.FEED_PORTION_PRESETS = {
    dry: ['15g', '30g', '50g'],
    freeze: ['15g', '30g', '50g'],
    treat: ['15g', '30g', '50g'],
    can: ['0.5', '0.34', '0.25', '1']
  };
  MP.FEED_USAGE_UNITS = ['支', '粒', '个', '块', '勺', '片', '滴', 'g', 'ml', '份'];
  MP.ITEM_FORM_DEFAULTS = { units: ['袋', '罐', '包', '盒', '支', '粒', '片', '瓶', '杯'], netWeightUnit: '克' };
  MP.ITEM_FORM_RULES = {
    can: {
      '罐头': { units: ['罐'], defaultUnit: '罐', conversionLayout: 'none' },
      '餐盒': { units: ['杯'], defaultUnit: '杯', conversionLayout: 'none' },
      '餐包': { units: ['包'], defaultUnit: '包', conversionLayout: 'none' }
    },
    freeze: {
      '主食冻干': { units: ['袋', '包'], defaultUnit: '袋', conversionLayout: 'none' },
      '零食冻干': { units: ['袋', '包'], defaultUnit: '袋', conversionLayout: 'inline', feedUnit: '块' },
      '冻干粉末': { units: ['袋', '包', '瓶'], defaultUnit: '袋', conversionLayout: 'inline', feedUnit: '勺', help: '填写后可按勺自动扣库存' }
    },
    treat: {
      '猫条': { units: ['支'], defaultUnit: '支', conversionLayout: 'none', feedUnit: '支' },
      '猫条／肉泥条': { units: ['支'], defaultUnit: '支', conversionLayout: 'none', feedUnit: '支' },
      '肉干': { units: ['袋', '包'], defaultUnit: '袋' },
      '饼干': { units: ['袋', '包'], defaultUnit: '袋' },
      '洁齿': { units: ['袋', '包'], defaultUnit: '袋' },
      '奶制品': { units: ['袋', '包'], defaultUnit: '袋' },
      '其他': { units: ['袋', '包'], defaultUnit: '袋' }
    },
    supp: {
      '粉剂': { conversionLayout: 'inline', feedUnit: '勺' },
      '膏剂': { conversionLayout: 'collapsible' },
      '液体': { conversionLayout: 'collapsible' },
      '片剂': { units: ['片', '粒', '包'], defaultUnit: '片', conversionLayout: 'none', feedUnit: '片' },
      '胶囊': { units: ['粒', '包'], defaultUnit: '粒', conversionLayout: 'none' }
    },
    med: {
      '片剂': { units: ['片', '粒', '包'], defaultUnit: '片', conversionLayout: 'none', feedUnit: '片' },
      '胶囊': { units: ['粒', '包'], defaultUnit: '粒', conversionLayout: 'none' },
      '膏剂': { conversionLayout: 'collapsible' },
      '滴剂/液体': { conversionLayout: 'inline', selectLiquidUnit: true }
    }
  };
  MP.EFFECT_TAG_PRESETS = {
    dry: { default: ['日常营养', '肠胃', '美毛', '洁齿', '泌尿', '体重管理'] },
    can: { default: ['日常营养', '补水', '肠胃', '美毛', '泌尿', '体重管理'] },
    freeze: {
      default: ['日常营养', '肠胃', '美毛', '排毛', '拌粮', '奖励'],
      '主食冻干': ['日常营养', '肠胃', '美毛', '排毛', '泌尿', '体重管理'],
      '零食冻干': ['奖励', '互动', '拌粮', '肠胃', '美毛', '排毛'],
      '冻干粉末': ['拌粮', '增加适口性', '肠胃', '美毛', '排毛', '日常营养']
    },
    treat: {
      default: ['奖励', '互动', '洁齿', '排毛', '美毛', '肠胃'],
      '猫条': ['奖励', '互动', '补水', '排毛', '美毛', '肠胃'],
      '肉干': ['奖励', '互动', '磨牙', '肠胃', '美毛', '补充营养'],
      '饼干': ['奖励', '互动', '洁齿', '排毛', '肠胃', '补充营养'],
      '洁齿': ['洁齿', '口腔护理', '奖励', '互动', '排毛', '肠胃'],
      '奶制品': ['奖励', '互动', '肠胃', '补充营养', '美毛', '补水']
    },
    supp: {
      default: ['肠胃', '美毛', '排毛', '口腔护理', '关节', '日常营养'],
      '膏剂': ['排毛', '肠胃', '美毛', '口腔护理', '补充营养', '日常营养'],
      '液体': ['补水', '肠胃', '美毛', '口腔护理', '补充营养', '日常营养']
    },
    med: {
      default: ['体内驱虫', '体外驱虫', '皮肤护理', '耳部护理', '眼部护理', '其他护理'],
      '片剂': ['体内驱虫', '肠胃', '皮肤护理', '关节', '日常护理', '其他护理'],
      '胶囊': ['体内驱虫', '肠胃', '皮肤护理', '关节', '日常护理', '其他护理'],
      '膏剂': ['皮肤护理', '外伤护理', '口腔护理', '眼部护理', '耳部护理', '其他护理'],
      '滴剂/液体': ['体外驱虫', '眼部护理', '耳部护理', '皮肤护理', '口腔护理', '其他护理']
    }
  };

  MP.STOCK_WEIGHT_PRESETS = {
    dry: [400, 1500, 1800, 4500, 5400],
    treat: [30, 50, 100],
    supp: [30, 60, 100],
    med: [1, 5, 10]
  };

  MP.SUPPLY_SPEC_UNITS = ['克', '千克', '毫升', '升', '片', '张'];
  MP.LEGACY_SUPPLY_SPEC_UNITS = ['包', '支', '瓶'];

  MP.PALATABILITY = {
    love: { label: '超爱吃', suppLabel: '主动爱吃', emoji: '😍', bg: 'var(--accent-soft)', text: 'var(--accent-strong)' },
    ok:   { label: '正常吃', suppLabel: '拌粮顺吃', emoji: '😋', bg: 'var(--warn-soft)', text: 'var(--status-warning-text)' },
    coax: { label: '需哄吃', suppLabel: '需哄喂',   emoji: '😐', bg: 'var(--info-bg)', text: 'var(--info-text)' },
    meh:  { label: '不爱吃', suppLabel: '抗拒拒食', emoji: '😣', bg: 'var(--status-neutral-bg)', text: 'var(--text-main)' }
  };

  MP.getPalatabilityEmoji = function (key) {
    return MP.PALATABILITY[key]?.emoji || (key === 'mixed' ? '🔀' : '❔');
  };

  MP.MEDICATION_OUTCOMES = {
    '':        { label: '未记录', emoji: '➖' },
    smooth:    { label: '顺利',   emoji: '✅' },
    coaxed:    { label: '需哄喂', emoji: '🥹' },
    resisted:  { label: '抗拒',   emoji: '🙅' },
    vomited:   { label: '吐了',   emoji: '🤮' }
  };

  MP.MEDICATION_PALATABILITY_OUTCOME = {
    love: 'smooth',
    ok: 'coaxed',
    coax: 'resisted',
    meh: 'vomited'
  };

  MP.getMedicationOutcomeInfo = function (value) {
    return MP.MEDICATION_OUTCOMES[Object.hasOwn(MP.MEDICATION_OUTCOMES, value) ? value : ''];
  };

  MP.STOCK_ACTION_META = {
    create:  { label: '新购入库', icon: 'package-plus', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'in' },
    restock: { label: '同款复购', icon: 'shopping-cart', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'in' },
    open:    { label: '拆封启用', icon: 'lock-open', bg: 'var(--accent-soft)', text: 'var(--accent-strong)', group: 'consume' },
    unopen:  { label: '取消拆封', icon: 'lock', bg: 'var(--status-neutral-bg)', text: 'var(--text-muted)', group: 'adjust' },
    partial: { label: '分顿投喂', icon: 'utensils', bg: 'var(--warn-soft)', text: 'var(--status-warning-text)', group: 'consume' },
    consume: { label: '吃完核销', icon: 'circle-check', bg: 'var(--ok-soft)', text: 'var(--ok)', group: 'consume' },
    discard: { label: '过期丢弃', icon: 'trash-2', bg: 'var(--danger-soft)', text: 'var(--status-danger-text)', group: 'adjust' },
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
    var medOutcome = grp === 'med' ? MP.MEDICATION_PALATABILITY_OUTCOME[key] : '';
    var medInfo = medOutcome ? MP.getMedicationOutcomeInfo(medOutcome) : null;
    var lbl = medInfo ? medInfo.label : (grp === 'supp' ? p.suppLabel : p.label);
    return {
      key: key,
      emoji: medInfo?.emoji,
      label: lbl,
      bg: p.bg,
      text: p.text
    };
  };

  MP.getItemImages = function (item) {
    if (!item) return [];
    var images = Array.isArray(item.images) ? item.images : [item.imageData || item.image];
    return images.filter(function (src) { return typeof src === 'string' && src.length > 20; });
  };

  MP.getItemCoverSrc = function (item) {
    var images = MP.getItemImages(item);
    if (images.length) return images[0];
    var cat = (item && item.category && MP.CATEGORIES[item.category]) ? item.category : 'dry';
    var covers = MP.COVERS || {};
    return covers[cat] || covers.dry || '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
