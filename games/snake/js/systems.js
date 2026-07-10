// ============================================================
// systems.js — 皮肤/装备/成就/任务/Ghost/排行榜/兑换码/死亡复活
// ============================================================
import { SKINS, ACHIEVEMENTS, BASE_MISSIONS, MODE_NAME, DIFF, MAP, VC, MODE_REVERSE, DIFF_REVERSE, UNLOCKS } from './config.js';
import { esc, Emitter } from './utils.js';
import { G, rebuildSnakeSet } from './state.js';
import {
  getBest, setBest, getHist, addHist, getGold, addGold, spendGold,
  getActiveSkin, setActiveSkin, getOwnedSkins, setOwnedSkins,
  getUnlockedAch, setUnlockedAch,
  getMissionsData, saveMissionsData, getGhosts, saveReplay,
  getUsedRedeem, addUsedRedeem,
  getUnlockedModes, setUnlockedModes,
  getUnlockedDiffs, setUnlockedDiffs
} from './storage.js';
import { isWall, safeCellNear } from './engine.js';
import { uploadScore, fetchGlobal } from './network.js';
import { checkUnlocks } from './unlock.js';
import { setPhase } from './state.js';
import { PHASE } from './config.js';

export const bus = new Emitter();

// ── 皮肤 ──
export function renderSkinGrid() {
  const el = document.getElementById('skinGrid'); if (!el) return;
  const owned = getOwnedSkins(), active = getActiveSkin();
  let h = '';
  for (const k in SKINS) {
    const v = SKINS[k];
    const o = owned.includes(k), a = active === k;
    h += '<div class="skin-item' + (a ? ' active' : '') + (!o ? ' locked' : '') +
      '" data-skin="' + k + '"><div class="skin-icon">' + v.emoji + '</div>' +
      '<div class="skin-name">' + (a ? '✅ ' : '') + v.name + '</div>' +
      '<div class="skin-price">' + (o ? (a ? '使用中' : '点击使用') : '🔒 ' + v.price + ' 金币') + '</div></div>';
  }
  el.innerHTML = h;
  const sg = document.getElementById('shopGold');
  if (sg) sg.textContent = '💰 金币余额：' + getGold();
}

export function selectSkin(k) {
  if (!getOwnedSkins().includes(k)) return;
  setActiveSkin(k); G.skin = k; renderSkinGrid();
}

export function buySkin(k) {
  if (getOwnedSkins().includes(k)) return;
  if (!spendGold(SKINS[k].price)) return;
  const owned = getOwnedSkins();
  owned.push(k); setOwnedSkins(owned);
  selectSkin(k);
  checkAchievements();
}

// ── 成就 ──
export function checkAchievements() {
  const s = {
    score: G.score, kills: G.kills, level: G.level,
    mode: MODE_NAME[G.mode], diff: DIFF[G.diff].name,
    bossKilled: G.sessionStats.bossKilled,
    maxCombo: G.sessionStats.maxCombo,
    coinEaten: G.sessionStats.coinEaten,
    ghostBeaten: G.sessionStats.ghostBeaten
  };
  const unlocked = getUnlockedAch();
  const nu = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.includes(a.id)) continue;
    let pass = false;
    if (a.id === 'a11') {
      pass = getGold() >= 500;
    } else if (a.id === 'a12') {
      pass = getOwnedSkins().length >= Object.keys(SKINS).length;
    } else {
      pass = a.check(s);
    }
    if (pass) { unlocked.push(a.id); nu.push(a); }
  }
  if (nu.length > 0) {
    setUnlockedAch(unlocked);
    addGold(nu.length * 20);
    bus.emit('achievement', nu);
  }
}

export function renderAch() {
  const el = document.getElementById('achList'); if (!el) return;
  const unlocked = getUnlockedAch();
  el.innerHTML = ACHIEVEMENTS.map(a => {
    const u = unlocked.includes(a.id);
    return '<div class="ach-item' + (u ? ' unlocked' : ' locked') +
      '"><span class="ach-icon">' + a.icon + '</span>' +
      '<span class="ach-info"><span class="ach-name">' + a.name +
      '</span><br><span class="ach-desc">' + a.desc + '</span></span></div>';
  }).join('');
  const as = document.getElementById('achSub');
  if (as) as.textContent = '已解锁 ' + unlocked.length + ' / ' + ACHIEVEMENTS.length;
}

// ── 每日任务 ──
export function getMissions() {
  const d = getMissionsData();
  if (!Array.isArray(d.missions) || d.missions.length === 0) {
    d.missions = BASE_MISSIONS.map(m => ({ ...m, progress: 0, claimed: false }));
    saveMissionsData(d);
  }
  return d;
}

export function updateMissions() {
  const d = getMissions(); let ch = false;
  for (const m of d.missions) {
    if (m.claimed) continue;
    if (m.id === 'm1') { m.progress = Math.min(m.goal, m.progress + 1); ch = true; }
    if (m.id === 'm2' && G.score >= 500) { m.progress = Math.max(m.progress, 1); ch = true; }
    if (m.id === 'm3' && G.sessionStats.bossKilled > 0) { m.progress = Math.max(m.progress, 1); ch = true; }
    if (m.id === 'm4' && G.mode === 'chaos') { m.progress = Math.max(m.progress, 1); ch = true; }
    if (m.id === 'm5' && G.diff === 'hell') { m.progress = Math.max(m.progress, 1); ch = true; }
  }
  if (ch) saveMissionsData(d);
}

export function renderMissions() {
  const d = getMissions();
  const el = document.getElementById('missionsList');
  if (!el) return;
  el.innerHTML = d.missions.map(m =>
    '<div class="mission-item' + (m.progress >= m.goal && !m.claimed ? ' completed' : '') + (m.claimed ? ' claimed' : '') +
    '" data-mid="' + m.id + '">' +
    '<span class="m-desc">' + m.desc + '</span>' +
    '<span class="m-prog">' + m.progress + '/' + m.goal + '</span>' +
    '<span class="m-reward">💰' + m.reward + '</span>' +
    (m.progress >= m.goal && !m.claimed ? '<button class="claim-btn" style="padding:3px 6px;font-size:10px;margin-left:4px">领取</button>' : '') +
    '</div>'
  ).join('');

  el.querySelectorAll('.mission-item').forEach(item => {
    const id = item.dataset.mid;
    const btn = item.querySelector('.claim-btn');
    if (btn) btn.addEventListener('click', () => claimMission(id));
  });
}

function claimMission(id) {
  const d = getMissions();
  const m = d.missions.find(x => x.id === id);
  if (m && m.progress >= m.goal && !m.claimed) {
    m.claimed = true;
    addGold(m.reward);
    saveMissionsData(d);
    renderMissions();
  }
}

// ── Ghost ──
export function renderGhostList() {
  const g = getGhosts();
  const el = document.getElementById('ghostList');
  if (!el) return;
  if (!g.length) { el.innerHTML = '<div class="empty">暂无回放记录，请先进行游戏</div>'; return; }
  el.innerHTML = g.slice(0, 10).map((rec, i) =>
    '<div class="row" style="cursor:pointer" data-ghost="' + i + '">' +
    '<span>👻 ' + esc(rec.date) + ' · ' + esc(rec.mode || '经典') + '-' + esc(rec.diff || '普通') + '</span>' +
    '<b style="color:var(--accent)">' + rec.score + ' 分</b></div>'
  ).join('');
}

export function startGhost(idx) {
  const g = getGhosts();
  if (!g[idx]) return;
  G.ghostFrames = g[idx].frames;
  G.ghostIdx = 0;
  G.isGhostMode = true;
}

// ── 排行榜 ──
export function renderHistory(mf, df) {
  const el = document.getElementById('hlist'); if (!el) return;
  let h = getHist();
  if (mf !== 'all') h = h.filter(e => e.mode === mf);
  if (df !== 'all') h = h.filter(e => e.diff === df);
  if (!h.length) { el.innerHTML = '<div class="empty">该筛选下无本地记录</div>'; return; }
  el.innerHTML = h.slice(0, 20).map((e, i) => {
    const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    return '<li><span class="hd">' + m + ' ' + esc(e.name) + ' · ' + esc(e.mode) + '-' + esc(e.diff) + (e.level ? ' L' + e.level : '') + '</span><span class="hs">' + e.score + ' 分</span></li>';
  }).join('');
}

export async function renderGlobal(mf, df, tr) {
  const el = document.getElementById('hlist'); if (!el) return;
  el.innerHTML = '<div class="empty">加载中…</div>';
  const data = await fetchGlobal(tr);
  if (!data) { el.innerHTML = '<div class="empty">连接失败，请检查网络</div>'; return; }

  // ★ 优化：使用反向映射表 O(1) 查找，替代 16 个 if-else 分支
  const norm = data.map(x => {
    const mr = MODE_REVERSE[x.mode] || { cn: '经典', key: 'classic' };
    const dr = DIFF_REVERSE[x.diff] || { cn: '普通', key: 'normal' };
    return { ...x, pm: mr.cn, pd: dr.cn, modeKey: mr.key, diffKey: dr.key };
  });

  let fd = norm;
  if (mf !== 'all') fd = fd.filter(x => x.pm === mf);
  if (df !== 'all') fd = fd.filter(x => x.pd === df);
  if (!fd.length) { el.innerHTML = '<div class="empty">该时间范围内无对应记录</div>'; return; }
  el.innerHTML = fd.slice(0, 20).map((e, i) => {
    const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    return '<li><span class="hd">' + m + ' ' + esc(e.name) + ' · ' + esc(e.pm) + '-' + esc(e.pd) + '</span><span class="hs">' + e.score + ' 分</span></li>';
  }).join('');
}

// ── 死亡 ──
let pendingEntry = null;

export function die() {
  setPhase(PHASE.GAME_OVER);
  G.shake = 14;

  const best = getBest(), isNew = G.score > best;
  if (isNew) setBest(G.score);

  pendingEntry = {
    score: G.score,
    mode: G.mode,
    diff: G.diff,
    modeName: MODE_NAME[G.mode],
    diffName: DIFF[G.diff].name,
    level: G.mode === 'level' ? G.level : 0,
    date: (new Date().getMonth() + 1) + '/' + new Date().getDate(),
    name: G.nickname
  };

  if (G.replayFrames && G.replayFrames.length > 10) {
    saveReplay({
      score: G.score,
      date: pendingEntry.date,
      mode: pendingEntry.modeName,
      diff: pendingEntry.diffName,
      // ★ 优化：编码帧在保存时转换回对象（仅一次性操作）
      frames: G.replayFrames.map(f => f.map(n => ({ x: n >> 8, y: n & 255 })))
    });
  }

  updateMissions();
  checkAchievements();
  const newUnlocks = checkUnlocks();
  if (newUnlocks.length) {
    bus.emit('unlock', newUnlocks);
  }
  addGold(Math.floor(G.score / 10));

  return { isNew, best: getBest(), pendingEntry };
}

export function revive() {
  if (G.usedRevive) return false;
  G.usedRevive = true;
  G.lives = 1;
  const hd = G.snake[0] || { x: (MAP / 2) | 0, y: (MAP / 2) | 0 };
  const d = G.dir || { x: 1, y: 0 };

  // ★ 安全兜底：复活点不能卡在墙/火焰/敌人附近
  const safe = isWall(hd.x, hd.y)
    ? safeCellNear(hd.x, hd.y, { avoidSnake: false, minEnemyDist: 3 })
    : hd;

  G.snake = [
    { x: safe.x, y: safe.y },
    { x: safe.x - d.x, y: safe.y - d.y },
    { x: safe.x - d.x * 2, y: safe.y - d.y * 2 }
  ];
  rebuildSnakeSet();
  G.speedBoostUntil = 0;
  G.mirrorUntil = 0;
  G.curSpeed = G.baseSpeed;
  G.invincibleUntil = Date.now() + 2500;
  G.cam.x = safe.x - VC / 2;
  G.cam.y = safe.y - VC / 2;
  setPhase(G.boss ? PHASE.BOSS_FIGHT : PHASE.PLAYING);
  return true;
}

export function commitEntry() {
  if (!pendingEntry) return;
  pendingEntry.name = pendingEntry.name || G.nickname || '无名英雄';
  // ★ 统一命名：本地历史用中文显示名，上传用英文 key
  const entry = { ...pendingEntry, mode: pendingEntry.modeName, diff: pendingEntry.diffName };
  addHist(entry);
  uploadScore(entry.name, entry.score, pendingEntry.mode, pendingEntry.diff); // 英文 key 上传
  pendingEntry = null;
}

export function getPendingEntry() { return pendingEntry; }

// ── 兑换码系统 ──
export const REDEEM_CODES = {
  'snake2024': { type: 'gold',   amount: 200, desc: '200 金币' },
  'mengyuan':  { type: 'gold',   amount: 500, desc: '500 金币' },
  'vip666':    { type: 'skin',   skin:   'neon',  desc: '霓虹紫皮肤' },
  'flameon':   { type: 'skin',   skin:   'flame', desc: '火焰皮肤' },
  'frosty':    { type: 'skin',   skin:   'frost', desc: '冰霜皮肤' },
  'golden':    { type: 'skin',   skin:   'gold',  desc: '暗金皮肤' },
  'pixelart':  { type: 'skin',   skin:   'pixel', desc: '像素皮肤' },
  'lucky888':  { type: 'gold',   amount: 888, desc: '888 金币' },
  'rebirth':   { type: 'revive', desc: '额外复活次数 +1' },
  'allunlock': { type: 'cheat',  desc: '一键全解锁 (99999金币 + 6大炫彩皮肤 + 12个成就)' }
};

export function redeemCode(code) {
  const c = String(code || '').toLowerCase().trim();
  if (!c) return { ok: false, msg: '请输入兑换码' };
  const used = getUsedRedeem();
  if (used.includes(c)) return { ok: false, msg: '该兑换码已使用过' };
  const r = REDEEM_CODES[c];
  if (!r) return { ok: false, msg: '无效的兑换码' };

  if (c === 'allunlock') {
    addGold(99999);
    setOwnedSkins(['classic', 'neon', 'flame', 'frost', 'gold', 'pixel']);
    setUnlockedAch(ACHIEVEMENTS.map(a => a.id));
    setUnlockedModes(Object.keys(UNLOCKS.mode));
    setUnlockedDiffs(Object.keys(UNLOCKS.diff));
    selectSkin('gold');
  } else {
    switch (r.type) {
      case 'gold':   addGold(r.amount); break;
      case 'skin': {
        if (!getOwnedSkins().includes(r.skin)) {
          const owned = getOwnedSkins();
          owned.push(r.skin);
          setOwnedSkins(owned);
        }
        break;
      }
      case 'revive': G.usedRevive = false; break;
    }
  }
  addUsedRedeem(c);
  return { ok: true, msg: '✅ 兑换成功：' + r.desc };
}
