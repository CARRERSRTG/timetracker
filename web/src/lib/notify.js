// Lightweight notification hub: emits an in-app toast (via subscribers) AND
// fires an OS notification through the HTML5 Notification API. That API also
// works in the Electron renderer, where it shows a native Windows toast even
// when the window is unfocused/minimized.

const listeners = new Set();
export function subscribeNotifications(cb) { listeners.add(cb); return () => listeners.delete(cb); }

let seq = 0;

export function ensureNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}

export function notify({ title, body, tag }) {
  // in-app toast
  const item = { id: ++seq, title, body, at: Date.now() };
  listeners.forEach((cb) => { try { cb(item); } catch { /* ignore */ } });
  // OS notification (best-effort)
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag });
    }
  } catch { /* ignore */ }
}
