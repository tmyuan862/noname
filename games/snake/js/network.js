// network.js — 梦缘资源站同源排行榜 API
import { UPLOAD_INTERVAL } from './config.js';
import { load, save } from './storage.js';

let online = navigator.onLine;
let sessionToken = '';

window.addEventListener('online', () => { online = true; });
window.addEventListener('offline', () => { online = false; });

async function requestSession() {
  if (!online) return '';
  try {
    const response = await fetch('/api/game/session', { cache: 'no-store' });
    if (!response.ok) return '';
    const data = await response.json();
    sessionToken = data.token || '';
    return sessionToken;
  } catch {
    return '';
  }
}

export async function beginScoreSession() {
  sessionToken = '';
  return requestSession();
}

export function isNetworkAvailable() { return online; }

export async function uploadScore(name, score, mode, diff) {
  if (!online || score <= 0 || score > 999999) return false;
  const lastUpload = load('lu', 0);
  if (Date.now() - lastUpload < UPLOAD_INTERVAL) return false;
  const token = sessionToken || await requestSession();
  if (!token) return false;

  try {
    const response = await fetch('/api/game/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        name: String(name || '匿名').slice(0, 12),
        score: score | 0,
        mode: mode || 'classic',
        diff: diff || 'normal'
      })
    });
    sessionToken = '';
    if (!response.ok) return false;
    save('lu', Date.now());
    return true;
  } catch {
    return false;
  }
}

export async function fetchGlobal(timeRange) {
  if (!online) return null;
  try {
    const params = new URLSearchParams({ range: timeRange || 'all' });
    const response = await fetch('/api/game/leaderboard?' + params, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.scores || [];
  } catch {
    return null;
  }
}
