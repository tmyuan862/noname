// ============================================================
// storage.js — localStorage 读写，内置容错
// ★ 优化：dpad 持久化 + redeem 加固 + 防超容量
// ============================================================
import { KEY_BEST, KEY_HIST, KEY_GOLD, KEY_GHOST, KEY_USE_DPAD, KEY_LAST_REDEEM } from './config.js';

// ── 通用读（损坏自动回退）──
export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const parsed = JSON.parse(v);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// ── 通用写（失败时发出警告事件）──
let _warnedStorage = false;
function warnStorageFull() {
  if (_warnedStorage) return;
  _warnedStorage = true;
  // 使用 CustomEvent 通知 UI 层，避免循环依赖
  try {
    window.dispatchEvent(new CustomEvent('storage-full', { detail: '本地存储已满，部分数据可能无法保存' }));
  } catch {}
  setTimeout(() => { _warnedStorage = false; }, 10000); // 10秒内不重复警告
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 配额超限：尝试清理 Ghost 历史后重试
    if (key === KEY_GHOST) return;
    try {
      const ghosts = load(KEY_GHOST, []);
      save(KEY_GHOST, ghosts.slice(0, 5));
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      warnStorageFull();
    }
  }
}

// ── 最高分 ──
export function getBest() { return load(KEY_BEST, 0); }
export function setBest(v) { save(KEY_BEST, v | 0); }

// ── 历史记录 ──
export function getHist() { return load(KEY_HIST, []); }
export function addHist(entry) {
  const h = getHist();
  h.unshift(entry);
  h.sort((a, b) => b.score - a.score);
  save(KEY_HIST, h.slice(0, 100));
}
export function clearHist() {
  try { localStorage.removeItem(KEY_HIST); } catch {}
}

// ── 金币 ──
export function getGold() { return load(KEY_GOLD, 0); }
export function addGold(n) {
  const g = Math.max(0, getGold() + (n | 0));
  save(KEY_GOLD, g);
  return g;
}
export function spendGold(n) {
  const g = getGold() - n;
  if (g < 0) return false;
  save(KEY_GOLD, g);
  return true;
}

// ── Ghost 回放 ──
export function getGhosts() { return load(KEY_GHOST, []); }
export function saveReplay(rec) {
  const g = getGhosts();
  g.push(rec);
  g.sort((a, b) => b.score - a.score);
  save(KEY_GHOST, g.slice(0, 20));
}

// ── 皮肤 ──
export function getActiveSkin() {
  return localStorage.getItem('sk_a') || 'classic';
}
export function setActiveSkin(k) {
  try { localStorage.setItem('sk_a', k); } catch {}
}
export function getOwnedSkins() {
  const arr = load('sk_o', ['classic']);
  return Array.isArray(arr) ? arr : ['classic'];
}
export function setOwnedSkins(arr) {
  if (!Array.isArray(arr)) return;
  save('sk_o', arr);
}

// ── 装备 ──
export function getActiveEquips() {
  const arr = load('eq_a', ['none', 'none']);
  return Array.isArray(arr) && arr.length >= 2 ? arr : ['none', 'none'];
}
export function setActiveEquips(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return;
  save('eq_a', arr);
}

// ── 成就 ──
export function getUnlockedAch() {
  const arr = load('ach_u', []);
  return Array.isArray(arr) ? arr : [];
}
export function setUnlockedAch(arr) {
  if (!Array.isArray(arr)) return;
  save('ach_u', arr);
}

// ── ★ 方向手柄持久化（修复 G.useDpad 刷新丢失）──
export function getUseDpad() {
  try { return localStorage.getItem(KEY_USE_DPAD) === '1'; } catch { return false; }
}
export function setUseDpad(v) {
  try { localStorage.setItem(KEY_USE_DPAD, v ? '1' : '0'); } catch {}
}

// ── 每日任务 ──
export function getMissionsData() {
  const k = 'sn_ms';
  let d = load(k, null);
  const today = new Date().toDateString();
  if (!d || typeof d !== 'object' || d.date !== today) {
    d = { date: today, missions: [] };
  }
  return d;
}
export function saveMissionsData(d) {
  if (!d || typeof d !== 'object') return;
  save('sn_ms', d);
}

// ── 渐进解锁 ──
export function getUnlockedModes() {
  const arr = load('un_m', ['classic']);
  return Array.isArray(arr) ? arr : ['classic'];
}
export function setUnlockedModes(arr) {
  if (!Array.isArray(arr)) return;
  save('un_m', arr);
}
export function getUnlockedDiffs() {
  const arr = load('un_d', ['easy']);
  return Array.isArray(arr) ? arr : ['easy'];
}
export function setUnlockedDiffs(arr) {
  if (!Array.isArray(arr)) return;
  save('un_d', arr);
}
export function getNickname() {
  try { return localStorage.getItem('sn_n') || ''; } catch { return ''; }
}
export function setNickname(v) {
  try { localStorage.setItem('sn_n', v || ''); } catch {}
}

// ── 兑换码使用记录 ──
export function getUsedRedeem() {
  const arr = load('redeem_used', []);
  return Array.isArray(arr) ? arr : [];
}
export function addUsedRedeem(code) {
  const arr = getUsedRedeem();
  if (!arr.includes(code)) {
    arr.push(code);
    save('redeem_used', arr);
  }
}
