// ============================================================
// rogue.js — 肉鸽升级系统
// 每级三选一，能力叠加生效
// ============================================================
import { G } from './state.js';

// ★ 能力池
const ABILITIES = [
  { id: 'fang',    name: '🗡️ 利齿',    desc: '撞敌人头一击必杀，Boss +1 伤害', apply() { G.rogueFang = (G.rogueFang||0)+1; } },
  { id: 'swift',   name: '⚡ 疾速',    desc: '基础速度永久 +6ms',           apply() { G.rogueSwift = (G.rogueSwift||0)+1; G.baseSpeed = Math.max(34, G.baseSpeed - 6); G.curSpeed = G.baseSpeed; } },
  { id: 'magnet',  name: '🧲 磁力',    desc: '吸收 3 格内的食物和金币',    apply() { G.rogueMagnet = (G.rogueMagnet||0)+1; } },
  { id: 'armor',   name: '🛡️ 坚甲',    desc: '每级挡一次弹幕 (Lv.1起效)',   apply() { G.rogueArmor = (G.rogueArmor||0)+1; } },
  { id: 'vitality',name: '❤️ 活力',    desc: '生命上限 +1（立即恢复）',      apply() { G.rogueVitality = (G.rogueVitality||0)+1; G.lives = Math.min(5, G.lives+1); } },
  { id: 'blast',   name: '💥 爆裂',    desc: '蜕皮爆炸半径 +2',            apply() { G.rogueBlast = (G.rogueBlast||0)+1; } },
  { id: 'fortune', name: '💰 财运',    desc: '拾取金币额外 +10 分',        apply() { G.rogueFortune = (G.rogueFortune||0)+1; } },
  { id: 'regrow',  name: '🌱 再生',    desc: '每次蜕皮后恢复 2 节身体',     apply() { G.rogueRegrow = (G.rogueRegrow||0)+1; } },
];

// ★ 等级阈值：每 N 分升一级
export function levelThreshold(level) {
  return 50 * level * (level + 1) / 2;
}

export function getLevel() {
  return G.snakeLevel || 1;
}

export function nextLevelAt() {
  return levelThreshold(getLevel());
}

// ★ 检查升级，每 tick 最多升一级
export function checkLevelUp() {
  const lv = getLevel();
  const th = levelThreshold(lv);
  if (G.score >= th) {
    G.snakeLevel = lv + 1;
    return true;
  }
  return false;
}

// ★ 超级技能池（Lv.5 / Lv.10 ... 触发）
const SUPER_ABILITIES = [
  { id: 'clone',   name: '👥 影分身',  desc: '蜕皮时放出一个分身蛇帮你杀敌', apply() { G.rogueClone = (G.rogueClone||0)+1; } },
  { id: 'storm',   name: '⚡ 雷暴',    desc: '每 10 秒随机雷击一个敌人',     apply() { G.rogueStorm = (G.rogueStorm||0)+1; } },
  { id: 'firetrail',name:'🔥 火径',    desc: '身后留下火焰轨迹灼烧敌人',     apply() { G.rogueFiretrail = (G.rogueFiretrail||0)+1; } },
  { id: 'frost',   name: '❄️ 冰域',    desc: '敌蛇移动速度永久减半',         apply() { G.rogueFrost = (G.rogueFrost||0)+1; } },
  { id: 'vortex',  name: '🌀 漩涡',    desc: '持续将全图食物吸向你',         apply() { G.rogueVortex = (G.rogueVortex||0)+1; } },
];

// ★ 生成三选一选项
export function rollChoices() {
  const lv = G.snakeLevel || 1;
  // Lv.5 触发超级技能（之后每 5 级再触发）
  const isSuper = (lv === 5 || (lv > 5 && lv % 5 === 0));

  let pool = isSuper ? [...SUPER_ABILITIES] : [...ABILITIES];
  if (!isSuper && G.lives >= 5) pool = pool.filter(a => a.id !== 'vitality');

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

// ★ 应用选择
export function applyChoice(abilityId) {
  const ability = ABILITIES.find(a => a.id === abilityId) || SUPER_ABILITIES.find(a => a.id === abilityId);
  if (!ability) return false;
  if (!G.roguePicks) G.roguePicks = [];
  G.roguePicks.push(abilityId);
  ability.apply();
  return true;
}

// ★ 重置本局肉鸽状态
export function resetRogue() {
  G.snakeLevel = 1;
  G.roguePicks = [];
  G.rogueFang = 0;
  G.rogueSwift = 0;
  G.rogueMagnet = 0;
  G.rogueArmor = 0;
  G.rogueVitality = 0;
  G.rogueBlast = 0;
  G.rogueFortune = 0;
  G.rogueRegrow = 0;
  G.rogueClone = 0;
  G.rogueStorm = 0;
  G.rogueFiretrail = 0;
  G.rogueFrost = 0;
  G.rogueVortex = 0;
}

// ★ 获取当前已选能力摘要（显示在 HUD）
export function getAbilitiesSummary() {
  if (!G.roguePicks || !G.roguePicks.length) return '';
  const last = G.roguePicks.slice(-4); // 最近 4 个
  return last.map(id => {
    const a = ABILITIES.find(x => x.id === id);
    return a ? a.name.split(' ')[0] : '';
  }).join(' ');
}
