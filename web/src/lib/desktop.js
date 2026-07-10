// Desktop bridge glue for the shared UI. In the web build window.ttDesktop is
// undefined and everything here no-ops.
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { dateISO } from './helpers.js';
import { queueShot } from './offlineQueue.js';

export const IS_DESKTOP = !!(window.ttDesktop && window.ttDesktop.isDesktop);
export const DESKTOP_SHOT_MIN = 10;

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// UI subscribers (e.g. the "screenshot taken" toast). Emitted on every capture
// with { dataUrl, at, status } where status is 'saving' → 'saved' | 'error'.
const shotListeners = new Set();
export function subscribeShots(cb) {
  shotListeners.add(cb);
  return () => shotListeners.delete(cb);
}
function emitShot(evt) { shotListeners.forEach((cb) => { try { cb(evt); } catch { /* ignore */ } }); }

// Fired right after a screenshot row is written to the DB, so the screenshot
// views (latest-shot card, work diary) can refresh instantly on this machine
// instead of waiting for a realtime round-trip.
const shotsChangedListeners = new Set();
export function subscribeShotsChanged(cb) {
  shotsChangedListeners.add(cb);
  return () => shotsChangedListeners.delete(cb);
}
export function emitShotsChanged() { shotsChangedListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } }); }

// Register the screenshot upload handler once, globally. The desktop main
// process captures the screen and hands us a dataUrl; we upload it with the
// authenticated Supabase client (renderer owns auth).
let shotsInit = false;
export function initDesktopShots(getEmployeeUid) {
  if (shotsInit || !IS_DESKTOP) return;
  shotsInit = true;
  window.ttDesktop.onShot(async (data) => {
    const at = Date.now();
    // Blank slot: the segment had no activity → record a marker row (no image).
    if (data?.blank) {
      const uid = getEmployeeUid();
      if (!uid) return;
      try { await screenshotsApi.insertBlank({ employeeUid: uid, sessionId: data.sessionId || null, date: dateISO(at) }); emitShotsChanged(); }
      catch (e) { console.error('blank slot insert failed', e); }
      return;
    }
    if (!data?.dataUrl) return;
    emitShot({ dataUrl: data.dataUrl, at, status: 'saving' });
    const employeeUid = getEmployeeUid();
    if (!employeeUid) { emitShot({ dataUrl: data.dataUrl, at, status: 'error' }); return; }
    const rec = {
      employeeUid,
      sessionId: data.sessionId || null,
      blob: dataUrlToBlob(data.dataUrl),
      date: dateISO(at),
      activityPercent: data.activityPercent || 0,
    };
    const report = (status) => {
      emitShot({ dataUrl: data.dataUrl, at, status });
      try { window.ttDesktop.notifyShotStatus?.(status); } catch { /* ignore */ }
      if (status === 'saved') emitShotsChanged(); // row is in the DB → refresh views now
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      await screenshotsApi.upload(rec);
      report('saved');
    } catch (e) {
      // Offline or upload failed → buffer the image locally and sync later.
      const queued = await queueShot(rec);
      report(queued ? 'queued' : 'error');
      if (!queued) console.error('screenshot upload + queue failed', e);
    }
  });
}

export async function desktopGetActivity() {
  if (!IS_DESKTOP) return null;
  try { return await window.ttDesktop.getActivity(); } catch { return null; }
}

// { app, title, movement } — for smart idle. Null on web or if unavailable.
export async function desktopGetContext() {
  if (!IS_DESKTOP || !window.ttDesktop.getContext) return null;
  try { return await window.ttDesktop.getContext(); } catch { return null; }
}

// Subscribe to OS lock/sleep events (desktop only). cb receives the reason.
// Returns an unsubscribe function; no-ops on web.
export function desktopOnPower(cb) {
  if (!IS_DESKTOP || !window.ttDesktop.onPower) return () => {};
  try { return window.ttDesktop.onPower(cb); } catch { return () => {}; }
}

// The installed desktop app version, or null on web / if unavailable.
export async function desktopGetVersion() {
  if (!IS_DESKTOP || !window.ttDesktop.getVersion) return null;
  try { return await window.ttDesktop.getVersion(); } catch { return null; }
}

// --- auto-update (desktop only; all no-op on web) ---
export function desktopOnUpdate(cb) {
  if (!IS_DESKTOP || !window.ttDesktop.onUpdate) return () => {};
  try { return window.ttDesktop.onUpdate(cb); } catch { return () => {}; }
}
export async function desktopGetUpdateState() {
  if (!IS_DESKTOP || !window.ttDesktop.getUpdateState) return null;
  try { return await window.ttDesktop.getUpdateState(); } catch { return null; }
}
export function desktopCheckUpdate() {
  try { window.ttDesktop?.checkForUpdates?.(); } catch { /* ignore */ }
}
export function desktopInstallUpdate() {
  try { window.ttDesktop?.installUpdate?.(); } catch { /* ignore */ }
}
