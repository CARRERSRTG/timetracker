import {
  profiles as profilesApi,
  assignments as assignmentsApi,
  audit as auditApi,
} from '@shared/lib/supabase.js';
import { useT } from '../lib/i18n.js';

// NOTE: schema profiles has no `phone` column (dropped in the port). `active`,
// worker_type, track_mode, breaks_enabled all exist.
export default function ManagerPeople({ users, me }) {
  const t = useT();
  const adminCount = users.filter((u) => u.role === 'admin').length;

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
      const asn = await assignmentsApi.listByEmployee(u.id);
      await Promise.all(asn.map((a) => assignmentsApi.remove(a.id)));
      await profilesApi.remove(u.id);
      auditApi.log('Employee removed', u.name);
    } catch (e) {
      alert(t('mgr.ppl.deleteFail', { e: e.message || e }));
    }
  }

  const others = users.filter((u) => u.id !== me.id);
  return (
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
              <th>{t('mgr.ppl.colName')}</th><th>{t('mgr.ppl.colCity')}</th><th>{t('mgr.ppl.colPayTo')}</th><th>{t('mgr.ppl.colRole')}</th><th>{t('mgr.ppl.colType')}</th>
              <th>{t('mgr.ppl.colTracking')}</th><th>{t('mgr.ppl.colBreak')}</th><th>{t('mgr.ppl.colStatus')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const inactive = u.active === false;
              return (
                <tr key={u.id} style={inactive ? { opacity: 0.55 } : null}>
                  <td className="nowrap">{u.name}{u.id === me.id && <span className="muted">{t('mgr.ppl.you')}</span>}</td>
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
                    {inactive ? <span className="pill off">{t('mgr.ppl.inactive')}</span> : <span className="pill on">{t('mgr.ppl.active')}</span>}
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
  );
}
