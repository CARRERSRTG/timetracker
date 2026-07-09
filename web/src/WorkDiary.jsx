import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { fmtTime, fmtDT, fmtClock } from './lib/helpers.js';

// Upwork-style Work Diary: screenshots grouped into session blocks (time range +
// memo header), each shot with a segmented 10-bar activity meter + timestamp.
// `sessionsMap` is id -> session (for memo + time range). Optional onDelete(shot).
export default function WorkDiary({ shots, sessionsMap = {}, onDelete }) {
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    const missing = shots.filter((s) => s.path && !urls[s.path]);
    if (!missing.length) return;
    Promise.all(missing.map(async (s) => {
      try { return [s.path, await screenshotsApi.signedUrl(s.path, 3600)]; } catch { return [s.path, null]; }
    })).then((pairs) => {
      if (cancelled) return;
      setUrls((prev) => { const next = { ...prev }; pairs.forEach(([p, u]) => { if (u) next[p] = u; }); return next; });
    });
    return () => { cancelled = true; };
  }, [shots]); // eslint-disable-line react-hooks/exhaustive-deps

  // group shots by session id (falling back to a synthetic per-day bucket)
  const groups = {};
  shots.forEach((s) => {
    const key = s.sessionId || ('day-' + (s.date || ''));
    (groups[key] = groups[key] || []).push(s);
  });
  const blocks = Object.entries(groups).map(([key, list]) => {
    const sorted = list.slice().sort((a, b) => new Date(a.takenAt || 0) - new Date(b.takenAt || 0));
    const sess = sessionsMap[key];
    const firstMs = sorted[0]?.takenAt ? new Date(sorted[0].takenAt).getTime() : 0;
    const lastMs = sorted[sorted.length - 1]?.takenAt ? new Date(sorted[sorted.length - 1].takenAt).getTime() : firstMs;
    const startMs = sess?.startMs || firstMs;
    const endMs = sess?.endMs || lastMs;
    const durSec = sess?.durationSeconds ?? Math.max(0, Math.round((endMs - startMs) / 1000));
    return { key, sorted, startMs, endMs, durSec, memo: sess?.memo || '' };
  }).sort((a, b) => b.startMs - a.startMs);

  if (!shots.length) return null;

  return (
    <div>
      {blocks.map((b) => (
        <div key={b.key} style={{ marginTop: 16 }}>
          <div className="between" style={{ alignItems: 'baseline' }}>
            <div style={{ fontWeight: 700 }}>
              🟢 {fmtTime(b.startMs)} – {fmtTime(b.endMs)}
              <span className="muted small"> ({(b.durSec / 3600).toFixed(2)} hrs)</span>
            </div>
            {b.memo && <div className="small muted">{b.memo}</div>}
          </div>
          <div className="shotgrid" style={{ marginTop: 8 }}>
            {b.sorted.map((s) => {
              const url = urls[s.path];
              const pct = Math.max(0, Math.min(100, s.activityPercent || 0));
              const filled = Math.round(pct / 10);
              return (
                <div key={s.id} className="shot">
                  <a href={url || undefined} target="_blank" rel="noopener noreferrer">
                    {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
                  </a>
                  <div className="meter" title={`Activity ${pct}%`} style={{ marginTop: 4 }}>
                    {Array.from({ length: 10 }).map((_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
                  </div>
                  <div className="small muted">{s.takenAt ? fmtDT(new Date(s.takenAt).getTime(), { hour: '2-digit', minute: '2-digit' }) : '…'}</div>
                  {onDelete && (
                    <button className="btn-danger btn-sm" style={{ width: '100%', marginTop: 4, padding: '2px 6px' }} onClick={() => onDelete(s)}>Delete</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
