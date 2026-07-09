import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi, sessions as sessionsApi } from '@shared/lib/supabase.js';
import { weekStartISO, weekLabel } from '../lib/helpers.js';
import WorkDiary from '../WorkDiary.jsx';

// Employees see their own Work Diary and can delete a shot they're not
// comfortable with (RLS allows own-delete).
export default function EmployeeScreenshots({ profile }) {
  const [shots, setShots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => screenshotsApi.subscribeByEmployee(profile.id, setShots), [profile.id]);
  useEffect(() => sessionsApi.subscribeByEmployee(profile.id, setSessions), [profile.id]);

  const sessMap = {}; sessions.forEach((s) => { sessMap[s.id] = s; });

  async function del(s) {
    if (busy) return;
    if (!confirm('Delete this screenshot? This removes it permanently, for your manager too.')) return;
    setBusy(true);
    try { await screenshotsApi.deleteWithFile({ id: s.id, path: s.path }); }
    catch (e) { alert('Could not delete: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  // group by week
  const byWeek = {};
  shots.forEach((s) => {
    const wk = weekStartISO(s.date || (s.takenAt ? new Date(s.takenAt) : new Date()));
    (byWeek[wk] = byWeek[wk] || []).push(s);
  });
  const weeks = Object.keys(byWeek).sort().reverse();

  return (
    <div className="card">
      <h2>My work diary</h2>
      {shots.length === 0 ? (
        <p className="muted">No screenshots yet. They're captured while you track time on the desktop app.</p>
      ) : weeks.map((w) => (
        <details key={w} open style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer' }} className="small muted">{weekLabel(w)} · {byWeek[w].length} shots</summary>
          <WorkDiary shots={byWeek[w]} sessionsMap={sessMap} onDelete={del} />
        </details>
      ))}
      <p className="small muted" style={{ marginTop: 10 }}>
        Deleting a screenshot removes it for your manager too. Use it if a capture caught something private.
      </p>
    </div>
  );
}
