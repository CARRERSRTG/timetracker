'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
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

let mainWindow = null;

// activity counters (system-wide, accumulated for the current session)
const activity = { keystrokes: 0, clicks: 0 };
let hookRunning = false;
let shotTimer = null;
let currentSessionId = null;

function startHook() {
  if (!uIOhook || hookRunning) return;
  activity.keystrokes = 0;
  activity.clicks = 0;
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
  uIOhook.on('keydown', () => { activity.keystrokes++; });
  uIOhook.on('mousedown', () => { activity.clicks++; });
}

async function captureAndSend() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
    mainWindow.webContents.send('tt:shot', { sessionId: currentSessionId, dataUrl });
  } catch (e) {
    console.error('Screenshot capture failed:', e.message);
  }
}

ipcMain.handle('tt:start', (_evt, opts) => {
  const intervalMin = Math.max(1, Number(opts?.intervalMin) || 10);
  currentSessionId = opts?.sessionId || null;
  startHook();
  if (shotTimer) clearInterval(shotTimer);
  // first shot shortly after start, then every intervalMin
  setTimeout(captureAndSend, 5000);
  shotTimer = setInterval(captureAndSend, intervalMin * 60 * 1000);
  return { ok: true };
});

ipcMain.handle('tt:stop', () => {
  if (shotTimer) { clearInterval(shotTimer); shotTimer = null; }
  currentSessionId = null;
  stopHook();
  return { ok: true };
});

ipcMain.handle('tt:getActivity', () => ({ ...activity }));

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
});

app.on('window-all-closed', () => {
  stopHook();
  if (shotTimer) clearInterval(shotTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
