import { useEffect, useRef, useState } from 'react';
import { supabase, settings as settingsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, BROWSER_TZ, TZ_LIST, DAYS, LOCALE, dateISO } from '../lib/helpers.js';

const CUR_PRESETS = [['$', 'US$'], ['L', 'Lempira'], ['€', 'Euro'], ['MX$', 'Peso MX'], ['Q', 'Quetzal']];
const BACKUP_TABLES = ['profiles', 'projects', 'assignments', 'sessions', 'payrolls', 'requests', 'audit'];

export default function ManagerSettings() {
  const [cur, setCur] = useState(APP_SETTINGS.currency);
  const [tz, setTz] = useState(APP_SETTINGS.timeZone);
  const [wsd, setWsd] = useState(APP_SETTINGS.weekStartDay);
  const [period, setPeriod] = useState(APP_SETTINGS.payPeriod);
  const [methods, setMethods] = useState((APP_SETTINGS.paymentMethods || []).join(', '));
  const [adjTypes, setAdjTypes] = useState((APP_SETTINGS.adjustmentTypes || []).join(', '));
  const [shotMin, setShotMin] = useState(APP_SETTINGS.screenshotIntervalMin ?? 10);
  const [idleMin, setIdleMin] = useState(APP_SETTINGS.idleLimitMin ?? 5);
  const [smartIdle, setSmartIdle] = useState(APP_SETTINGS.smartIdle !== false);
  const [workApps, setWorkApps] = useState((APP_SETTINGS.workApps || []).join(', '));
  const [wtype, setWtype] = useState(APP_SETTINGS.defaultWorkerType);
  const [tmode, setTmode] = useState(APP_SETTINGS.defaultTrackMode);
  const [breaks, setBreaks] = useState(APP_SETTINGS.defaultBreaksEnabled ? 'yes' : 'no');
  const [co, setCo] = useState({
    name: APP_SETTINGS.companyName || '', address: APP_SETTINGS.companyAddress || '',
    taxId: APP_SETTINGS.companyTaxId || '', phone: APP_SETTINGS.companyPhone || '', email: APP_SETTINGS.companyEmail || '',
  });
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [dataMsg, setDataMsg] = useState('');
  const [working, setWorking] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const upCo = (k, v) => setCo((p) => ({ ...p, [k]: v }));

  async function save() {
    const list = methods.split(',').map((s) => s.trim()).filter(Boolean);
    const alist = adjTypes.split(',').map((s) => s.trim()).filter(Boolean);
    await settingsApi.update({
      currency: cur.trim() || '$',
      timeZone: tz,
      weekStartDay: Number(wsd),
      payPeriod: period,
      paymentMethods: list,
      adjustmentTypes: alist.length ? alist : ['Bonus', 'Advance', 'Deduction'],
      screenshotIntervalMin: Math.max(1, Number(shotMin) || 10),
      idleLimitMin: Math.max(0, Number(idleMin) || 0),
      smartIdle,
      workApps: workApps.split(',').map((s) => s.trim()).filter(Boolean),
      defaultWorkerType: wtype,
      defaultTrackMode: tmode,
      defaultBreaksEnabled: breaks === 'yes',
      companyName: co.name.trim(), companyAddress: co.address.trim(), companyTaxId: co.taxId.trim(),
      companyPhone: co.phone.trim(), companyEmail: co.email.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function backup() {
    setWorking(true); setDataMsg('Preparing backup…');
    try {
      const out = { _meta: { app: 'time-tracker', at: new Date().toISOString(), version: 1 } };
      for (const t of BACKUP_TABLES) {
        const { data, error } = await supabase.from(t).select('*');
        if (error) throw error;
        out[t] = data || [];
      }
      out.settings = await settingsApi.get();
      const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'timetracker_backup_' + dateISO(new Date()) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      setDataMsg('Backup downloaded. ' + BACKUP_TABLES.map((t) => t + ': ' + out[t].length).join(', ') + '.');
    } catch (e) {
      setDataMsg('Backup failed: ' + (e.message || e));
    } finally { setWorking(false); }
  }

  async function restore(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!confirm('Restore from this backup?\n\nRecords with the same ID are OVERWRITTEN with the backup version; new records are added. Nothing is deleted.')) return;
    setWorking(true); setDataMsg('Restoring…');
    try {
      const data = JSON.parse(await file.text());
      let total = 0;
      // profiles first (fk targets), then the rest
      for (const t of ['profiles', 'projects', 'assignments', 'payrolls', 'sessions', 'requests']) {
        const arr = data[t] || [];
        if (!arr.length) continue;
        const { error } = await supabase.from(t).upsert(arr);
        if (error) throw error;
        total += arr.length;
      }
      if (data.settings) await supabase.from('settings').update({ data: data.settings }).eq('id', 'app');
      setDataMsg('Restore complete. ' + total + ' records written. Reload to see everything.');
    } catch (e) {
      setDataMsg('Restore failed: ' + (e.message || e));
    } finally { setWorking(false); }
  }

  const tzOptions = TZ_LIST.includes(tz) ? TZ_LIST : [tz, ...TZ_LIST];
  let tzPreview = '';
  try { tzPreview = new Date(now).toLocaleString(LOCALE, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }); }
  catch { tzPreview = '(invalid time zone)'; }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <h2>Settings</h2>
      {saved && <div className="banner ok">Saved. Applies across the app.</div>}

      <h3 style={{ color: 'var(--muted)' }}>Company (shown on receipts)</h3>
      <label>Company name</label>
      <input value={co.name} onChange={(e) => upCo('name', e.target.value)} placeholder="El Lechón Ardiente S. de R.L." />
      <label>Address</label>
      <input value={co.address} onChange={(e) => upCo('address', e.target.value)} placeholder="Col. ..., San Pedro Sula, Honduras" />
      <div className="grid g3">
        <div><label>Tax ID / RTN</label><input value={co.taxId} onChange={(e) => upCo('taxId', e.target.value)} placeholder="0501-..." /></div>
        <div><label>Phone</label><input value={co.phone} onChange={(e) => upCo('phone', e.target.value)} placeholder="+504 ..." /></div>
        <div><label>Email</label><input value={co.email} onChange={(e) => upCo('email', e.target.value)} placeholder="pay@company.com" /></div>
      </div>

      <div className="hr" />
      <label>Currency symbol</label>
      <input value={cur} onChange={(e) => setCur(e.target.value)} placeholder="$" />
      <div className="row" style={{ marginTop: 8 }}>
        {CUR_PRESETS.map(([s, l]) => <button key={s} className="btn-ghost btn-sm" onClick={() => setCur(s)}>{l}</button>)}
      </div>

      <label style={{ marginTop: 14 }}>Time zone</label>
      <select value={tz} onChange={(e) => setTz(e.target.value)}>
        {tzOptions.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
      </select>
      <p className="small muted" style={{ marginTop: 4 }}>
        All dates and times use this zone. Current time here: <b>{tzPreview}</b>. Your computer's zone is {BROWSER_TZ.replace(/_/g, ' ')}.
      </p>

      <label style={{ marginTop: 14 }}>Week starts on…</label>
      <select value={wsd} onChange={(e) => setWsd(e.target.value)}>
        {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
      </select>
      <p className="small muted" style={{ marginTop: 4 }}>Default Saturday (Saturday → Friday). Changing this regroups all reports.</p>

      <label style={{ marginTop: 14 }}>Pay period</label>
      <select value={period} onChange={(e) => setPeriod(e.target.value)}>
        <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
      </select>

      <label style={{ marginTop: 14 }}>Payment methods (comma-separated)</label>
      <input value={methods} onChange={(e) => setMethods(e.target.value)} placeholder="Cash, Bank transfer, PayPal" />

      <label style={{ marginTop: 14 }}>Adjustment types (comma-separated)</label>
      <input value={adjTypes} onChange={(e) => setAdjTypes(e.target.value)} placeholder="Bonus, Advance, Deduction" />

      <div className="grid g2">
        <div>
          <label>Screenshot interval (minutes, desktop app)</label>
          <input type="number" min="1" value={shotMin} onChange={(e) => setShotMin(e.target.value)} placeholder="10" />
        </div>
        <div>
          <label>Idle limit (minutes, 0 = off)</label>
          <input type="number" min="0" value={idleMin} onChange={(e) => setIdleMin(e.target.value)} placeholder="5" />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        After the idle limit with no keyboard/mouse input, the timer stops counting; that idle time is excluded from paid hours.
      </p>

      <label style={{ marginTop: 14 }}>
        <input type="checkbox" checked={smartIdle} onChange={(e) => setSmartIdle(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
        Smart idle (desktop): count input-idle time when the screen is active in a work app
      </label>
      {smartIdle && (
        <>
          <label style={{ marginTop: 8 }}>Work apps (comma-separated, matched against the active window)</label>
          <textarea value={workApps} onChange={(e) => setWorkApps(e.target.value)} rows={3} placeholder="Meet, Zoom, Teams, Claude, RingCentral, VS Code…" />
          <p className="small muted" style={{ marginTop: 4 }}>
            When someone is input-idle but the screen is changing (a meeting, a video, reading, code appearing) in one of these apps, the time counts and is labeled with the app — so meetings and reading aren't penalized. A parked app with a frozen screen still counts as idle.
          </p>
        </>
      )}

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>Default setup (can be overridden per employee)</h3>
      <div className="grid g3">
        <div>
          <label>Worker type</label>
          <select value={wtype} onChange={(e) => setWtype(e.target.value)}><option value="remote">Remote</option><option value="inhouse">In-house</option></select>
        </div>
        <div>
          <label>Tracking mode</label>
          <select value={tmode} onChange={(e) => setTmode(e.target.value)}><option value="activity">Full activity</option><option value="inout">Clock in / out only</option></select>
        </div>
        <div>
          <label>Lunch & break</label>
          <select value={breaks} onChange={(e) => setBreaks(e.target.value)}><option value="no">Disabled</option><option value="yes">Enabled</option></select>
        </div>
      </div>

      <button style={{ marginTop: 16 }} onClick={save}>Save settings</button>

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>Data backup</h3>
      {dataMsg && <div className="banner info">{dataMsg}</div>}
      <p className="small muted">Download a full copy of your data (people, projects, time, payments) as a file you can keep safe, or restore it back.</p>
      <div className="row">
        <button className="btn-ghost" disabled={working} onClick={backup}>⬇ Download backup</button>
        <button className="btn-ghost" disabled={working} onClick={() => fileRef.current && fileRef.current.click()}>⬆ Restore from file</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={restore} />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Keep backups private — the file contains everyone's data. Restore merges by record ID; it never deletes.</p>
    </div>
  );
}
