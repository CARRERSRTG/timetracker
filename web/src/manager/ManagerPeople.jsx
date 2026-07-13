import { useEffect, useState } from 'react';
import {
  profiles as profilesApi,
  audit as auditApi,
  auth,
} from '@shared/lib/supabase.js';
import { useT } from '../lib/i18n.js';

// Single "Team" view: creates accounts, edits people, sets each employee's
// tracking config, and manages status/role — the former People and Users tabs
// merged into one. NOTE: schema profiles has no `phone` column (dropped in the
// port). `active`, worker_type, track_mode, breaks_enabled all exist.
export default function ManagerPeople({ users, me }) {
  const t = useT();
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  async function changeRole(u, newRole) {
    if (u.role === newRole) return;
    if (u.role === 'admin' && newRole === 'employee' && adminCount <= 1) {
      alert(t('mgr.ppl.needManager'));
      return;
    }
    if (u.id === me.id && newRole === 'employee' && !confirm(t('mgr.ppl.confirmSelfDemote'))) return;
    await profilesApi.update(u.id, { role: newRole });
    auditApi.log('Role change', u.name + ' → ' + (newRole === 'admin' ? 'Manager' : 'Employee'));
  }

  function setField(u, field, val) { profilesApi.update(u.id, { [field]: val }); }

  async function saveName(u) {
    if (editName.trim().length < 2) return;
    await profilesApi.update(u.id, { name: editName.trim() });
    auditApi.log('Name changed', u.name + ' → ' + editName.trim());
    setEditId(null);
  }

  async function toggleActive(u) {
    if (u.id === me.id) { alert(t('mgr.ppl.noSelfDeactivate')); return; }
    const willBeActive = u.active === false;
    await profilesApi.update(u.id, { active: willBeActive });
    auditApi.log(willBeActive ? 'Employee reactivated' : 'Employee deactivated', u.name);
  }

  async function removeUser(u) {
    if (u.id === me.id) { alert(t('mgr.ppl.noSelfDelete')); return; }
    if (u.role === 'admin' && adminCount <= 1) { alert(t('mgr.ppl.noDeleteOnlyMgr')); return; }
    if (!confirm(t('mgr.ppl.deleteConfirm', { name: u.name }))) return;
    try {
      // Soft delete: hide from the active list but KEEP their login and all
      // payment/time history. Restorable from "Removed accounts" below.
      await profilesApi.softDelete(u.id);
      auditApi.log('Employee removed', u.name);
    } catch (e) {
      alert(t('mgr.ppl.deleteFail', { e: e.message || e }));
    }
  }

  const others = users.filter((u) => u.id !== me.id);
  return (
    <>
      <NewUser />
      <div className="card">
        <h2>{t('mgr.tab.people')}</h2>
        {others.length === 0 && (
          <div className="banner info">
            {t('mgr.ppl.onlyUser')}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t('mgr.ppl.colName')}</th><th>{t('mgr.usr.colEmail')}</th><th>{t('mgr.ppl.colCity')}</th><th>{t('mgr.ppl.colPayTo')}</th><th>{t('mgr.ppl.colRole')}</th><th>{t('mgr.ppl.colType')}</th>
                <th>{t('mgr.ppl.colTracking')}</th><th>{t('mgr.ppl.colBreak')}</th><th>{t('mgr.ppl.colStatus')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const inactive = u.active === false;
                return (
                  <tr key={u.id} style={inactive ? { opacity: 0.55 } : null}>
                    <td className="nowrap">
                      {editId === u.id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ padding: '4px 8px', width: 140 }} />
                          <button className="btn-ok btn-sm" onClick={() => saveName(u)}>{t('common.save')}</button>
                          <button className="btn-ghost btn-sm" onClick={() => setEditId(null)}>×</button>
                        </span>
                      ) : (
                        <>{u.name}{u.id === me.id && <span className="muted">{t('mgr.ppl.you')}</span>}
                          <button className="link" style={{ marginLeft: 6 }} onClick={() => { setEditId(u.id); setEditName(u.name || ''); }}>{t('mgr.usr.editLink')}</button></>
                      )}
                    </td>
                    <td className="small muted">{u.email || '—'}</td>
                    <td className="muted">{u.city || '—'}</td>
                    <td className="small muted">{u.payMethod ? u.payMethod + (u.payDetails ? ' · ' + u.payDetails : '') : '—'}</td>
                    <td>
                      <select value={u.role} style={{ width: 'auto', minWidth: 120 }} onChange={(e) => changeRole(u, e.target.value)}>
                        <option value="employee">{t('shell.employee')}</option>
                        <option value="admin">{t('shell.manager')}</option>
                      </select>
                    </td>
                    <td>
                      <select value={u.workerType || ''} style={{ width: 'auto', minWidth: 120 }} onChange={(e) => setField(u, 'workerType', e.target.value || null)}>
                        <option value="">{t('mgr.ppl.default')}</option>
                        <option value="remote">{t('track.remote')}</option>
                        <option value="inhouse">{t('track.inhouse')}</option>
                      </select>
                    </td>
                    <td>
                      <select value={u.trackMode || ''} style={{ width: 'auto', minWidth: 150 }} onChange={(e) => setField(u, 'trackMode', e.target.value || null)}>
                        <option value="">{t('mgr.ppl.default')}</option>
                        <option value="activity">{t('mgr.ppl.trackActivity')}</option>
                        <option value="inout">{t('mgr.ppl.trackInout')}</option>
                      </select>
                    </td>
                    <td>
                      <select value={u.breaksEnabled || ''} style={{ width: 'auto', minWidth: 110 }} onChange={(e) => setField(u, 'breaksEnabled', e.target.value || null)}>
                        <option value="">{t('mgr.ppl.default')}</option>
                        <option value="yes">{t('common.yes')}</option>
                        <option value="no">{t('common.no')}</option>
                      </select>
                    </td>
                    <td className="nowrap">
                      {inactive
                        ? <span className="pill off" title={t('mgr.ppl.pendingHint')}>{t('mgr.ppl.inactive')}</span>
                        : <span className="pill on">{t('mgr.ppl.active')}</span>}
                      {u.id !== me.id && (
                        <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleActive(u)}>
                          {inactive ? t('mgr.ppl.activate') : t('mgr.ppl.deactivate')}
                        </button>
                      )}
                    </td>
                    <td>{u.id !== me.id && <button className="btn-danger btn-sm" onClick={() => removeUser(u)}>{t('common.delete')}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {t('mgr.ppl.foot')}
        </p>
      </div>
      <DeletedUsers activeCount={users.length} />
    </>
  );
}

// Soft-deleted accounts, with restore. These aren't in the live `users` list
// (it filters them out), so we load them on demand and reload after any change.
function DeletedUsers({ activeCount }) {
  const t = useT();
  const [deleted, setDeleted] = useState([]);
  const [busy, setBusy] = useState(false);
  async function load() {
    try { setDeleted(await profilesApi.listDeleted()); }
    catch { /* non-fatal */ }
  }
  useEffect(() => { load(); }, [activeCount]);
  async function restore(u) {
    setBusy(true);
    try { await profilesApi.restore(u.id); auditApi.log('Employee restored', u.name); await load(); }
    catch (e) { alert(t('mgr.usr.restoreFail', { e: e.message || e })); }
    finally { setBusy(false); }
  }
  async function purge(u) {
    if (!confirm(t('mgr.usr.purgeConfirm', { name: u.name }))) return;
    setBusy(true);
    try { await auth.deleteUserFully(u.id); auditApi.log('Employee deleted permanently', u.name); await load(); }
    catch (e) { alert(t('mgr.usr.purgeFail', { e: e.message || e })); }
    finally { setBusy(false); }
  }
  if (!deleted.length) return null;
  return (
    <div className="card">
      <h2>{t('mgr.usr.deletedTitle')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('mgr.usr.deletedNote')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>{t('mgr.ppl.colName')}</th><th>{t('mgr.usr.colEmail')}</th><th>{t('mgr.usr.colDeleted')}</th><th></th></tr></thead>
          <tbody>
            {deleted.map((u) => (
              <tr key={u.id} style={{ opacity: 0.7 }}>
                <td>{u.name}</td>
                <td className="small muted">{u.email || '—'}</td>
                <td className="small muted nowrap">{u.deletedAt ? new Date(u.deletedAt).toLocaleDateString() : '—'}</td>
                <td className="nowrap">
                  <button className="btn-ok btn-sm" disabled={busy} onClick={() => restore(u)}>{t('common.restore')}</button>
                  <button className="btn-danger btn-sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => purge(u)}>{t('mgr.usr.purgeBtn')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewUser() {
  const t = useT();
  const [f, setF] = useState({ email: '', name: '', password: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function create() {
    setMsg(''); setErr('');
    if (!f.email.trim() || f.name.trim().length < 2 || f.password.length < 6) { setErr(t('mgr.usr.newErr')); return; }
    setBusy(true);
    try {
      await auth.adminCreateUser(f);
      setMsg(t('mgr.usr.created', { email: f.email.trim() }));
      setF({ email: '', name: '', password: '' });
    } catch (e) { setErr(e.message || t('mgr.usr.createFail')); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>{t('mgr.usr.newTitle')}</h2>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      <div className="grid g3">
        <div><label>{t('mgr.usr.email')}</label><input type="email" value={f.email} onChange={(e) => upd('email', e.target.value)} placeholder="person@example.com" /></div>
        <div><label>{t('mgr.ppl.colName')}</label><input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder={t('mgr.usr.namePh')} /></div>
        <div><label>{t('mgr.usr.tempPw')}</label><input type="text" value={f.password} onChange={(e) => upd('password', e.target.value)} placeholder={t('mgr.usr.pwPh')} /></div>
      </div>
      <button style={{ marginTop: 12 }} disabled={busy} onClick={create}>{busy ? t('mgr.usr.creating') : t('mgr.usr.createBtn')}</button>
    </div>
  );
}
