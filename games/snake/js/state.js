// ============================================================
// state.js — 单一状态树，全局唯一数据源
// Phase 4: 引入 PHASE 状态机
// ============================================================
import { DIFF, MAP, VC, PHASE } from './config.js';
import {
  getBest, getGold, getActiveSkin, getNickname, getUseDpad
} from './storage.js';

// ★ 阶段辅助函数（统一状态判断入口）
export function isPlaying()  { return G.phase === PHASE.PLAYING || G.phase === PHASE.BOSS_FIGHT; }
export function isPaused()   { return G.phase === PHASE.PAUSED; }
export function isInGame()   { return G.phase !== PHASE.MENU && G.phase !== PHASE.GAME_OVER; }
export function hasBoss()    { return G.phase === PHASE.BOSS_FIGHT; }
export function setPhase(p) {
  G.phase = p;
  // ★ 向后兼容旧代码中的 running / paused
  G.running = (p === PHASE.PLAYING || p === PHASE.BOSS_FIGHT);
  G.paused  = (p === PHASE.PAUSED);
}

function makeInitial() {
  return {
    phase: PHASE.MENU,
    running: false,
    paused: false,
    mode: 'classic',
    diff: 'normal',

    snake: [],
    snakeSet: new Set(),
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },

    score: 0,
    kills: 0,
    combo: 0,
    level: 1,
    eatenInLevel: 0,
    lastEatTime: 0,

    lives: 3,
    usedRevive: false,
    dieReason: '',

    walls: new Set(),
    foods: [],
    timedFoods: [],
    coins: [],
    enemies: [],
    portals: null,
    nextTimedAt: 0,
    nextCoinAt: 0,

    baseSpeed: 98,
    curSpeed: 98,

    speedBoostUntil: 0,
    mirrorUntil: 0,
    invincibleUntil: 0,
    shieldUntil: 0,
    dizzyUntil: 0,

    boss: null,
    projectiles: [],
    bossType: 'giant',
    bossFireTrail: new Map(),
    firstBoss: false,
    nextBossTh: 0,

    sprintCooldown: 0,
    lastTickAt: 0,

    weatherType: null,
    weatherUntil: 0,
    // ★ 优化：将初始天气的等待时间下调，第一场天气在开局 8秒~23秒 内便会随机降临
    weatherNext: Date.now() + 8000 + Math.random() * 15000,

    particles: [],
    floatingTexts: [],
    shake: 0,
    headSwell: 0,

    cam: { x: 0, y: 0 },
    muted: false,
    gpPressed: {},
    useDpad: false,

    currentTab: 'local',
    currentTimeRange: 'day',

    replayFrames: [],
    ghostFrames: null,
    ghostIdx: 0,
    isGhostMode: false,

    sessionStats: {
      bossKilled: 0,
      maxCombo: 0,
      coinEaten: 0,
      ghostBeaten: false
    },

    best: getBest(),
    gold: getGold(),
    skin: getActiveSkin(),
    snakeLevel: 1,
    rogueFang: 0,
    rogueSwift: 0,
    rogueMagnet: 0,
    rogueArmor: 0,
    rogueVitality: 0,
    rogueBlast: 0,
    rogueFortune: 0,
    rogueRegrow: 0,
    rogueClone: 0,
    rogueStorm: 0,
    rogueFiretrail: 0,
    rogueFrost: 0,
    rogueVortex: 0,
    roguePicks: [],
    nickname: getNickname(),
  };
}

export function rebuildSnakeSet() {
  const s = new Set();
  for (let i = 0; i < G.snake.length; i++) {
    const sg = G.snake[i];
    s.add((sg.x << 8) | sg.y);
  }
  G.snakeSet = s;
}

export const G = makeInitial();

export function resetState(mode, diff) {
  const d = DIFF[diff];
  const keep = {
    muted: G.muted,
    useDpad: G.useDpad,
    skin: G.skin,
    best: getBest(),
    gold: getGold(),
    nickname: getNickname()
  };
  const fresh = makeInitial();
  Object.assign(G, fresh, keep);

  G.mode = mode;
  G.diff = diff;
  G.lives = d.lives;
  G.baseSpeed = d.speed;
  G.curSpeed = d.speed;
  G.lastTickAt = 0;
}

export function safeSnakePos() {
  const sx = (MAP / 2) | 0, sy = (MAP / 2) | 0;
  for (let dx = 0; dx <= 2; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      const x = sx - dx, y = sy + dy;
      if (x >= 0 && x < MAP && y >= 0 && y < MAP && !G.walls.has((x << 8) | y)) {
        return { x, y };
      }
    }
  }
  for (let x = 0; x < MAP; x++) {
    for (let y = 0; y < MAP; y++) {
      if (!G.walls.has((x << 8) | y)) return { x, y };
    }
  }
  return { x: sx, y: sy };
}
