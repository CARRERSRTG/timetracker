import { useState } from 'react';
import {
  profiles as profilesApi,
  assignments as assignmentsApi,
  audit as auditApi,
  auth,
} from '@shared/lib/supabase.js';

// Account management: create / edit / delete user accounts. (The Employees tab
// stays focused on per-employee tracking config.)
export default function ManagerUsers({ users, me }) {
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  async function changeRole(u, newRole) {
    if (u.role === newRole) return;
    if (u.role === 'admin' && newRole === 'employee' && adminCount <= 1) { alert('Promote someone else to manager first.'); return; }
    if (u.id === me.id && newRole === 'employee' && !confirm('Remove your own manager role and lose admin access?')) return;
    await profilesApi.update(u.id, { role: newRole });
    auditApi.log('Role change', u.name + ' → ' + (newRole === 'admin' ? 'Manager' : 'Employee'));
  }
  async function toggleActive(u) {
    if (u.id === me.id) { alert('You cannot deactivate yourself.'); return; }
    const willBeActive = u.active === false;
    await profilesApi.update(u.id, { active: willBeActive });
    auditApi.log(willBeActive ? 'Employee reactivated' : 'Employee deactivated', u.name);
  }
  async function saveName(u) {
    if (editName.trim().length < 2) return;
    await profilesApi.update(u.id, { name: editName.trim() });
    auditApi.log('Name changed', u.name + ' → ' + editName.trim());
    setEditId(null);
  }
  async function removeUser(u) {
    if (u.id === me.id) { alert('You cannot delete yourself.'); return; }
    if (u.role === 'admin' && adminCount <= 1) { alert('Cannot delete the only manager.'); return; }
    if (!confirm('Delete ' + u.name + ' and their assignments? Their tracked time stays in reports.')) return;
    try {
      const asn = await assignmentsApi.listByEmployee(u.id);
      await Promise.all(asn.map((a) => assignmentsApi.remove(a.id)));
      await profilesApi.remove(u.id);
      auditApi.log('Employee removed', u.name);
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  }

  return (
    <>
      <NewUser />
      <div className="card">
        <h2>Users</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const inactive = u.active === false;
                return (
                  <tr key={u.id} style={inactive ? { opacity: 0.55 } : null}>
                    <td className="nowrap">
                      {editId === u.id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ padding: '4px 8px', width: 140 }} />
                          <button className="btn-ok btn-sm" onClick={() => saveName(u)}>Save</button>
                          <button className="btn-ghost btn-sm" onClick={() => setEditId(null)}>×</button>
                        </span>
                      ) : (
                        <>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}
                          <button className="link" style={{ marginLeft: 6 }} onClick={() => { setEditId(u.id); setEditName(u.name || ''); }}>edit</button></>
                      )}
                    </td>
                    <td className="small muted">{u.email || '—'}</td>
                    <td>
                      <select value={u.role} style={{ width: 'auto' }} onChange={(e) => changeRole(u, e.target.value)}>
                        <option value="employee">Employee</option>
                        <option value="admin">Manager</option>
                      </select>
                    </td>
                    <td className="nowrap">
                      {inactive ? <span className="pill off">Inactive</span> : <span className="pill on">Active</span>}
                      {u.id !== me.id && <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleActive(u)}>{inactive ? 'Activate' : 'Deactivate'}</button>}
                    </td>
                    <td>{u.id !== me.id && <button className="btn-danger btn-sm" onClick={() => removeUser(u)}>Delete</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          New accounts start <b>pending</b> until you activate them. Employees can change their own password in My account; per-employee tracking settings are under the Employees tab.
        </p>
      </div>
    </>
  );
}

function NewUser() {
  const [f, setF] = useState({ email: '', name: '', password: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function create() {
    setMsg(''); setErr('');
    if (!f.email.trim() || f.name.trim().length < 2 || f.password.length < 6) { setErr('Enter an email, a name, and a temporary password (6+ chars).'); return; }
    setBusy(true);
    try {
      await auth.adminCreateUser(f);
      setMsg(`Created ${f.email.trim()}. They'll get a confirmation email; after they confirm, activate them below.`);
      setF({ email: '', name: '', password: '' });
    } catch (e) { setErr(e.message || 'Could not create the user.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>Create user</h2>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      <div className="grid g3">
        <div><label>Email</label><input type="email" value={f.email} onChange={(e) => upd('email', e.target.value)} placeholder="person@example.com" /></div>
        <div><label>Name</label><input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder="Full name" /></div>
        <div><label>Temporary password</label><input type="text" value={f.password} onChange={(e) => upd('password', e.target.value)} placeholder="they can change it later" /></div>
      </div>
      <button style={{ marginTop: 12 }} disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create & send confirmation'}</button>
    </div>
  );
}
