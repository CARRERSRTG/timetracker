import { useEffect, useState } from 'react';
import { payrolls as payrollsApi } from '@shared/lib/supabase.js';
import {
  fmtClock, fmtTime, money, breaksText, weekStartISO, thisWeekStart, addWeeks, weekLabel, computePay,
  fmtDayLong, dateISO,
} from '../lib/helpers.js';

// NOTE: schema stores the payroll amount in the `total` column (the original
// Firebase app used `amount`). We read `total` here; the manager payroll step
// writes `total`.
export default function EmployeeWeek({ profile, assignments, sessions }) {
  const [week, setWeek] = useState(thisWeekStart());
  const [batches, setBatches] = useState([]);
  const [openDays, setOpenDays] = useState(() => new Set([dateISO(new Date())])); // today expanded
  const toggleDay = (d) => setOpenDays((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const aMap = {};
  assignments.forEach((a) => { aMap[a.id] = a; });

  useEffect(() => payrollsApi.subscribeByEmployee(profile.id, setBatches), [profile.id]);

  const weekSessions = sessions.filter((s) => weekStartISO(s.date) === week);
  const weekBatches = batches.filter((b) => b.weekOf === week);
  const paidTotal = weekBatches.filter((b) => b.paid).reduce((n, b) => n + (b.total || 0), 0);

  const byAssign = {};
  weekSessions.forEach((s) => {
    if (!byAssign[s.assignmentId]) byAssign[s.assignmentId] = { sec: 0 };
    byAssign[s.assignmentId].sec += s.durationSeconds || 0;
  });

  // group the week's entries by day (most recent first), with a per-day total
  const byDay = {};
  weekSessions.forEach((s) => {
    (byDay[s.date] = byDay[s.date] || { date: s.date, sec: 0, items: [] });
    byDay[s.date].sec += s.durationSeconds || 0;
    byDay[s.date].items.push(s);
  });
  const dayGroups = Object.values(byDay)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => ({ ...d, items: d.items.slice().sort((a, b) => (a.startMs || 0) - (b.startMs || 0)) }));

  let totalPay = 0, totalSec = 0;
  const rows = Object.entries(byAssign).map(([aid, v]) => {
    const a = aMap[aid];
    const hours = v.sec / 3600;
    const calc = a ? computePay(hours, a) : { pay: 0, reg: 0, ot: 0, overLimit: 0 };
    totalPay += calc.pay; totalSec += v.sec;
    const proj = a ? a.project : { name: '(deleted project)' };
    return { aid, proj, sec: v.sec, calc };
  });

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>My week</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn-ghost btn-sm" onClick={() => setWeek(addWeeks(week, -1))}>← Previous</button>
          <span className="small nowrap">{weekLabel(week)}</span>
          <button className="btn-ghost btn-sm" disabled={week >= thisWeekStart()} onClick={() => setWeek(addWeeks(week, 1))}>Next →</button>
        </div>
      </div>

      {paidTotal > 0 && <div className="banner ok" style={{ marginTop: 12 }}>Paid this week: {money(paidTotal)}.</div>}

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="stat"><div className="n">{(totalSec / 3600).toFixed(2)} h</div><div className="l">Total hours</div></div>
        <div className="stat"><div className="n">{money(totalPay)}</div><div className="l">Estimated pay</div></div>
        <div className="stat"><div className="n">{money(paidTotal)}</div><div className="l">Paid so far</div></div>
      </div>

      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>No time logged this week.</p>
      ) : (
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Project</th>
              <th className="right">Hours</th>
              <th className="right">Regular</th>
              <th className="right">Overtime</th>
              <th className="right">Over limit</th>
              <th className="right">Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.aid}>
                <td>{r.proj.name}</td>
                <td className="right nowrap">{(r.sec / 3600).toFixed(2)}</td>
                <td className="right nowrap">{r.calc.reg.toFixed(2)}</td>
                <td className="right nowrap">{r.calc.ot.toFixed(2)}</td>
                <td className="right nowrap" style={{ color: r.calc.overLimit > 0 ? 'var(--danger)' : 'inherit' }}>{r.calc.overLimit.toFixed(2)}</td>
                <td className="right nowrap">{money(r.calc.pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>This week's entries</h3>
      {dayGroups.length === 0 ? (
        <p className="muted small">No entries.</p>
      ) : (
        dayGroups.map((d) => {
          const open = openDays.has(d.date);
          return (
            <div key={d.date} className="box" style={{ marginTop: 8 }}>
              <div className="between" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => toggleDay(d.date)}>
                <div style={{ fontWeight: 700 }}>
                  <span className="small muted" style={{ marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                  {fmtDayLong(d.date)}
                  <span className="small muted" style={{ marginLeft: 6 }}>· {d.items.length} {d.items.length === 1 ? 'entry' : 'entries'}</span>
                </div>
                <b className="nowrap">{fmtClock(d.sec)}</b>
              </div>
              {open && (
                <table style={{ marginTop: 8 }}>
                  <thead><tr><th>In → Out</th><th>Project</th><th>Note</th><th className="right">Duration</th></tr></thead>
                  <tbody>
                    {d.items.map((s) => {
                      const a = aMap[s.assignmentId];
                      return (
                        <tr key={s.id}>
                          <td className="small nowrap">{fmtTime(s.startMs)} → {s.endMs ? fmtTime(s.endMs) : '—'}</td>
                          <td className="small">{a ? a.project.name : '—'}</td>
                          <td className="small muted">
                            {s.memo || '—'}
                            {s.source === 'manual' ? <span className="pill on" style={{ marginLeft: 6 }}>added</span>
                              : s.source === 'adjusted' ? <span className="pill wait" style={{ marginLeft: 6 }}>adjusted</span> : null}
                            {breaksText(s) && <div className="small muted" style={{ marginTop: 2 }}>{breaksText(s)}</div>}
                          </td>
                          <td className="right nowrap small">{fmtClock(s.durationSeconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Entries are grouped by day — tap a day to see its in/out times. To adjust, delete or add time, send a request from the "My requests" tab. The manager must approve it.
      </p>
    </div>
  );
}
