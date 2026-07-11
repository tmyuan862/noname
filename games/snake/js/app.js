// ============================================================
// app.js — 组装车间，高性能解耦渲染入口
// ============================================================
import { MAP, VC } from './config.js';
import { $, wk, Emitter } from './utils.js';
import { G, resetState, safeSnakePos, rebuildSnakeSet, setPhase, isPlaying, isPaused, isInGame, hasBoss } from './state.js';
import { PHASE } from './config.js';
import { getBest, setBest, getGold, getNickname, setNickname, getUseDpad, setUseDpad, clearHist, getOwnedSkins } from './storage.js';
import { initCanvas, draw, updateCam } from './render.js';
import { initKeyboard, initTouch, initJoystick, checkGamepad } from './input.js';
import { initAudio, resetAudio } from './audio.js';
import { initPWA } from './pwa.js';
import { beginScoreSession } from './network.js';
import {
  buildWalls, spawnMain, scheduleTimed, scheduleCoin, spawnCoin,
  spawnPortals, spawnEnemy, enemyCount, tick, shedSkin, spawnBoss,
  safeCellNear, isWall
} from './engine.js';
import {
  hideSubs, showPanel, updateHUD, updateBossBar, toast, showCombo,
  showWeatherLabel, showGameOver, hideGameOver, showMenu, hideMenu,
  burst, showFloating, initNickname
} from './ui.js';
import {
  renderSkinGrid, selectSkin, buySkin,
  renderAch, renderMissions, renderGhostList, startGhost,
  renderHistory, renderGlobal, redeemCode,
  die as sysDie, revive as sysRevive, commitEntry, bus
} from './systems.js';
import { resetRogue, rollChoices, applyChoice, getLevel, nextLevelAt, getAbilitiesSummary } from './rogue.js';

// ── 物理游戏循环 ──
let loopHandle = 0;

function scheduleLoop() {
  if (!isPlaying()) return;
  const delay = Math.max(20, Number.isFinite(G.curSpeed) ? G.curSpeed : 100);
  loopHandle = setTimeout(() => {
    if (isPlaying() && !isPaused()) {
      try {
        tick(() => handleDeath());
      } catch (e) {
        console.error('Game tick error:', e);
        stopLoop();
        toast('游戏发生异常，请重新开始');
        return;
      }
    }
    scheduleLoop();
  }, delay);
}

function stopLoop() {
  clearTimeout(loopHandle);
  loopHandle = 0;
}

// ── 高刷新率原生渲染循环 ──
function renderLoop() {
  if (G.running) updateCam();
  draw();
  updateHUD();
  updateBossBar();
  checkGamepad();
  requestAnimationFrame(renderLoop);
}

// ── 死亡处理 ──
function handleDeath() {
  const result = sysDie();
  if (!result) return;
  stopLoop();
  showGameOver(result.isNew);
}

// ── 开始游戏 ──
function startGame() {
  beginScoreSession();
  const mode = document.querySelector('#modeSeg .active')?.dataset?.m || 'classic';
  const diff = document.querySelector('#diffSeg .active')?.dataset?.d || 'normal';
  resetState(mode, diff);
  G.best = getBest();
  G.gold = getGold();

  buildWalls();
  const safe = safeSnakePos();
  G.snake = [
    { x: safe.x, y: safe.y },
    { x: safe.x - 1, y: safe.y },
    { x: safe.x - 2, y: safe.y }
  ];
  rebuildSnakeSet();

  // ★ 安全兜底：开局墙壁若恰好生成在蛇出生点，整体平移到最近安全位置
  if (isWall(G.snake[0].x, G.snake[0].y)) {
    const origin = G.snake[0];
    const fixed = safeCellNear(origin.x, origin.y, { avoidSnake: false });
    const dx = fixed.x - origin.x, dy = fixed.y - origin.y;
    G.snake = G.snake.map(s => ({ x: s.x + dx, y: s.y + dy }));
    rebuildSnakeSet();
  }

  G.cam.x = G.snake[0].x - VC / 2;
  G.cam.y = G.snake[0].y - VC / 2;

  spawnMain();
  scheduleTimed();
  scheduleCoin();
  if (G.mode === 'chaos') spawnPortals();
  
  // ★ 优化判定：Boss Rush 模式（挑战赛）开局直接生成 Boss，不刷普通怪
  if (G.mode === 'bossRush') {
    spawnBoss();
  } else {
    for (let i = 0; i < enemyCount(); i++) spawnEnemy();
  }

  G.replayFrames = [];
  G.isGhostMode = !!G.ghostFrames;
  G.ghostIdx = 0;

  // ★ 肉鸽：重置本局能力
  resetRogue();

  setPhase(G.mode === 'bossRush' ? PHASE.BOSS_FIGHT : PHASE.PLAYING);
  hideMenu();
  hideGameOver();
  resetAudio();

  const dp = $('dpad');
  if (dp) dp.classList.toggle('on', G.useDpad);
  const jw = $('joystickWrap');
  if (jw) jw.classList.toggle('on', G.useDpad);
  const pb = $('pauseBtn');
  if (pb) pb.textContent = '暂停';

  updateHUD();
  stopLoop();
  scheduleLoop();
}

// ── 暂停（通过 CustomEvent 解耦）──
window.addEventListener('toggle-pause', () => {
  if (!isInGame()) return;
  setPhase(isPaused() ? (hasBoss() ? PHASE.BOSS_FIGHT : PHASE.PLAYING) : PHASE.PAUSED);
  const pb = $('pauseBtn');
  if (pb) pb.textContent = G.paused ? '继续' : '暂停';
});

// ── 控制按钮 ──
function bindControls() {
  $('startBtn')?.addEventListener('click', () => {
    // 开局选一个初始能力
    showStartAbility();
  });
  $('againBtn')?.addEventListener('click', () => { commitEntry(); showStartAbility(); });
  $('reviveBtn')?.addEventListener('click', () => {
    if (sysRevive()) { hideGameOver(); updateHUD(); stopLoop(); scheduleLoop(); }
  });
  $('backBtn')?.addEventListener('click', () => { commitEntry(); stopLoop(); hideGameOver(); showMenu(); });
  $('pauseBtn')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('toggle-pause')));
  $('restartBtn')?.addEventListener('click', () => { commitEntry(); showStartAbility(); });
  $('shedBtn')?.addEventListener('click', shedSkin);
  $('menuBtn')?.addEventListener('click', () => {
    if (isInGame()) commitEntry();
    stopLoop();
    setPhase(PHASE.MENU);
    hideGameOver();
    showMenu();
  });
  $('muteBtn')?.addEventListener('click', () => {
    G.muted = !G.muted;
    const b = $('muteBtn');
    if (b) b.textContent = G.muted ? '🔇 静音' : '🔊 音效';
  });
  $('shopBtn')?.addEventListener('click', () => { showMenu(); showPanel('shopCard'); renderSkinGrid(); });
  $('helpBtn')?.addEventListener('click', () => $('help')?.classList.remove('hidden'));
  $('helpClose')?.addEventListener('click', () => $('help')?.classList.add('hidden'));
  $('clearBtn')?.addEventListener('click', () => {
    if (confirm('确定清除所有本地记录？')) {
      clearHist();
      renderHistory('all', 'all');
    }
  });
}

// ── 菜单按钮 ──
function bindMenus() {
  $('openTutorialBtn')?.addEventListener('click', () => { showPanel('tutorialCard'); resetTutorial(); });
  $('backTutorialBtn')?.addEventListener('click', hideSubs);
  $('openSettingsBtn')?.addEventListener('click', () => showPanel('settingsCard'));
  $('saveSettingsBtn')?.addEventListener('click', () => { hideSubs(); });
  $('openMissionsBtn')?.addEventListener('click', () => { showPanel('missionsCard'); renderMissions(); });
  $('backMissionsBtn')?.addEventListener('click', hideSubs);
  $('openShopBtn')?.addEventListener('click', () => { showPanel('shopCard'); renderSkinGrid(); });
  $('backShopBtn')?.addEventListener('click', hideSubs);
  $('openAchBtn')?.addEventListener('click', () => { showPanel('achCard'); renderAch(); });
  $('backAchBtn')?.addEventListener('click', hideSubs);
  $('openLeaderboardBtn')?.addEventListener('click', () => { showPanel('leaderboardCard'); refreshBoard(); });
  $('backLeaderboardBtn')?.addEventListener('click', hideSubs);
  $('openHelpBtn')?.addEventListener('click', () => $('help')?.classList.remove('hidden'));
  $('openRedeemBtn')?.addEventListener('click', () => {
    showPanel('redeemCard');
    const inp = $('redeemInput'); if (inp) inp.value = '';
    const msg = $('redeemMsg'); if (msg) msg.textContent = '';
  });
  $('backRedeemBtn')?.addEventListener('click', hideSubs);
  $('redeemSubmitBtn')?.addEventListener('click', () => {
    const r = redeemCode($('redeemInput')?.value || '');
    const msg = $('redeemMsg');
    if (msg) {
      msg.textContent = r.msg;
      msg.style.color = r.ok ? 'var(--accent)' : '#ff3366';
    }
    if (r.ok) {
      updateHUD();
      const inp = $('redeemInput'); if (inp) inp.value = '';
    }
  });

  // 排行榜
  let currentTab = 'local', currentTimeRange = 'day';
  function syncBoardTabs() {
    $('tabLocal')?.classList.toggle('active', currentTab === 'local');
    $('tabGlobal')?.classList.toggle('active', currentTab === 'global');
    $('timeDay')?.classList.toggle('active', currentTimeRange === 'day');
    $('timeWeek')?.classList.toggle('active', currentTimeRange === 'week');
    $('timeAll')?.classList.toggle('active', currentTimeRange === 'all');
    const clearBtn = $('clearBtn');
    if (clearBtn) clearBtn.style.display = currentTab === 'local' ? '' : 'none';
  }
  function refreshBoard() {
    syncBoardTabs();
    const mf = $('filterMode')?.value || 'all';
    const df = $('filterDiff')?.value || 'all';
    if (currentTab === 'global') {
      $('globalTimeSeg')?.classList.remove('hidden');
      renderGlobal(mf, df, currentTimeRange);
    } else {
      $('globalTimeSeg')?.classList.add('hidden');
      renderHistory(mf, df);
    }
  }
  $('tabLocal')?.addEventListener('click', () => { currentTab = 'local'; refreshBoard(); });
  $('tabGlobal')?.addEventListener('click', () => { currentTab = 'global'; refreshBoard(); });
  $('timeDay')?.addEventListener('click', () => { currentTimeRange = 'day'; refreshBoard(); });
  $('timeWeek')?.addEventListener('click', () => { currentTimeRange = 'week'; refreshBoard(); });
  $('timeAll')?.addEventListener('click', () => { currentTimeRange = 'all'; refreshBoard(); });
  $('filterMode')?.addEventListener('change', refreshBoard);
  $('filterDiff')?.addEventListener('change', refreshBoard);

  // 皮肤
  $('skinGrid')?.addEventListener('click', e => {
    const item = e.target.closest('.skin-item');
    if (!item) return;
    const k = item.dataset.skin;
    if (!k) return;
    const owned = getOwnedSkins();
    if (owned.includes(k)) selectSkin(k);
    else buySkin(k);
  });

  // Ghost
  $('ghostList')?.addEventListener('click', e => {
    const row = e.target.closest('[data-ghost]');
    if (!row) return;
    startGhost(+row.dataset.ghost);
    startGame();
  });

  // DPad
  $('dpad')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-dir]');
    if (!b) return;
    const [x, y] = b.dataset.dir.split(',').map(Number);
    if (G.mirrorUntil && Date.now() < G.mirrorUntil) { G.nextDir = { x: -x, y: -y }; return; }
    if (G.dir.x === -x && G.dir.y === -y) return;
    G.nextDir = { x, y };
  });

  // 教程步骤导航
  let tutStep = 0;
  const TUT_TOTAL = 4;
  window.resetTutorial = () => { tutStep = 0; updateTutUI(); };
  function updateTutUI() {
    [...document.querySelectorAll('.tut-panel')].forEach(p => p.classList.toggle('active', +p.dataset.step === tutStep));
    [...document.querySelectorAll('.tut-dot')].forEach(d => {
      d.classList.remove('active', 'done');
      const s = +d.dataset.step;
      if (s === tutStep) d.classList.add('active');
      else if (s < tutStep) d.classList.add('done');
    });
    const prev = $('tutPrevBtn'); if (prev) prev.disabled = tutStep === 0;
    const next = $('tutNextBtn'); if (next) next.disabled = tutStep === TUT_TOTAL - 1;
    const prog = $('tutProg'); if (prog) prog.textContent = (tutStep + 1) + ' / ' + TUT_TOTAL;
  }
  $('tutPrevBtn')?.addEventListener('click', () => { if (tutStep > 0) { tutStep--; updateTutUI(); } });
  $('tutNextBtn')?.addEventListener('click', () => { if (tutStep < TUT_TOTAL - 1) { tutStep++; updateTutUI(); } });
  // 点击圆点直接跳转
  $('tutSteps')?.addEventListener('click', e => {
    const dot = e.target.closest('.tut-dot');
    if (!dot) return;
    tutStep = +dot.dataset.step;
    updateTutUI();
  });
}

// ── 设置 ──
function renderSettingsSegs() {
  // ★ 全开模式：移除所有 🔒 标记
  const modeSeg = $('modeSeg');
  const diffSeg = $('diffSeg');
  if (modeSeg) {
    [...modeSeg.children].forEach(b => { b.classList.remove('locked'); b.title = ''; });
  }
  if (diffSeg) {
    [...diffSeg.children].forEach(b => { b.classList.remove('locked'); b.title = ''; });
  }
}

function bindSettings() {
  const dpadChk = $('dpadChk');
  if (dpadChk) {
    G.useDpad = getUseDpad();
    dpadChk.checked = G.useDpad;
  }

  $('modeSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b?.dataset.m) return;
    G.mode = b.dataset.m;
    [...e.currentTarget.children].forEach(c => c.classList.toggle('active', c === b));
  });
  $('diffSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b?.dataset.d) return;
    G.diff = b.dataset.d;
    [...e.currentTarget.children].forEach(c => c.classList.toggle('active', c === b));
  });
  $('dpadChk')?.addEventListener('change', e => {
    G.useDpad = e.target.checked;
    setUseDpad(G.useDpad);
    $('dpad')?.classList.toggle('on', G.useDpad);
    $('joystickWrap')?.classList.toggle('on', G.useDpad);
  });

  renderSettingsSegs();
}

// ── 公告/昵称 ──
function bindOverlays() {
  $('noticeCloseBtn')?.addEventListener('click', () => $('noticeOverlay')?.classList.add('hidden'));
  $('swLaterBtn')?.addEventListener('click', () => $('updateModal')?.classList.add('hidden'));
  // ★ 点击昵称可改名
  $('menuNickDisplay')?.addEventListener('click', () => {
    const inp = $('globalNicknameInput');
    if (inp) inp.value = G.nickname || '';
    $('nicknameOverlay')?.classList.remove('hidden');
  });

  $('saveNicknameBtn')?.addEventListener('click', () => {
    let v = $('globalNicknameInput')?.value?.trim();
    if (!v) { toast('请输入昵称！'); return; }
    // 过滤特殊字符和零宽字符
    v = v
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F]/g, '')
      .replace(/[<>"'&]/g, '')
      .slice(0, 8);
    if (!v) { toast('昵称无效，请重新输入！'); return; }
    G.nickname = v;
    setNickname(v);
    $('nicknameOverlay')?.classList.add('hidden');
    // 更新主菜单显示
    const md = $('menuNickDisplay');
    if (md) md.textContent = v;
    updateHUD();
    if (!localStorage.getItem('sn_v2_seen')) {
      $('noticeOverlay')?.classList.remove('hidden');
      try { localStorage.setItem('sn_v2_seen', '1'); } catch {}
    }
  });
  $('help')?.addEventListener('click', e => { if (e.target.id === 'help') $('help')?.classList.add('hidden'); });
  $('noticeOverlay')?.addEventListener('click', e => { if (e.target.id === 'noticeOverlay') $('noticeOverlay')?.classList.add('hidden'); });
  $('menu')?.addEventListener('click', e => { if (e.target.id === 'menu') hideSubs(); });
  $('nicknameOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'nicknameOverlay' && G.nickname) $('nicknameOverlay')?.classList.add('hidden');
  });
}

// ── 成就解锁提示 ──
function bindBus() {
  bus.on('achievement', list => {
    if (!list || !list.length) return;
    toast('🏅 解锁成就：' + list[0].name + (list.length > 1 ? ' +' + (list.length - 1) : ''));
  });
  bus.on('unlock', list => {
    if (!list || !list.length) return;
    const first = list[0];
    toast('🔓 解锁' + (first.type === 'mode' ? '模式' : '难度') + '：' + first.name);
    renderSettingsSegs();
  });

  // ★ 肉鸽升级事件
  window.addEventListener('rogue-level-up', () => {
    showLevelUpChoices();
  });
}

// ── 开局选初始能力 ──
let _pendingStart = false;
function showStartAbility() {
  _pendingStart = true;
  hideMenu();
  const sub = document.getElementById('levelUpSub');
  if (sub) sub.textContent = '选择初始能力';

  const choices = rollChoices();
  const el = document.getElementById('levelUpChoices');
  if (!el) { startGame(); return; }

  el.innerHTML = choices.map(c =>
    '<button class="rogue-choice" data-ability="' + c.id + '" style="width:100%;padding:14px;border-radius:12px;border:2px solid rgba(0,255,170,.25);background:rgba(255,255,255,.03);color:#fff;font-size:14px;text-align:left;cursor:pointer;transition:.15s">' +
    '<span style="font-size:20px">' + c.name + '</span>' +
    '<br><span style="font-size:11px;color:#8a8ab0">' + c.desc + '</span></button>'
  ).join('');

  el.querySelectorAll('.rogue-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.ability;
      document.getElementById('levelUpOverlay')?.classList.add('hidden');
      _pendingStart = false;
      startGame();
      // 在 resetRogue 之后应用初始能力
      applyChoice(id);
    }, { once: true });
  });

  document.getElementById('levelUpOverlay')?.classList.remove('hidden');
}

// ── 肉鸽升级选择 ──
function showLevelUpChoices() {
  if (_pendingStart) return; // 开局选能力中，不重复弹出
  if (!isPlaying()) return;
  // 暂停游戏
  window.dispatchEvent(new CustomEvent('toggle-pause'));

  const lv = getLevel();
  const isSuper = lv === 5 || (lv > 5 && lv % 5 === 0);
  const sub = document.getElementById('levelUpSub');
  if (sub) sub.textContent = isSuper ? '⭐ 超级技能！Lv.' + (lv-1) + ' → Lv.' + lv : '⬆ 升级！ Lv.' + (lv-1) + ' → Lv.' + lv;

  const choices = rollChoices();
  const el = document.getElementById('levelUpChoices');
  if (!el) return;

  el.innerHTML = choices.map(c =>
    '<button class="rogue-choice" data-ability="' + c.id + '" style="width:100%;padding:14px;border-radius:12px;border:2px solid rgba(255,215,0,.3);background:rgba(255,255,255,.03);color:#fff;font-size:14px;text-align:left;cursor:pointer;transition:.15s">' +
    '<span style="font-size:20px">' + c.name + '</span>' +
    '<br><span style="font-size:11px;color:#8a8ab0">' + c.desc + '</span></button>'
  ).join('');

  // 绑定点击
  el.querySelectorAll('.rogue-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.ability;
      applyChoice(id);
      document.getElementById('levelUpOverlay')?.classList.add('hidden');
      setPhase(hasBoss() ? PHASE.BOSS_FIGHT : PHASE.PLAYING);
      G.rogueLevelUpTriggered = false;
      stopLoop();
      scheduleLoop();
      updateHUD();
      toast('✅ ' + (btn.textContent?.split('\n')[0] || '已选择'));
    }, { once: true });
  });

  document.getElementById('levelUpOverlay')?.classList.remove('hidden');
}

// ── ★ 启动 ★ ──
function boot() {
  const canvas = initCanvas();
  initKeyboard();
  initTouch(canvas);
  initJoystick();
  initAudio();
  initPWA();

  bindControls();
  bindMenus();
  bindSettings();
  bindOverlays();
  bindBus();

  // ★ 监听存储满事件
  window.addEventListener('storage-full', e => toast(e.detail || '存储异常'));

  G.best = getBest();
  G.gold = getGold();
  G.nickname = getNickname();
  G.useDpad = getUseDpad();

  updateHUD();
  initNickname();
  showMenu();

  requestAnimationFrame(renderLoop);
}

document.addEventListener('DOMContentLoaded', boot);
