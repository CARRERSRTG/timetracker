import { useEffect, useState } from 'react';
import { sessions as sessionsApi, payrolls as payrollsApi, audit as auditApi } from '@shared/lib/supabase.js';
import {
  APP_SETTINGS, computePay, money, fmtClock, fmtHM, fmtDT, dateISO,
  weekStartISO, weekEndISO, weekLabel, addWeeks, thisWeekStart, breaksText,
} from '../lib/helpers.js';

// Payroll adapted to our schema: batches live in `payrolls`, the amount is the
// `total` column (not `amount`), drafts are payroll rows with draft=true holding
// pending adjustments (deduped by find-or-create on employee+week), and paid
// sessions are linked via sessions.payroll_id.
const tParse = (t) => { if (!t) return 0; const p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); };
function hhmm(ms) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: APP_SETTINGS.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
  catch { return ''; }
}
function fromRange(date, from, to) {
  let d = tParse(to) - tParse(from); if (d < 0) d += 1440;
  const durationSeconds = d * 60;
  const ft = String(from).length === 5 ? from : '0' + from;
  const startMs = new Date(date + 'T' + ft + ':00').getTime();
  return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
}
const paidAtMs = (b) => (b && b.paidAt ? new Date(b.paidAt).getTime() : 0);

export default function ManagerReports({ profile, users, projects, assignments }) {
  const [week, setWeek] = useState(thisWeekStart());
  const [sessions, setSessions] = useState([]);
  const [batches, setBatches] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const adjTypes = APP_SETTINGS.adjustmentTypes || ['Bonus', 'Advance', 'Deduction'];
  const [adjType, setAdjType] = useState(adjTypes[0]);
  const [adjAmount, setAdjAmount] = useState('');
  const [sa, setSa] = useState({ uid: '', type: adjTypes[0], amount: '' });
  const [editId, setEditId] = useState(null);
  const [ed, setEd] = useState({ date: '', from: '', to: '' });
  const [addUid, setAddUid] = useState(null);
  const [nadd, setNadd] = useState({ assignmentId: '', date: '', from: '', to: '' });

  const start = week, end = weekEndISO(week);
  useEffect(() => sessionsApi.subscribeDateRange(start, end, setSessions), [start, end]);
  useEffect(() => payrollsApi.subscribeByWeek(week, setBatches), [week]);

  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });
  const pMap = {}; projects.forEach((p) => { pMap[p.id] = p; });
  const aMap = {}; assignments.forEach((a) => { aMap[a.id] = a; });

  const drafts = batches.filter((b) => b.draft);
  const draftMap = {}; drafts.forEach((d) => { draftMap[d.employeeUid] = d; });
  const realBatches = batches.filter((b) => !b.draft);
  const batchMap = {}; realBatches.forEach((b) => { batchMap[b.id] = b; });

  const adjOf = (list) => (list || []).reduce((n, a) => n + Number(a.amount || 0), 0);

  function calcLines(sess) {
    const agg = {};
    sess.forEach((s) => {
      if (!agg[s.assignmentId]) agg[s.assignmentId] = { sec: 0, active: 0 };
      agg[s.assignmentId].sec += s.durationSeconds || 0;
      agg[s.assignmentId].active += s.activeSeconds || 0;
    });
    let pay = 0, sec = 0;
    const lines = Object.entries(agg).map(([aid, g]) => {
      const a = aMap[aid];
      const hours = g.sec / 3600;
      const calc = a ? computePay(hours, a) : { pay: 0, reg: 0, ot: 0, overLimit: 0 };
      pay += calc.pay; sec += g.sec;
      return { aid, a, g, calc };
    });
    return { lines, pay, sec };
  }

  const weekSessions = sessions.filter((s) => weekStartISO(s.date) === week);
  const byEmp = {};
  weekSessions.forEach((s) => {
    const bk = s.payrollId || 'live';
    (byEmp[s.employeeUid] = byEmp[s.employeeUid] || {});
    (byEmp[s.employeeUid][bk] = byEmp[s.employeeUid][bk] || []).push(s);
  });
  const draftUids = drafts.filter((d) => (d.adjustments || []).length).map((d) => d.employeeUid);
  const allUids = Array.from(new Set([...Object.keys(byEmp), ...draftUids]));
  let grandPay = 0, grandSec = 0;
  Object.values(byEmp).forEach((groups) => Object.values(groups).forEach((sess) => { const c = calcLines(sess); grandPay += c.pay; grandSec += c.sec; }));

  // --- mutations ---
  async function addAdjustment(uid, type, amount) {
    if (!uid || !type || amount === '') return;
    const emp = uMap[uid];
    const draft = draftMap[uid];
    const list = [...(draft ? draft.adjustments || [] : []), { label: type, amount: Number(amount) }];
    try {
      if (draft) await payrollsApi.update(draft.id, { adjustments: list });
      else await payrollsApi.insert({ employeeUid: uid, employeeName: emp ? emp.name : '', weekOf: week, draft: true, paid: false, adjustments: list });
      auditApi.log('Adjustment added', (emp ? emp.name : '') + ' · ' + type + ' ' + money(Number(amount)));
    } catch (e) { alert('Could not add: ' + (e.message || e)); }
  }
  async function removeAdjustment(uid, idx) {
    const draft = draftMap[uid];
    if (!draft) return;
    const list = (draft.adjustments || []).filter((_, i) => i !== idx);
    try { await payrollsApi.update(draft.id, { adjustments: list }); }
    catch (e) { alert('Could not remove: ' + (e.message || e)); }
  }
  async function markPaid(uid, sess, pay) {
    const draft = draftMap[uid];
    const adjustments = draft ? draft.adjustments || [] : [];
    if (!sess.length && !adjustments.length) return;
    setBusy(true);
    try {
      const emp = uMap[uid];
      const first = sess[0] ? aMap[sess[0].assignmentId] : null;
      const method = (first && first.paymentMethod) || (emp && emp.payMethod) || '';
      const row = await payrollsApi.insert({
        employeeUid: uid, employeeName: emp ? emp.name : '', weekOf: week,
        total: Number(pay.toFixed(2)), adjustments, method, paid: true,
        paidAt: new Date().toISOString(), paidBy: profile.id, sessionCount: sess.length, draft: false,
      });
      if (sess.length) await Promise.all(sess.map((s) => sessionsApi.update(s.id, { payrollId: row.id })));
      if (draft) await payrollsApi.remove(draft.id);
      auditApi.log('Marked paid', (emp ? emp.name : '') + ' · ' + money(Number(pay.toFixed(2)) + adjOf(adjustments)));
    } catch (e) { alert('Could not mark paid: ' + (e.message || e)); }
    finally { setBusy(false); }
  }
  async function toggleBatch(b) {
    try {
      await payrollsApi.update(b.id, { paid: !b.paid, paidAt: b.paid ? null : new Date().toISOString() });
      auditApi.log(b.paid ? 'Marked unpaid' : 'Marked paid', (b.employeeName || '') + ' · ' + money(b.total || 0));
    } catch (e) { alert('Could not update: ' + (e.message || e)); }
  }
  async function reopen(b, sess) {
    if (!confirm('Reopen this payment? Its entries go back to the current unpaid group and adjustments are dropped.')) return;
    setBusy(true);
    try {
      if (sess.length) await Promise.all(sess.map((s) => sessionsApi.update(s.id, { payrollId: null })));
      await payrollsApi.remove(b.id);
      auditApi.log('Payment reopened', b.employeeName || '');
    } catch (e) { alert('Could not reopen: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  async function saveEditEntry(x) {
    if (!ed.from || !ed.to) return;
    const d = fromRange(ed.date, ed.from, ed.to);
    try {
      await sessionsApi.update(x.id, { date: ed.date, weekOf: weekStartISO(ed.date), startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds, source: 'adjusted' });
      auditApi.log('Entry adjusted', (uMap[x.employeeUid] ? uMap[x.employeeUid].name : '') + ' · ' + ed.date + ' · ' + ed.from + '-' + ed.to);
      setEditId(null);
    } catch (e) { alert('Could not save: ' + (e.message || e)); }
  }
  async function addManualEntry(uid) {
    if (!nadd.assignmentId || !nadd.from || !nadd.to) { alert('Pick a project, from and to time.'); return; }
    const a = aMap[nadd.assignmentId];
    const emp = uMap[uid];
    const d = fromRange(nadd.date, nadd.from, nadd.to);
    try {
      await sessionsApi.insert({
        employeeUid: uid, employeeName: emp ? emp.name : '', projectId: a.projectId, assignmentId: a.id,
        memo: '[Manual]', weekOf: weekStartISO(nadd.date), date: nadd.date, startMs: d.startMs, endMs: d.endMs,
        durationSeconds: d.durationSeconds, activeSeconds: 0, keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0,
        breakEvents: [], manual: true, source: 'manual', isLive: false,
      });
      auditApi.log('Entry added (manual)', (emp ? emp.name : '') + ' · ' + nadd.date + ' · ' + nadd.from + '-' + nadd.to);
      setAddUid(null); setNadd({ assignmentId: '', date: '', from: '', to: '' });
    } catch (e) { alert('Could not add: ' + (e.message || e)); }
  }
  async function deleteEntry(s) {
    if (!confirm('Delete this entry?')) return;
    await sessionsApi.remove(s.id);
    auditApi.log('Entry deleted', (uMap[s.employeeUid] ? uMap[s.employeeUid].name : '') + ' · ' + s.date);
  }

  // --- CSV ---
  const csvEscape = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function exportCSV() {
    const rows = [['Employee', 'Group', 'Status', 'Project', 'Location', 'Hours', 'Regular h', 'OT h', 'Pay', 'Adjustments', 'Group total', 'Method', 'Week']];
    allUids.forEach((uid) => {
      const emp = uMap[uid];
      const groups = { ...(byEmp[uid] || {}) };
      if (!groups.live) groups.live = [];
      Object.keys(groups).forEach((k) => {
        const b = k === 'live' ? null : batchMap[k];
        const { lines, pay } = calcLines(groups[k]);
        const adjs = b ? b.adjustments || [] : draftMap[uid] ? draftMap[uid].adjustments || [] : [];
        const adj = adjOf(adjs);
        const status = b ? (b.paid ? 'Paid' : 'Closed-unpaid') : 'Open';
        const total = (b ? b.total || 0 : pay) + adj;
        lines.forEach((l) => {
          const proj = l.a && pMap[l.a.projectId] ? pMap[l.a.projectId] : { name: '(deleted)', location: '' };
          rows.push([emp ? emp.name : '', b ? 'Payment' : 'Current', status, proj.name, proj.location || '', (l.g.sec / 3600).toFixed(2), l.calc.reg.toFixed(2), l.calc.ot.toFixed(2), l.calc.pay.toFixed(2), adj.toFixed(2), total.toFixed(2), (b && b.method) || '', weekLabel(week)]);
        });
        adjs.forEach((ad) => rows.push([emp ? emp.name : '', b ? 'Payment' : 'Current', status, ad.label, '', '', '', '', ad.amount, '', '', (b && b.method) || '', weekLabel(week)]));
      });
    });
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'timesheet_' + week + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function openReceipt(uid, b, sess) {
    const emp = uMap[uid];
    const { lines, pay } = calcLines(sess);
    const adjs = b.adjustments || [];
    setReceipt({ emp, batch: b, lines, adjustments: adjs, total: (b.total || pay) + adjOf(adjs) });
  }

  function renderGroup(uid, key, sess) {
    const b = key === 'live' ? null : batchMap[key] || null;
    const orphan = key !== 'live' && !batchMap[key];
    const { lines, pay, sec } = calcLines(sess);
    const adjs = b ? b.adjustments || [] : (key === 'live' && draftMap[uid] ? draftMap[uid].adjustments || [] : []);
    const adjTotal = adjOf(adjs);
    const total = (b ? b.total || 0 : pay) + adjTotal;
    const paid = b ? b.paid : false;
    const gid = uid + '__' + key;
    const when = b && paidAtMs(b) ? fmtDT(paidAtMs(b), { day: '2-digit', month: 'short' }) : '';
    const canPay = sec > 0 || adjs.length > 0;
    return (
      <div key={gid} className="box" style={{ marginTop: 10 }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 700 }}>
              {b ? 'Payment' + (when ? ' · ' + when : '') : orphan ? 'Unlinked entries (old payment)' : 'Current (unpaid)'}{' '}
              {b ? (paid ? <span className="pill on" style={{ marginLeft: 4 }}>Paid</span> : <span className="pill wait" style={{ marginLeft: 4 }}>Closed · unpaid</span>) : <span className="pill wait" style={{ marginLeft: 4 }}>Open</span>}
            </div>
            <div className="small muted">{(sec / 3600).toFixed(2)} h ({fmtHM(sec)}) · {money(total)}{adjTotal ? ' (incl. adj.)' : ''}{b && b.method ? ' · ' + b.method : ''}</div>
          </div>
          <div className="row">
            {!b && <button className="btn-ok btn-sm" disabled={busy || !canPay} onClick={() => markPaid(uid, sess, pay)}>Mark paid</button>}
            {b && <button className={paid ? 'btn-ghost btn-sm' : 'btn-ok btn-sm'} onClick={() => toggleBatch(b)}>{paid ? 'Mark unpaid' : 'Mark paid'}</button>}
            {b && <button className="btn-ghost btn-sm" onClick={() => openReceipt(uid, b, sess)}>Receipt</button>}
            {b && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => reopen(b, sess)}>Reopen</button>}
            {sec > 0 && <button className="btn-ghost btn-sm" onClick={() => setExpanded(expanded === gid ? null : gid)}>{expanded === gid ? 'Hide' : 'Detail'}</button>}
          </div>
        </div>

        {lines.length > 0 && (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Project</th><th className="right">Hours</th><th className="right">Regular</th><th className="right">OT</th><th className="right">Pay</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.aid}>
                  <td>{l.a && pMap[l.a.projectId] ? pMap[l.a.projectId].name : '(deleted)'}</td>
                  <td className="right nowrap">{(l.g.sec / 3600).toFixed(2)}</td>
                  <td className="right nowrap">{l.calc.reg.toFixed(2)}</td>
                  <td className="right nowrap">{l.calc.ot.toFixed(2)}</td>
                  <td className="right nowrap">{money(l.calc.pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 8 }}>
          {adjs.map((ad, i) => (
            <div key={i} className="row between" style={{ padding: '2px 0' }}>
              <span className="small">{Number(ad.amount) < 0 ? '➖' : '➕'} {ad.label}</span>
              <span className="small nowrap">{money(ad.amount)} {!b && <button className="btn-danger btn-sm" style={{ padding: '1px 6px', marginLeft: 6 }} onClick={() => removeAdjustment(uid, i)}>×</button>}</span>
            </div>
          ))}
          {key === 'live' && (
            <div className="row" style={{ marginTop: 6 }}>
              <select value={adjType} onChange={(e) => setAdjType(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
                {adjTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" placeholder="+/- amount" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} style={{ flex: 1, minWidth: 90 }} />
              <button className="btn-ghost btn-sm" onClick={() => { addAdjustment(uid, adjType, adjAmount); setAdjAmount(''); }}>Add</button>
            </div>
          )}
          {adjTotal !== 0 && <div className="right small" style={{ marginTop: 4 }}>Hours {money(b ? b.total || 0 : pay)} · Adjustments {money(adjTotal)} · <b>Total {money(total)}</b></div>}
        </div>

        {!b && (
          <div style={{ marginTop: 8 }}>
            {addUid === uid ? (
              <div className="box">
                <div className="small muted" style={{ marginBottom: 6 }}>Add an entry to this group</div>
                <div className="row">
                  <select value={nadd.assignmentId} onChange={(e) => setNadd((p) => ({ ...p, assignmentId: e.target.value }))} style={{ flex: 2, minWidth: 130 }}>
                    <option value="">Project…</option>
                    {assignments.filter((x) => x.employeeUid === uid).map((x) => <option key={x.id} value={x.id}>{pMap[x.projectId] ? pMap[x.projectId].name : '(deleted)'}</option>)}
                  </select>
                  <input type="date" value={nadd.date} onChange={(e) => setNadd((p) => ({ ...p, date: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                  <input type="time" value={nadd.from} onChange={(e) => setNadd((p) => ({ ...p, from: e.target.value }))} style={{ width: 'auto' }} />
                  <input type="time" value={nadd.to} onChange={(e) => setNadd((p) => ({ ...p, to: e.target.value }))} style={{ width: 'auto' }} />
                  <button className="btn-ok btn-sm" onClick={() => addManualEntry(uid)}>Add</button>
                  <button className="btn-ghost btn-sm" onClick={() => setAddUid(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => { setAddUid(uid); setNadd({ assignmentId: '', date: dateISO(new Date()), from: '', to: '' }); }}>+ Add entry</button>
            )}
          </div>
        )}

        {(!b || expanded === gid) && sec > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Day</th><th>Project</th><th>Note</th><th className="right">Duration</th></tr></thead>
            <tbody>
              {sess.slice().sort((a, c) => (a.startMs || 0) - (c.startMs || 0)).map((s) => {
                const proj = pMap[s.projectId] ? pMap[s.projectId].name : '—';
                if (editId === s.id) return (
                  <tr key={s.id}>
                    <td className="small nowrap"><input type="date" value={ed.date} onChange={(e) => setEd((p) => ({ ...p, date: e.target.value }))} style={{ padding: '4px 6px' }} /></td>
                    <td className="small">{proj}</td>
                    <td className="small"><div className="row"><input type="time" value={ed.from} onChange={(e) => setEd((p) => ({ ...p, from: e.target.value }))} style={{ padding: '4px 6px', width: 'auto' }} /><input type="time" value={ed.to} onChange={(e) => setEd((p) => ({ ...p, to: e.target.value }))} style={{ padding: '4px 6px', width: 'auto' }} /></div></td>
                    <td className="right small nowrap"><button className="btn-ok btn-sm" style={{ padding: '2px 8px' }} onClick={() => saveEditEntry(s)}>Save</button> <button className="btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => setEditId(null)}>Cancel</button></td>
                  </tr>
                );
                return (
                  <tr key={s.id}>
                    <td className="small nowrap">{fmtDT(s.startMs, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="small">{proj}</td>
                    <td className="small muted">
                      {s.memo || '—'}
                      {s.source === 'adjusted' ? <span className="pill wait" style={{ marginLeft: 6 }}>adjusted</span> : s.source === 'manual' ? <span className="pill on" style={{ marginLeft: 6 }}>added</span> : null}
                      {breaksText(s) && <div className="small muted" style={{ marginTop: 2 }}>{breaksText(s)}</div>}
                    </td>
                    <td className="right small nowrap">
                      {fmtClock(s.durationSeconds)}
                      {!b && <> <button className="btn-ghost btn-sm" style={{ marginLeft: 6, padding: '2px 6px' }} onClick={() => { setEditId(s.id); setEd({ date: s.date, from: hhmm(s.startMs), to: hhmm(s.endMs || s.startMs) }); }}>Edit</button><button className="btn-danger btn-sm" style={{ marginLeft: 4, padding: '2px 6px' }} onClick={() => deleteEntry(s)}>×</button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  const empIds = allUids.sort((x, y) => {
    const tot = (uid) => Object.values(byEmp[uid] || {}).reduce((n, ss) => n + ss.reduce((m, s) => m + (s.durationSeconds || 0), 0), 0);
    return tot(y) - tot(x);
  });
  const co = APP_SETTINGS;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Reports / Pay</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn-ghost btn-sm" onClick={exportCSV} disabled={empIds.length === 0}>⬇ CSV</button>
          <button className="btn-ghost btn-sm" onClick={() => setWeek(addWeeks(week, -1))}>← Previous</button>
          <span className="small nowrap">{weekLabel(week)}</span>
          <button className="btn-ghost btn-sm" disabled={week >= thisWeekStart()} onClick={() => setWeek(addWeeks(week, 1))}>Next →</button>
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="stat"><div className="n">{(grandSec / 3600).toFixed(2)} h</div><div className="l">Team total</div></div>
        <div className="stat"><div className="n">{money(grandPay)}</div><div className="l">Estimated payroll</div></div>
        <div className="stat"><div className="n">{empIds.length}</div><div className="l">Active employees</div></div>
      </div>

      <div className="box" style={{ marginTop: 14 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>Add a standalone bonus / advance / deduction (before it's paid)</div>
        <div className="row">
          <select value={sa.uid} onChange={(e) => setSa((p) => ({ ...p, uid: e.target.value }))} style={{ flex: 2, minWidth: 140 }}>
            <option value="">Employee…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={sa.type} onChange={(e) => setSa((p) => ({ ...p, type: e.target.value }))} style={{ flex: 1, minWidth: 110 }}>
            {adjTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" placeholder="+/- amount" value={sa.amount} onChange={(e) => setSa((p) => ({ ...p, amount: e.target.value }))} style={{ flex: 1, minWidth: 90 }} />
          <button className="btn-ghost btn-sm" disabled={!sa.uid || sa.amount === ''} onClick={() => { addAdjustment(sa.uid, sa.type, sa.amount); setSa((p) => ({ ...p, amount: '' })); }}>Add</button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>Use a negative amount for advances/deductions. The employee then appears below where you can pay it.</div>
      </div>

      {empIds.length === 0 && <p className="muted" style={{ marginTop: 14 }}>No time or payments this week.</p>}
      {empIds.map((uid) => {
        const groups = { ...(byEmp[uid] || {}) };
        if (!groups.live) groups.live = [];
        const keys = Object.keys(groups).sort((a, b) => (a === 'live' ? -1 : b === 'live' ? 1 : 0));
        const emp = uMap[uid];
        return (
          <div key={uid} style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{emp ? emp.name : '—'}</div>
            {keys.map((k) => renderGroup(uid, k, groups[k]))}
          </div>
        );
      })}

      <p className="small muted" style={{ marginTop: 14 }}>
        Add bonuses/advances/deductions to a payment while it is still "Current (unpaid)". Once you Mark it paid they are locked in and appear on the receipt. Week based on the configured start day and time zone.
      </p>

      {receipt && (
        <div className="rcpt-overlay" onClick={() => setReceipt(null)}>
          <div className="rcpt-print" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{co.companyName || 'Payment receipt'}</div>
            {co.companyName && <div className="small muted">Payment receipt</div>}
            {co.companyAddress && <div className="small">{co.companyAddress}</div>}
            <div className="small">
              {co.companyTaxId ? 'Tax ID / RTN: ' + co.companyTaxId : ''}
              {co.companyPhone ? '  ·  ' + co.companyPhone : ''}
              {co.companyEmail ? '  ·  ' + co.companyEmail : ''}
            </div>
            <div className="hr" style={{ background: '#ddd' }} />
            <div><b>Employee:</b> {receipt.emp ? receipt.emp.name : '—'}{receipt.emp && receipt.emp.city ? ' · ' + receipt.emp.city : ''}</div>
            {receipt.emp && receipt.emp.payMethod ? <div className="small"><b>Pay to:</b> {receipt.emp.payMethod}{receipt.emp.payDetails ? ' · ' + receipt.emp.payDetails : ''}</div> : null}
            <div className="small muted">
              Period: {weekLabel(week)}
              {receipt.batch && paidAtMs(receipt.batch) ? '  ·  Paid ' + fmtDT(paidAtMs(receipt.batch), { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
              {receipt.batch && receipt.batch.method ? '  ·  ' + receipt.batch.method : ''}
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Project</th><th>Location</th><th className="right">Hours</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {receipt.lines.map((l) => {
                  const p = l.a && pMap[l.a.projectId] ? pMap[l.a.projectId] : { name: '(deleted)', location: '' };
                  return <tr key={l.aid}><td>{p.name}</td><td>{p.location || '—'}</td><td className="right">{(l.g.sec / 3600).toFixed(2)}</td><td className="right">{money(l.calc.pay)}</td></tr>;
                })}
                {receipt.adjustments.map((ad, i) => <tr key={'a' + i}><td>{ad.label}</td><td>—</td><td className="right">—</td><td className="right">{money(ad.amount)}</td></tr>)}
              </tbody>
            </table>
            <div className="right" style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}>Total: {money(receipt.total)}</div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
              <div className="small muted">_______________________<br />Employee signature</div>
              <div className="small muted" style={{ textAlign: 'right' }}>_______________________<br />Authorized by</div>
            </div>
            <div className="row rcpt-noprint" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn-ghost btn-sm" onClick={() => setReceipt(null)}>Close</button>
              <button className="btn-sm" onClick={() => window.print()}>Print / Save PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
