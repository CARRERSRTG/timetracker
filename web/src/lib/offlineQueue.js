// Offline buffering: when the network drops, session updates and screenshots
// are stashed locally and flushed on reconnect, so no worked time or shots are
// lost on flaky connections (field sites). Session patches are small JSON →
// localStorage (keep only the latest patch per session). Screenshots are large
// binary → IndexedDB.
//
// Limitation: a session must be STARTED while online (the initial insert needs
// the server to mint the row id). Dropping offline mid-session is fully covered
// — the tracker keeps counting locally and the buffered patches sync later.
import { sessions as sessionsApi, screenshots as screenshotsApi } from '@shared/lib/supabase.js';

const LS_SESSIONS = 'tt_offline_sessions';
const DB_NAME = 'tt_offline';
const DB_VERSION = 1;
const STORE = 'shots';

// --- session patches (localStorage) --------------------------------------
function loadPatches() {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || '{}'); } catch { return {}; }
}
function savePatches(o) {
  try { localStorage.setItem(LS_SESSIONS, JSON.stringify(o)); } catch { /* quota — ignore */ }
}
// Buffer the LATEST state for a session (merge over any prior buffered patch).
export function queueSession(id, patch) {
  if (!id) return;
  const o = loadPatches();
  o[id] = { ...(o[id] || {}), ...patch };
  savePatches(o);
  emit();
}

// --- screenshots (IndexedDB) ---------------------------------------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

export async function queueShot(rec) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).add(rec));
    emit();
    return true;
  } catch { return false; }
}
async function countShots() {
  try { const db = await openDB(); return await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).count()); }
  catch { return 0; }
}
async function allShots() {
  const db = await openDB();
  return idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}
async function deleteShot(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  await idbReq(tx.objectStore(STORE).delete(id));
}

// --- flush (send everything buffered, oldest first; stop on first failure) --
let flushing = false;
export async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    // 1) session patches
    const patches = loadPatches();
    for (const id of Object.keys(patches)) {
      try { await sessionsApi.update(id, patches[id]); delete patches[id]; savePatches(patches); }
      catch { break; } // still offline / server error — retry next time
    }
    // 2) screenshots
    let shots = [];
    try { shots = await allShots(); } catch { shots = []; }
    for (const s of shots) {
      try {
        await screenshotsApi.upload({ employeeUid: s.employeeUid, sessionId: s.sessionId, blob: s.blob, date: s.date, activityPercent: s.activityPercent });
        await deleteShot(s.id);
      } catch { break; }
    }
  } finally {
    flushing = false;
    emit();
  }
}

// --- status subscription (for the UI indicator) --------------------------
const listeners = new Set();
export function subscribeOfflineStatus(cb) {
  listeners.add(cb);
  status().then(cb);
  return () => listeners.delete(cb);
}
async function status() {
  const sessions = Object.keys(loadPatches()).length;
  const shots = await countShots();
  return { online: navigator.onLine, sessions, shots, total: sessions + shots };
}
function emit() { status().then((s) => listeners.forEach((cb) => { try { cb(s); } catch { /* ignore */ } })); }

// --- init: flush on reconnect + periodic retry ---------------------------
let inited = false;
export function initOfflineQueue() {
  if (inited) return;
  inited = true;
  window.addEventListener('online', () => { emit(); flush(); });
  window.addEventListener('offline', emit);
  setInterval(() => { if (navigator.onLine) flush(); }, 30000);
  if (navigator.onLine) flush();
}
