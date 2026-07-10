import { useState } from 'react';
import { assignments as assignmentsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, money } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';

export default function ManagerAssignments({ users, projects, assignments }) {
  const t = useT();
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
    if (!f.employeeUid || !f.projectId) { setErr(t('mgr.asn.errPick')); return; }
    if (f.hourlyRate === '') { setErr(t('mgr.asn.errRate')); return; }
    const dup = assignments.find((a) => a.employeeUid === f.employeeUid && a.projectId === f.projectId && a.id !== editId);
    if (dup) { setErr(t('mgr.asn.errDup')); return; }
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
        <h2>{editId ? t('mgr.asn.editTitle') : t('mgr.asn.newTitle')}</h2>
        {err && <div className="banner err">{err}</div>}
        <div className="grid g2">
          <div>
            <label>{t('mgr.asn.employee')}</label>
            <select value={f.employeeUid} onChange={(e) => upd('employeeUid', e.target.value)}>
              <option value="">{t('mgr.asn.pick')}</option>
              {employees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? t('mgr.asn.managerSuffix') : ''}</option>)}
            </select>
          </div>
          <div>
            <label>{t('mgr.asn.project')}</label>
            <select value={f.projectId} onChange={(e) => upd('projectId', e.target.value)}>
              <option value="">{t('mgr.asn.pick')}</option>
              {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid g4" style={{ marginTop: 4 }}>
          <div><label>{t('mgr.asn.rate', { cur: APP_SETTINGS.currency })}</label><input type="number" value={f.hourlyRate} onChange={(e) => upd('hourlyRate', e.target.value)} placeholder="10" /></div>
          <div><label>{t('mgr.asn.otRate', { cur: APP_SETTINGS.currency })}</label><input type="number" value={f.overtimeRate} onChange={(e) => upd('overtimeRate', e.target.value)} placeholder="15" /></div>
          <div><label>{t('mgr.asn.otAfter')}</label><input type="number" value={f.overtimeThreshold} onChange={(e) => upd('overtimeThreshold', e.target.value)} placeholder="44" /></div>
          <div><label>{t('mgr.asn.weeklyLimit')}</label><input type="number" value={f.weeklyLimit} onChange={(e) => upd('weeklyLimit', e.target.value)} placeholder={t('mgr.asn.optional')} /></div>
        </div>
        <label style={{ marginTop: 4 }}>{t('mgr.asn.payMethod')}</label>
        <select value={f.paymentMethod} onChange={(e) => upd('paymentMethod', e.target.value)}>
          <option value="">{t('mgr.asn.none')}</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={save}>{editId ? t('common.saveChanges') : t('mgr.asn.assign')}</button>
          {editId && <button className="btn-ghost" onClick={cancel}>{t('common.cancel')}</button>}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {t('mgr.asn.foot')}
        </p>
      </div>

      <div className="card">
        <h2>{t('mgr.tab.assign')}</h2>
        {assignments.length === 0 ? <p className="muted">{t('mgr.asn.empty')}</p> : (
          <table>
            <thead>
              <tr>
                <th>{t('mgr.asn.employee')}</th><th>{t('mgr.asn.project')}</th><th className="right">{t('mgr.asn.colRate')}</th><th className="right">{t('mgr.asn.colOt')}</th>
                <th className="right">{t('mgr.asn.colOtAfter')}</th><th className="right">{t('mgr.asn.colLimit')}</th><th>{t('mgr.asn.colPay')}</th><th></th>
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
                    <button className="btn-ghost btn-sm" onClick={() => startEdit(a)}>{t('common.edit')}</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => { if (confirm(t('mgr.asn.removeConfirm'))) assignmentsApi.remove(a.id); }}>{t('common.remove')}</button>
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
