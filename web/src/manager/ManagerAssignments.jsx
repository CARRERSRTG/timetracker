import { useState } from 'react';
import { assignments as assignmentsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, money } from '../lib/helpers.js';

export default function ManagerAssignments({ users, projects, assignments }) {
  const employees = users;
  const activeProjects = projects.filter((p) => !p.archived);
  const empty = {
    employeeUid: '', projectId: '', hourlyRate: '', overtimeRate: '',
    overtimeThreshold: '', weeklyLimit: '', paymentMethod: '',
  };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState('');
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const methods = APP_SETTINGS.paymentMethods || [];

  function startEdit(a) {
    setEditId(a.id);
    setF({
      employeeUid: a.employeeUid, projectId: a.projectId,
      hourlyRate: a.hourlyRate ?? '', overtimeRate: a.overtimeRate ?? '',
      overtimeThreshold: a.overtimeThreshold ?? '', weeklyLimit: a.weeklyLimit ?? '',
      paymentMethod: a.paymentMethod || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancel() { setEditId(null); setF(empty); setErr(''); }

  async function save() {
    setErr('');
    if (!f.employeeUid || !f.projectId) { setErr('Pick an employee and a project.'); return; }
    if (f.hourlyRate === '') { setErr('Enter the hourly rate.'); return; }
    const dup = assignments.find((a) => a.employeeUid === f.employeeUid && a.projectId === f.projectId && a.id !== editId);
    if (dup) { setErr('That employee is already assigned to that project.'); return; }
    // NOTE: numeric columns must be null (not '') when empty; assignments has no
    // employee_name column in our schema, so we don't write one.
    const data = {
      employeeUid: f.employeeUid,
      projectId: f.projectId,
      hourlyRate: Number(f.hourlyRate) || 0,
      overtimeRate: f.overtimeRate === '' ? Number(f.hourlyRate) || 0 : Number(f.overtimeRate),
      overtimeThreshold: f.overtimeThreshold === '' ? null : Number(f.overtimeThreshold),
      weeklyLimit: f.weeklyLimit === '' ? null : Number(f.weeklyLimit),
      paymentMethod: f.paymentMethod || null,
    };
    try {
      if (editId) await assignmentsApi.update(editId, data);
      else await assignmentsApi.insert(data);
      cancel();
    } catch (e) { setErr(e.message || String(e)); }
  }

  const pMap = {}; projects.forEach((p) => { pMap[p.id] = p; });
  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });

  return (
    <>
      <div className="card">
        <h2>{editId ? 'Edit assignment' : 'New assignment'}</h2>
        {err && <div className="banner err">{err}</div>}
        <div className="grid g2">
          <div>
            <label>Employee</label>
            <select value={f.employeeUid} onChange={(e) => upd('employeeUid', e.target.value)}>
              <option value="">Pick…</option>
              {employees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (manager)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label>Project</label>
            <select value={f.projectId} onChange={(e) => upd('projectId', e.target.value)}>
              <option value="">Pick…</option>
              {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid g4" style={{ marginTop: 4 }}>
          <div><label>Rate/hour ({APP_SETTINGS.currency})</label><input type="number" value={f.hourlyRate} onChange={(e) => upd('hourlyRate', e.target.value)} placeholder="10" /></div>
          <div><label>Overtime rate ({APP_SETTINGS.currency})</label><input type="number" value={f.overtimeRate} onChange={(e) => upd('overtimeRate', e.target.value)} placeholder="15" /></div>
          <div><label>Overtime after (h/week)</label><input type="number" value={f.overtimeThreshold} onChange={(e) => upd('overtimeThreshold', e.target.value)} placeholder="44" /></div>
          <div><label>Weekly limit (h)</label><input type="number" value={f.weeklyLimit} onChange={(e) => upd('weeklyLimit', e.target.value)} placeholder="optional" /></div>
        </div>
        <label style={{ marginTop: 4 }}>Payment method</label>
        <select value={f.paymentMethod} onChange={(e) => upd('paymentMethod', e.target.value)}>
          <option value="">(none)</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={save}>{editId ? 'Save changes' : 'Assign'}</button>
          {editId && <button className="btn-ghost" onClick={cancel}>Cancel</button>}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          The overtime rate applies to hours above the threshold. Time above the weekly limit is not paid.
        </p>
      </div>

      <div className="card">
        <h2>Assignments</h2>
        {assignments.length === 0 ? <p className="muted">No assignments yet.</p> : (
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Project</th><th className="right">Rate</th><th className="right">OT</th>
                <th className="right">OT after</th><th className="right">Limit</th><th>Payment</th><th></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td>{uMap[a.employeeUid] ? uMap[a.employeeUid].name : '—'}</td>
                  <td>{pMap[a.projectId] ? pMap[a.projectId].name : '(deleted)'}</td>
                  <td className="right nowrap">{money(a.hourlyRate)}</td>
                  <td className="right nowrap">{money(a.overtimeRate)}</td>
                  <td className="right nowrap">{a.overtimeThreshold == null ? '—' : a.overtimeThreshold + 'h'}</td>
                  <td className="right nowrap">{a.weeklyLimit == null ? '—' : a.weeklyLimit + 'h'}</td>
                  <td className="small muted">{a.paymentMethod || '—'}</td>
                  <td className="right nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => startEdit(a)}>Edit</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => { if (confirm('Remove this assignment?')) assignmentsApi.remove(a.id); }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
