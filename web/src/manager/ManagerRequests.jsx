import { sessions as sessionsApi, requests as requestsApi, audit as auditApi } from '@shared/lib/supabase.js';
import { fmtClock, weekStartISO } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';

// English labels for the audit log (records stay in one language).
const LABEL = { add: 'Add time', adjust: 'Adjust time', delete: 'Delete time' };

function tParse(t) { if (!t) return 0; const p = t.split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
function fromRange(date, fromTime, toTime) {
  let d = tParse(toTime) - tParse(fromTime);
  if (d < 0) d += 1440;
  const durationSeconds = d * 60;
  const ft = String(fromTime).length === 5 ? fromTime : '0' + fromTime;
  const startMs = new Date(date + 'T' + ft + ':00').getTime();
  return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
}

export default function ManagerRequests({ profile, requests, projects, assignments }) {
  const t = useT();
  const rLabel = (type) => t('reqtype.' + type);
  const aMap = {};
  assignments.forEach((a) => { aMap[a.id] = a; });
  const projName = (a) => (a && projects[a.projectId] ? projects[a.projectId].name : '—');

  const pending = requests.filter((r) => r.status === 'pending').sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const history = requests.filter((r) => r.status !== 'pending').sort((a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0)).slice(0, 30);

  async function accept(r) {
    const p = r.payload || {};
    try {
      if (r.type === 'add') {
        let d;
        if (p.fromTime && p.toTime) d = fromRange(p.date, p.fromTime, p.toTime);
        else { const dur = Math.round((p.hours || 0) * 3600); const s = Date.parse(p.date + 'T12:00:00Z'); d = { durationSeconds: dur, startMs: s, endMs: s + dur * 1000 }; }
        await sessionsApi.insert({
          employeeUid: r.employeeUid,
          employeeName: p.employeeName,
          projectId: p.projectId,
          assignmentId: p.assignmentId,
          memo: p.reason ? '[Manual] ' + p.reason : '[Time added]',
          weekOf: weekStartISO(p.date),
          date: p.date,
          startMs: d.startMs,
          endMs: d.endMs,
          durationSeconds: d.durationSeconds,
          keystrokes: 0, clicks: 0, activeSeconds: 0,
          manual: true, source: 'manual', isLive: false,
        });
      } else if (r.type === 'adjust') {
        if (p.fromTime && p.toTime) {
          const d = fromRange(p.date, p.fromTime, p.toTime);
          await sessionsApi.update(p.sessionId, { date: p.date, weekOf: weekStartISO(p.date), startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds, source: 'adjusted' });
        } else {
          await sessionsApi.update(p.sessionId, { durationSeconds: Math.round((p.hours || 0) * 3600), source: 'adjusted' });
        }
      } else if (r.type === 'delete') {
        await sessionsApi.remove(p.sessionId);
      }
      await requestsApi.update(r.id, { status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: profile.id });
      auditApi.log('Request approved', LABEL[r.type] + ' · ' + (p.employeeName || '') + ' · ' + p.date + (p.hours ? ' · ' + p.hours + 'h' : ''));
    } catch (e) {
      alert(t('mgr.req.applyFail', { e: e.message || e }));
    }
  }

  async function reject(r) {
    const p = r.payload || {};
    await requestsApi.update(r.id, { status: 'rejected', resolvedAt: new Date().toISOString(), resolvedBy: profile.id });
    auditApi.log('Request rejected', LABEL[r.type] + ' · ' + (p.employeeName || '') + ' · ' + p.date);
  }

  return (
    <>
      <div className="card">
        <h2>{t('mgr.req.pendingTitle')}</h2>
        {pending.length === 0 ? <p className="muted">{t('mgr.req.noPending')}</p> : pending.map((r) => {
          const p = r.payload || {};
          const a = aMap[p.assignmentId];
          return (
            <div className="box" key={r.id} style={{ marginBottom: 10 }}>
              <div className="between">
                <div>
                  <div style={{ fontWeight: 700 }}>{p.employeeName} · {rLabel(r.type)}</div>
                  <div className="small muted">
                    {projName(a)} · {p.date}
                    {r.type === 'add' && (p.fromTime ? <> · {p.fromTime}–{p.toTime} (<b>{p.hours} h</b>)</> : <> · <b>{p.hours} h</b></>)}
                    {r.type === 'adjust' && <> · {fmtClock(p.oldSeconds || 0)} → {p.fromTime ? <>{p.fromTime}–{p.toTime} (<b>{p.hours} h</b>)</> : <b>{p.hours} h</b>}</>}
                    {p.reason ? <> · "{p.reason}"</> : null}
                  </div>
                </div>
                <div className="row">
                  <button className="btn-ok btn-sm" onClick={() => accept(r)}>{t('mgr.req.accept')}</button>
                  <button className="btn-danger btn-sm" onClick={() => reject(r)}>{t('mgr.req.reject')}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>{t('mgr.req.history')}</h2>
        {history.length === 0 ? <p className="muted">{t('mgr.req.noHistory')}</p> : (
          <table>
            <thead><tr><th>{t('mgr.asn.employee')}</th><th>{t('mgr.req.colType')}</th><th>{t('mgr.req.colDetail')}</th><th>{t('mgr.req.colStatus')}</th></tr></thead>
            <tbody>
              {history.map((r) => {
                const p = r.payload || {};
                const a = aMap[p.assignmentId];
                return (
                  <tr key={r.id}>
                    <td>{p.employeeName}</td>
                    <td>{rLabel(r.type)}</td>
                    <td className="small muted">{projName(a)} · {p.date}{r.type !== 'delete' && p.hours ? ' · ' + p.hours + ' h' : ''}</td>
                    <td>{r.status === 'approved' ? <span className="pill on">{t('mgr.req.approved')}</span> : <span className="pill off">{t('mgr.req.rejected')}</span>}</td>
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
