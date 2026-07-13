import { useState } from 'react';
import { requests as requestsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, dateISO, fmtClock, weekIsFinished, weekStartISO } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';

// Request-specific fields live in the `payload` jsonb column (the table only has
// employee_uid, type, status, payload, resolved_*). Status uses the schema's
// enum: pending | approved | rejected.
const LABEL = { add: 'Add time', adjust: 'Adjust time', delete: 'Delete time' };

function hhmm(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: APP_SETTINGS.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  } catch { return ''; }
}
function tParse(t) { if (!t) return null; const p = t.split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
function rangeHours(from, to) {
  const a = tParse(from), b = tParse(to);
  if (a == null || b == null) return 0;
  let d = b - a; if (d < 0) d += 1440;
  return d / 60;
}

export default function EmployeeRequests({ profile, assignments, sessions, requests }) {
  const t = useT();
  const aMap = {};
  assignments.forEach((a) => { aMap[a.id] = a; });
  const [type, setType] = useState('add');
  const blank = { assignmentId: '', date: dateISO(new Date()), fromTime: '', toTime: '', sessionId: '', reason: '' };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const mySessions = sessions.slice().sort((a, b) => (b.startMs || 0) - (a.startMs || 0)).slice(0, 60);
  const hrs = rangeHours(f.fromTime, f.toTime);

  function pickSession(id) {
    const s = sessions.find((x) => x.id === id);
    if (s) setF((p) => ({ ...p, sessionId: id, date: s.date, fromTime: hhmm(s.startMs), toTime: hhmm(s.endMs || s.startMs) }));
    else setF((p) => ({ ...p, sessionId: id }));
  }

  async function send() {
    setMsg('');
    // Finished weeks are locked (in review) — no change requests against them.
    const involved = [];
    if (type === 'add') involved.push(f.date);
    else { const s = sessions.find((x) => x.id === f.sessionId); if (s) involved.push(s.date); if (type === 'adjust') involved.push(f.date); }
    if (involved.some((dt) => dt && weekIsFinished(weekStartISO(dt), 'weekly'))) { setMsg(t('emp.req.weekLocked')); return undefined; }
    try {
      let payload;
      if (type === 'add') {
        if (!f.assignmentId) return setMsg('Pick a project.');
        if (!f.fromTime || !f.toTime) return setMsg('Enter the start and end time.');
        if (hrs <= 0) return setMsg('End time must be after start time.');
        const a = aMap[f.assignmentId];
        payload = { employeeName: profile.name, projectId: a.projectId, assignmentId: a.id, date: f.date, fromTime: f.fromTime, toTime: f.toTime, hours: Number(hrs.toFixed(2)), reason: f.reason.trim() };
      } else if (type === 'adjust') {
        if (!f.sessionId) return setMsg('Pick an entry.');
        if (!f.fromTime || !f.toTime) return setMsg('Enter the new start and end time.');
        if (hrs <= 0) return setMsg('End time must be after start time.');
        const s = sessions.find((x) => x.id === f.sessionId);
        payload = { employeeName: profile.name, projectId: s.projectId, assignmentId: s.assignmentId, sessionId: s.id, date: f.date, fromTime: f.fromTime, toTime: f.toTime, hours: Number(hrs.toFixed(2)), oldSeconds: s.durationSeconds, reason: f.reason.trim() };
      } else {
        if (!f.sessionId) return setMsg('Pick an entry.');
        const s = sessions.find((x) => x.id === f.sessionId);
        payload = { employeeName: profile.name, projectId: s.projectId, assignmentId: s.assignmentId, sessionId: s.id, date: s.date, reason: f.reason.trim() };
      }
      await requestsApi.insert({ employeeUid: profile.id, type, status: 'pending', payload });
      setF(blank);
      setMsg('Request sent. The manager must approve it.');
    } catch (e) {
      setMsg(e.message || 'Failed to send.');
    }
    return undefined;
  }

  const sorted = requests.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return (
    <>
      <div className="card">
        <h2>New request</h2>
        {msg && <div className="banner info">{msg}</div>}
        <label>Type</label>
        <div className="row">
          {['add', 'adjust', 'delete'].map((t) => (
            <button key={t} className={type === t ? '' : 'btn-ghost'} onClick={() => { setType(t); setF(blank); }}>{LABEL[t]}</button>
          ))}
        </div>

        {type === 'add' && (
          <>
            <div className="grid g2" style={{ marginTop: 10 }}>
              <div>
                <label>Project</label>
                <select value={f.assignmentId} onChange={(e) => upd('assignmentId', e.target.value)}>
                  <option value="">Pick…</option>
                  {assignments.map((a) => <option key={a.id} value={a.id}>{a.project.name}</option>)}
                </select>
              </div>
              <div><label>Date</label><input type="date" value={f.date} onChange={(e) => upd('date', e.target.value)} /></div>
            </div>
            <div className="grid g2">
              <div><label>From</label><input type="time" value={f.fromTime} onChange={(e) => upd('fromTime', e.target.value)} /></div>
              <div><label>To</label><input type="time" value={f.toTime} onChange={(e) => upd('toTime', e.target.value)} /></div>
            </div>
          </>
        )}

        {type === 'adjust' && (
          <>
            <label style={{ marginTop: 10 }}>Entry to fix</label>
            <select value={f.sessionId} onChange={(e) => pickSession(e.target.value)}>
              <option value="">Pick an entry…</option>
              {mySessions.map((s) => { const a = aMap[s.assignmentId]; return <option key={s.id} value={s.id}>{s.date} · {a ? a.project.name : '—'} · {fmtClock(s.durationSeconds)} · {s.memo || 'no note'}</option>; })}
            </select>
            <div className="grid g2" style={{ marginTop: 8 }}>
              <div><label>Date</label><input type="date" value={f.date} onChange={(e) => upd('date', e.target.value)} /></div>
              <div />
            </div>
            <div className="grid g2">
              <div><label>New From</label><input type="time" value={f.fromTime} onChange={(e) => upd('fromTime', e.target.value)} /></div>
              <div><label>New To</label><input type="time" value={f.toTime} onChange={(e) => upd('toTime', e.target.value)} /></div>
            </div>
          </>
        )}

        {type === 'delete' && (
          <>
            <label style={{ marginTop: 10 }}>Entry to delete</label>
            <select value={f.sessionId} onChange={(e) => upd('sessionId', e.target.value)}>
              <option value="">Pick an entry…</option>
              {mySessions.map((s) => { const a = aMap[s.assignmentId]; return <option key={s.id} value={s.id}>{s.date} · {a ? a.project.name : '—'} · {fmtClock(s.durationSeconds)} · {s.memo || 'no note'}</option>; })}
            </select>
          </>
        )}

        {(type === 'add' || type === 'adjust') && hrs > 0 && (
          <div className="small muted" style={{ marginTop: 4 }}>That's <b>{hrs.toFixed(2)} h</b> — the system calculates it from the times.</div>
        )}
        <label style={{ marginTop: 8 }}>Reason (optional)</label>
        <input value={f.reason} onChange={(e) => upd('reason', e.target.value)} placeholder="e.g. forgot to start the timer" />
        <button style={{ marginTop: 14 }} onClick={send}>Send request</button>
      </div>

      <div className="card">
        <h2>My requests</h2>
        {sorted.length === 0 ? <p className="muted">You haven't sent any yet.</p> : (
          <table>
            <thead><tr><th>Type</th><th>Detail</th><th>Status</th></tr></thead>
            <tbody>
              {sorted.map((r) => {
                const p = r.payload || {};
                const a = aMap[p.assignmentId];
                const proj = a ? a.project.name : '';
                const det = r.type === 'delete'
                  ? `${proj} · ${p.date}`
                  : `${proj} · ${p.date} · ${p.fromTime || ''}-${p.toTime || ''} (${p.hours} h)`;
                return (
                  <tr key={r.id}>
                    <td>{LABEL[r.type]}</td>
                    <td className="small muted">{det}</td>
                    <td>
                      {r.status === 'pending' ? <span className="pill wait">Pending</span>
                        : r.status === 'approved' ? <span className="pill on">Approved</span>
                        : <span className="pill off">Rejected</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
