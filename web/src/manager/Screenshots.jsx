import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi, sessions as sessionsApi } from '@shared/lib/supabase.js';
import { weekStartISO, weekLabel, dateISO } from '../lib/helpers.js';
import WorkDiary from '../WorkDiary.jsx';

// Manager Work Diary: collapsible per employee, then per pay week, with Upwork-
// style session blocks + segmented activity bars.
export default function Screenshots({ users }) {
  const [shots, setShots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [purgeMsg, setPurgeMsg] = useState('');
  const [purging, setPurging] = useState(false);

  useEffect(() => screenshotsApi.subscribeRecent(500, setShots), []);
  useEffect(() => {
    const start = dateISO(Date.now() - 15 * 86400000); // last ~2 weeks for memo/time ranges
    return sessionsApi.subscribeFromDate(start, setSessions);
  }, []);

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
  const sessMap = {}; sessions.forEach((s) => { sessMap[s.id] = s; });

  // group: employee -> week -> shots
  const byEmp = {};
  shots.forEach((s) => {
    const emp = s.employeeUid || 'unknown';
    const wk = weekStartISO(s.date || (s.takenAt ? new Date(s.takenAt) : new Date()));
    ((byEmp[emp] = byEmp[emp] || {})[wk] = byEmp[emp][wk] || []).push(s);
  });
  const empIds = Object.keys(byEmp).sort((a, b) => (uMap[a]?.name || '').localeCompare(uMap[b]?.name || ''));

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Work diary</h2>
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
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
              {uMap[emp]?.name || '—'} <span className="chip" style={{ marginLeft: 6 }}>{total}</span>
            </summary>
            {weeks.map((w) => (
              <details key={w} open style={{ margin: '8px 0 0 12px' }}>
                <summary style={{ cursor: 'pointer' }} className="small muted">
                  {weekLabel(w)} · {byEmp[emp][w].length} shots
                </summary>
                <WorkDiary shots={byEmp[emp][w]} sessionsMap={sessMap} />
              </details>
            ))}
          </details>
        );
      })}
      <p className="small muted" style={{ marginTop: 14 }}>
        One shot per ~10-minute segment (max 6/hour) at a random time. The bar under each shows that segment's keyboard/mouse activity.
      </p>
    </div>
  );
}
