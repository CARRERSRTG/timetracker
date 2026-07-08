import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { fmtDT } from '../lib/helpers.js';

// Manager screenshot gallery. Our storage bucket is PRIVATE (unlike the old
// Firebase public URLs), so we mint short-lived signed URLs per shot on demand.
export default function Screenshots({ users }) {
  const [shots, setShots] = useState([]);
  const [uid, setUid] = useState('');
  const [urls, setUrls] = useState({}); // path -> signed url
  const [purgeMsg, setPurgeMsg] = useState('');
  const [purging, setPurging] = useState(false);

  useEffect(() => screenshotsApi.subscribeRecent(120, setShots), []);

  async function purge() {
    if (!confirm('Delete all screenshots older than 14 days? This frees storage and cannot be undone.')) return;
    setPurging(true); setPurgeMsg('');
    try {
      const n = await screenshotsApi.purgeOlderThan(14);
      setPurgeMsg(n === 0 ? 'Nothing older than 14 days.' : `Deleted ${n} old screenshot${n === 1 ? '' : 's'}.`);
    } catch (e) {
      setPurgeMsg('Purge failed: ' + (e.message || e));
    } finally { setPurging(false); }
  }

  // fetch signed URLs for any shots we don't have one for yet
  useEffect(() => {
    let cancelled = false;
    const missing = shots.filter((s) => s.path && !urls[s.path]);
    if (!missing.length) return;
    Promise.all(missing.map(async (s) => {
      try { return [s.path, await screenshotsApi.signedUrl(s.path, 3600)]; }
      catch { return [s.path, null]; }
    })).then((pairs) => {
      if (cancelled) return;
      setUrls((prev) => { const next = { ...prev }; pairs.forEach(([p, u]) => { if (u) next[p] = u; }); return next; });
    });
    return () => { cancelled = true; };
  }, [shots]); // eslint-disable-line react-hooks/exhaustive-deps

  const uMap = {};
  users.forEach((u) => { uMap[u.id] = u; });
  const list = uid ? shots.filter((s) => s.employeeUid === uid) : shots;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Screenshots</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn-ghost btn-sm" disabled={purging} onClick={purge}>🗑 Delete &gt; 14 days old</button>
          <select value={uid} onChange={(e) => setUid(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All employees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {purgeMsg && <div className="banner info" style={{ marginTop: 10 }}>{purgeMsg}</div>}

      {list.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          No screenshots yet. They appear here when employees track time using the desktop app.
        </p>
      ) : (
        <div className="shotgrid">
          {list.map((s) => {
            const url = urls[s.path];
            return (
              <a key={s.id} className="shot" href={url || undefined} target="_blank" rel="noopener noreferrer">
                {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
                <div className="small muted">
                  {uMap[s.employeeUid] ? uMap[s.employeeUid].name : '—'} · {s.takenAt ? fmtDT(new Date(s.takenAt).getTime(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…'}
                </div>
              </a>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Click a shot to open it full size. Captured automatically while an employee is clocked in on the desktop app.
      </p>
    </div>
  );
}
