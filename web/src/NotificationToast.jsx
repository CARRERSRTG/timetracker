import { useEffect, useState } from 'react';
import { subscribeNotifications } from './lib/notify.js';

// In-app toast stack for notifications (paired with OS popups fired in notify()).
export default function NotificationToast() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribeNotifications((item) => {
    setItems((prev) => [...prev, item]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== item.id)), 7000);
  }), []);
  const dismiss = (id) => setItems((prev) => prev.filter((x) => x.id !== id));
  if (!items.length) return null;
  return (
    <div className="notif-stack">
      {items.map((it) => (
        <div key={it.id} className="notif" onClick={() => dismiss(it.id)}>
          <div className="notif-title">🔔 {it.title}</div>
          {it.body && <div className="small muted">{it.body}</div>}
        </div>
      ))}
    </div>
  );
}
