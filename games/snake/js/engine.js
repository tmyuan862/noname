// ============================================================
// engine.js — 游戏物理核心 (避墙磁吸、Boss 战穿透无敌解锁、自爆蛇削弱与 BossRush 狂暴技能)
// ============================================================
import {
  CELL, VC, MAP, PHASE, DIFF, DIFF_MULT, MODE_NAME,
  BOSS_CFG, BOSS_NAMES, BOSS_EMOJI, WEATHERS,
  FOOD_MAX, TIMED_MAX, COIN_MAX, TIMED_LIFE, COIN_LIFE, NEED_PER_LEVEL,
  FOOD_EFFECT,
  MIN_SPEED, SPEED_BUFF_MULT,
  CAM_LERP, SHAKE_DECAY, SHAKE_THRESHOLD, HEAD_SWELL_DECAY,
  SPEED_BUFF_DUR, SHIELD_DUR, DIZZY_DUR, MIRROR_DUR,
  INVINCIBLE_SHORT, INVINCIBLE_HIT, INVINCIBLE_RAINBOW, RAINBOW_SPEED_DUR
} from './config.js';
import { wk, wx, wy, inMap, isSafeSpot, visible, clamp, pickWeighted } from './utils.js';
import { G, resetState, safeSnakePos, rebuildSnakeSet, setPhase, isPlaying, isPaused } from './state.js';
import { checkLevelUp, getLevel } from './rogue.js';
import { moveEnemies, bomberExplosion, moveBoss, shootProjectile, updateBossAI } from './ai.js';
import { getBest, setBest, addHist, addGold, saveReplay, getGhosts } from './storage.js';
import { sEat, sSpecial, sCoin, sKill, sBad, sPortal, sDie, sLevel } from './audio.js';
import { burst, showFloating, showCombo, showWeatherLabel } from './ui.js';
import { uploadScore } from './network.js';


// ── 地图 ──
export function buildWalls() {
  G.walls = new Set();
  let n = G.mode === 'level' ? Math.min(2 + G.level, 8) : G.mode === 'chaos' ? 9 : 5;
  for (let i = 0; i < n; i++) {
    let px = 2 + Math.floor(Math.random() * (MAP - 4));
    let py = 2 + Math.floor(Math.random() * (MAP - 4));
    for (let j = 0; j < 4 + Math.floor(Math.random() * 8); j++) {
      if (inMap(px, py, MAP) && !isSafeSpot(px, py, MAP) && !occupied(px, py))
        G.walls.add(wk(px, py));
      px += Math.floor(Math.random() * 3) - 1;
      py += Math.floor(Math.random() * 3) - 1;
      px = clamp(px, 0, MAP - 1);
      py = clamp(py, 0, MAP - 1);
    }
  }
}

export function isWall(x, y) {
  return G.walls.has(wk(x, y));
}

export function occupied(x, y) {
  if (G.snakeSet.has(wk(x, y))) return true;
  if (isWall(x, y)) return true;
  for (let i = 0; i < G.foods.length; i++)
    if (G.foods[i].x === x && G.foods[i].y === y) return true;
  for (let i = 0; i < G.timedFoods.length; i++)
    if (G.timedFoods[i].x === x && G.timedFoods[i].y === y) return true;
  for (let i = 0; i < G.coins.length; i++)
    if (G.coins[i].x === x && G.coins[i].y === y) return true;
  if (G.portals) {
    for (let i = 0; i < G.portals.length; i++)
      if (G.portals[i].x === x && G.portals[i].y === y) return true;
  }
  for (let i = 0; i < G.enemies.length; i++) {
    const en = G.enemies[i];
    for (let j = 0; j < en.body.length; j++) {
      if (en.body[j].x === x && en.body[j].y === y) return true;
    }
  }
  if (G.boss) {
    for (let j = 0; j < G.boss.body.length; j++) {
      if (G.boss.body[j].x === x && G.boss.body[j].y === y) return true;
    }
  }
  if (G.bossFireTrail.has(wk(x, y))) return true;
  return false;
}

// ── ★ 优化：构建空间占用哈希集，一次性收集所有实体位置，避免 O(N*M) 嵌套扫描 ──
function buildOccupancySet() {
  const set = new Set(G.walls); // walls 已经是 wk 编码的 Set
  for (const s of G.snake) set.add(wk(s.x, s.y));
  for (const f of G.foods) set.add(wk(f.x, f.y));
  for (const f of G.timedFoods) set.add(wk(f.x, f.y));
  for (const c of G.coins) set.add(wk(c.x, c.y));
  if (G.portals) for (const p of G.portals) set.add(wk(p.x, p.y));
  for (const en of G.enemies) {
    for (const s of en.body) set.add(wk(s.x, s.y));
  }
  if (G.boss) {
    for (const s of G.boss.body) set.add(wk(s.x, s.y));
    for (const key of G.bossFireTrail.keys()) set.add(key);
  }
  return set;
}

// ★ 优化：接受预构建的占用集，实现 O(1) 空闲寻址
function freeCellFast(occSet) {
  let x, y, g = 0;
  while (g < 1500) {
    x = Math.floor(Math.random() * MAP);
    y = Math.floor(Math.random() * MAP);
    if (!occSet.has(wk(x, y))) return { x, y };
    g++;
  }
  // 尝试清理过期食物/金币后继续搜寻
  const now = Date.now();
  G.timedFoods = G.timedFoods.filter(f => now < f.expire);
  G.coins = G.coins.filter(c => now < c.expire);
  g = 0;
  while (g < 3000) {
    x = Math.floor(Math.random() * MAP);
    y = Math.floor(Math.random() * MAP);
    if (!occSet.has(wk(x, y))) return { x, y };
    g++;
  }
  // 穷举扫描
  for (let i = 0; i < MAP; i++) {
    for (let j = 0; j < MAP; j++) {
      if (!occSet.has(wk(i, j))) return { x: i, y: j };
    }
  }
  return { x: (MAP / 2) | 0, y: (MAP / 2) | 0 };
}

export function freeCell() {
  return freeCellFast(buildOccupancySet());
}

// ── 安全位置查找：优先返回离 (x,y) 最近的非墙壁、非蛇身、可选远离敌人的格子 ──
export function safeCellNear(x, y, opts = {}) {
  const { avoidSnake = true, minEnemyDist = 0 } = opts;
  for (let r = 0; r < MAP; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) !== r) continue;
        const nx = clamp(x + dx, 0, MAP - 1);
        const ny = clamp(y + dy, 0, MAP - 1);
        if (isWall(nx, ny)) continue;
        if (avoidSnake && G.snakeSet.has(wk(nx, ny))) continue;
        if (minEnemyDist > 0) {
          let tooClose = false;
          for (const en of G.enemies) {
            if (Math.hypot(en.body[0].x - nx, en.body[0].y - ny) < minEnemyDist) { tooClose = true; break; }
          }
          if (tooClose) continue;
          if (G.boss && Math.hypot(G.boss.body[0].x - nx, G.boss.body[0].y - ny) < minEnemyDist + 2) continue;
        }
        return { x: nx, y: ny };
      }
    }
  }
  return { x: (MAP / 2) | 0, y: (MAP / 2) | 0 };
}

// ── 食物 ──
const FOOD_WEIGHTS = [
  { t: 'normal', w: 30 },
  { t: 'speed',  w: 12 },
  { t: 'shrink', w: 12 },
  { t: 'double', w: 10 },
  { t: 'shield', w: 12 },
  { t: 'dizzy',  w: 3  },
  { t: 'lifeUp', w: 7  },
  { t: 'mystery',w: 8  },
  { t: 'rainbow',w: 4  },
  { t: 'chest',  w: 2  }
];
let _foodDeck = [];
function _ensureFoodDeck() {
  if (_foodDeck.length) return;
  for (let i = 0; i < 100; i++) {
    let r = Math.random() * 100, acc = 0;
    for (const it of FOOD_WEIGHTS) {
      acc += it.w;
      if (r <= acc) { _foodDeck.push(it.t); break; }
    }
  }
}
function _drawFoodType() {
  _ensureFoodDeck();
  if (_foodDeck.length === 0) return 'normal';
  const i = Math.floor(Math.random() * _foodDeck.length);
  return _foodDeck.splice(i, 1)[0] || 'normal';
}

export function spawnMain() {
  const occSet = buildOccupancySet();
  while (G.foods.length < FOOD_MAX) {
    const cell = freeCellFast(occSet);
    G.foods.push({ ...cell, type: _drawFoodType() });
    occSet.add(wk(cell.x, cell.y)); // 避免重复放置
  }
}

export function spawnTimed() {
  if (G.timedFoods.length < TIMED_MAX)
    G.timedFoods.push({ ...freeCell(), type: Math.random() < 0.8 ? 'poison' : 'mirror', expire: Date.now() + TIMED_LIFE });
}
export function scheduleTimed() { G.nextTimedAt = Date.now() + 2000 + Math.random() * 3000; }

export function spawnCoin() {
  const occSet = buildOccupancySet();
  while (G.coins.length < COIN_MAX) {
    const cell = freeCellFast(occSet);
    G.coins.push({ ...cell, expire: Date.now() + COIN_LIFE });
    occSet.add(wk(cell.x, cell.y));
  }
}
export function scheduleCoin() { G.nextCoinAt = Date.now() + 3000 + Math.random() * 4000; }

export function spawnPortals() {
  const occSet = buildOccupancySet();
  const a = freeCellFast(occSet);
  occSet.add(wk(a.x, a.y));
  let b;
  do { b = freeCellFast(occSet); } while (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 8);
  G.portals = [{ ...a, pair: 1 }, { ...b, pair: 0 }];
}

// ── 敌人生成 ──
export function spawnEnemy() {
  if (G.boss || G.mode === 'bossRush') return;
  const c = freeCell();
  const body = [];
  const len = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < len; i++) body.push({ x: c.x, y: c.y });

  const r = Math.random();
  const type = r < 0.6 ? 'normal' : (r < 0.8 ? 'special' : (r < 0.9 ? 'hunter' : 'bomber'));

  G.enemies.push({
    body,
    dir: { x: 1, y: 0 },
    nextMove: Date.now() + 600,
    type,
    history: []
  });
}

export function enemyCount() {
  if (G.mode === 'bossRush') return 0;
  if (G.mode === 'chaos') return 3;
  if (G.mode === 'level') return G.level >= 4 ? 2 : G.level >= 2 ? 1 : 0;
  return 1;
}



// ── Boss Spawning ──
export function spawnBoss() {
  const h = freeCell();
  const body = [];
  for (let i = 0; i < 15; i++) body.push({ x: h.x, y: h.y });
  G.bossType = ['giant', 'lava', 'ghost'][Math.floor(Math.random() * 3)];
  
  // ★ 优化：仅在挑战赛（bossRush）中 Boss 强度逐渐增强并具有 5 倍数狂暴技能
  const isRush = (G.mode === 'bossRush');
  const bossCount = G.sessionStats.bossKilled;
  const maxHp = isRush ? Math.min(20, 5 + bossCount) : 5;

  setPhase(PHASE.BOSS_FIGHT); // ★ 状态机：进入 Boss 战

  G.boss = {
    body, dir: { x: 0, y: -1 },
    hp: maxHp, maxHp: maxHp,
    nextMove: 0, nextShoot: 0, nextPhase: Date.now() + 4000,
    phased: false,
    superSkill: isRush ? ((bossCount + 1) % 5 === 0) : false
  };
  G.bossFireTrail = new Map(); // ★ Map<wk, expire> — O(1) 碰撞查找
  G.enemies = [];
  G.projectiles = [];
  G.weatherType = null;
  G.weatherUntil = 0;

  burst(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, '#ff1744', 20);
  let label = BOSS_EMOJI[G.bossType] + ' ' + BOSS_NAMES[G.bossType];
  if (isRush) {
    if (G.boss.superSkill) {
      label = '🔥 狂暴 Boss ' + (bossCount + 1) + ' 🔥';
    } else {
      label = label + ' (Lv.' + (bossCount + 1) + ')';
    }
  }
  showFloating(h.x, h.y, label, '#ff1744');
  showWeatherLabel();
}

export function checkBossSpawn(prev, ns) {
  if (G.boss || G.mode === 'bossRush') return;
  const c = BOSS_CFG[G.diff] || BOSS_CFG.normal;
  const firstThreshold = c.first;
  const stepThreshold = c.step;

  if (!G.firstBoss) {
    if (ns >= firstThreshold) {
      G.firstBoss = true;
      spawnBoss();
      G.nextBossTh = Math.floor(ns / stepThreshold) * stepThreshold + stepThreshold;
    }
  } else {
    if (ns >= G.nextBossTh) {
      spawnBoss();
      G.nextBossTh = Math.floor(ns / stepThreshold) * stepThreshold + stepThreshold;
    }
  }
}



export function hitBoss(dmg) {
  if (!G.boss) return;
  const totalDmg = dmg + (G.rogueFang||0); G.boss.hp = Math.max(0, G.boss.hp - totalDmg);
  G.shake = 12;
  const bh = G.boss.body[0];
  burst(bh.x * CELL + CELL / 2, bh.y * CELL + CELL / 2, '#ffd700', 8);
  showFloating(bh.x, bh.y, '-' + dmg + '❤️', '#ff1744');
  if (G.boss.hp <= 0) killBoss();
}

export function killBoss() {
  if (!G.boss) return;
  const p = 50 * (DIFF_MULT[G.diff] || 2);
  G.score += p;
  G.sessionStats.bossKilled++;
  const bh = G.boss.body[0];
  burst(bh.x * CELL + CELL / 2, bh.y * CELL + CELL / 2, '#ffd700', 30);
  showFloating(bh.x, bh.y, '击杀BOSS +' + p, '#ffd700');
  sKill();

  if (G.lives < 5) {
    G.lives++;
    showFloating(bh.x, bh.y + 1, '❤️ 生命 +1', '#ff3366');
  } else {
    addGold(30);
    showFloating(bh.x, bh.y + 1, '💰 额外赏金 +30', '#ffd700');
  }

  G.boss = null; G.projectiles = []; G.bossFireTrail = new Map();
  G.shake = 25;

  // ★ 状态机：非挑战赛模式下 Boss 死后返回正常游玩
  if (G.mode !== 'bossRush') setPhase(PHASE.PLAYING);

  if (G.mode === 'bossRush') {
    G._nextBossAt = Date.now() + 500;
  } else {
    for (let i = 0; i < enemyCount(); i++) {
      spawnEnemy();
    }
    // 延迟到下一帧检测，避免 killBoss 内同步再出 Boss 导致状态错乱
    setTimeout(() => {
      if (G.running && !G.boss) checkBossSpawn(G.score - p, G.score);
    }, 100);
  }
}

export function killEnemy(idx) {
  const en = G.enemies[idx];
  if (!en) return;
  const eh = en.body[0];

  if (en.type === 'bomber') {
    bomberExplosion(eh.x, eh.y);
  }

  G.enemies.splice(idx, 1);
  G.kills++;
  const p = 10 * (DIFF_MULT[G.diff] || 2);
  G.score += p;
  G.shake = 10;
  burst(eh.x * CELL + CELL / 2, eh.y * CELL + CELL / 2, '#ff1744', 8);
  showFloating(eh.x, eh.y, '+' + p, '#ffaa00');
  sKill();
  if (en.type === 'special') {
    setTimeout(() => { if (G.running) applyMysteryBox(); }, 300);
  }
  setTimeout(() => {
    if (G.running && G.enemies.length < enemyCount() && !G.boss) spawnEnemy();
  }, 3000);
  checkBossSpawn(G.score - p, G.score);
}

// ── 碰撞与受击 ──
export function handleHit(reason, dieFn) {
  const now = Date.now();

  if (G.shieldUntil && now < G.shieldUntil) {
    G.shieldUntil = 0;
    G.invincibleUntil = now + INVINCIBLE_SHORT;
    G.shake = 10;
    burst(G.snake[0].x * CELL + CELL / 2, G.snake[0].y * CELL + CELL / 2, '#00f5d4', 15);
    showFloating(G.snake[0].x, G.snake[0].y, '🛡️ 护盾破碎抵挡!', '#00f5d4');
    sSpecial();
    G.snake[0].x = clamp(G.snake[0].x, 0, MAP - 1);
    G.snake[0].y = clamp(G.snake[0].y, 0, MAP - 1);
    return;
  }

  if (G.lives > 1) {
    G.lives--;
    G.invincibleUntil = Date.now() + INVINCIBLE_HIT;
    if (G.snake.length > 3) G.snake = G.snake.slice(0, 3);
    let iter = 0;
    while (G.snake.length < 3 && iter++ < 10) {
      const last = G.snake[G.snake.length - 1];
      G.snake.push({ x: last.x - G.dir.x, y: last.y - G.dir.y });
    }

    // ★ 安全兜底：受击后若蛇头卡在墙/火焰里，整体平移到最近安全位置
    const head = G.snake[0];
    if (isWall(head.x, head.y) || G.bossFireTrail.has(wk(head.x, head.y))) {
      const fixed = safeCellNear(head.x, head.y, { avoidSnake: false, minEnemyDist: 2 });
      const dx = fixed.x - head.x, dy = fixed.y - head.y;
      G.snake = G.snake.map(s => ({ x: s.x + dx, y: s.y + dy }));
    }
    rebuildSnakeSet();

    G.speedBoostUntil = 0; G.mirrorUntil = 0; G.curSpeed = G.baseSpeed;
    G.shake = 18;
    sBad();
    showFloating(G.snake[0].x, G.snake[0].y, '💔', '#ff3366');
  } else {
    G.dieReason = reason;
    sDie();
    if (dieFn) dieFn();
  }
}

// ── ★ 优化：共享的时效 Buff 辅助函数（同时被 applyFood 和 applyMysteryBox 调用）──
function applyTimedBuff(type, now) {
  switch (type) {
    case 'speed':  G.curSpeed = Math.max(MIN_SPEED, G.baseSpeed * SPEED_BUFF_MULT); G.speedBoostUntil = now + SPEED_BUFF_DUR; break;
    case 'shield': G.shieldUntil = now + SHIELD_DUR; break;
    case 'dizzy':  G.dizzyUntil = now + DIZZY_DUR; break;
    case 'mirror': G.mirrorUntil = now + MIRROR_DUR; break;
  }
}

// ── 道具宝箱 ──
export function applyMysteryBox() {
  const eff = ['speed', 'shrink', 'double', 'shield', 'dizzy', 'poison', 'mirror', 'flatPoints', 'lifeUp'];
  const wgt = [12, 12, 12, 16, 6, 4, 6, 20, 6];
  const ch = pickWeighted(eff, wgt);
  const m = DIFF_MULT[G.diff] || 2;
  const now = Date.now();
  switch (ch) {
    case 'speed': case 'shield': case 'dizzy': case 'mirror':
      applyTimedBuff(ch, now); break;
    case 'shrink':
      for (let i = 0; i < 4 && G.snake.length > 3; i++) { const t = G.snake.pop(); if (t) G.snakeSet.delete(wk(t.x, t.y)); } break;
    case 'double':
      G.score += 10 * m; break;
    case 'poison':
      G.score = Math.max(0, G.score - 4 * m);
      for (let i = 0; i < 1 && G.snake.length > 3; i++) { const t = G.snake.pop(); if (t) G.snakeSet.delete(wk(t.x, t.y)); }
      G.shake = 8;
      break;
    case 'flatPoints': G.score += 15 * m; break;
    case 'lifeUp': if (G.lives < 5) G.lives++; else G.score += 20 * m; break;
  }
  sSpecial();
}

export function applyFood(f) {
  const now = Date.now();
  const cnt = f.type !== 'poison';
  if (cnt) {
    G.combo = (now - G.lastEatTime < 1500) ? G.combo + 1 : 1;
    G.lastEatTime = now;
    if (G.combo > G.sessionStats.maxCombo) G.sessionStats.maxCombo = G.combo;
  } else {
    G.combo = 0;
  }
  // ★ 优化：使用效果查找表获取增益 / 弹出 / 关卡计数等公共字段
  const eff = FOOD_EFFECT[f.type] || { gain: 1, pop: 0, cntLvl: true };
  let gain = eff.gain, cntLvl = eff.cntLvl;
  const old = G.score;

  // 应用时效 Buff（speed/shield/dizzy/mirror）
  if (eff.speed) { G.curSpeed = Math.max(MIN_SPEED, G.baseSpeed * eff.speed.mult); G.speedBoostUntil = now + eff.speed.dur; }
  if (eff.shield) G.shieldUntil = now + eff.shield;
  if (eff.dizzy)  G.dizzyUntil = now + eff.dizzy;
  if (eff.mirror) G.mirrorUntil = now + eff.mirror;
  if (eff.invincible) G.invincibleUntil = now + eff.invincible;

  // 特殊类型处理
  if (eff.special === 'poison') { G.shake = 8; }
  if (eff.special === 'lifeUp') { if (G.lives < 5) G.lives++; else gain = 5; }
  if (eff.special === 'mystery') { applyMysteryBox(); }
  if (eff.special === 'rainbow') {} // 已在上面处理完毕
  if (f.type !== 'mystery') {
    const m = DIFF_MULT[G.diff] || 2;
    const bonus = G.combo >= 3 ? G.combo - 2 : 0;
    const fg = gain > 0 ? (gain + bonus) * m : gain * m;
    G.score = Math.max(0, G.score + fg);
    for (let i = 0; i < eff.pop && G.snake.length > 3; i++) { const t = G.snake.pop(); if (t) G.snakeSet.delete(wk(t.x, t.y)); }
    if (G.mode === 'level' && cntLvl) {
      G.eatenInLevel++;
      if (G.eatenInLevel >= NEED_PER_LEVEL) nextLevel();
    }
    checkBossSpawn(old, G.score);
  } else {
    if (G.mode === 'level' && cntLvl) {
      G.eatenInLevel++;
      if (G.eatenInLevel >= NEED_PER_LEVEL) nextLevel();
    }
  }

  if (f.type === 'chest') {
    const offsets = [{dx:-1,dy:0},{dx:1,dy:0},{dx:0,dy:-1},{dx:0,dy:1}];
    offsets.forEach(off => {
      const cx = clamp(f.x + off.dx, 0, MAP - 1);
      const cy = clamp(f.y + off.dy, 0, MAP - 1);
      if (!occupied(cx, cy)) {
        G.coins.push({ x: cx, y: cy, expire: Date.now() + COIN_LIFE });
      }
    });
    showFloating(f.x, f.y, '🎁 宝箱爆发!', '#ffd700');
  } else if (f.type === 'rainbow') {
    showFloating(f.x, f.y, '🌟 彩虹星闪!', '#ff00e5');
  }

  if (f.type === 'poison') { sBad(); showFloating(f.x, f.y, '☠️', '#8d6e63'); }
  else if (f.type === 'mystery' || f.type === 'chest') { }
  else if (f.type === 'lifeUp') { sSpecial(); showFloating(f.x, f.y, '💖+1', '#ff3366'); }
  else { sEat(); if (G.combo >= 3) showCombo(); }
  if (f.type !== 'poison' && f.type !== 'chest') {
    burst(f.x * CELL + CELL / 2, f.y * CELL + CELL / 2, '#00ffaa', 4);
  }
}

export function applyCoin() {
  const now = Date.now();
  G.combo = (now - G.lastEatTime < 1500) ? G.combo + 1 : 1;
  G.lastEatTime = now;
  if (G.combo > G.sessionStats.maxCombo) G.sessionStats.maxCombo = G.combo;
  const m = DIFF_MULT[G.diff] || 2;
  const bonus = G.combo >= 3 ? G.combo - 2 : 0;
  G.score += (5 + bonus + (G.rogueFortune||0) * 10) * m;
  G.shake = 4;
  G.sessionStats.coinEaten++;
  if (G.mode === 'level') {
    G.eatenInLevel++;
    if (G.eatenInLevel >= NEED_PER_LEVEL) nextLevel();
  }
  checkBossSpawn(G.score - (5 + bonus) * m, G.score);
  sCoin();
  if (G.combo >= 3) showCombo();
  burst(G.snake[0].x * CELL + CELL / 2, G.snake[0].y * CELL + CELL / 2, '#ffd700', 5);
}

export function nextLevel() {
  G.level++;
  G.eatenInLevel = 0;
  buildWalls();

  // ★ 安全兜底：关卡切换后若蛇头被新墙壁覆盖，整体平移到最近安全位置
  const head = G.snake[0];
  if (isWall(head.x, head.y)) {
    const fixed = safeCellNear(head.x, head.y, { avoidSnake: false });
    const dx = fixed.x - head.x, dy = fixed.y - head.y;
    G.snake = G.snake.map(s => ({ x: s.x + dx, y: s.y + dy }));
    rebuildSnakeSet();
  }

  G.baseSpeed = Math.max(44, DIFF[G.diff].speed - G.level * 6);
  G.curSpeed = G.baseSpeed;
  G.speedBoostUntil = 0;
  for (let i = G.foods.length - 1; i >= 0; i--) {
    if (isWall(G.foods[i].x, G.foods[i].y)) G.foods.splice(i, 1);
  }
  spawnMain();
  for (let i = G.timedFoods.length - 1; i >= 0; i--) {
    if (isWall(G.timedFoods[i].x, G.timedFoods[i].y)) G.timedFoods.splice(i, 1);
  }
  if (G.level >= 3 && !G.portals) spawnPortals();
  while (G.enemies.length < enemyCount() && !G.boss) spawnEnemy();
  sLevel();
  showFloating(G.snake[0].x, G.snake[0].y, '⬆ Lv.' + G.level, '#00ffaa');
}

// ── 天气 ──
export function updateWeather() {
  const now = Date.now();
  if (G.boss || G.mode === 'bossRush') {
    G.weatherType = null;
    G.weatherUntil = 0;
    return;
  }
  if (G.weatherUntil < now && G.weatherNext < now && G.running) {
    const w = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
    G.weatherType = w.id;
    G.weatherUntil = now + w.dur;
    G.weatherNext = now + 6000 + Math.random() * 12000;
    showWeatherLabel();
  }
  if (G.weatherUntil > now && G.weatherType === 'foodRain' && G.running && Math.random() < 0.02) {
    G.foods.push({ ...freeCell(), type: 'normal' });
    if (G.foods.length > FOOD_MAX) G.foods.shift();
  }
  if (G.weatherUntil > now && G.weatherType === 'quake' && G.running && Math.random() < 0.05) {
    G.shake = Math.max(G.shake, 3 + Math.random() * 3);
  }
}

// ── 时效道具与金币的清理/生成 ──
function expireAndSpawnItems(now) {
  for (let i = G.timedFoods.length - 1; i >= 0; i--)
    if (G.timedFoods[i].expire <= now) G.timedFoods.splice(i, 1);
  if (now >= G.nextTimedAt) { spawnTimed(); scheduleTimed(); }

  for (let i = G.coins.length - 1; i >= 0; i--)
    if (G.coins[i].expire <= now) G.coins.splice(i, 1);
  if (G.coins.length < COIN_MAX && now >= G.nextCoinAt) { spawnCoin(); scheduleCoin(); }
}

// ── 肉鸽能力：磁铁 ──
const MAGNET_BLOCKED = new Set(['poison', 'dizzy', 'mirror']);
function applyRogueMagnet(now) {
  const magLv = G.rogueMagnet || 0;
  if (magLv <= 0) return;
  const maxDist = 2 + magLv;
  const minD2 = maxDist * maxDist;
  const h = G.snake[0];

  // 每 tick 最多吸收 1 个，避免卡顿
  let absorbed = false;
  const pullItem = (item) => {
    if (absorbed) return;
    const dx = h.x - item.x, dy = h.y - item.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= minD2 && d2 > 0) {
      let nx = item.x, ny = item.y;
      if (dx !== 0) nx += dx > 0 ? 1 : -1;
      if (dy !== 0) ny += dy > 0 ? 1 : -1;
      nx = clamp(nx, 0, MAP - 1);
      ny = clamp(ny, 0, MAP - 1);
      if (!isWall(nx, ny)) { item.x = nx; item.y = ny; }
      // 拉近到蛇头 1 格内自动吃
      if (nx === h.x && ny === h.y) absorbed = true;
    }
  };

  for (let i = 0; i < G.foods.length; i++) {
    if (!MAGNET_BLOCKED.has(G.foods[i].type)) pullItem(G.foods[i]);
  }
  for (let i = 0; i < G.timedFoods.length; i++) {
    if (G.timedFoods[i].expire > now && !MAGNET_BLOCKED.has(G.timedFoods[i].type)) pullItem(G.timedFoods[i]);
  }
  for (let i = 0; i < G.coins.length; i++) {
    if (G.coins[i].expire > now) pullItem(G.coins[i]);
  }

  // 吸收蛇头位置的物品（合并处理）
  for (let i = G.foods.length - 1; i >= 0; i--) {
    if (G.foods[i].x === h.x && G.foods[i].y === h.y && !MAGNET_BLOCKED.has(G.foods[i].type)) {
      applyFood(G.foods[i]); G.foods.splice(i, 1); G.headSwell = 1;
    }
  }
  for (let i = G.timedFoods.length - 1; i >= 0; i--) {
    if (G.timedFoods[i].x === h.x && G.timedFoods[i].y === h.y && !MAGNET_BLOCKED.has(G.timedFoods[i].type)) {
      applyFood(G.timedFoods[i]); G.timedFoods.splice(i, 1); G.headSwell = 1;
    }
  }
  for (let i = G.coins.length - 1; i >= 0; i--) {
    if (G.coins[i].x === h.x && G.coins[i].y === h.y) {
      applyCoin(); G.coins.splice(i, 1); G.headSwell = 1;
    }
  }
}

// ── 超级技能 ──
function applySuperAbilities(now) {
  // 🔥 火径：蛇头身后 5 格火链
  if ((G.rogueFiretrail||0) > 0) {
    for (let i = 1; i <= Math.min(5, G.snake.length - 1); i++) {
      const seg = G.snake[i];
      if (seg) G.bossFireTrail.set(wk(seg.x, seg.y), now + 2000);
    }
    for (const [key, expire] of G.bossFireTrail) {
      if (expire <= now) G.bossFireTrail.delete(key);
    }
  }

  // ⚡ 雷暴：每 10 秒削掉随机敌人一半身体
  if ((G.rogueStorm||0) > 0) {
    if (!G._lastStormAt) G._lastStormAt = now;
    if (now - G._lastStormAt > 10000 && G.enemies.length > 0) {
      G._lastStormAt = now;
      const idx = Math.floor(Math.random() * G.enemies.length);
      const en = G.enemies[idx];
      const cut = Math.max(1, Math.floor(en.body.length / 2));
      if (en.body.length - cut <= 1) {
        killEnemy(idx);
      } else {
        en.body = en.body.slice(0, en.body.length - cut);
      }
      burst(en.body[0].x * CELL + CELL/2, en.body[0].y * CELL + CELL/2, '#ffff00', 10);
      showFloating(en.body[0].x, en.body[0].y, '⚡ 雷削 -' + cut, '#ffff00');
    }
  }

  // 🌀 漩涡：蛇头周围 10 格缓速吸入
  if ((G.rogueVortex||0) > 0) {
    const h = G.snake[0];
    const maxD2 = 10 * 10;
    const pull = (item) => {
      const dx = h.x - item.x, dy = h.y - item.y;
      if (dx * dx + dy * dy > maxD2) return;
      if (dx !== 0) item.x += dx > 0 ? 1 : -1;
      else if (dy !== 0) item.y += dy > 0 ? 1 : -1;
      item.x = clamp(item.x, 0, MAP - 1);
      item.y = clamp(item.y, 0, MAP - 1);
    };
    G.foods.forEach(pull);
    G.timedFoods.forEach(f => { if (f.expire > now) pull(f); });
    G.coins.forEach(c => { if (c.expire > now) pull(c); });
  }
}

// ── 弹幕移动与碰撞（含荆棘甲折射）──
function updateProjectiles(now, dieFn, isInvincible) {
  const thornCount = G.rogueArmor || 0;
  for (let i = 0; i < G.projectiles.length; i++) {
    const p = G.projectiles[i];
    if (p.homing) {
      const ph = G.snake[0];
      const pdx = ph.x - p.x, pdy = ph.y - p.y;
      const plen = Math.hypot(pdx, pdy) || 1;
      const steerSpeed = 0.035;
      const curSp = Math.hypot(p.vx, p.vy) || 0.24;
      p.vx += (pdx / plen * curSp - p.vx) * steerSpeed;
      p.vy += (pdy / plen * curSp - p.vy) * steerSpeed;
    }
    p.x += p.vx;
    p.y += p.vy;
  }
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    const px = Math.round(p.x), py = Math.round(p.y); // ★ 用 round 替代 floor，碰撞更贴合视觉
    if (!inMap(px, py, MAP) || now >= p.expire) {
      G.projectiles.splice(i, 1);
      continue;
    }
    const hitSnake = (px === G.snake[0].x && py === G.snake[0].y) || G.snakeSet.has(wk(px, py));
    if (hitSnake) {
      if (thornCount > 0) {
        G.projectiles.splice(i, 1);
        burst(px * CELL + CELL / 2, py * CELL + CELL / 2, '#d500f9', 8);
        showFloating(px, py, '🛡️ 棘刺折射!', '#d500f9');
        if (G.boss) {
          const bh = G.boss.body[0];
          const dist = Math.hypot(bh.x - px, bh.y - py);
          if (dist <= 4) hitBoss(1);
        }
        continue;
      }
      if (px === G.snake[0].x && py === G.snake[0].y) {
        if (!isInvincible) handleHit('被弹幕击中', dieFn);
        G.projectiles.splice(i, 1);
      }
    }
  }
}


// ── ★ 主物理 tick ★ ──
export function tick(dieFn) {
  if (!isPlaying() || isPaused()) return;
  const now = Date.now();
  const isInvincible = G.invincibleUntil && now < G.invincibleUntil;
  const isShielded = G.shieldUntil && now < G.shieldUntil;

  if (G.speedBoostUntil && now > G.speedBoostUntil) {
    G.speedBoostUntil = 0; G.curSpeed = G.baseSpeed;
  }

  updateWeather();

  expireAndSpawnItems(now);
  applyRogueMagnet(now);
  applySuperAbilities(now);
  updateProjectiles(now, dieFn, isInvincible);
  // 挑战赛 Boss 间隔刷新
  if (G.mode === 'bossRush' && !G.boss && G._nextBossAt && now >= G._nextBossAt && !G.paused) {
    G._nextBossAt = 0;
    spawnBoss();
  }

  updateBossAI(now);
  if (G.boss && G.boss.hp <= 0) killBoss();

  moveEnemies(now);

  G.dir = G.nextDir;
  let nx = G.snake[0].x + G.dir.x, ny = G.snake[0].y + G.dir.y;

  // 边界
  if (!inMap(nx, ny, MAP)) {
    if (isInvincible) {
      nx = clamp(nx, 0, MAP - 1);
      ny = clamp(ny, 0, MAP - 1);
    } else {
      return handleHit('撞到边界', dieFn);
    }
  }

  // 传送门
  let teleported = false;
  if (G.portals) {
    const p = G.portals.find(p => p.x === nx && p.y === ny);
    if (p) {
      sPortal();
      const o = G.portals[p.pair];
      nx = o.x + G.dir.x;
      ny = o.y + G.dir.y;
      if (!inMap(nx, ny, MAP)) { nx = o.x; ny = o.y; }
      nx = clamp(nx, 0, MAP - 1);
      ny = clamp(ny, 0, MAP - 1);
      teleported = true;
    }
  }

  const head = { x: nx, y: ny };
  const headKey = wk(head.x, head.y);

  // ★ 敌蛇碰撞 - 玩家蛇头撞向敌人任何部位都直接击杀
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const en = G.enemies[i];
    // 检查是否撞到敌人头部
    if (en.body[0].x === head.x && en.body[0].y === head.y) {
      G.snake.unshift(head);
      G.snakeSet.add(headKey);
      killEnemy(i);
      return;
    }
    // 检查是否撞到敌人身体
    const bi = en.body.findIndex((s, si) => si > 0 && s.x === head.x && s.y === head.y);
    if (bi > 0) {
      G.snake.unshift(head);
      G.snakeSet.add(headKey);
      killEnemy(i);
      return;
    }
  }

  if (!isInvincible) {
    if (G.snakeSet.has(headKey)) return handleHit('撞到自己', dieFn);
    if (isWall(head.x, head.y)) return handleHit('撞到障碍', dieFn);
    // 踩到火焰轨迹：Boss 火扣身体，自己的火不受伤
    if (G.bossFireTrail.has(headKey) && !(G.rogueFiretrail||0)) {
      if (!isInvincible) {
        const cut = Math.max(1, Math.floor(G.snake.length * 0.15));
        for (let j = 0; j < cut && G.snake.length > 3; j++) {
          const t = G.snake.pop();
          if (t) G.snakeSet.delete(wk(t.x, t.y));
        }
        G.shake = 8;
        showFloating(head.x, head.y, '🔥 烧伤 -' + cut, '#ff6d00');
        sBad();
      }
    }

    // ★ 敌蛇咬我身体 → 截断尾巴，身体长度≤3时直接死亡
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const en = G.enemies[i];
      const enHeadKey = wk(en.body[0].x, en.body[0].y);
      if (G.snakeSet.has(enHeadKey)) {
        if (thornCount > 0) {
          showFloating(en.body[0].x, en.body[0].y, '🛡️ 荆棘反咬!', '#00ffaa');
          killEnemy(i);
        } else {
          // ★ 如果身体长度≤3，被咬后直接死亡
          if (G.snake.length <= 3) {
            return handleHit('被敌蛇咬死', dieFn);
          }
          // 找到被咬的身体节位置
          const bodyIdx = G.snake.findIndex(s => s.x === en.body[0].x && s.y === en.body[0].y);
          if (bodyIdx > 0) {
            const cutCount = G.snake.length - bodyIdx;
            for (let j = 0; j < cutCount && G.snake.length > 3; j++) {
              const tail = G.snake.pop();
              if (tail) G.snakeSet.delete(wk(tail.x, tail.y));
            }
            // ★ 截断后再次检查长度，如果变成≤3则死亡
            if (G.snake.length <= 3) {
              return handleHit('被敌蛇咬至过短而死', dieFn);
            }
          }
          G.shake = 10;
          showFloating(en.body[0].x, en.body[0].y, '💢 被咬断尾!', '#ff3366');
          sBad();
        }
      }
    }
    if (G.isGhostMode && G.ghostFrames && G.ghostIdx < G.ghostFrames.length) {
      let gf = G.ghostFrames[G.ghostIdx];
      if (gf) {
        // ★ 优化：惰性构建 Set，首次访问时缓存到帧上，后续 O(1) 查找
        if (!gf._set) gf._set = new Set(gf.map(s => (s.x << 8) | s.y));
        if (gf._set.has(headKey)) return handleHit('撞到 Ghost 幻影', dieFn);
      }
    }
  }

  // ★ Boss 战无碰撞卡死深度优化（无敌状态时原地攻击Boss，不移动避免卡入）
  if (G.boss && !(G.bossType === 'ghost' && G.boss.phased)) {
    const bh = G.boss.body[0];
    if (head.x === bh.x && head.y === bh.y) {
      if (isInvincible || isShielded) {
        if (isInvincible) {
          hitBoss(2);
        } else {
          G.shieldUntil = 0;
          G.invincibleUntil = now + INVINCIBLE_SHORT;
          showFloating(head.x, head.y, '🛡️ 护盾破碎抵挡!', '#00f5d4');
          hitBoss(2);
        }
        // ★ 修复：无敌撞Boss时原地不动，避免卡入Boss身体导致重叠
        return;
      } else {
        return handleHit('与 Boss 迎头相撞', dieFn);
      }
    } else {
      const bi = G.boss.body.findIndex((s, i) => i > 0 && s.x === head.x && s.y === head.y);
      if (bi > 0) {
        if (isInvincible || isShielded) {
          if (isInvincible) {
            hitBoss(1);
          } else {
            G.shieldUntil = 0;
            G.invincibleUntil = now + INVINCIBLE_SHORT;
            showFloating(head.x, head.y, '🛡️ 护盾破碎抵挡!', '#00f5d4');
            hitBoss(1);
          }
          // ★ 修复：无敌撞Boss身体时原地不动，避免卡入
          return;
        } else {
          return handleHit('撞击 Boss 身体', dieFn);
        }
      }
    }
  }

  G.snake.unshift(head);
  G.snakeSet.add(headKey);
  let ate = false;

  const fi = G.foods.findIndex(f => f.x === head.x && f.y === head.y);
  if (fi >= 0) {
    applyFood(G.foods[fi]);
    G.foods.splice(fi, 1);
    spawnMain();
    ate = true;
    G.headSwell = 1;
  } else {
    const ci = G.coins.findIndex(c => c.x === head.x && c.y === head.y);
    if (ci >= 0) {
      applyCoin();
      G.coins.splice(ci, 1);
      spawnCoin();
      ate = true;
      G.headSwell = 1;
    } else {
      const ti = G.timedFoods.findIndex(f => f.x === head.x && f.y === head.y);
      if (ti >= 0) {
        applyFood(G.timedFoods[ti]);
        G.timedFoods.splice(ti, 1);
        ate = true;
        G.headSwell = 1;
      }
    }
  }

  if (!ate) {
    const tail = G.snake.pop();
    if (tail) G.snakeSet.delete(wk(tail.x, tail.y));
  }

  if (checkLevelUp()) { G.rogueLevelUpTriggered = true; window.dispatchEvent(new CustomEvent("rogue-level-up")); }
  if (G.running) {
    G.replayFrames.push(G.snake.map(s => (s.x << 8) | s.y));
    if (G.replayFrames.length > 1800) G.replayFrames.shift(); // ★ 1800 帧 ≈ 3 分钟回放，防内存膨胀
  }

  if (G.isGhostMode && G.ghostFrames) {
    G.ghostIdx++;
    if (G.ghostIdx >= G.ghostFrames.length) {
      const gs = getGhosts()[0]?.score || 0;
      if (G.score > gs) G.sessionStats.ghostBeaten = true;
    }
  }

  G.lastTickAt = now;
}

// ── 主动断尾蜕皮 ──
export function shedSkin() {
  if (!isPlaying() || isPaused()) return;

  if (G.snake.length < 6) {
    showFloating(G.snake[0].x, G.snake[0].y, '⚠️ 长度不足 6!', '#ff3366');
    sBad();
    return;
  }

  const cutCount = Math.floor(G.snake.length * 0.3);
  if (cutCount <= 0) return;

  for (let i = 0; i < cutCount; i++) {
    const tail = G.snake.pop();
    if (tail) G.snakeSet.delete(wk(tail.x, tail.y));
  }

  const head = G.snake[0];
  G.shake = 18;
  burst(head.x * CELL + CELL / 2, head.y * CELL + CELL / 2, '#d500f9', 25);
  showFloating(head.x, head.y, '💥 断尾蜕皮!', '#d500f9');
  sSpecial();

  G.invincibleUntil = Date.now() + INVINCIBLE_SHORT;
  // regrow
  if ((G.rogueRegrow||0) > 0) {
    for (let ri = 0; ri < (G.rogueRegrow||0) * 2; ri++) {
      const tail = G.snake[G.snake.length - 1];
      G.snake.push({ x: tail.x - G.dir.x, y: tail.y - G.dir.y });
      G.snakeSet.add(wk(tail.x - G.dir.x, tail.y - G.dir.y));
    }
    showFloating(head.x, head.y, "regrow", "#00ffaa");
  }

  // ★ 蜕皮加分
  const m = DIFF_MULT[G.diff] || 2;
  G.score += 5 * m;
  showFloating(head.x, head.y + 1, '++' + (5 * m) + ' 分', '#d500f9');

  const radius = 6 + (G.rogueBlast||0) * 2;
  G.projectiles = G.projectiles.filter(p => {
    const dx = p.x - head.x;
    const dy = p.y - head.y;
    const hit = dx * dx + dy * dy <= radius * radius;
    if (hit) {
      burst(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, '#ff1744', 3);
    }
    return !hit;
  });

  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const en = G.enemies[i];
    const eh = en.body[0];
    const dx = eh.x - head.x;
    const dy = eh.y - head.y;
    if (dx * dx + dy * dy <= radius * radius) {
      if (en.body.length > 3) {
        const enCut = Math.floor(en.body.length * 0.4);
        for (let j = 0; j < enCut && en.body.length > 2; j++) {
          en.body.pop();
        }
        burst(eh.x * CELL + CELL / 2, eh.y * CELL + CELL / 2, '#ff1744', 8);
        showFloating(eh.x, eh.y, '⚡ 击退削弱', '#ffaa00');
      } else {
        killEnemy(i);
      }
    }
  }

  if (G.boss) {
    const bh = G.boss.body[0];
    const dx = bh.x - head.x;
    const dy = bh.y - head.y;
    if (dx * dx + dy * dy <= radius * radius) {
      hitBoss(1);
    }
  }

  // 👥 影分身：蜕皮时自动击杀最近的一个敌人
  if ((G.rogueClone||0) > 0 && G.enemies.length > 0) {
    let closest = 0, minD = Infinity;
    for (let i = 0; i < G.enemies.length; i++) {
      const d = Math.hypot(G.enemies[i].body[0].x - head.x, G.enemies[i].body[0].y - head.y);
      if (d < minD) { minD = d; closest = i; }
    }
    if (minD < 15) {
      showFloating(G.enemies[closest].body[0].x, G.enemies[closest].body[0].y, '👥 分身击杀!', '#d500f9');
      killEnemy(closest);
    }
  }
}
