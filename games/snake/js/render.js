// ============================================================
// render.js — Canvas 绘制（高性能原生刷新 + 炫丽皮肤 + Boss独立皮肤 + 双雷达寻路指示线 + 靠近食物变暗）
// ★ Phase 3: 自适应质量、网格缓存、批量绘制
// ============================================================
import { CELL, VIEW, VC, MAP, PERF, setPerf, EMOJI_FONT, STATUS_FONT, SKINS, BOSS_EMOJI, BOSS_NAMES, WEATHERS, WEATHER_NAME, CAM_LERP, SHAKE_DECAY, SHAKE_THRESHOLD, HEAD_SWELL_DECAY } from './config.js';
import { wk, wx, wy, visible, countIn } from './utils.js'; // wx/wy 用于火焰轨迹 Map 解码
import { G } from './state.js';

export let ctx = null;



export function initCanvas() {
  const canvas = document.getElementById('game');
  ctx = canvas.getContext('2d', { alpha: false }); // ★ 禁用 alpha 通道减少合成开销
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // ★ 上限 2x，超高分屏不浪费
  canvas.width = VIEW * dpr;
  canvas.height = VIEW * dpr;
  ctx.scale(dpr, dpr);

  // ★ 自适应质量档位
  const mobile = /Mobi|Android|iPhone/i.test(navigator.userAgent) || window.innerWidth < 600;
  setPerf({
    maxParticles: mobile ? 80 : 200,
    maxFloats:    mobile ? 15 : 30,
    particleScale: mobile ? 0.5 : 1
  });

  return canvas;
}

function cx(gx) { return (gx - G.cam.x) * CELL; }
function cy(gy) { return (gy - G.cam.y) * CELL; }
// ★ 优化：单元格中心点快捷辅助函数
function midX(gx) { return cx(gx) + CELL / 2; }
function midY(gy) { return cy(gy) + CELL / 2; }



// ★ 优化：靠近蛇头的距离衰减透明度辅助函数
function nearHeadAlpha(gx, gy, range, minAlpha, maxAlpha) {
  if (!G.snake || !G.snake.length) return maxAlpha;
  const head = G.snake[0];
  const dist = Math.hypot(gx - head.x, gy - head.y);
  if (dist >= range) return maxAlpha;
  return minAlpha + (dist / range) * (maxAlpha - minAlpha);
}

export function updateCam() {
  if (!G.snake.length) return;
  const tx = G.snake[0].x - VC / 2 + 0.5;
  const ty = G.snake[0].y - VC / 2 + 0.5;
  G.cam.x += (tx - G.cam.x) * CAM_LERP;
  G.cam.y += (ty - G.cam.y) * CAM_LERP;

  const padding = 4.5;
  if (G.cam.x < -padding) G.cam.x = -padding;
  else if (G.cam.x > MAP - VC + padding) G.cam.x = MAP - VC + padding;
  if (G.cam.y < -padding) G.cam.y = -padding;
  else if (G.cam.y > MAP - VC + padding) G.cam.y = MAP - VC + padding;
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

// 食物 emoji 字典 (★ 优化：植入彩虹果 🌟 和宝箱 🎁 映射)
const FOOD_EMOJI = {
  normal: '🍎', speed: '⚡', shrink: '🍇', double: '🍒',
  shield: '🛡️', dizzy: '🌀', poison: '🍄', mirror: '🔮',
  lifeUp: '💖', mystery: '❓', rainbow: '🌟', chest: '🎁'
};

// ── 食物绘制 (简洁 emoji，统一风格) ──
function drawFood(f, now) {
  if (!visible(f.x, f.y, G.cam, VC)) return;
  const X = midX(f.x), Y = midY(f.y);
  const emoji = FOOD_EMOJI[f.type] || FOOD_EMOJI.normal;
  const isMystery = f.type === "mystery" || f.type === "chest";
  const bounce = isMystery ? Math.sin(now / 150) * 2 : 0;
  ctx.font = EMOJI_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, X, Y + bounce);
}

function drawStatusList(now) {
  const list = [];
  if (G.invincibleUntil > now) list.push({ t: '⚡ 无敌：' + ((G.invincibleUntil - now) / 1000).toFixed(1) + 's', c: '#00ffaa' });
  if (G.shieldUntil > now)     list.push({ t: '🛡️ 护盾：一次免伤活性', c: '#00f5d4' });
  if (G.speedBoostUntil > now) list.push({ t: '🚀 加速：' + ((G.speedBoostUntil - now) / 1000).toFixed(1) + 's', c: '#00e5ff' });
  if (G.mirrorUntil > now)     list.push({ t: '🔮 镜像：' + ((G.mirrorUntil - now) / 1000).toFixed(1) + 's', c: '#eceff1' });
  if (G.dizzyUntil > now)      list.push({ t: '🌀 眩晕：' + ((G.dizzyUntil - now) / 1000).toFixed(1) + 's', c: '#ff007f' });
  if (G.weatherUntil > now && G.weatherType) {
    list.push({ t: (WEATHER_NAME[G.weatherType] || '') + '：' + ((G.weatherUntil - now) / 1000).toFixed(1) + 's', c: '#ffd700' });
  }
  if (!list.length) return;

  ctx.font = STATUS_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let sy = 12;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const w = ctx.measureText(x.t).width + 16, h = 20;
    ctx.fillStyle = 'rgba(15,18,40,.82)';
    rr(12, sy, w, h, 4);
    ctx.strokeStyle = 'rgba(0,255,170,.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = x.c;
    ctx.fillText(x.t, 20, sy + h / 2);
    sy += h + 6;
  }
}

function drawMinimap() {
  const S = 70, pad = 8, sc = S / MAP, ox = VIEW - S - pad, oy = pad;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  rr(ox - 3, oy - 3, S + 6, S + 6, 6);
  ctx.fillStyle = 'rgba(58,63,99,.8)';
  for (const k of G.walls) {
    ctx.fillRect(ox + wx(k) * sc, oy + wy(k) * sc, sc + 0.5, sc + 0.5);
  }
  
  const radarCount = G.rogueMagnet || 0;
  if (radarCount > 0) {
    ctx.fillStyle = '#ff6b6b';
    for (let i = 0; i < G.foods.length; i++) {
      const f = G.foods[i];
      ctx.fillRect(ox + f.x * sc, oy + f.y * sc, 2, 2);
    }
    
    if (radarCount === 2) {
      ctx.fillStyle = '#ffd700';
      for (let i = 0; i < G.timedFoods.length; i++) {
        const f = G.timedFoods[i];
        ctx.fillRect(ox + f.x * sc, oy + f.y * sc, 2, 2);
      }
      for (let i = 0; i < G.coins.length; i++) {
        const c = G.coins[i];
        ctx.fillRect(ox + c.x * sc, oy + c.y * sc, 2, 2);
      }
      ctx.fillStyle = '#ff1744';
      for (let i = 0; i < G.projectiles.length; i++) {
        const p = G.projectiles[i];
        ctx.fillRect(ox + p.x * sc, oy + p.y * sc, 2, 2);
      }
    }
  }

  ctx.fillStyle = '#ff5c8a';
  for (let i = 0; i < G.enemies.length; i++) {
    const en = G.enemies[i];
    ctx.fillRect(ox + en.body[0].x * sc, oy + en.body[0].y * sc, 2, 2);
  }
  ctx.fillStyle = '#4ecca3';
  if (G.snake.length) ctx.fillRect(ox + G.snake[0].x * sc, oy + G.snake[0].y * sc, 2, 2);
  ctx.strokeStyle = 'rgba(78,204,163,.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + G.cam.x * sc, oy + G.cam.y * sc, VC * sc, VC * sc);
  ctx.restore();
}

function updateParticles() {
  const arr = G.particles;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06;
    p.life -= 0.015;
    if (p.life <= 0) arr.splice(i, 1);
  }
}

function drawParticles() {
  ctx.globalAlpha = 1;
  const ox = G.cam.x * CELL, oy = G.cam.y * CELL;
  for (let i = 0; i < G.particles.length; i++) {
    const p = G.particles[i];
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - ox - p.size / 2, p.y - oy - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function updateFloatingTexts() {
  const arr = G.floatingTexts;
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = arr[i];
    t.offsetY -= 0.8;
    t.life -= 0.02;
    if (t.life <= 0) arr.splice(i, 1);
  }
}

function drawFloatingTexts() {
  for (let i = 0; i < G.floatingTexts.length; i++) {
    const t = G.floatingTexts[i];
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.life);
    ctx.fillStyle = t.color;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, midX(t.gx), midY(t.gy) + t.offsetY);
    ctx.restore();
  }
}

// ── ★ 主渲染 (含全屏天气及双雷达寻路指示线) ★ ──
export function draw() {
  if (!ctx) return;
  const now = Date.now();

  const mr = G.mirrorUntil && now < G.mirrorUntil;
  const inv = G.invincibleUntil && now < G.invincibleUntil;
  const dz = G.dizzyUntil && now < G.dizzyUntil;
  const sh = G.shieldUntil && now < G.shieldUntil;
  const darkW = G.weatherType === 'dark' && G.weatherUntil > now;

  ctx.save();

  // 震屏
  if (G.shake > 0) {
    ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    G.shake *= SHAKE_DECAY;
    if (G.shake < SHAKE_THRESHOLD) G.shake = 0;
  }

  // 眩晕
  if (dz) {
    ctx.translate(VIEW / 2, VIEW / 2);
    ctx.rotate(Math.sin(now / 150) * 0.08);
    ctx.scale(1.04 + Math.sin(now / 100) * 0.02, 1.04 + Math.sin(now / 100) * 0.02);
    ctx.translate(-VIEW / 2, -VIEW / 2);
    ctx.filter = 'hue-rotate(' + (now / 12 % 360) + 'deg) saturate(2)';
  }

  // 绘制底背景
  ctx.fillStyle = darkW ? '#02050c' : '#020309';
  ctx.fillRect(0, 0, VIEW, VIEW);

  // 铺底
  ctx.fillStyle = mr ? '#181c45' : '#111638';
  ctx.fillRect(cx(0), cy(0), MAP * CELL, MAP * CELL);

  // 网格线
  ctx.strokeStyle = 'rgba(0,255,170,.08)';
  ctx.lineWidth = 1;
  const sx1 = Math.max(0, Math.floor(G.cam.x));
  const ex = Math.min(MAP, Math.ceil(G.cam.x + VC));
  const sy1 = Math.max(0, Math.floor(G.cam.y));
  const ey = Math.min(MAP, Math.ceil(G.cam.y + VC));
  for (let x = sx1; x <= ex; x++) {
    ctx.beginPath();
    ctx.moveTo(cx(x), Math.max(0, cy(sy1)));
    ctx.lineTo(cx(x), Math.min(MAP * CELL, cy(ey)));
    ctx.stroke();
  }
  for (let y = sy1; y <= ey; y++) {
    ctx.beginPath();
    ctx.moveTo(Math.max(0, cx(sx1)), cy(y));
    ctx.lineTo(Math.min(MAP * CELL, cx(ex)), cy(y));
    ctx.stroke();
  }

  // 墙壁
  for (const k of G.walls) {
    const x = wx(k), y = wy(k);
    if (!visible(x, y, G.cam, VC)) continue;
    ctx.fillStyle = '#3a3f63';
    rr(cx(x) + 1, cy(y) + 1, CELL - 2, CELL - 2, 4);
  }

  // ★ Boss 氛围红光已移除，避免食物视觉变暗

  // 地震岩浆裂痕
  if (G.weatherType === 'quake' && G.weatherUntil > now) {
    ctx.fillStyle = 'rgba(255, 60, 0, 0.04)';
    ctx.fillRect(cx(0), cy(0), MAP * CELL, MAP * CELL);
    
    ctx.strokeStyle = 'rgba(255, 90, 0, 0.45)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const seed = Math.floor(now / 220) + i * 8;
      const rx = cx((seed * 17) % MAP);
      const ry = cy((seed * 31) % MAP);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + ((seed % 8) - 4) * 5, ry + 15);
      ctx.lineTo(rx + ((seed % 10) - 5) * 5, ry + 30);
      ctx.stroke();
    }
  }

  // 障碍物岩石墙壁
  // ★ 岩石墙壁已合并到网格缓存，此处不再逐帧绘制

  // 火焰轨迹 (Map 迭代)
  for (const [key] of G.bossFireTrail) {
    const x = wx(key), y = wy(key);
    if (!visible(x, y, G.cam, VC)) continue;
    ctx.fillStyle = 'rgba(255,100,0,.4)';
    rr(cx(x) + 3, cy(y) + 3, CELL - 6, CELL - 6, 3);
  }

  // 传送门
  if (G.portals) {
    for (let i = 0; i < G.portals.length; i++) {
      const p = G.portals[i];
      if (!visible(p.x, p.y, G.cam, VC)) continue;
      const X = midX(p.x), Y = midY(p.y);
      const g = ctx.createRadialGradient(X, Y, 1, X, Y, CELL / 1.3);
      g.addColorStop(0, '#cffaff');
      g.addColorStop(1, i ? '#0088cc' : '#00d4ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(X, Y, CELL / 2 - 2 + Math.sin(now / 200) * 2, 0, 7);
      ctx.fill();
    }
  }

  // 金币 (靠近蛇头平滑变暗)
  ctx.font = EMOJI_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < G.coins.length; i++) {
    const c = G.coins[i];
    if (!visible(c.x, c.y, G.cam, VC)) continue;
    if (c.expire - now < 2000 && Math.floor(now / 150) % 2 === 0) continue;
    const X = midX(c.x), Y = midY(c.y);

    ctx.fillText('🪙', X, Y);
  }

  // 水果食物
  for (let i = 0; i < G.foods.length; i++) drawFood(G.foods[i], now);
  for (let i = 0; i < G.timedFoods.length; i++) {
    const f = G.timedFoods[i];
    if (f.expire - now > 2000 || Math.floor(now / 150) % 2 === 0) drawFood(f, now);
  }

  // 敌蛇
  for (let ei = 0; ei < G.enemies.length; ei++) {
    const en = G.enemies[ei];
    for (let i = 0; i < en.body.length; i++) {
      const s = en.body[i];
      if (!visible(s.x, s.y, G.cam, VC)) continue;
      const sx2 = cx(s.x), sy2 = cy(s.y);
      
      if (en.type === 'special') {
        ctx.fillStyle = i === 0 ? '#ffd700' : 'hsl(' + ((45 + i * 10) % 360) + ',100%,50%)';
      } else if (en.type === 'hunter') {
        ctx.fillStyle = i === 0 ? '#4a148c' : (i % 2 === 0 ? '#d81b60' : '#8e24aa');
      } else if (en.type === 'bomber') {
        ctx.fillStyle = i === 0 ? '#ff3d00' : (i % 2 === 0 ? '#ff9100' : '#e65100');
      } else {
        ctx.fillStyle = i === 0 ? '#ff1744' : 'hsl(' + ((335 - i * 7) % 360) + ',100%,45%)';
      }
      
      rr(sx2 + 1, sy2 + 1, CELL - 2, CELL - 2, 4);
      if (i === 0) {
        ctx.fillStyle = (en.type === 'hunter') ? '#00e5ff' : ((en.type === 'bomber') ? '#ffd700' : '#fff');
        ctx.fillRect(sx2 + 6, sy2 + 6, 3, 3);
        ctx.fillRect(sx2 + CELL - 9, sy2 + 6, 3, 3);
      }
    }
  }

  // Ghost
  if (G.isGhostMode && G.ghostFrames && G.ghostIdx < G.ghostFrames.length) {
    const gf = G.ghostFrames[G.ghostIdx];
    if (gf) {
      for (let i = 0; i < gf.length; i++) {
        const s = gf[i];
        if (!visible(s.x, s.y, G.cam, VC)) continue;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = i === 0 ? '#88ffcc' : 'rgba(136,255,204,.4)';
        rr(cx(s.x) + 1, cy(s.y) + 1, CELL - 2, CELL - 2, 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  // 玩家蛇
  if (inv) ctx.globalAlpha = 0.55;
  for (let i = 0; i < G.snake.length; i++) {
    const s = G.snake[i];
    if (!visible(s.x, s.y, G.cam, VC)) continue;
    const sx3 = cx(s.x), sy3 = cy(s.y);
    const sw = (i === 0) ? G.headSwell * CELL * 0.22 : 0;
    const size = CELL - 2 + sw;
    const rx = sx3 + 1 - sw / 2;
    const ry = sy3 + 1 - sw / 2;

    ctx.save();

    if (G.skin === 'neon') {
      ctx.shadowBlur = 10;
      ctx.shadowColor = (i % 2 === 0) ? '#d500f9' : '#00e5ff';
      ctx.fillStyle = (i % 2 === 0) ? '#d500f9' : '#00e5ff';
      rr(rx, ry, size, size, 4);
    } else if (G.skin === 'flame') {
      const grad = ctx.createLinearGradient(rx, ry, rx + size, ry + size);
      grad.addColorStop(0, '#ff1a00');
      grad.addColorStop(0.5, '#ff8000');
      grad.addColorStop(1, '#ffea00');
      ctx.fillStyle = grad;
      rr(rx, ry, size, size, 6);
      
      if (Math.random() < 0.06) {
        G.particles.push({
          x: rx + size / 2, y: ry + size / 2,
          vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5 + 0.5,
          life: 0.5, color: Math.random() < 0.5 ? '#ff4500' : '#ffcc00', size: 1.5 + Math.random() * 2
        });
      }
    } else if (G.skin === 'frost') {
      ctx.fillStyle = '#b3f0ff';
      ctx.strokeStyle = '#00a3cc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx + size / 2, ry);
      ctx.lineTo(rx + size, ry + size / 2);
      ctx.lineTo(rx + size / 2, ry + size);
      ctx.lineTo(rx, ry + size / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(rx + size * 0.35, ry + size * 0.2, size * 0.2, size * 0.15);
    } else if (G.skin === 'gold') {
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#ffd700';
      const grad = ctx.createLinearGradient(rx, ry, rx + size, ry + size);
      grad.addColorStop(0, '#ffe57f');
      grad.addColorStop(0.5, '#ffd700');
      grad.addColorStop(1, '#ff8f00');
      ctx.fillStyle = grad;
      rr(rx, ry, size, size, 3);
      
      if (Math.random() < 0.02) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx + Math.random() * size, ry + Math.random() * size, 2.5, 2.5);
      }
    } else if (G.skin === 'pixel') {
      ctx.fillStyle = (i % 2 === 0) ? '#00e676' : '#00b0ff';
      ctx.fillRect(rx, ry, size, size);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 1, ry + 1, size - 2, size - 2);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx + size * 0.3, ry + size * 0.3, size * 0.4, size * 0.4);
    } else {
      const grad = ctx.createLinearGradient(rx, ry, rx + size, ry + size);
      grad.addColorStop(0, '#00ffaa');
      grad.addColorStop(1, '#009966');
      ctx.fillStyle = grad;
      rr(rx, ry, size, size, 4);
    }

    if (i === 0) {
      ctx.fillStyle = (G.skin === 'neon' || G.skin === 'flame') ? '#ffffff' : '#062018';
      ctx.fillRect(sx3 + 6 - sw / 2, sy3 + 6 - sw / 2, 3, 3);
      ctx.fillRect(sx3 + CELL - 9 + sw / 2, sy3 + 6 - sw / 2, 3, 3);
      
      if (G.skin === 'gold') {
        ctx.fillStyle = '#ffd700';
        ctx.font = '10px sans-serif';
        ctx.fillText('👑', sx3 + CELL / 2 - 5, sy3 - 2);
      }
    }
    ctx.restore();
  }
  if (G.headSwell > 0) {
    G.headSwell *= HEAD_SWELL_DECAY;
    if (G.headSwell < 0.01) G.headSwell = 0;
  }
  ctx.globalAlpha = 1;

  // Boss 炫酷皮肤
  if (G.boss && !(G.bossType === 'ghost' && G.boss.phased)) {
    const ip = G.boss.hp <= 2 && (G.diff === 'hard' || G.diff === 'hell');
    for (let i = 0; i < G.boss.body.length; i++) {
      const s = G.boss.body[i];
      if (!visible(s.x, s.y, G.cam, VC)) continue;
      const sx4 = cx(s.x), sy4 = cy(s.y);

      ctx.save();
      if (i === 0) {
        if (G.bossType === 'giant') {
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#00ffaa';
          ctx.fillStyle = ip ? '#ff1744' : '#1a0033';
          rr(sx4, sy4, CELL, CELL, 6);
          ctx.strokeStyle = '#00ffaa';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx4 + 1, sy4 + 1, CELL - 2, CELL - 2);
        } else if (G.bossType === 'lava') {
          const g = ctx.createRadialGradient(sx4 + CELL/2, sy4 + CELL/2, 2, sx4 + CELL/2, sy4 + CELL/2, CELL/2);
          g.addColorStop(0, '#ff3d00');
          g.addColorStop(1, '#3e0f00');
          ctx.fillStyle = g;
          rr(sx4, sy4, CELL, CELL, 6);
        } else if (G.bossType === 'ghost') {
          ctx.globalAlpha = 0.65;
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#00e5ff';
          ctx.fillStyle = 'rgba(10,25,50,0.8)';
          rr(sx4, sy4, CELL, CELL, 6);
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx4 + 1, sy4 + 1, CELL - 2, CELL - 2);
        }

        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(sx4 + 4, sy4 + 3);
        ctx.lineTo(sx4 + 8, sy4 + 8);
        ctx.lineTo(sx4 + 12, sy4 + 3);
        ctx.lineTo(sx4 + 16, sy4 + 8);
        ctx.lineTo(sx4 + 20, sy4 + 3);
        ctx.lineTo(sx4 + 18, sy4 + 12);
        ctx.lineTo(sx4 + 6, sy4 + 12);
        ctx.closePath();
        ctx.fill();
      } else {
        if (G.bossType === 'giant') {
          ctx.shadowBlur = ip ? 12 : 5;
          ctx.shadowColor = '#00ffaa';
          ctx.fillStyle = ip ? '#ff1744' : '#2d004d';
          rr(sx4 + 1, sy4 + 1, CELL - 2, CELL - 2, 5);
          
          ctx.fillStyle = ip ? '#ffeb3b' : 'rgba(0, 255, 170, 0.7)';
          ctx.fillRect(sx4 + CELL/2 - 2, sy4 + CELL/2 - 2, 4, 4);
        } else if (G.bossType === 'lava') {
          ctx.fillStyle = ip ? '#ff5722' : '#2b2625';
          rr(sx4 + 1, sy4 + 1, CELL - 2, CELL - 2, 5);
          
          const p = Math.abs(Math.sin(now / 200 + i * 0.3));
          ctx.fillStyle = ip ? '#ffeb3b' : 'rgba(255, 61, 0, ' + (0.3 + p * 0.6) + ')';
          ctx.fillRect(sx4 + 3, sy4 + 3, CELL - 6, CELL - 6);
          
          if (Math.random() < 0.02) {
            G.particles.push({
              x: sx4 + CELL / 2, y: sy4 + CELL / 2,
              vx: (Math.random() - 0.5) * 1.0, vy: (Math.random() - 0.5) * 1.0 - 0.2,
              life: 0.4, color: '#ff9100', size: 1.5 + Math.random() * 1.5
            });
          }
        } else if (G.bossType === 'ghost') {
          ctx.globalAlpha = ip ? 0.55 : (0.2 + 0.35 * Math.abs(Math.sin(now / 350 + i * 0.4)));
          ctx.shadowBlur = 6;
          ctx.shadowColor = '#00e5ff';
          ctx.fillStyle = ip ? '#ff007f' : '#b48cff';
          rr(sx4 + 2, sy4 + 2, CELL - 4, CELL - 4, 8);
        }
      }
      ctx.restore();
    }
  }

  // Projectiles
  for (let i = 0; i < G.projectiles.length; i++) {
    const p = G.projectiles[i];
    const px = Math.floor(p.x), py = Math.floor(p.y);
    if (!visible(px, py, G.cam, VC)) continue;
    ctx.fillStyle = '#ff1744';
    ctx.beginPath();
    ctx.arc(midX(px), midY(py), 5 + Math.sin(now / 80) * 2, 0, 7);
    ctx.fill();
  }

  // Aura
  if ((sh || inv) && G.snake.length) {
    const hx = midX(G.snake[0].x), hy = midY(G.snake[0].y);
    ctx.strokeStyle = sh ? '#00f5d4' : '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hx, hy, CELL * 0.95 + Math.sin(now / 80) * 2.5, 0, 7);
    ctx.stroke();
    ctx.fillStyle = sh ? 'rgba(0,245,212,.08)' : 'rgba(255,215,0,.08)';
    ctx.fill();
  }

  // 双雷达指示折线
  const radarCount = G.rogueMagnet || 0;
  if (radarCount === 2 && G.snake.length && (G.foods.length || G.timedFoods.length || G.coins.length)) {
    const h = G.snake[0];
    let closest = null, minD2 = Infinity;
    const all = [...G.foods, ...G.timedFoods, ...G.coins];
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      if (f.expire && now > f.expire) continue;
      const dx = f.x - h.x, dy = f.y - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2 && d2 > 0) { minD2 = d2; closest = f; }
    }
    if (closest) {
      const lineAlpha = nearHeadAlpha(closest.x, closest.y, 4, 0.08, 0.28);
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 170, ' + lineAlpha + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(midX(h.x), midY(h.y));
      ctx.lineTo(midX(closest.x), midY(closest.y));
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── 天气全屏层 ──
  
  // 1. 酸雨
  if (G.weatherType === 'acid' && G.weatherUntil > now) {
    ctx.fillStyle = 'rgba(0, 255, 100, 0.05)';
    ctx.fillRect(0, 0, VIEW, VIEW);
    
    ctx.strokeStyle = 'rgba(0, 255, 120, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      const rx = (now * 0.15 + i * 45) % VIEW;
      const ry = (now * 0.42 + i * 70) % VIEW;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 3, ry + 12);
      ctx.stroke();
    }
  }

  // 2. 食物雨
  if (G.weatherType === 'foodRain' && G.weatherUntil > now) {
    ctx.fillStyle = 'rgba(255, 80, 80, 0.03)';
    ctx.fillRect(0, 0, VIEW, VIEW);
    
    for (let i = 0; i < 12; i++) {
      const rx = (now * 0.08 + i * 60) % VIEW;
      const ry = (now * 0.15 + i * 90) % VIEW;
      ctx.fillStyle = (i % 2 === 0) ? 'rgba(255, 100, 100, 0.55)' : 'rgba(255, 215, 0, 0.55)';
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. 黑暗渐变遮罩（减弱不透明度，扩大可见范围）
  if (darkW && G.snake.length) {
    const hx = midX(G.snake[0].x);
    const hy = midY(G.snake[0].y);
    ctx.save();
    const grad = ctx.createRadialGradient(hx, hy, CELL * 2.5, hx, hy, CELL * 7);
    grad.addColorStop(0, 'rgba(2, 3, 9, 0)');
    grad.addColorStop(1, 'rgba(2, 3, 9, 0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW, VIEW);
    ctx.restore();
  }

  updateParticles();
  drawParticles();
  updateFloatingTexts();
  drawFloatingTexts();

  if (mr) {
    ctx.fillStyle = 'rgba(232,237,240,.05)';
    ctx.fillRect(0, 0, VIEW, VIEW);
  }

  ctx.restore();
  drawMinimap();
  drawStatusList(now);
}
