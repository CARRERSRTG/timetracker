import { useEffect, useMemo, useState } from 'react';
import { sessions as sessionsApi } from '@shared/lib/supabase.js';
import { addWeeks, thisWeekStart, weekStartISO, fmtISOday, money, computePay } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';

const WEEKS = 8;

// Manager dashboard: headline KPIs, an 8-week hours trend, a sortable per-employee
// table (scales to many people), and top projects. Single-hue marks + status
// colors (no per-employee rainbow that breaks past ~8 people).
export default function Insights({ users, projects, assignments }) {
  const t = useT();
  const startISO = addWeeks(thisWeekStart(), -(WEEKS - 1));
  const [sessions, setSessions] = useState([]);
  const [sort, setSort] = useState({ key: 'hours', dir: 'desc' });
  useEffect(() => sessionsApi.subscribeFromDate(startISO, setSessions), [startISO]);

  const uMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const pMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const aMap = useMemo(() => Object.fromEntries(assignments.map((a) => [a.id, a])), [assignments]);
  const thisWk = thisWeekStart();

  // ---- weekly trend (all weeks) ----
  const weekKeys = Array.from({ length: WEEKS }, (_, i) => addWeeks(startISO, i));
  const weekHours = Object.fromEntries(weekKeys.map((w) => [w, 0]));
  sessions.forEach((s) => { const w = weekStartISO(s.date); if (weekHours[w] != null) weekHours[w] += (s.durationSeconds || 0) / 3600; });
  const trend = weekKeys.map((w) => ({ w, hours: weekHours[w] }));

  // ---- this week aggregates ----
  const wk = sessions.filter((s) => weekStartISO(s.date) === thisWk);
  const byEmp = {};
  wk.forEach((s) => {
    const e = (byEmp[s.employeeUid] = byEmp[s.employeeUid] || { sec: 0, active: 0, byWeekAssign: {} });
    e.sec += s.durationSeconds || 0;
    e.active += s.activeSeconds || 0;
    (e.byWeekAssign[s.assignmentId] = e.byWeekAssign[s.assignmentId] || 0) ;
    e.byWeekAssign[s.assignmentId] += s.durationSeconds || 0;
  });
  const empRows = Object.entries(byEmp).map(([uid, e]) => {
    let cost = 0;
    Object.entries(e.byWeekAssign).forEach(([aid, sec]) => { const a = aMap[aid]; if (a) cost += computePay(sec / 3600, a).pay; });
    return {
      uid, name: uMap[uid]?.name || '—',
      hours: e.sec / 3600,
      activity: e.sec > 0 ? Math.round((e.active / e.sec) * 100) : 0,
      cost,
    };
  });

  const totalHours = empRows.reduce((n, r) => n + r.hours, 0);
  const totalCost = empRows.reduce((n, r) => n + r.cost, 0);
  const avgActivity = empRows.length ? Math.round(empRows.reduce((n, r) => n + r.activity * r.hours, 0) / (totalHours || 1)) : 0;

  const sorted = empRows.slice().sort((a, b) => {
    const d = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return d * a.name.localeCompare(b.name);
    return d * (a[sort.key] - b[sort.key]);
  });
  const maxHours = Math.max(1, ...empRows.map((r) => r.hours));

  // ---- top projects this week ----
  const byProj = {};
  wk.forEach((s) => { byProj[s.projectId] = (byProj[s.projectId] || 0) + (s.durationSeconds || 0) / 3600; });
  const projRows = Object.entries(byProj).map(([id, h]) => ({ name: pMap[id]?.name || '(deleted)', hours: h })).sort((a, b) => b.hours - a.hours);
  const topProj = projRows.slice(0, 6);
  const otherProj = projRows.slice(6).reduce((n, r) => n + r.hours, 0);
  if (otherProj > 0) topProj.push({ name: t('mgr.ins.other'), hours: otherProj });
  const maxProj = Math.max(1, ...topProj.map((r) => r.hours));

  const hdr = (key, label, right) => (
    <th className={right ? 'right' : ''} style={{ cursor: 'pointer' }} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );
  const actColor = (p) => (p >= 60 ? 'var(--accent2)' : p >= 25 ? 'var(--warn)' : 'var(--danger)');

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="n">{totalHours.toFixed(1)} h</div><div className="l">{t('mgr.ins.hoursWeek')}</div></div>
        <div className="stat"><div className="n">{money(totalCost)}</div><div className="l">{t('mgr.ins.payWeek')}</div></div>
        <div className="stat"><div className="n">{empRows.length}</div><div className="l">{t('mgr.ins.people')}</div></div>
        <div className="stat"><div className="n">{avgActivity}%</div><div className="l">{t('mgr.ins.avgAct')}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>{t('mgr.ins.perWeek')} <span className="small muted">{t('mgr.ins.lastWeeks', { n: WEEKS })}</span></h2>
        <TrendChart data={trend} />
      </div>

      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>{t('mgr.ins.empWeek')}</h2><span className="small muted">{t('mgr.ins.tracking', { n: empRows.length })}</span></div>
        {empRows.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>{t('mgr.ins.noTime')}</p> : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead><tr>{hdr('name', t('mgr.ins.colEmp'))}{hdr('hours', t('mgr.ins.colHours'), true)}<th>{t('mgr.ins.colLoad')}</th>{hdr('activity', t('mgr.ins.colActivity'), true)}{hdr('cost', t('mgr.ins.colPay'), true)}</tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.uid}>
                    <td className="nowrap">{r.name}</td>
                    <td className="right nowrap">{r.hours.toFixed(2)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ background: 'var(--line)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: (r.hours / maxHours) * 100 + '%', height: '100%', background: 'var(--accent)' }} />
                      </div>
                    </td>
                    <td className="right nowrap"><span style={{ color: actColor(r.activity), fontWeight: 700 }}>{r.activity}%</span></td>
                    <td className="right nowrap">{money(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t('mgr.ins.topProj')}</h2>
        {topProj.length === 0 ? <p className="muted">{t('mgr.ins.noProj')}</p> : topProj.map((r) => (
          <div key={r.name} style={{ margin: '8px 0' }}>
            <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{r.name}</span><span className="muted">{r.hours.toFixed(1)} h</span>
            </div>
            <div style={{ background: 'var(--line)', borderRadius: 6, height: 10, overflow: 'hidden', marginTop: 2 }}>
              <div style={{ width: (r.hours / maxProj) * 100 + '%', height: '100%', background: 'var(--accent2)' }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Compact 8-week hours trend: area + line + end dot, recessive axis, hover dots.
function TrendChart({ data }) {
  const W = 720, H = 160, padL = 8, padR = 8, padT = 12, padB = 22;
  const max = Math.max(1, ...data.map((d) => d.hours));
  const n = data.length;
  const x = (i) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const pts = data.map((d, i) => [x(i), y(d.hours)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `M ${x(0).toFixed(1)} ${(H - padB).toFixed(1)} ` + pts.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ` L ${x(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="trendfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendfill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="var(--accent)" />
          <text x={p[0]} y={H - 6} fontSize="10" fill="var(--muted)" textAnchor="middle">{fmtISOday(data[i].w)}</text>
          {data[i].hours > 0 && <text x={p[0]} y={p[1] - 6} fontSize="10" fill="var(--txt)" textAnchor="middle">{data[i].hours.toFixed(0)}</text>}
        </g>
      ))}
    </svg>
  );
}
