// Notification hub: emits an in-app toast (via subscribers) AND fires a native
// OS notification. On the web / Electron that's the HTML5 Notification API
// (Electron shows a Windows toast even when unfocused). Inside the Android app
// (Capacitor) the Notification API isn't available in the WebView, so we route
// through the Capacitor LocalNotifications plugin instead.

const listeners = new Set();
export function subscribeNotifications(cb) { listeners.add(cb); return () => listeners.delete(cb); }

let seq = 0;

function capNative() {
  try { const c = typeof window !== 'undefined' && window.Capacitor; return c && c.isNativePlatform && c.isNativePlatform() ? c : null; }
  catch { return null; }
}

export function ensureNotifyPermission() {
  try {
    const c = capNative();
    if (c) { c.Plugins?.LocalNotifications?.requestPermissions?.().catch(() => {}); return; }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}

export function notify({ title, body, tag }) {
  // in-app toast (always)
  const item = { id: ++seq, title, body, at: Date.now() };
  listeners.forEach((cb) => { try { cb(item); } catch { /* ignore */ } });
  // native OS notification (best-effort)
  try {
    const c = capNative();
    if (c) {
      c.Plugins?.LocalNotifications?.schedule?.({
        notifications: [{ id: Date.now() % 2147483000, title: String(title || ''), body: String(body || '') }],
      }).catch(() => {});
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag });
    }
  } catch { /* ignore */ }
}
