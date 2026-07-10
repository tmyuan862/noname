// ============================================================
// utils.js — 纯工具函数，无副作用，永不出错
// ★ 优化：增加事件发射器、时间格式化等
// ============================================================

// ── DOM 快捷引用 ──
export function $(id) {
  return document.getElementById(id);
}

// ── HTML 安全转义（防 XSS）──
export function esc(s) {
  if (s == null) return '匿名';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ── 墙壁数值键（避免字符串拆解；MAP=40 用 8 位足够）──
export function wk(x, y) {
  return (x << 8) | y;
}

export function wx(k) {
  return k >> 8;
}

export function wy(k) {
  return k & 255;
}

// ── 数值钳制 ──
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// ── 随机整数 ──
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── 日期格式化 ──
export function fmtDate() {
  const d = new Date();
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// ── 判定坐标在地图内 ──
export function inMap(x, y, MAP) {
  return x >= 0 && x < MAP && y >= 0 && y < MAP;
}

// ── 判定是否在中心安全区 ──
export function isSafeSpot(x, y, MAP) {
  return Math.abs(x - MAP / 2) <= 2 && Math.abs(y - MAP / 2) <= 2;
}

// ── 可见性检测 ──
export function visible(gx, gy, cam, VC) {
  return gx >= cam.x - 1 && gx <= cam.x + VC + 1
      && gy >= cam.y - 1 && gy <= cam.y + VC + 1;
}

// ── ★ 简单事件发射器（取代直接挂 window）──
export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) {
    (this._h[ev] || (this._h[ev] = [])).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    const arr = this._h[ev]; if (!arr) return;
    const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
  }
  emit(ev, ...args) {
    const arr = this._h[ev]; if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try { arr[i](...args); } catch (e) { console.warn('[emitter]', ev, e); }
    }
  }
}

// ── ★ 节流（RAF 帧合并）──
export function rafThrottle(fn) {
  let scheduled = false, lastArgs;
  return function (...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(this, lastArgs);
    });
  };
}

// ── ★ 防抖 ──
export function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ── ★ 选择权重（修复原 mysteryBox 概率 bug）──
export function pickWeighted(eff, wgt) {
  let total = 0;
  for (let i = 0; i < wgt.length; i++) total += wgt[i];
  let r = Math.random() * total, acc = 0;
  for (let i = 0; i < eff.length; i++) {
    acc += wgt[i];
    if (r <= acc) return eff[i];
  }
  return eff[eff.length - 1];
}

// ── ★ 计数数组内指定元素的出现次数（无分配，替代 .filter().length）──
export function countIn(arr, item) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === item) n++;
  }
  return n;
}
