import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { fmtDT } from '../lib/helpers.js';

// Employees review their own screenshots and can delete any they're not
// comfortable with (which discards that capture). RLS allows own-delete.
export default function EmployeeScreenshots({ profile }) {
  const [shots, setShots] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => screenshotsApi.subscribeByEmployee(profile.id, setShots), [profile.id]);

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

  async function del(s) {
    if (!confirm('Delete this screenshot? This removes it permanently.')) return;
    setBusy(s.id);
    try { await screenshotsApi.deleteWithFile({ id: s.id, path: s.path }); }
    catch (e) { alert('Could not delete: ' + (e.message || e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="card">
      <h2>My screenshots</h2>
      {shots.length === 0 ? (
        <p className="muted">No screenshots yet. They're captured while you track time on the desktop app.</p>
      ) : (
        <div className="shotgrid">
          {shots.map((s) => {
            const url = urls[s.path];
            return (
              <div key={s.id} className="shot" style={{ position: 'relative' }}>
                {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
                <div className="small muted">{s.takenAt ? fmtDT(new Date(s.takenAt).getTime(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…'}</div>
                <button className="btn-danger btn-sm" style={{ width: '100%', marginTop: 6 }} disabled={busy === s.id} onClick={() => del(s)}>
                  {busy === s.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Deleting a screenshot removes it for your manager too. Use this if a capture caught something private.
      </p>
    </div>
  );
}
