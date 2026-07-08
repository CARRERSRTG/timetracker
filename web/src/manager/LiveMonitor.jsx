import { useEffect, useState } from 'react';
import { sessions as sessionsApi } from '@shared/lib/supabase.js';
import { fmtClock, fmtTime } from '../lib/helpers.js';

// "Who's working now" — currently clocked-in sessions, live via realtime.
export default function LiveMonitor({ users, projects }) {
  const [live, setLive] = useState([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => sessionsApi.subscribeLive(setLive), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });
  const pMap = {}; projects.forEach((p) => { pMap[p.id] = p; });
  const rows = live.slice().sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  // map the employee's short live_note to a friendly status
  function status(note) {
    if (!note) return null;
    if (note === 'idle') return { pill: 'wait', text: '⏸ Idle' };
    if (note === 'break') return { pill: 'wait', text: '☕ On break' };
    if (note === 'active') return { pill: 'on', text: '⌨ Working' };
    return { pill: 'on', text: '🟢 ' + note }; // an app name (meeting/reading)
  }

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Working now</h2>
        <span className="chip">{rows.length} active</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>Nobody is clocked in right now.</p>
      ) : (
        <div className="pbtns" style={{ marginTop: 12 }}>
          {rows.map((s) => {
            const emp = uMap[s.employeeUid];
            const proj = pMap[s.projectId];
            const elapsed = s.startMs ? Math.max(0, Math.floor((now - s.startMs) / 1000)) : (s.durationSeconds || 0);
            const dur = s.durationSeconds || 0;
            const pct = dur > 0 ? Math.round(((s.activeSeconds || 0) / dur) * 100) : 0;
            const screen = s.screenSeconds || 0;
            const inputActive = Math.max(0, (s.activeSeconds || 0) - screen);
            const idle = s.idleSeconds || 0;
            const st = status(s.liveNote);
            return (
              <div key={s.id} className="box">
                <div style={{ fontWeight: 700 }}>
                  {emp ? emp.name : (s.employeeName || '—')}
                  {st ? <span className={'pill ' + st.pill} style={{ marginLeft: 6 }}>{st.text}</span>
                    : <span className="pill on" style={{ marginLeft: 6 }}>live</span>}
                </div>
                <div className="small muted">{proj ? proj.name : '—'}{s.memo ? ' · ' + s.memo : ''}</div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="timer-big" style={{ fontSize: 26 }}>{fmtClock(elapsed)}</span>
                  <span className="small muted" style={{ textAlign: 'right' }}>
                    Activity {pct}%<br />since {fmtTime(s.startMs)}
                  </span>
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  ⌨ {fmtClock(inputActive)} input · 🖥 {fmtClock(screen)} screen · 💤 {fmtClock(idle)} idle
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Updates live as employees start and stop. Elapsed is wall-clock since they clocked in.
      </p>
    </div>
  );
}
