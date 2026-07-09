import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi, sessions as sessionsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, dateISO, fmtHM } from '../lib/helpers.js';
import WorkDiary from '../WorkDiary.jsx';

// Manager Work Diary: pick an employee, then browse their day-by-day diary
// (Upwork-style date nav + hourly groups + activity bars).
export default function Screenshots({ users }) {
  const [shots, setShots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [uid, setUid] = useState('');
  const [purgeMsg, setPurgeMsg] = useState('');
  const [purging, setPurging] = useState(false);

  useEffect(() => screenshotsApi.subscribeRecent(500, setShots), []);
  useEffect(() => {
    const start = dateISO(Date.now() - 15 * 86400000);
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

  // #11 Delete a shot and forfeit its ~segment of paid time (Upwork-style).
  async function deleteShot(s) {
    const segMin = Number(APP_SETTINGS.screenshotIntervalMin) || 10;
    const forfeitSeconds = segMin * 60;
    const msg = s.sessionId
      ? `Delete this screenshot and forfeit the ~${fmtHM(forfeitSeconds)} block it covers from the tracked (unpaid) time?`
      : 'Delete this screenshot? (It isn\'t linked to a session, so no time is forfeited.)';
    if (!confirm(msg)) return;
    try {
      await screenshotsApi.deleteWithForfeit({ id: s.id, path: s.path, sessionId: s.sessionId, forfeitSeconds });
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  }

  // employees that actually have screenshots
  const empIds = Array.from(new Set(shots.map((s) => s.employeeUid)));
  const employees = users.filter((u) => empIds.includes(u.id));
  const activeUid = uid || employees[0]?.id || '';
  const empShots = shots.filter((s) => s.employeeUid === activeUid);
  const empSessions = sessions.filter((s) => s.employeeUid === activeUid);

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Work diary</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <select value={activeUid} onChange={(e) => setUid(e.target.value)} style={{ width: 'auto' }}>
            {employees.length === 0 && <option value="">No screenshots yet</option>}
            {employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-ghost btn-sm" disabled={purging} onClick={purge}>🗑 &gt; 14 days</button>
        </div>
      </div>
      {purgeMsg && <div className="banner info" style={{ marginTop: 10 }}>{purgeMsg}</div>}

      {employees.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>No screenshots yet. They appear here when employees track time on the desktop app.</p>
      ) : (
        <WorkDiary key={activeUid} shots={empShots} sessions={empSessions} onDelete={deleteShot} />
      )}
      <p className="small muted" style={{ marginTop: 14 }}>
        One shot per ~10-minute segment (max 6/hour) at a random time; the bar under each shows that segment's activity.
        Deleting a shot also removes its ~{fmtHM((Number(APP_SETTINGS.screenshotIntervalMin) || 10) * 60)} block from tracked time.
      </p>
    </div>
  );
}
