// ============================================================
// audio.js — 音效系统
// ★ 优化：track tokens 防止旧 setTimeout 残留
// ★ 优化：AudioContext 预创建 + 自动 resume
// ============================================================
import { G } from './state.js';

let actx = null;
let soundToken = 0;   // ★ 每次 restart 自增，旧音效的 setTimeout 失效

export function beep(f, d = 0.08, t = 'square', v = 0.15) {
  if (G.muted) return;
  const myToken = soundToken;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = t;
    o.frequency.value = f;
    o.connect(g);
    g.connect(actx.destination);
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(v, actx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.start();
    o.stop(actx.currentTime + d);
  } catch { /* 静默 */ }
  return myToken;
}

// 链式播放：检测 token，过期则放弃
function chain(token, steps) {
  if (token !== soundToken) return;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    setTimeout(() => {
      if (token !== soundToken) return;
      beep(s[0], s[1], s[2], s[3]);
    }, s._t || 0);
  }
}

export function initAudio() {
  document.addEventListener('click', () => {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    else if (actx.state === 'suspended') actx.resume();
  }, { once: false });
}

// ★ 每次新一局调用，让旧 setTimeout 失效
export function resetAudio() { soundToken++; }

export const sEat     = () => beep(660, 0.07);
export const sSpecial = () => chain(beep(880, 0.06), [[1180, 0.08, 'square', 0.15, 60]]);
export const sCoin    = () => chain(beep(988, 0.05), [
  [1318, 0.07, 'square', 0.15, 50],
  [1568, 0.09, 'square', 0.15, 100]
]);
export const sKill    = () => chain(beep(1200, 0.06), [
  [1600, 0.06, 'square', 0.15, 50],
  [2000, 0.10, 'square', 0.15, 100]
]);
export const sBad     = () => beep(160, 0.15, 'sawtooth', 0.2);
export const sPortal  = () => chain(beep(440, 0.05, 'sine', 0.2), [
  [880, 0.08, 'sine', 0.2, 40]
]);
export const sDie     = () => chain(beep(200, 0.18, 'sawtooth', 0.2), [
  [120, 0.25, 'sawtooth', 0.2, 120]
]);
export const sLevel   = () => chain(beep(523, 0.1), [
  [659, 0.1, 'square', 0.15, 100],
  [784, 0.15, 'square', 0.15, 200]
]);
