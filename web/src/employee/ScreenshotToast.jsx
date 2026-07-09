import { useEffect, useState } from 'react';
import { IS_DESKTOP, subscribeShots } from '../lib/desktop.js';
import { fmtTime } from '../lib/helpers.js';

// Upwork-style popup: whenever the desktop app captures a screenshot, briefly
// show a thumbnail preview so the user knows it happened. Web build renders
// nothing (no desktop screenshots).
export default function ScreenshotToast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    let hideTimer = null;
    const unsub = subscribeShots((evt) => {
      setToast(evt);
      clearTimeout(hideTimer);
      // keep it up a little longer once we know it saved
      hideTimer = setTimeout(() => setToast(null), evt.status === 'saving' ? 12000 : 6000);
    });
    return () => { unsub(); clearTimeout(hideTimer); };
  }, []);

  if (!toast) return null;

  const label = toast.status === 'saved' ? 'Screenshot captured'
    : toast.status === 'queued' ? 'Saved offline — will upload when back online'
    : toast.status === 'error' ? 'Screenshot failed to upload'
    : 'Capturing screenshot…';
  const icon = toast.status === 'error' ? '⚠ ' : toast.status === 'queued' ? '💾 ' : '📸 ';

  return (
    <div className="shot-toast" onClick={() => setToast(null)}>
      <img src={toast.dataUrl} alt="screenshot preview" />
      <div className="shot-toast-body">
        <div className="shot-toast-title">
          {icon}{label}
        </div>
        <div className="small muted">{fmtTime(toast.at)}</div>
      </div>
      <button className="shot-toast-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); setToast(null); }}>×</button>
    </div>
  );
}
