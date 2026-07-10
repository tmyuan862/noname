// ============================================================
// config.js — 所有常量、配置、数据定义
// ============================================================

// ── 游戏阶段状态机 ──
export const PHASE = Object.freeze({
  MENU:       'menu',
  PLAYING:    'playing',
  PAUSED:     'paused',
  BOSS_FIGHT: 'boss_fight',
  GAME_OVER:  'game_over'
});

// ── 地图 ──
export const CELL = 24;
export const VIEW = 480;
export const VC = VIEW / CELL;        // 20
export const MAP = 40;

// ── 字体常量 ──
export const EMOJI_FONT = "20px 'Apple Color Emoji','Segoe UI Emoji',sans-serif";
export const STATUS_FONT = "bold 13px sans-serif"; // ★ 加大字体提升可读性

// ── ★ 物理调参常量（消除魔法数字）──
export const MIN_SPEED = 34;           // 最快速度上限 (ms/tick)
export const SPEED_BUFF_MULT = 0.6;    // 普通加速食物的速度倍率
export const RAINBOW_SPEED_MULT = 0.5; // 彩虹星加速倍率
export const SPRINT_SPEED_MULT = 0.55; // 疾跑靴冲刺倍率
export const BOSS_SPEED_BASE_MULT = 0.82; // Boss 残血加速的基础倍率
export const CAM_LERP = 0.18;          // 摄像机平滑跟随系数
export const SHAKE_DECAY = 0.85;       // 屏幕震动衰减系数
export const SHAKE_THRESHOLD = 0.4;    // 震动停止阈值
export const HEAD_SWELL_DECAY = 0.88;  // 蛇头膨胀衰减

// Buff 持续时长 (ms)
export const SPEED_BUFF_DUR = 5000;
export const SHIELD_DUR = 12000;
export const DIZZY_DUR = 3000;
export const MIRROR_DUR = 3000;
export const INVINCIBLE_SHORT = 1500;   // 蜕皮/护盾破碎无敌
export const INVINCIBLE_HIT = 2500;     // 受击后无敌
export const INVINCIBLE_RAINBOW = 2000; // 彩虹星无敌
export const RAINBOW_SPEED_DUR = 3500;  // 彩虹星加速持续
export const SPRINT_DUR = 800;          // 单件疾跑持续
export const SPRINT_DUR_AWAKEN = 1500;  // 双件觉醒疾跑持续
export const SPRINT_MIN_SPEED = 30;     // 疾跑速度下限
export const SPRINT_CD = 25000;         // 单件疾跑冷却
export const SPRINT_CD_AWAKEN = 12000;  // 双件觉醒疾跑冷却

// ── 难度配置 ──
export const DIFF = {
  easy:   { speed: 140, name: '简单', lives: 4 },
  normal: { speed: 98,  name: '普通', lives: 3 },
  hard:   { speed: 68,  name: '困难', lives: 2 },
  hell:   { speed: 42,  name: '地狱', lives: 1 }
};
export const DIFF_MULT = { easy: 1, normal: 2, hard: 4, hell: 8 };
export const MODE_NAME = { classic: '经典', level: '闯关', chaos: '混沌', bossRush: '挑战赛' };

// ★ 优化：排行榜规范化反向映射表，同时支持中英双向查找 ──
export const MODE_REVERSE = {
  classic: { cn: '经典', key: 'classic' }, level: { cn: '闯关', key: 'level' },
  chaos: { cn: '混沌', key: 'chaos' }, bossRush: { cn: '挑战赛', key: 'bossRush' },
  '经典': { cn: '经典', key: 'classic' }, '闯关': { cn: '闯关', key: 'level' },
  '混沌': { cn: '混沌', key: 'chaos' }, '挑战赛': { cn: '挑战赛', key: 'bossRush' }
};
export const DIFF_REVERSE = {
  easy: { cn: '简单', key: 'easy' }, normal: { cn: '普通', key: 'normal' },
  hard: { cn: '困难', key: 'hard' }, hell: { cn: '地狱', key: 'hell' },
  '简单': { cn: '简单', key: 'easy' }, '普通': { cn: '普通', key: 'normal' },
  '困难': { cn: '困难', key: 'hard' }, '地狱': { cn: '地狱', key: 'hell' }
};

// ── localStorage 键名 ──
export const KEY_BEST  = 's_b';
export const KEY_HIST  = 's_h';
export const KEY_GOLD  = 's_g';
export const KEY_GHOST = 's_gh';
export const KEY_USE_DPAD = 's_dpad';
export const KEY_LAST_REDEEM = 's_rd';

// ── 皮肤系统 ──
export const SKINS = {
  classic: { name: '经典绿', emoji: '🐍', color: '#00ffaa', price: 0 },
  neon:    { name: '霓虹紫', emoji: '🦎', color: '#d500f9', price: 200 },
  flame:   { name: '火焰',   emoji: '🐲', color: '#ff6d00', price: 300 },
  frost:   { name: '冰霜',   emoji: '🐉', color: '#00e5ff', price: 300 },
  gold:    { name: '暗金',   emoji: '👑', color: '#ffd700', price: 500 },
  pixel:   { name: '像素',   emoji: '👾', color: '#aaffaa', price: 400 }
};

// ── 装备系统 ──
export const EQUIPS = {
  none:   { name: '空槽',     icon: '➖', id: 'none' },
  magnet: { name: '磁铁',     icon: '🧲', id: 'magnet', desc: '吸引3格内食物' },
  thorn:  { name: '荆棘甲',   icon: '🛡️', id: 'thorn',  desc: '敌人撞你反伤' },
  sprint: { name: '疾跑靴',   icon: '👟', id: 'sprint', desc: '每25秒冲刺一次' },
  radar:  { name: '食物雷达', icon: '📡', id: 'radar',  desc: '小地图显示食物位置' }
};

// ── 成就系统 ──
export const ACHIEVEMENTS = [
  { id: 'a1',  name: '初出茅庐',   desc: '首次得分 ≥ 50',           icon: '🥚', check: s => s.score >= 50 },
  { id: 'a2',  name: '小试牛刀',   desc: '首次得分 ≥ 200',          icon: '🐣', check: s => s.score >= 200 },
  { id: 'a3',  name: '猎人执照',   desc: '单局击杀 5 只敌蛇',       icon: '⚔️', check: s => s.kills >= 5 },
  { id: 'a4',  name: '屠蛇大师',   desc: '单局击杀 10 只敌蛇',      icon: '🗡️', check: s => s.kills >= 10 },
  { id: 'a5',  name: '屠龙勇士',   desc: '击杀 1 个 Boss',          icon: '🏆', check: s => s.bossKilled >= 1 },
  { id: 'a6',  name: 'Boss终结者', desc: '单局击杀 3 个 Boss',      icon: '👑', check: s => s.bossKilled >= 3 },
  { id: 'a7',  name: '连击大师',   desc: '达成 10 连击',             icon: '🔥', check: s => s.maxCombo >= 10 },
  { id: 'a8',  name: '混沌主宰',   desc: '混沌模式得分 ≥ 500',      icon: '🌀', check: s => s.mode === '混沌' && s.score >= 500 },
  { id: 'a9',  name: '地狱使者',   desc: '地狱难度得分 ≥ 300',      icon: '💀', check: s => s.diff === '地狱' && s.score >= 300 },
  { id: 'a10', name: '金币猎人',   desc: '单局吃掉 20 个金币',       icon: '💰', check: s => s.coinEaten >= 20 },
  { id: 'a11', name: '金币富翁',   desc: '累计攒够 500 金币',        icon: '🪙', check: () => false },
  { id: 'a12', name: '皮肤收藏家', desc: '拥有全部 6 种皮肤',        icon: '🎨', check: () => false }
];

// ── 每日任务 ──
export const BASE_MISSIONS = [
  { id: 'm1', desc: '完成 3 局游戏',       goal: 3, reward: 30 },
  { id: 'm2', desc: '单局得分 ≥ 500',       goal: 1, reward: 50 },
  { id: 'm3', desc: '击杀 1 个 Boss',       goal: 1, reward: 40 },
  { id: 'm4', desc: '混沌模式完成 1 局',     goal: 1, reward: 35 },
  { id: 'm5', desc: '地狱难度完成 1 局',     goal: 1, reward: 45 }
];

// ── 天气系统 ──
export const WEATHERS = [
  { id: 'acid',     name: '☣️ 酸雨',   dur: 7000 },
  { id: 'foodRain', name: '🍎 食物雨', dur: 6000 },
  { id: 'dark',     name: '🌑 黑暗',   dur: 5000 },
  { id: 'quake',    name: '🌋 地震',   dur: 5000 }
];

export const WEATHER_NAME = WEATHERS.reduce((m, w) => (m[w.id] = w.name, m), {});

// ★ 优化：食物效果查找表 — 共享于 applyFood() 和 applyMysteryBox() ──
// gain: 分数倍率, pop: 弹出节数, dur: 效果持续时间(ms)
// 特殊标志：cntLvl=false 时不计关卡进度, special=类型名触发特殊分支
export const FOOD_EFFECT = {
  normal:  { gain: 1,  pop: 0, cntLvl: true  },
  double:  { gain: 2,  pop: 0, cntLvl: true  },
  speed:   { gain: 1,  pop: 0, cntLvl: true,  speed: { dur: SPEED_BUFF_DUR,  mult: SPEED_BUFF_MULT } },
  shrink:  { gain: 1,  pop: 4, cntLvl: true  },
  shield:  { gain: 1,  pop: 0, cntLvl: true,  shield: SHIELD_DUR },
  dizzy:   { gain: 1,  pop: 0, cntLvl: true,  dizzy: DIZZY_DUR },
  poison:  { gain: -2, pop: 1, cntLvl: false, special: 'poison' },
  mirror:  { gain: 1,  pop: 0, cntLvl: true,  mirror: MIRROR_DUR },
  lifeUp:  { gain: 0,  pop: 0, cntLvl: false, special: 'lifeUp' },
  mystery: { gain: 0,  pop: 0, cntLvl: false, special: 'mystery' },
  rainbow: { gain: 3,  pop: 0, cntLvl: true,  speed: { dur: RAINBOW_SPEED_DUR, mult: RAINBOW_SPEED_MULT }, invincible: INVINCIBLE_RAINBOW, special: 'rainbow' },
  chest:   { gain: 0,  pop: 0, cntLvl: false, special: 'chest' },
};

// ── Boss ──
export const BOSS_NAMES = { giant: '噬界巨蟒', lava: '熔岩巨蛇', ghost: '幽灵蛇' };
export const BOSS_EMOJI = { giant: '👿', lava: '🐉', ghost: '👻' };
export const BOSS_FULL_NAME = Object.keys(BOSS_NAMES).reduce(
  (m, k) => (m[k] = BOSS_EMOJI[k] + ' ' + BOSS_NAMES[k], m), {}
);
export const BOSS_CFG = {
  easy:   { first: 200, step: 600 },
  normal: { first: 150, step: 500 },
  hard:   { first: 100, step: 350 },
  hell:   { first: 60,  step: 250 }
};

// ── ★ 优化：提高水果常驻食物量至 20 颗 ──
export const FOOD_MAX = 20;
export const TIMED_MAX = 6;
export const COIN_MAX = 3;
export const TIMED_LIFE = 8000;
export const COIN_LIFE = 7000;

// ★ Phase 3: 自适应质量 —— 由 render.js 在 initCanvas 后注入
export let PERF = { maxParticles: 200, maxFloats: 30, particleScale: 1 };
export function setPerf(v) { PERF = v; }

export const NEED_PER_LEVEL = 5;
export const UPLOAD_INTERVAL = 10000;

export const MODE_KEY = { classic: 'classic', level: 'level', chaos: 'chaos', bossRush: 'bossRush' };
export const DIFF_KEY = { easy: 'easy', normal: 'normal', hard: 'hard', hell: 'hell' };

// ── 渐进解锁配置 ──
export const UNLOCKS = {
  mode: {
    classic:   { requires: null, hint: '初始开放' },
    level:     { requires: { mode: 'classic', score: 200 }, hint: '经典模式得分 ≥ 200 解锁' },
    chaos:     { requires: { mode: 'level', level: 3 }, hint: '闯关模式到达 Lv.3 解锁' },
    bossRush:  { requires: { bossKilled: 3 }, hint: '累计击杀 3 个 Boss 解锁' }
  },
  diff: {
    easy:   { requires: null, hint: '初始开放' },
    normal: { requires: { diff: 'easy', score: 100 }, hint: '简单难度得分 ≥ 100 解锁' },
    hard:   { requires: { diff: 'normal', score: 300 }, hint: '普通难度得分 ≥ 300 解锁' },
    hell:   { requires: { diff: 'hard', score: 500 }, hint: '困难难度得分 ≥ 500 解锁' }
  }
};
