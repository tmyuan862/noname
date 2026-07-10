// ============================================================
// ai.js — 敌人 AI 与 Boss AI（Phase 4: 从 engine.js 抽离）
// ============================================================
import { CELL, MAP } from './config.js';
import { wk, inMap, clamp } from './utils.js';
import { G } from './state.js';
import { burst, showFloating } from './ui.js';
import { sSpecial } from './audio.js';

// ★ 本地 isWall，避免与 engine.js 循环依赖
function isWall(x, y) { return G.walls.has(wk(x, y)); }

// ── ★ 优化：模块级方向常量，避免每帧/每敌人重复分配 ──
const DIRS = Object.freeze([
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }
]);

// ── 自爆散射 ──
export function bomberExplosion(x, y) {
  G.shake = 8;
  burst(x * CELL + CELL / 2, y * CELL + CELL / 2, '#ff6d00', 15);
  sSpecial();
  showFloating(x, y, '⚠️ 轰爆自毁!', '#ff3d00');

  const speed = 0.13;
  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2];
  for (const angle of angles) {
    G.projectiles.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      expire: Date.now() + 2000
    });
  }
}

// ── 敌人 AI ──
export function moveEnemies(now) {
  for (let ei = 0; ei < G.enemies.length; ei++) {
    const en = G.enemies[ei];
    if (now < en.nextMove) continue;

    let speedMult = 1.0;
    if (en.type === 'bomber') speedMult = 0.65;
    else if (en.type === 'hunter') speedMult = 0.8;
    if ((G.rogueFrost||0) > 0) speedMult *= 2.0; // 冰域：速度减半
    en.nextMove = now + Math.max(80, (G.curSpeed + 50) * speedMult);

    const h = en.body[0];
    const ph = G.snake[0];
    let tx = h.x, ty = h.y;

    let tracked = false;
    if ((en.type === 'hunter' && Math.hypot(h.x - ph.x, h.y - ph.y) < 14) || en.type === 'bomber') {
      tx = ph.x; ty = ph.y;
      tracked = true;
    } else {
      if (Math.random() < 0.25 && Math.hypot(h.x - ph.x, h.y - ph.y) < 10) {
        const targetSeg = G.snake[Math.min(G.snake.length - 1, 3)];
        if (targetSeg) {
          tx = targetSeg.x; ty = targetSeg.y;
          tracked = true;
        }
      }
      if (!tracked && G.foods.length > 0) {
        let md = Infinity;
        for (let i = 0; i < G.foods.length; i++) {
          const f = G.foods[i];
          const d = Math.hypot(f.x - h.x, f.y - h.y);
          if (d < md) { md = d; tx = f.x; ty = f.y; }
        }
      }
    }

    let others = null;
    for (let j = 0; j < G.enemies.length; j++) {
      if (j === ei) continue;
      const en2 = G.enemies[j];
      if (!others) others = [];
      for (let k = 0; k < en2.body.length; k++) others.push(en2.body[k]);
    }

    const opts = DIRS.filter(d => !(d.x === -en.dir.x && d.y === -en.dir.y));

    opts.sort((a, b) =>
      (Math.abs(h.x + a.x - tx) + Math.abs(h.y + a.y - ty)) -
      (Math.abs(h.x + b.x - tx) + Math.abs(h.y + b.y - ty))
    );

    if (!en.history) en.history = [];

    function isCellFree(nx, ny) {
      if (!inMap(nx, ny, MAP) || isWall(nx, ny)) return false;
      if (G.snakeSet.has(wk(nx, ny))) return false;
      if (others) {
        for (let m = 0; m < others.length; m++) {
          if (others[m].x === nx && others[m].y === ny) return false;
        }
      }
      return true;
    }

    let ch = null;
    for (let k = 0; k < opts.length; k++) {
      const d = opts[k];
      const nx = h.x + d.x, ny = h.y + d.y;
      if (!isCellFree(nx, ny)) continue;
      if (en.history.slice(-4).includes((nx << 8) | ny) && k < opts.length - 1) continue;
      ch = d; break;
    }
    if (!ch) {
      for (let k = 0; k < opts.length; k++) {
        const d = opts[k];
        const nx = h.x + d.x, ny = h.y + d.y;
        if (!isCellFree(nx, ny)) continue;
        ch = d; break;
      }
    }

    if (!ch) ch = opts[0] || en.dir;
    en.dir = ch;
    let nx = h.x + ch.x, ny = h.y + ch.y;
    if (!inMap(nx, ny, MAP)) { nx = h.x; ny = h.y; }
    en.body.unshift({ x: nx, y: ny });
    en.body.pop();

    // 敌人踩玩家火 → 直接死
    if ((G.rogueFiretrail||0) > 0 && G.bossFireTrail.has(wk(nx, ny))) {
      G.enemies.splice(ei, 1);
      G.kills++;
      G.shake = 4;
      ei--;
      continue;
    }

    en.history.push((nx << 8) | ny);
    if (en.history.length > 8) en.history.shift();
  }
}

// ── Boss 移动 ──
export function moveBoss(now) {
  if (!G.boss) return;
  const h = G.boss.body[0];
  const ph = G.snake[0];

  if (G.bossType === 'ghost' && now > G.boss.nextPhase) {
    G.boss.phased = !G.boss.phased;
    G.boss.nextPhase = now + 4000;
  }
  if (G.bossType === 'ghost' && G.boss.phased) {
    G.boss.body.unshift({ x: h.x, y: h.y });
    G.boss.body.pop();
    return;
  }

  const opts = DIRS.filter(d => !(d.x === -G.boss.dir.x && d.y === -G.boss.dir.y));

  if (Math.random() < 0.35) {
    opts.sort(() => Math.random() - 0.5);
  } else {
    opts.sort((a, b) =>
      Math.hypot(h.x + a.x - ph.x, h.y + a.y - ph.y) -
      Math.hypot(h.x + b.x - ph.x, h.y + b.y - ph.y)
    );
  }
  let ch = null;
  for (let i = 0; i < opts.length; i++) {
    const d = opts[i];
    const nx = h.x + d.x, ny = h.y + d.y;
    if (inMap(nx, ny, MAP) && !isWall(nx, ny)) { ch = d; break; }
  }
  if (!ch) ch = opts[0] || G.boss.dir;
  G.boss.dir = ch;
  const nx = h.x + ch.x, ny = h.y + ch.y;
  const inB = inMap(nx, ny, MAP);
  G.boss.body.unshift({ x: inB ? nx : h.x, y: inB ? ny : h.y });
  G.boss.body.pop();

  if (G.bossType === 'lava') {
    G.bossFireTrail.set(wk(G.boss.body[0].x, G.boss.body[0].y), now + 5000);
  }
  // Boss 踩玩家火径 → 扣血
  if ((G.rogueFiretrail||0) > 0 && G.bossFireTrail.has(wk(nx, ny)) && G.bossType !== 'lava') {
    G.boss.hp = Math.max(0, G.boss.hp - 1);
    if (G.boss.hp <= 0) G.boss.hp = 0; // 由 tick 后续检测击杀
  }
  for (const [key, expire] of G.bossFireTrail) {
    if (expire <= now) G.bossFireTrail.delete(key);
  }
}

// ── Boss 弹幕射击 ──
export function shootProjectile() {
  if (!G.boss || (G.bossType === 'ghost' && G.boss.phased)) return;
  const bh = G.boss.body[0];
  const ph = G.snake[0];
  const dx = ph.x - bh.x, dy = ph.y - bh.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = (G.bossType === 'lava' ? 0.3 : 0.24) *
    (G.boss.hp <= 2 && (G.diff === 'hard' || G.diff === 'hell') ? 1.5 : 1);

  if (G.boss.superSkill) {
    if (G.bossType === 'giant') {
      const projSpeed = speed * 0.9;
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI * 2 / 10) * i;
        G.projectiles.push({
          x: bh.x, y: bh.y,
          vx: Math.cos(angle) * projSpeed, vy: Math.sin(angle) * projSpeed,
          expire: Date.now() + 5000
        });
      }
      showFloating(bh.x, bh.y, '🌀 暗能星环!', '#d500f9');
    } else if (G.bossType === 'lava') {
      const angleToPlayer = Math.atan2(dy, dx);
      const angles = [angleToPlayer - 0.25, angleToPlayer, angleToPlayer + 0.25];
      for (const angle of angles) {
        G.projectiles.push({
          x: bh.x, y: bh.y,
          vx: Math.cos(angle) * speed * 1.1, vy: Math.sin(angle) * speed * 1.1,
          expire: Date.now() + 5000
        });
      }
      showFloating(bh.x, bh.y, '🌋 三重熔岩!', '#ff3d00');
    } else if (G.bossType === 'ghost') {
      G.projectiles.push({
        x: bh.x, y: bh.y,
        vx: (dx / len) * speed * 0.8, vy: (dy / len) * speed * 0.8,
        expire: Date.now() + 6000,
        homing: true
      });
      G.projectiles.push({
        x: bh.x, y: bh.y,
        vx: (-dy / len) * speed * 0.8, vy: (dx / len) * speed * 0.8,
        expire: Date.now() + 6000,
        homing: true
      });
      showFloating(bh.x, bh.y, '👻 幽影追踪!', '#00e5ff');
    }
  } else {
    G.projectiles.push({
      x: bh.x, y: bh.y,
      vx: dx / len * speed, vy: dy / len * speed,
      expire: Date.now() + 6000
    });
  }
}

// ── Boss AI 调度 ──
export function updateBossAI(now) {
  if (!G.boss) return;
  const ip = G.boss.hp <= 2 && (G.diff === 'hard' || G.diff === 'hell');
  const speedUp = Math.max(0.6, 1.0 - G.sessionStats.bossKilled * 0.04);
  const md = ip
    ? Math.max(120, (G.curSpeed + 80) * 0.82 * speedUp)
    : Math.max(160, (G.curSpeed + 80) * speedUp);

  const shootSpeedUp = Math.max(0.5, 1.0 - G.sessionStats.bossKilled * 0.05);
  const sd = ip
    ? (1500 + Math.random() * 1000) * shootSpeedUp
    : (2500 + Math.random() * 1500) * shootSpeedUp;

  if (now > G.boss.nextMove)  { G.boss.nextMove  = now + md; moveBoss(now); }
  if (now > G.boss.nextShoot) { G.boss.nextShoot = now + sd; shootProjectile(); }
}
