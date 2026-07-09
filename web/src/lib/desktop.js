// Desktop bridge glue for the shared UI. In the web build window.ttDesktop is
// undefined and everything here no-ops.
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { dateISO } from './helpers.js';

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

// Register the screenshot upload handler once, globally. The desktop main
// process captures the screen and hands us a dataUrl; we upload it with the
// authenticated Supabase client (renderer owns auth).
let shotsInit = false;
export function initDesktopShots(getEmployeeUid) {
  if (shotsInit || !IS_DESKTOP) return;
  shotsInit = true;
  window.ttDesktop.onShot(async (data) => {
    if (!data?.dataUrl) return;
    const at = Date.now();
    emitShot({ dataUrl: data.dataUrl, at, status: 'saving' });
    try {
      const employeeUid = getEmployeeUid();
      if (!employeeUid) throw new Error('no employee uid');
      const blob = dataUrlToBlob(data.dataUrl);
      await screenshotsApi.upload({
        employeeUid,
        sessionId: data.sessionId || null,
        blob,
        date: dateISO(at),
        activityPercent: data.activityPercent || 0,
      });
      emitShot({ dataUrl: data.dataUrl, at, status: 'saved' });
    } catch (e) {
      console.error('screenshot upload failed', e);
      emitShot({ dataUrl: data.dataUrl, at, status: 'error' });
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
