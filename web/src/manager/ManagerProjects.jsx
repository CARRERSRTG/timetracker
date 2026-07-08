import { useEffect, useState } from 'react';
import { projects as projectsApi, sessions as sessionsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, money } from '../lib/helpers.js';

const PERIODS = [['weekly', 'Weekly'], ['biweekly', 'Biweekly'], ['monthly', 'Monthly']];
const periodLabel = (v) => (PERIODS.find((p) => p[0] === v) || ['', '—'])[1];

export default function ManagerProjects({ projects, assignments, users }) {
  const empty = {
    name: '', client: '', location: '',
    payPeriod: APP_SETTINGS.payPeriod || 'weekly', category: '', positions: '',
  };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [openId, setOpenId] = useState(null);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const uMap = {};
  (users || []).forEach((u) => { uMap[u.id] = u; });
  const assignedTo = (pid) => (assignments || []).filter((a) => a.projectId === pid).map((a) => uMap[a.employeeUid]).filter(Boolean);
  const posText = (p) => { const x = p.positions; if (!x) return ''; return Array.isArray(x) ? x.join(', ') : String(x); };

  function startEdit(p) {
    setEditId(p.id);
    setF({
      name: p.name || '', client: p.client || '', location: p.location || '',
      payPeriod: p.payPeriod || 'weekly', category: p.category || '', positions: posText(p),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancel() { setEditId(null); setF(empty); }

  async function save() {
    if (f.name.trim().length < 2) return;
    const positions = f.positions.split(',').map((s) => s.trim()).filter(Boolean);
    const data = {
      name: f.name.trim(), client: f.client.trim(), location: f.location.trim(),
      payPeriod: f.payPeriod, category: f.category.trim(), positions,
    };
    if (editId) await projectsApi.update(editId, data);
    else await projectsApi.insert({ ...data, archived: false });
    cancel();
  }

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const cats = {};
  active.forEach((p) => { const c = p.category || 'Uncategorized'; (cats[c] = cats[c] || []).push(p); });
  const catNames = Object.keys(cats).sort();

  function ProjectRow({ p }) {
    const people = assignedTo(p.id);
    const pos = posText(p);
    return (
      <div className="box" style={{ marginTop: 8 }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 700 }}>
              {p.name} {p.category ? <span className="chip" style={{ marginLeft: 4 }}>{p.category}</span> : null}
            </div>
            <div className="small muted">
              {p.client ? p.client + ' · ' : ''}{p.location || '—'} · {periodLabel(p.payPeriod || 'weekly')}
            </div>
            {pos ? <div className="small muted">Positions: {pos}</div> : null}
            <div className="small" style={{ marginTop: 2 }}>
              Assigned: {people.length ? people.map((u) => u.name).join(', ') : <span className="muted">nobody</span>}
            </div>
          </div>
          <div className="row">
            <button className="btn-ghost btn-sm" onClick={() => setOpenId(openId === p.id ? null : p.id)}>{openId === p.id ? 'Hide' : 'Stats'}</button>
            <button className="btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
            <button className="btn-ghost btn-sm" onClick={() => projectsApi.update(p.id, { archived: !p.archived })}>{p.archived ? 'Restore' : 'Archive'}</button>
          </div>
        </div>
        {openId === p.id && <ProjectStats project={p} assignments={assignments} />}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>{editId ? 'Edit project' : 'New project'}</h2>
        <div className="grid g2">
          <div><label>Name</label><input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder="e.g. POS App" /></div>
          <div><label>Client (optional)</label><input value={f.client} onChange={(e) => upd('client', e.target.value)} placeholder="e.g. El Lechón Ardiente" /></div>
        </div>
        <div className="grid g2">
          <div><label>Location (optional)</label><input value={f.location} onChange={(e) => upd('location', e.target.value)} placeholder="e.g. SPS / Remote" /></div>
          <div><label>Category (optional)</label><input value={f.category} onChange={(e) => upd('category', e.target.value)} placeholder="e.g. Development, Sales" /></div>
        </div>
        <div className="grid g2">
          <div>
            <label>Payment period</label>
            <select value={f.payPeriod} onChange={(e) => upd('payPeriod', e.target.value)}>
              {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div><label>Positions (comma-separated)</label><input value={f.positions} onChange={(e) => upd('positions', e.target.value)} placeholder="e.g. Dispatcher, Sales rep" /></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={save}>{editId ? 'Save changes' : 'Create project'}</button>
          {editId && <button className="btn-ghost" onClick={cancel}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <h2>Projects</h2>
        {active.length === 0 ? <p className="muted">No active projects.</p> : catNames.map((c) => (
          <div key={c} style={{ marginBottom: 14 }}>
            <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{c}</div>
            {cats[c].map((p) => <ProjectRow key={p.id} p={p} />)}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>Archive {archived.length ? '(' + archived.length + ')' : ''}</h2>
          <button className="btn-ghost btn-sm" onClick={() => setShowArchive((v) => !v)}>{showArchive ? 'Hide' : 'Show'}</button>
        </div>
        {showArchive && (archived.length === 0
          ? <p className="muted" style={{ marginTop: 10 }}>No archived projects.</p>
          : <div style={{ marginTop: 10 }}>{archived.map((p) => <ProjectRow key={p.id} p={p} />)}</div>)}
      </div>
    </>
  );
}

function ProjectStats({ project, assignments }) {
  const [sessions, setSessions] = useState(null);
  useEffect(() => {
    let live = true;
    sessionsApi.listByProject(project.id).then((rows) => { if (live) setSessions(rows); }).catch(() => { if (live) setSessions([]); });
    return () => { live = false; };
  }, [project.id]);

  const aMap = {};
  (assignments || []).forEach((a) => { aMap[a.id] = a; });
  if (sessions === null) return <div className="small muted" style={{ marginTop: 8 }}>Loading stats…</div>;

  let sec = 0, spent = 0;
  sessions.forEach((s) => {
    sec += s.durationSeconds || 0;
    const a = aMap[s.assignmentId];
    const rate = a ? Number(a.hourlyRate || 0) : 0;
    spent += ((s.durationSeconds || 0) / 3600) * rate;
  });
  return (
    <div className="grid g3" style={{ marginTop: 10 }}>
      <div className="stat"><div className="n">{(sec / 3600).toFixed(2)} h</div><div className="l">Hours logged</div></div>
      <div className="stat"><div className="n">{money(spent)}</div><div className="l">Money spent</div></div>
      <div className="stat"><div className="n">{sessions.length}</div><div className="l">Entries</div></div>
    </div>
  );
}
