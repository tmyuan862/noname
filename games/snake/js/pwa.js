// ============================================================
// pwa.js — PWA 安装 + Service Worker 更新
// ★ 优化：稍后再提醒"今日"标记
// ★ 优化：参数化 worker，避免作用域脆弱
// ============================================================
import { $ } from './utils.js';
import { toast } from './ui.js';

let deferredPrompt = null;
const SW_LATER_KEY = 'sw_later_ts';

export function initPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $('installBtn');
    if (btn) btn.style.display = 'inline-block';
  });

  const installBtn = $('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        toast('已安装或浏览器不支持');
        return;
      }
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null;
      installBtn.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    const btn = $('installBtn');
    if (btn) btn.style.display = 'none';
  });

  let refreshing = false;
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      // 今日已点过"稍后"
      let last = 0;
      try { last = parseInt(localStorage.getItem(SW_LATER_KEY) || '0', 10); } catch {}
      const today = new Date().toDateString();
      if (last === today) return;

      navigator.serviceWorker.register('./sw.js').then(reg => {
        if (reg.waiting) showUpdatePrompt(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) {
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdatePrompt(nw);
              }
            });
          }
        });
      }).catch(() => {});
    });
  }
}

function showUpdatePrompt(worker) {
  const modal = $('updateModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const updateBtn = $('swUpdateBtn');
  const laterBtn = $('swLaterBtn');
  if (updateBtn) {
    updateBtn.onclick = () => {
      if (worker && worker.postMessage) worker.postMessage({ type: 'SKIP_WAITING' });
      modal.classList.add('hidden');
    };
  }
  if (laterBtn) {
    laterBtn.onclick = () => {
      try { localStorage.setItem(SW_LATER_KEY, new Date().toDateString()); } catch {}
      modal.classList.add('hidden');
    };
  }
}
