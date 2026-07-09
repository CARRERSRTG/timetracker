import { useState } from 'react';
import {
  profiles as profilesApi,
  assignments as assignmentsApi,
  audit as auditApi,
  auth,
} from '@shared/lib/supabase.js';

// NOTE: schema profiles has no `phone` column (dropped in the port). `active`,
// worker_type, track_mode, breaks_enabled all exist.
export default function ManagerPeople({ users, me }) {
  const adminCount = users.filter((u) => u.role === 'admin').length;

  async function changeRole(u, newRole) {
    if (u.role === newRole) return;
    if (u.role === 'admin' && newRole === 'employee' && adminCount <= 1) {
      alert('You cannot leave the system without any manager. Promote someone else to manager first.');
      return;
    }
    if (u.id === me.id && newRole === 'employee' && !confirm('You are about to remove your own manager role and lose admin access. Are you sure?')) return;
    await profilesApi.update(u.id, { role: newRole });
    auditApi.log('Role change', u.name + ' → ' + (newRole === 'admin' ? 'Manager' : 'Employee'));
  }

  function setField(u, field, val) { profilesApi.update(u.id, { [field]: val }); }

  async function toggleActive(u) {
    if (u.id === me.id) { alert('You cannot deactivate yourself.'); return; }
    const willBeActive = u.active === false;
    await profilesApi.update(u.id, { active: willBeActive });
    auditApi.log(willBeActive ? 'Employee reactivated' : 'Employee deactivated', u.name);
  }

  async function removeUser(u) {
    if (u.id === me.id) { alert('You cannot delete yourself.'); return; }
    if (u.role === 'admin' && adminCount <= 1) { alert('Cannot delete the only manager.'); return; }
    if (!confirm('Delete ' + u.name + ' and their project assignments?\n\nTheir already tracked time stays in reports. This cannot be undone. To just block access, use Deactivate instead.')) return;
    try {
      const asn = await assignmentsApi.listByEmployee(u.id);
      await Promise.all(asn.map((a) => assignmentsApi.remove(a.id)));
      await profilesApi.remove(u.id);
      auditApi.log('Employee removed', u.name);
    } catch (e) {
      alert('Could not delete: ' + (e.message || e));
    }
  }

  const others = users.filter((u) => u.id !== me.id);
  return (
    <>
      <NewEmployee />
      <div className="card">
      <h2>Employees</h2>
      {others.length === 0 && (
        <div className="banner info">
          You're the only user so far. To add employees, have them register from the sign-in screen. They'll then show up here to configure.
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>City</th><th>Pay to</th><th>Role</th><th>Type</th>
              <th>Tracking</th><th>Lunch/break</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const inactive = u.active === false;
              return (
                <tr key={u.id} style={inactive ? { opacity: 0.55 } : null}>
                  <td className="nowrap">{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{u.city || '—'}</td>
                  <td className="small muted">{u.payMethod ? u.payMethod + (u.payDetails ? ' · ' + u.payDetails : '') : '—'}</td>
                  <td>
                    <select value={u.role} style={{ width: 'auto', minWidth: 120 }} onChange={(e) => changeRole(u, e.target.value)}>
                      <option value="employee">Employee</option>
                      <option value="admin">Manager</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.workerType || ''} style={{ width: 'auto', minWidth: 120 }} onChange={(e) => setField(u, 'workerType', e.target.value || null)}>
                      <option value="">(default)</option>
                      <option value="remote">Remote</option>
                      <option value="inhouse">In-house</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.trackMode || ''} style={{ width: 'auto', minWidth: 150 }} onChange={(e) => setField(u, 'trackMode', e.target.value || null)}>
                      <option value="">(default)</option>
                      <option value="activity">Activity</option>
                      <option value="inout">Clock in/out only</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.breaksEnabled || ''} style={{ width: 'auto', minWidth: 110 }} onChange={(e) => setField(u, 'breaksEnabled', e.target.value || null)}>
                      <option value="">(default)</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </td>
                  <td className="nowrap">
                    {inactive ? <span className="pill off">Inactive</span> : <span className="pill on">Active</span>}
                    {u.id !== me.id && (
                      <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleActive(u)}>
                        {inactive ? 'Activate' : 'Deactivate'}
                      </button>
                    )}
                  </td>
                  <td>{u.id !== me.id && <button className="btn-danger btn-sm" onClick={() => removeUser(u)}>Delete</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        "(default)" uses the value in Settings. <b>Deactivate</b> blocks a person's access but keeps everything. <b>Delete</b> removes their profile and assignments. "Pay to" is set by each employee in their account and appears on receipts.
      </p>
      </div>
    </>
  );
}

function NewEmployee() {
  const [f, setF] = useState({ email: '', name: '', password: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function create() {
    setMsg(''); setErr('');
    if (!f.email.trim() || f.name.trim().length < 2 || f.password.length < 6) {
      setErr('Enter an email, a name, and a temporary password (6+ chars).');
      return;
    }
    setBusy(true);
    try {
      await auth.adminCreateUser(f);
      setMsg(`Invited ${f.email.trim()}. They'll get a confirmation email; after they confirm, activate them below.`);
      setF({ email: '', name: '', password: '' });
    } catch (e) { setErr(e.message || 'Could not create the user.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>Add an employee</h2>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      <div className="grid g3">
        <div><label>Email</label><input type="email" value={f.email} onChange={(e) => upd('email', e.target.value)} placeholder="person@example.com" /></div>
        <div><label>Name</label><input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder="Full name" /></div>
        <div><label>Temporary password</label><input type="text" value={f.password} onChange={(e) => upd('password', e.target.value)} placeholder="they can change it later" /></div>
      </div>
      <button style={{ marginTop: 12 }} disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create & send confirmation'}</button>
      <p className="small muted" style={{ marginTop: 8 }}>
        They receive a confirmation email. After they confirm, activate their account below. Share the temporary password with them (they can change it in My account).
      </p>
    </div>
  );
}
