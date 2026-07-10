// ============================================================
// unlock.js — 渐进解锁系统
// ============================================================
import { UNLOCKS, MODE_NAME, DIFF } from './config.js';
import { getUnlockedModes, setUnlockedModes, getUnlockedDiffs, setUnlockedDiffs } from './storage.js';
import { G } from './state.js';

function meetsRequirement(req) {
  if (!req) return true;
  if (req.score !== undefined && G.score < req.score) return false;
  if (req.level !== undefined && G.level < req.level) return false;
  if (req.bossKilled !== undefined && G.sessionStats.bossKilled < req.bossKilled) return false;
  if (req.mode && G.mode !== req.mode) return false;
  if (req.diff && G.diff !== req.diff) return false;
  return true;
}

export function checkUnlocks() {
  const unlockedModes = getUnlockedModes();
  const unlockedDiffs = getUnlockedDiffs();
  const newlyUnlocked = [];

  for (const [key, cfg] of Object.entries(UNLOCKS.mode)) {
    if (unlockedModes.includes(key)) continue;
    if (meetsRequirement(cfg.requires)) {
      unlockedModes.push(key);
      newlyUnlocked.push({ type: 'mode', key, name: MODE_NAME[key], hint: cfg.hint });
    }
  }

  for (const [key, cfg] of Object.entries(UNLOCKS.diff)) {
    if (unlockedDiffs.includes(key)) continue;
    if (meetsRequirement(cfg.requires)) {
      unlockedDiffs.push(key);
      newlyUnlocked.push({ type: 'diff', key, name: DIFF[key].name, hint: cfg.hint });
    }
  }

  if (newlyUnlocked.length) {
    setUnlockedModes(unlockedModes);
    setUnlockedDiffs(unlockedDiffs);
  }

  return newlyUnlocked;
}

export function isUnlocked(type, key) {
  // ★ 全开：所有模式和难度均可直接游玩
  return true;
}

export function getUnlockHint(type, key) {
  return UNLOCKS[type]?.[key]?.hint || '';
}

export function ensureSelectableDefaults() {
  const unlockedModes = getUnlockedModes();
  const unlockedDiffs = getUnlockedDiffs();
  if (!unlockedModes.includes(G.mode)) G.mode = 'classic';
  if (!unlockedDiffs.includes(G.diff)) G.diff = 'easy';
}
