'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, powerMonitor, dialog } = require('electron');
const path = require('node:path');

// uiohook-napi provides SYSTEM-WIDE keyboard/mouse events (works even when our
// window is unfocused — the whole point of the desktop app). Load defensively:
// if the native binary is unavailable the app still runs, just without global
// metering.
let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (e) {
  console.error('uiohook-napi unavailable — global input metering disabled:', e.message);
}

// Auto-update (packaged builds only). Requires a configured `publish` target in
// package.json and a matching release; no-ops in dev and if the module/binary
// is missing.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) {
  console.error('electron-updater unavailable — auto-update disabled:', e.message);
}

// Active-window title (for the smart-idle work-app label). get-windows is the
// maintained successor to active-win; loaded defensively.
let activeWindow = null;
try {
  activeWindow = require('get-windows').activeWindow;
} catch (e) {
  console.error('get-windows unavailable — active-window label disabled:', e.message);
}

let mainWindow = null;
let allowClose = false; // set true once the user confirms quitting while tracking

// activity counters (system-wide, accumulated for the current session)
const activity = { keystrokes: 0, clicks: 0, moves: 0 };
let lastMoveSec = 0;
let hookRunning = false;
let shotTimer = null;    // fires the single screenshot for the current window
let lastShotMs = 0;      // time of the last capture (to enforce the minimum gap)
const MIN_GAP_MS = 5 * 60 * 1000; // screenshots are never closer than 5 minutes apart
let currentSessionId = null;

// per-screenshot segment activity: count distinct seconds with input in the
// current 10-min segment, to show an Upwork-style activity bar on each shot.
let segStartMs = 0;
let segActiveSeconds = 0;
let lastActiveSec = 0;
let segmentMs = 10 * 60 * 1000;

function markActive() {
  const s = Math.floor(Date.now() / 1000);
  if (s !== lastActiveSec) { lastActiveSec = s; segActiveSeconds++; }
}

function startHook() {
  if (!uIOhook || hookRunning) return;
  activity.keystrokes = 0;
  activity.clicks = 0;
  activity.moves = 0;
  try {
    uIOhook.start();
    hookRunning = true;
  } catch (e) {
    console.error('Failed to start uiohook:', e.message);
  }
}

function stopHook() {
  if (!uIOhook || !hookRunning) return;
  try { uIOhook.stop(); } catch (e) { /* ignore */ }
  hookRunning = false;
}

if (uIOhook) {
  uIOhook.on('keydown', () => { activity.keystrokes++; markActive(); });
  uIOhook.on('mousedown', () => { activity.clicks++; markActive(); });
  // mouse movement + scroll count as activity too (throttled to once/second so
  // a moving mouse doesn't inflate the raw counters)
  uIOhook.on('mousemove', () => {
    const s = Math.floor(Date.now() / 1000);
    if (s !== lastMoveSec) { lastMoveSec = s; activity.moves++; }
    markActive();
  });
  uIOhook.on('wheel', () => { activity.moves++; markActive(); });
}

async function captureAndSend() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // activity % for this segment = distinct active seconds / seconds elapsed
  const elapsedS = Math.max(1, Math.round((Date.now() - segStartMs) / 1000));
  const activityPercent = Math.max(0, Math.min(100, Math.round((segActiveSeconds / elapsedS) * 100)));
  // Upwork-style: no keyboard/mouse activity this segment → no screenshot. Send a
  // blank marker so the diary shows an empty slot (and no image is captured/stored).
  if (segActiveSeconds === 0) {
    mainWindow.webContents.send('tt:shot', { sessionId: currentSessionId, blank: true, activityPercent: 0 });
    return;
  }
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.size;
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    if (!sources.length) return;
    const dataUrl = sources[0].thumbnail.toDataURL();
    // Show the floating on-top toast immediately (works even if the main window
    // is minimized/hidden). The renderer later reports upload status to update it.
    const timeText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    showShotToast(dataUrl, timeText);
    // The renderer owns the authenticated Supabase client, so it does the upload.
    mainWindow.webContents.send('tt:shot', { sessionId: currentSessionId, dataUrl, activityPercent });
  } catch (e) {
    console.error('Screenshot capture failed:', e.message);
  }
}

// Upwork-style cadence, clock-aligned: the hour is divided into fixed 10-min
// windows (:00–:09, :10–:19, … :50–:59). Exactly ONE screenshot per window, at a
// random moment inside it (so it can't be predicted/gamed), and NEVER less than
// 5 minutes after the previous shot. Six screenshots per hour.
function scheduleNextShot() {
  // activity for the upcoming shot is measured from now until it fires
  segStartMs = Date.now();
  segActiveSeconds = 0;
  lastActiveSec = 0;
  const now = Date.now();
  const d = new Date(now);
  const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
  // the window that contains the earliest time we're allowed to shoot
  const base = Math.max(now, lastShotMs + MIN_GAP_MS);
  const k = Math.floor((base - hourStart) / segmentMs);
  let winStart = hourStart + k * segmentMs;
  let winEnd = winStart + segmentMs;
  let earliest = Math.max(winStart, now, lastShotMs + MIN_GAP_MS);
  if (earliest >= winEnd) { // no room left in this window → roll to the next one
    winStart = winEnd; winEnd = winStart + segmentMs;
    earliest = Math.max(winStart, now, lastShotMs + MIN_GAP_MS);
  }
  const shotAt = earliest + Math.random() * (winEnd - earliest);
  shotTimer = setTimeout(async () => {
    await captureAndSend();
    lastShotMs = Date.now();
    if (currentSessionId) scheduleNextShot();
  }, Math.max(0, shotAt - now));
}

ipcMain.handle('tt:start', (_evt, opts) => {
  const intervalMin = Math.max(1, Number(opts?.intervalMin) || 10);
  segmentMs = intervalMin * 60 * 1000;
  currentSessionId = opts?.sessionId || null;
  startHook();
  clearTimeout(shotTimer); shotTimer = null;
  lastShotMs = 0; // allow the first shot to happen within the current window
  scheduleNextShot();
  return { ok: true };
});

ipcMain.handle('tt:stop', () => {
  clearTimeout(shotTimer); shotTimer = null;
  currentSessionId = null;
  stopHook();
  return { ok: true };
});

ipcMain.handle('tt:getActivity', () => ({ ...activity }));

ipcMain.handle('tt:getVersion', () => app.getVersion());

// Idle "are you still working?" — a centered, on-top native dialog that stays
// until answered (and flashes the taskbar to grab attention, even if minimized).
// Returns true to KEEP the away time as worked, false to DISCARD it.
ipcMain.handle('tt:askIdle', async (_evt, seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const away = s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true); } catch (e) { /* ignore */ }
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Discard', 'Keep this time'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: 'Are you still working?',
    message: 'Are you still working?',
    detail: 'No keyboard or mouse activity for ' + away + '. Keep this time as worked, or discard it?',
  });
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false); } catch (e) { /* ignore */ }
  return r.response === 1;
});

// --- smart-idle context: is the screen actually changing, and in what app? ---
// We keep the last low-res frame and diff against it to measure on-screen motion
// (meeting video, a video, scrolling, text appearing). This can't be faked by
// just parking an app in the foreground.
let lastFrame = null;
async function screenMovement() {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 100 } });
  if (!sources.length) return 0;
  const buf = sources[0].thumbnail.toBitmap(); // raw BGRA pixels
  let movement = 0;
  if (lastFrame && lastFrame.length === buf.length) {
    let changed = 0, count = 0;
    for (let i = 0; i < buf.length; i += 16) { // sample every 4th pixel (4 bytes each)
      const d = Math.abs(buf[i] - lastFrame[i]) + Math.abs(buf[i + 1] - lastFrame[i + 1]) + Math.abs(buf[i + 2] - lastFrame[i + 2]);
      if (d > 30) changed++;
      count++;
    }
    movement = count ? changed / count : 0;
  }
  lastFrame = buf;
  return movement;
}

ipcMain.handle('tt:context', async () => {
  let app = '', title = '';
  try {
    if (activeWindow) { const w = await activeWindow(); if (w) { app = (w.owner && w.owner.name) || ''; title = w.title || ''; } }
  } catch (e) { /* ignore */ }
  let movement = 0;
  try { movement = await screenMovement(); } catch (e) { /* ignore */ }
  return { app, title, movement };
});

// ---------------------------------------------------------------------
// Floating "screenshot captured" toast — a separate always-on-top, frameless,
// non-focusable window pinned to the bottom-right of the screen, so the user
// sees each capture even when the main app is minimized or hidden (Upwork-style).
// ---------------------------------------------------------------------
const TOAST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;overflow:hidden;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;-webkit-user-select:none;cursor:default}
  .card{display:flex;gap:10px;align-items:center;margin:8px;padding:10px;border-radius:12px;
    background:#171e2e;border:1px solid #2a3556;box-shadow:0 10px 30px rgba(0,0,0,.55);color:#e7ecf7}
  img{width:96px;height:60px;object-fit:cover;border-radius:8px;background:#000;flex:0 0 auto}
  .t{font-size:13.5px;font-weight:700}
  .s{font-size:12px;color:#93a0bd;margin-top:2px}
</style></head><body>
  <div class="card"><img id="img" alt=""/><div><div class="t" id="t"></div><div class="s" id="s"></div></div></div>
  <script>window.__setToast=function(o){
    document.getElementById('img').src=o.dataUrl||'';
    document.getElementById('t').textContent=(o.icon||'')+' '+(o.title||'');
    document.getElementById('s').textContent=o.timeText||'';};
  </script>
</body></html>`;

let toastWin = null;
let toastHideTimer = null;
let lastToast = null; // { dataUrl, timeText } — so a later status update reuses the same image

function ensureToastWin() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastWin = new BrowserWindow({
    width: 340, height: 118, show: false, frame: false, transparent: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver'); // above normal + fullscreen apps
  try { toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* platform */ }
  toastWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(TOAST_HTML));
  toastWin.on('closed', () => { toastWin = null; });
  return toastWin;
}

function showShotToast(dataUrl, timeText, status) {
  if (dataUrl) lastToast = { dataUrl, timeText };
  const t = lastToast || { dataUrl: '', timeText };
  const title = status === 'queued' ? 'Saved offline — will upload'
    : status === 'error' ? 'Screenshot failed to upload'
    : 'Screenshot captured';
  const icon = status === 'error' ? '⚠' : status === 'queued' ? '💾' : '📸';
  const win = ensureToastWin();
  const payload = JSON.stringify({ dataUrl: t.dataUrl, timeText: t.timeText, title, icon });
  const run = () => { win.webContents.executeJavaScript('window.__setToast(' + payload + ')').catch(() => {}); };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', run); else run();
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  win.setPosition(workArea.x + workArea.width - w - 16, workArea.y + workArea.height - h - 16);
  win.showInactive(); // show WITHOUT stealing focus from the user's current app
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => { if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); }, 5000);
}

// Renderer reports the upload outcome so the toast text can update.
ipcMain.handle('tt:shotStatus', (_evt, status) => { showShotToast(null, lastToast?.timeText, status); return true; });

// ---------------------------------------------------------------------
// Auto-update wiring. electron-updater downloads new releases from the GitHub
// `publish` target; we forward its progress to the renderer so the app can show
// an in-app "update available → downloading → restart to install" banner. The
// last state is cached so the renderer can query it on mount (avoids a race
// where an event fires before the UI subscribes).
// ---------------------------------------------------------------------
let lastUpdate = { state: 'idle' };
function sendUpdate(u) {
  lastUpdate = u;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tt:update', u);
}
function setupAutoUpdate() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;          // fetch the update as soon as it's found
  autoUpdater.autoInstallOnAppQuit = true;  // also install on a normal quit
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', version: lastUpdate.version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: (e && e.message) || String(e) }));
}
ipcMain.handle('tt:getUpdateState', () => lastUpdate);
ipcMain.handle('tt:checkUpdate', () => {
  // Always give immediate visible feedback, even when we can't really check.
  if (autoUpdater && app.isPackaged) {
    sendUpdate({ state: 'checking' });
    autoUpdater.checkForUpdates().catch((e) => sendUpdate({ state: 'error', message: e.message }));
  } else {
    sendUpdate({ state: 'error', message: 'Updates only work in the installed app (this looks like the dev build).' });
  }
  return true;
});
ipcMain.handle('tt:installUpdate', () => {
  // give the IPC reply a tick to flush before the app quits to install
  if (autoUpdater) setImmediate(() => autoUpdater.quitAndInstall());
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    title: 'Time Tracker v' + app.getVersion(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Keep our version in the OS window title / taskbar — don't let the loaded
  // page's <title> overwrite it.
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('Time Tracker v' + app.getVersion());
  });

  const devUrl = process.env.TT_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    // packaged: web/dist copied into resources/web (see electron-builder config)
    mainWindow.loadFile(path.join(process.resourcesPath, 'web', 'index.html'));
  }

  // Warn on exit while the clock is running: pressing X shows a message that
  // tracking is still active before letting the app quit.
  mainWindow.on('close', (e) => {
    if (allowClose || !currentSessionId) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Keep tracking', 'Stop & quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'The clock is still running',
      message: 'The clock is still running.',
      detail: "Your timer is still active. If you quit now it stops tracking. Your tracked time is saved.",
    });
    if (choice === 1) { allowClose = true; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // don't let the toast window keep the app alive after the main window closes
    if (toastWin && !toastWin.isDestroyed()) toastWin.destroy();
  });
}

app.whenReady().then(() => {
  createWindow();
  // check for updates on every launch (packaged app only, not the dev server)
  if (autoUpdater && !process.env.TT_DEV_URL && app.isPackaged) {
    setupAutoUpdate();
    autoUpdater.checkForUpdates().catch((e) => console.error('update check failed:', e.message));
  }
  // Auto-stop: when the machine locks or goes to sleep, tell the renderer so it
  // can stop the timer (no point counting time while the user is away/locked).
  ['lock-screen', 'suspend'].forEach((evt) => {
    powerMonitor.on(evt, () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tt:power', evt);
    });
  });
});

app.on('window-all-closed', () => {
  stopHook();
  clearTimeout(shotTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
