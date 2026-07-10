// ============================================================
// input.js — 键盘 / 触屏 / 手柄（含蜕皮快捷键支持）
// ============================================================
import { G, isPlaying } from './state.js';
import { shedSkin } from './engine.js';

const KEY_MAP = {
  ArrowUp:    [0, -1], ArrowDown:  [0, 1],
  ArrowLeft:  [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
};

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function initKeyboard() {
  document.addEventListener('keydown', e => {
    // 空格键暂停
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('toggle-pause'));
      return;
    }
    // Shift 或 F 键触发断尾蜕皮
    if (e.key === 'Shift' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      shedSkin();
      return;
    }
    if (isTyping()) return;
    const d = KEY_MAP[e.key];
    if (d) {
      e.preventDefault();
      setDir(d[0], d[1]);
    }
  });
}

export function initTouch(canvas) {
  let ts = null;
  let armed = false;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { ts = null; return; }
    ts = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    armed = true;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!ts || !armed) return;
    const dx = e.touches[0].clientX - ts.x;
    const dy = e.touches[0].clientY - ts.y;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
    armed = false;
  }, { passive: true });
  canvas.addEventListener('touchend', () => { ts = null; armed = false; }, { passive: true });
  canvas.addEventListener('touchcancel', () => { ts = null; armed = false; }, { passive: true });
}

// ★ 手游摇杆
let _joyActive = false, _joyId = null;
export function initJoystick() {
  const base = document.getElementById('joystickBase');
  const thumb = document.getElementById('joystickThumb');
  if (!base || !thumb) return;

  const center = () => ({ x: base.offsetWidth / 2, y: base.offsetHeight / 2 });
  const maxDist = base.offsetWidth / 2 - 12;

  function handleStart(e) {
    e.preventDefault();
    if (_joyActive) return;
    const t = e.touches ? e.touches[0] : e;
    _joyActive = true;
    _joyId = t.identifier;
    updateThumb(t);
  }

  function handleMove(e) {
    if (!_joyActive) return;
    e.preventDefault();
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === _joyId) {
        updateThumb(e.touches[i]);
        return;
      }
    }
  }

  function updateThumb(t) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) {
      dx = dx / dist * maxDist;
      dy = dy / dist * maxDist;
    }
    thumb.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

    // 方向判定
    if (dist > 12) {
      if (Math.abs(dx) > Math.abs(dy)) {
        setDir(dx > 0 ? 1 : -1, 0);
      } else {
        setDir(0, dy > 0 ? 1 : -1);
      }
    }
  }

  function handleEnd(e) {
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === _joyId) { _joyActive = false; _joyId = null; break; }
    }
    if (e.touches.length === 0) {
      _joyActive = false;
      _joyId = null;
    }
    thumb.style.transform = 'translate(0px, 0px)';
  }

  base.addEventListener('touchstart', handleStart, { passive: false });
  base.addEventListener('touchmove', handleMove, { passive: false });
  base.addEventListener('touchend', handleEnd);
  base.addEventListener('touchcancel', handleEnd);
}

export function checkGamepad() {
  if (!isPlaying()) return;
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp) continue;
    if (gp.buttons[12] && gp.buttons[12].pressed) setDir(0, -1);
    if (gp.buttons[13] && gp.buttons[13].pressed) setDir(0, 1);
    if (gp.buttons[14] && gp.buttons[14].pressed) setDir(-1, 0);
    if (gp.buttons[15] && gp.buttons[15].pressed) setDir(1, 0);
    const th = 0.5;
    if (gp.axes[0] < -th) setDir(-1, 0);
    if (gp.axes[0] >  th) setDir(1, 0);
    if (gp.axes[1] < -th) setDir(0, -1);
    if (gp.axes[1] >  th) setDir(0, 1);

    // Start 键暂停
    if (gp.buttons[9] && gp.buttons[9].pressed) {
      if (!G.gpPressed['pause']) {
        window.dispatchEvent(new CustomEvent('toggle-pause'));
        G.gpPressed['pause'] = true;
      }
    } else {
      G.gpPressed['pause'] = false;
    }

    // A 键(0) 或 X 键(2) 触发断尾蜕皮
    if ((gp.buttons[0] && gp.buttons[0].pressed) || (gp.buttons[2] && gp.buttons[2].pressed)) {
      if (!G.gpPressed['shed']) {
        shedSkin();
        G.gpPressed['shed'] = true;
      }
    } else {
      G.gpPressed['shed'] = false;
    }
  }
}

function setDir(x, y) {
  if (!isPlaying()) return;
  if (G.mirrorUntil && Date.now() < G.mirrorUntil) { x = -x; y = -y; }
  if ((G.dir.x === x && G.dir.y === y) ||
      (G.dir.x === -x && G.dir.y === -y)) return;
  G.nextDir = { x, y };
}
