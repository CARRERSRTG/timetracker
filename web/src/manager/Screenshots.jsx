import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { fmtDT, weekStartISO, weekLabel } from '../lib/helpers.js';

// Manager screenshot gallery: collapsible per employee, then per pay week, with
// an Upwork-style activity bar under each shot. Private bucket → signed URLs.
export default function Screenshots({ users }) {
  const [shots, setShots] = useState([]);
  const [urls, setUrls] = useState({});
  const [purgeMsg, setPurgeMsg] = useState('');
  const [purging, setPurging] = useState(false);

  useEffect(() => screenshotsApi.subscribeRecent(300, setShots), []);

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

  async function purge() {
    if (!confirm('Delete all screenshots older than 14 days? This frees storage and cannot be undone.')) return;
    setPurging(true); setPurgeMsg('');
    try {
      const n = await screenshotsApi.purgeOlderThan(14);
      setPurgeMsg(n === 0 ? 'Nothing older than 14 days.' : `Deleted ${n} old screenshot${n === 1 ? '' : 's'}.`);
    } catch (e) { setPurgeMsg('Purge failed: ' + (e.message || e)); }
    finally { setPurging(false); }
  }

  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });

  // group: employee -> week -> shots
  const byEmp = {};
  shots.forEach((s) => {
    const emp = s.employeeUid || 'unknown';
    const wk = weekStartISO(s.date || (s.takenAt ? new Date(s.takenAt) : new Date()));
    ((byEmp[emp] = byEmp[emp] || {})[wk] = byEmp[emp][wk] || []).push(s);
  });
  const empIds = Object.keys(byEmp).sort((a, b) => (uMap[a]?.name || '').localeCompare(uMap[b]?.name || ''));

  function Shot({ s }) {
    const url = urls[s.path];
    const pct = Math.max(0, Math.min(100, s.activityPercent || 0));
    const color = pct >= 60 ? 'var(--accent2)' : pct >= 25 ? 'var(--warn)' : 'var(--danger)';
    return (
      <div className="shot">
        <a href={url || undefined} target="_blank" rel="noopener noreferrer">
          {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
        </a>
        <div className="actbar" title={`Activity ${pct}%`}><i style={{ width: pct + '%', background: color }} /></div>
        <div className="small muted">{s.takenAt ? fmtDT(new Date(s.takenAt).getTime(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…'} · {pct}%</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Screenshots</h2>
        <button className="btn-ghost btn-sm" disabled={purging} onClick={purge}>🗑 Delete &gt; 14 days old</button>
      </div>
      {purgeMsg && <div className="banner info" style={{ marginTop: 10 }}>{purgeMsg}</div>}

      {empIds.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>No screenshots yet. They appear here when employees track time on the desktop app.</p>
      ) : empIds.map((emp) => {
        const weeks = Object.keys(byEmp[emp]).sort().reverse();
        const total = weeks.reduce((n, w) => n + byEmp[emp][w].length, 0);
        return (
          <details key={emp} open style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
              {uMap[emp]?.name || '—'} <span className="chip" style={{ marginLeft: 6 }}>{total}</span>
            </summary>
            {weeks.map((w) => (
              <details key={w} open style={{ margin: '8px 0 0 12px' }}>
                <summary style={{ cursor: 'pointer' }} className="small muted">
                  {weekLabel(w)} · {byEmp[emp][w].length} shots
                </summary>
                <div className="shotgrid">
                  {byEmp[emp][w].slice().sort((a, b) => new Date(b.takenAt || 0) - new Date(a.takenAt || 0)).map((s) => <Shot key={s.id} s={s} />)}
                </div>
              </details>
            ))}
          </details>
        );
      })}
      <p className="small muted" style={{ marginTop: 10 }}>
        One shot per ~10-minute segment (max 6/hour) at a random time. The bar under each is that segment's keyboard/mouse activity.
      </p>
    </div>
  );
}
