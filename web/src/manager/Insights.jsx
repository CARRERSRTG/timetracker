import { useEffect, useState } from 'react';
import { sessions as sessionsApi } from '@shared/lib/supabase.js';
import { addWeeks, thisWeekStart, weekStartISO, fmtISOday } from '../lib/helpers.js';

function Bars({ rows, unit }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted small">No data.</p>;
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ margin: '8px 0' }}>
          <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{r.label}</span>
            <span className="muted">{r.value.toFixed(2)} {unit || 'h'}</span>
          </div>
          <div style={{ background: 'var(--line)', borderRadius: 6, height: 12, overflow: 'hidden', marginTop: 2 }}>
            <div style={{ width: (r.value / max) * 100 + '%', height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Insights({ users, projects }) {
  const WEEKS = 8;
  const startISO = addWeeks(thisWeekStart(), -(WEEKS - 1));
  const [sessions, setSessions] = useState([]);
  useEffect(() => sessionsApi.subscribeFromDate(startISO, setSessions), [startISO]);

  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });
  const pMap = {}; projects.forEach((p) => { pMap[p.id] = p; });
  const totalSec = sessions.reduce((n, s) => n + (s.durationSeconds || 0), 0);

  const byWeek = {};
  for (let i = 0; i < WEEKS; i++) byWeek[addWeeks(startISO, i)] = 0;
  const byProj = {}, byEmp = {};
  sessions.forEach((s) => {
    const w = weekStartISO(s.date);
    if (byWeek[w] != null) byWeek[w] += s.durationSeconds || 0;
    byProj[s.projectId] = (byProj[s.projectId] || 0) + (s.durationSeconds || 0);
    byEmp[s.employeeUid] = (byEmp[s.employeeUid] || 0) + (s.durationSeconds || 0);
  });
  const weekRows = Object.keys(byWeek).map((w) => ({ label: fmtISOday(w), value: byWeek[w] / 3600 }));
  const projRows = Object.keys(byProj).map((id) => ({ label: pMap[id] ? pMap[id].name : '(deleted)', value: byProj[id] / 3600 })).sort((a, b) => b.value - a.value).slice(0, 8);
  const empRows = Object.keys(byEmp).map((id) => ({ label: uMap[id] ? uMap[id].name : '—', value: byEmp[id] / 3600 })).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div className="card">
      <h2>Dashboard</h2>
      <div className="grid g3">
        <div className="stat"><div className="n">{(totalSec / 3600).toFixed(1)} h</div><div className="l">Last {WEEKS} weeks</div></div>
        <div className="stat"><div className="n">{projRows.length}</div><div className="l">Active projects</div></div>
        <div className="stat"><div className="n">{empRows.length}</div><div className="l">People tracking</div></div>
      </div>
      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>Hours per week</h3>
      <Bars rows={weekRows} />
      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>Hours per project</h3>
      <Bars rows={projRows} />
      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>Hours per employee</h3>
      <Bars rows={empRows} />
    </div>
  );
}
