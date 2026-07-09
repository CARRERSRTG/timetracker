'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, powerMonitor } = require('electron');
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

// activity counters (system-wide, accumulated for the current session)
const activity = { keystrokes: 0, clicks: 0, moves: 0 };
let lastMoveSec = 0;
let hookRunning = false;
let shotTimer = null;   // fires the single shot at a random moment in the segment
let segTimer = null;    // fires at the segment boundary to begin the next segment
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
    // The renderer owns the authenticated Supabase client, so it does the upload.
    mainWindow.webContents.send('tt:shot', { sessionId: currentSessionId, dataUrl, activityPercent });
  } catch (e) {
    console.error('Screenshot capture failed:', e.message);
  }
}

// Upwork-style cadence: the session is divided into fixed segments (default
// 10 min → 6/hour). Exactly ONE screenshot per segment, taken at a random
// moment inside it (so it can't be predicted/gamed). The next segment always
// begins one FULL segmentMs after this one started — not right after the shot —
// so shots stay ~6/hour instead of bunching up.
function startSegment() {
  segStartMs = Date.now();
  segActiveSeconds = 0;
  lastActiveSec = 0;
  const offset = Math.floor(Math.random() * segmentMs); // random moment to shoot
  shotTimer = setTimeout(() => { captureAndSend(); }, offset);
  segTimer = setTimeout(() => { if (currentSessionId) startSegment(); }, segmentMs);
}

ipcMain.handle('tt:start', (_evt, opts) => {
  const intervalMin = Math.max(1, Number(opts?.intervalMin) || 10);
  segmentMs = intervalMin * 60 * 1000;
  currentSessionId = opts?.sessionId || null;
  startHook();
  clearTimeout(shotTimer); clearTimeout(segTimer); shotTimer = segTimer = null;
  startSegment();
  return { ok: true };
});

ipcMain.handle('tt:stop', () => {
  clearTimeout(shotTimer); clearTimeout(segTimer); shotTimer = segTimer = null;
  currentSessionId = null;
  stopHook();
  return { ok: true };
});

ipcMain.handle('tt:getActivity', () => ({ ...activity }));

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.TT_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    // packaged: web/dist copied into resources/web (see electron-builder config)
    mainWindow.loadFile(path.join(process.resourcesPath, 'web', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // only check for updates in a packaged app (not when loading the dev server)
  if (autoUpdater && !process.env.TT_DEV_URL && app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('update check failed:', e.message));
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
  clearTimeout(shotTimer); clearTimeout(segTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
