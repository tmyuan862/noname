// ============================================================
// ui.js — DOM 操作：智能缓存化面板切换、HUD 与 Boss 血条更新（解决重排卡顿）
// ============================================================
import { $ } from './utils.js';
import { G } from './state.js';
import { getGold } from './storage.js';
import { PERF, BOSS_FULL_NAME, WEATHER_NAME } from './config.js';
import { levelThreshold } from './rogue.js';

const SUB_CARDS = [
  'settingsCard', 'missionsCard', 'shopCard', 'achCard', 'equipCard',
  'leaderboardCard', 'ghostCard', 'redeemCard', 'tutorialCard'
];

// ── DOM 节点懒缓存（避免每帧遍历 DOM 树） ──
const _domCache = {};
function getCachedEl(id) {
  if (!_domCache[id]) {
    _domCache[id] = $(id);
  }
  return _domCache[id];
}

// ── 面板切换 ──
export function hideSubs() {
  for (let i = 0; i < SUB_CARDS.length; i++) {
    const el = getCachedEl(SUB_CARDS[i]);
    if (el) el.classList.add('hidden');
  }
  const mm = getCachedEl('mainMenuCard');
  if (mm) mm.classList.remove('hidden');
}

export function showPanel(id) {
  hideSubs();
  const mm = getCachedEl('mainMenuCard');
  if (mm) mm.classList.add('hidden');
  const el = getCachedEl(id);
  if (el) el.classList.remove('hidden');
}

// HUD 数值状态比对脏缓存
let _hudCache = { lives: -1, score: -1, best: -1, level: null, kills: -1, gold: -1 };
let _hudGoldMenu = -1;
let _hudNick = null;
let _hudMode = null;

export function updateHUD() {
  if (G.lives !== _hudCache.lives) {
    const lv = getCachedEl('lives'); if (lv) lv.textContent = '❤️ x' + G.lives;
    _hudCache.lives = G.lives;
  }
  if (G.score !== _hudCache.score) {
    const sc = getCachedEl('score'); if (sc) sc.textContent = G.score;
    _hudCache.score = G.score;
  }
  if (G.best !== _hudCache.best) {
    const be = getCachedEl('best'); if (be) be.textContent = G.best;
    _hudCache.best = G.best;
  }
  const lv = G.mode === 'level' ? G.level : '-';
  if (lv !== _hudCache.level) {
    const le = getCachedEl('level'); if (le) le.textContent = lv;
    _hudCache.level = lv;
  }
  if (G.kills !== _hudCache.kills) {
    const kl = getCachedEl('kills'); if (kl) kl.textContent = G.kills;
    _hudCache.kills = G.kills;
  }
  const g = getGold();
  if (g !== _hudCache.gold) {
    const ga = getCachedEl('goldAmt'); if (ga) ga.textContent = g;
    _hudCache.gold = g;
  }
  if (g !== _hudGoldMenu) {
    const mg = getCachedEl('menuGoldDisplay'); if (mg) mg.textContent = g;
    _hudGoldMenu = g;
  }
  if (G.nickname !== _hudNick) {
    const md = getCachedEl('menuNickDisplay'); if (md) md.textContent = G.nickname;
    _hudNick = G.nickname;
  }
  if (G.mode !== _hudMode) {
    const lvBox = getCachedEl('lvBox');
    if (lvBox) lvBox.style.display = G.mode === 'level' ? '' : 'none';
    _hudMode = G.mode;
  }
  // ★ 蛇等级
  const snakeLv = G.snakeLevel || 1;
  const slv = 'Lv.' + snakeLv;
  const slvEl = getCachedEl('snakeLv');
  if (slvEl && slvEl.textContent !== slv) slvEl.textContent = slv;

  // ★ XP 进度条
  const xpWrap = getCachedEl('xpBarWrap');
  if (xpWrap) {
    const inGame = G.phase !== 'menu' && G.phase !== 'game_over' && G.running;
    xpWrap.style.display = inGame ? 'block' : 'none';
    if (inGame) {
      const prev = levelThreshold(snakeLv - 1);
      const need = levelThreshold(snakeLv) - prev;
      const cur = Math.min(G.score - prev, need);
      const pct = need > 0 ? Math.floor(cur / need * 100) : 100;
      const fill = getCachedEl('xpBarFill');
      if (fill) fill.style.width = pct + '%';
      const txt = getCachedEl('xpBarText');
      if (txt) txt.textContent = 'Lv.' + snakeLv + ' · ' + cur + '/' + need;
    }
  }
}

// Boss 状态脏检测机制
let _lastBossHp = -1;
let _lastBossMaxHp = -1;
let _lastBossType = null;
let _lastBossSuper = null;
let _lastBossActive = false;

export function updateBossBar() {
  const bw = getCachedEl('bossBarWrap');
  const bb = getCachedEl('bossBar');
  const bn = getCachedEl('bossName');
  if (!bw) return;

  const active = !!G.boss;
  if (active !== _lastBossActive) {
    bw.style.display = active ? 'block' : 'none';
    _lastBossActive = active;
  }
  if (!active) return;

  const hp = G.boss.hp;
  const maxHp = G.boss.maxHp;
  const type = G.bossType;
  const superSkill = G.boss.superSkill;

  if (hp !== _lastBossHp || maxHp !== _lastBossMaxHp || type !== _lastBossType || superSkill !== _lastBossSuper) {
    if (bb) bb.style.width = (hp / maxHp * 100) + '%';
    if (bn) {
      let name = (BOSS_FULL_NAME[type] || '👿 BOSS') + ' BOSS';
      // ★ 挑战赛才显示等级 Lv.X，其他模式不显示等级后缀
      if (G.mode === 'bossRush') {
        const lv = G.sessionStats.bossKilled + 1;
        if (superSkill) {
          name = '🔥 狂暴 · ' + name + ' (Lv.' + lv + ') 🔥';
        } else {
          name = name + ' (Lv.' + lv + ')';
        }
      }
      bn.textContent = name;
    }
    _lastBossHp = hp;
    _lastBossMaxHp = maxHp;
    _lastBossType = type;
    _lastBossSuper = superSkill;
  }
}

// ── Toast ──
let _toastTimer = 0;
export function toast(msg) {
  const t = getCachedEl('toast'); if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
}

let _comboTimer = 0;
export function showCombo() {
  const c = getCachedEl('combo'); if (!c) return;
  c.textContent = '🔥 连击 x' + G.combo + ' +' + (G.combo - 2);
  c.classList.add('show');
  clearTimeout(_comboTimer);
  _comboTimer = setTimeout(() => c.classList.remove('show'), 900);
}

let _weatherTimer = 0;
export function showWeatherLabel() {
  const w = getCachedEl('weather'); if (!w) return;
  const wt = G.weatherType;
  if (!wt) { w.classList.remove('show'); return; }
  w.textContent = WEATHER_NAME[wt] || '';
  w.classList.add('show');
  clearTimeout(_weatherTimer);
  _weatherTimer = setTimeout(() => w.classList.remove('show'), 2000);
}

// ── 游戏结束 ──
export function showGameOver(isNew) {
  const gt = getCachedEl('goTitle'); if (gt) gt.textContent = isNew ? '🎉 新纪录！' : '游戏结束';
  const gs = getCachedEl('goSub');
  if (gs) gs.textContent = (G.dieReason ? G.dieReason + '　' : '') + '得分 ' + G.score + '　击杀 ' + G.kills + '　最高 ' + G.best;
  const rev = getCachedEl('reviveBtn');
  if (rev) rev.style.display = G.usedRevive ? 'none' : 'block';
  const go = getCachedEl('gameover');
  if (go) go.classList.remove('hidden');
}

export function hideGameOver() {
  const go = getCachedEl('gameover'); if (go) go.classList.add('hidden');
}

export function showMenu() {
  const m = getCachedEl('menu'); if (m) m.classList.remove('hidden');
  const dp = getCachedEl('dpad'); if (dp) dp.classList.remove('on');
  const jw = getCachedEl('joystickWrap'); if (jw) jw.classList.remove('on');
}

export function hideMenu() {
  const m = getCachedEl('menu'); if (m) m.classList.add('hidden');
}

// ── 粒子 ──
export function burst(px, py, color, n = 10) {
  if (G.particles.length > PERF.maxParticles) return;
  const scl = PERF.particleScale;
  const count = Math.round(n * scl);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.5;
    G.particles.push({
      x: px, y: py,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, color, size: 2 + Math.random() * 3
    });
  }
}

export function showFloating(gx, gy, text, color) {
  if (G.floatingTexts.length > PERF.maxFloats) G.floatingTexts.shift();
  G.floatingTexts.push({ gx, gy, text, color: color || '#ff1744', life: 1, offsetY: 0 });
}

// ── 昵称 ──
export function initNickname() {
  if (!G.nickname) {
    const no = getCachedEl('nicknameOverlay'); if (no) no.classList.remove('hidden');
  } else {
    const md = getCachedEl('menuNickDisplay'); if (md) md.textContent = G.nickname;
    if (!localStorage.getItem('sn_v2_seen')) {
      const nt = getCachedEl('noticeOverlay'); if (nt) nt.classList.remove('hidden');
      try { localStorage.setItem('sn_v2_seen', '1'); } catch {}
    }
  }
}
