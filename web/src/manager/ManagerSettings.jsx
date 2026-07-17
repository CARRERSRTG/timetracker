import { useEffect, useRef, useState } from 'react';
import { supabase, settings as settingsApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, BROWSER_TZ, TZ_LIST, DAYS, LOCALE, dateISO } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';
import ThemeSetting from '../ThemeSetting.jsx';

const CUR_PRESETS = [['$', 'US$'], ['€', 'Euro'], ['£', 'GBP'], ['C$', 'CAD'], ['A$', 'AUD']];
const BACKUP_TABLES = ['profiles', 'projects', 'assignments', 'sessions', 'payrolls', 'requests', 'audit'];

export default function ManagerSettings() {
  const t = useT();
  const [cur, setCur] = useState(APP_SETTINGS.currency);
  const [tz, setTz] = useState(APP_SETTINGS.timeZone);
  const [wsd, setWsd] = useState(APP_SETTINGS.weekStartDay);
  const [period, setPeriod] = useState(APP_SETTINGS.payPeriod);
  const [methods, setMethods] = useState((APP_SETTINGS.paymentMethods || []).join(', '));
  const [adjTypes, setAdjTypes] = useState((APP_SETTINGS.adjustmentTypes || []).join(', '));
  const [shotMin, setShotMin] = useState(APP_SETTINGS.screenshotIntervalMin ?? 10);
  const [idleMin, setIdleMin] = useState(APP_SETTINGS.idleLimitMin ?? 5);
  const [appName, setAppName] = useState(APP_SETTINGS.appName || 'TimeTracker');
  const [locations, setLocations] = useState(() => (APP_SETTINGS.locations || []).map((l) => ({ name: l.name || '', weekStartDay: l.weekStartDay == null ? '' : String(l.weekStartDay) })));
  const setLoc = (i, k, v) => setLocations((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
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
  const [saveErr, setSaveErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [dataMsg, setDataMsg] = useState('');
  const [working, setWorking] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const upCo = (k, v) => setCo((p) => ({ ...p, [k]: v }));

  async function save() {
    const list = methods.split(',').map((s) => s.trim()).filter(Boolean);
    const alist = adjTypes.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      appName: appName.trim() || 'TimeTracker',
      locations: locations.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), weekStartDay: l.weekStartDay === '' ? null : Number(l.weekStartDay) })),
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
    };
    try {
      await settingsApi.update(payload);
      setSaveErr('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaved(false);
      setSaveErr(e.message || String(e));
    }
  }

  async function backup() {
    setWorking(true); setDataMsg(t('mgr.set.preparing'));
    try {
      const out = { _meta: { app: 'time-tracker', at: new Date().toISOString(), version: 1 } };
      for (const tbl of BACKUP_TABLES) {
        const { data, error } = await supabase.from(tbl).select('*');
        if (error) throw error;
        out[tbl] = data || [];
      }
      out.settings = await settingsApi.get();
      const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'timetracker_backup_' + dateISO(new Date()) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      setDataMsg(t('mgr.set.backupDone', { list: BACKUP_TABLES.map((tbl) => tbl + ': ' + out[tbl].length).join(', ') }));
    } catch (e) {
      setDataMsg(t('mgr.set.backupFail', { e: e.message || e }));
    } finally { setWorking(false); }
  }

  async function restore(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!confirm(t('mgr.set.restoreConfirm'))) return;
    setWorking(true); setDataMsg(t('mgr.set.restoring'));
    try {
      const data = JSON.parse(await file.text());
      let total = 0;
      // profiles first (fk targets), then the rest
      for (const tbl of ['profiles', 'projects', 'assignments', 'payrolls', 'sessions', 'requests']) {
        const arr = data[tbl] || [];
        if (!arr.length) continue;
        const { error } = await supabase.from(tbl).upsert(arr);
        if (error) throw error;
        total += arr.length;
      }
      if (data.settings) await supabase.from('settings').update({ data: data.settings }).eq('id', 'app');
      setDataMsg(t('mgr.set.restoreDone', { n: total }));
    } catch (e) {
      setDataMsg(t('mgr.set.restoreFail', { e: e.message || e }));
    } finally { setWorking(false); }
  }

  const tzOptions = TZ_LIST.includes(tz) ? TZ_LIST : [tz, ...TZ_LIST];
  let tzPreview = '';
  try { tzPreview = new Date(now).toLocaleString(LOCALE, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }); }
  catch { tzPreview = t('mgr.set.invalidTz'); }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <h2>{t('mgr.tab.config')}</h2>
      {saved && <div className="banner ok">{t('mgr.set.saved')}</div>}
      {saveErr && <div className="banner err">{saveErr}</div>}

      <label>{t('mgr.set.appName')}</label>
      <input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="TimeTracker" />

      <div className="hr" />
      <ThemeSetting />

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>{t('mgr.set.locations')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('mgr.set.locNote')}
      </p>
      {locations.map((l, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <input value={l.name} onChange={(e) => setLoc(i, 'name', e.target.value)} placeholder={t('mgr.set.locPh')} style={{ flex: 2 }} />
          <select value={l.weekStartDay} onChange={(e) => setLoc(i, 'weekStartDay', e.target.value)} style={{ flex: 1, minWidth: 130 }}>
            <option value="">{t('mgr.set.companyDefault')}</option>
            {DAYS.map((d, di) => <option key={di} value={di}>{t('mgr.set.starts', { d })}</option>)}
          </select>
          <button className="btn-danger btn-sm" onClick={() => setLocations((ls) => ls.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="btn-ghost btn-sm" onClick={() => setLocations((ls) => [...ls, { name: '', weekStartDay: '' }])}>{t('mgr.set.addLocation')}</button>

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>{t('mgr.set.companyTitle')}</h3>
      <label>{t('mgr.set.companyName')}</label>
      <input value={co.name} onChange={(e) => upCo('name', e.target.value)} placeholder="Acme Corp, Inc." />
      <label>{t('mgr.set.address')}</label>
      <input value={co.address} onChange={(e) => upCo('address', e.target.value)} placeholder="123 Main St, Suite 100, Austin, TX 78701" />
      <div className="grid g3">
        <div><label>{t('mgr.set.taxId')}</label><input value={co.taxId} onChange={(e) => upCo('taxId', e.target.value)} placeholder="EIN 12-3456789" /></div>
        <div><label>{t('mgr.set.phone')}</label><input value={co.phone} onChange={(e) => upCo('phone', e.target.value)} placeholder="+1 (555) 123-4567" /></div>
        <div><label>{t('mgr.set.email')}</label><input value={co.email} onChange={(e) => upCo('email', e.target.value)} placeholder="payroll@company.com" /></div>
      </div>

      <div className="hr" />
      <label>{t('mgr.set.currency')}</label>
      <input value={cur} onChange={(e) => setCur(e.target.value)} placeholder="$" />
      <div className="row" style={{ marginTop: 8 }}>
        {CUR_PRESETS.map(([s, l]) => <button key={s} className="btn-ghost btn-sm" onClick={() => setCur(s)}>{l}</button>)}
      </div>

      <label style={{ marginTop: 14 }}>{t('mgr.set.timezone')}</label>
      <select value={tz} onChange={(e) => setTz(e.target.value)}>
        {tzOptions.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
      </select>
      <p className="small muted" style={{ marginTop: 4 }}>
        {t('mgr.set.tzNote', { cur: tzPreview, zone: BROWSER_TZ.replace(/_/g, ' ') })}
      </p>

      <label style={{ marginTop: 14 }}>{t('mgr.set.weekStart')}</label>
      <select value={wsd} onChange={(e) => setWsd(e.target.value)}>
        {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
      </select>
      <p className="small muted" style={{ marginTop: 4 }}>{t('mgr.set.weekNote')}</p>

      <label style={{ marginTop: 14 }}>{t('mgr.set.payPeriod')}</label>
      <select value={period} onChange={(e) => setPeriod(e.target.value)}>
        <option value="weekly">{t('mgr.proj.weekly')}</option><option value="biweekly">{t('mgr.proj.biweekly')}</option><option value="monthly">{t('mgr.proj.monthly')}</option>
      </select>

      <label style={{ marginTop: 14 }}>{t('mgr.set.payMethods')}</label>
      <input value={methods} onChange={(e) => setMethods(e.target.value)} placeholder="Cash, Bank transfer, PayPal" />

      <label style={{ marginTop: 14 }}>{t('mgr.set.adjTypes')}</label>
      <input value={adjTypes} onChange={(e) => setAdjTypes(e.target.value)} placeholder="Bonus, Advance, Deduction" />

      <div className="grid g2">
        <div>
          <label>{t('mgr.set.shotInterval')}</label>
          <input type="number" min="1" value={shotMin} onChange={(e) => setShotMin(e.target.value)} placeholder="10" />
        </div>
        <div>
          <label>{t('mgr.set.idleLimit')}</label>
          <input type="number" min="0" value={idleMin} onChange={(e) => setIdleMin(e.target.value)} placeholder="5" />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        {t('mgr.set.idleNote')}
      </p>

      <label style={{ marginTop: 14 }}>
        <input type="checkbox" checked={smartIdle} onChange={(e) => setSmartIdle(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
        {t('mgr.set.smartIdle')}
      </label>
      {smartIdle && (
        <>
          <label style={{ marginTop: 8 }}>{t('mgr.set.workApps')}</label>
          <textarea value={workApps} onChange={(e) => setWorkApps(e.target.value)} rows={3} placeholder="Meet, Zoom, Teams, Claude, RingCentral, VS Code…" />
          <p className="small muted" style={{ marginTop: 4 }}>
            {t('mgr.set.workAppsNote')}
          </p>
        </>
      )}

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>{t('mgr.set.defaultSetup')}</h3>
      <div className="grid g3">
        <div>
          <label>{t('mgr.set.workerType')}</label>
          <select value={wtype} onChange={(e) => setWtype(e.target.value)}><option value="remote">{t('track.remote')}</option><option value="inhouse">{t('track.inhouse')}</option></select>
        </div>
        <div>
          <label>{t('mgr.set.trackMode')}</label>
          <select value={tmode} onChange={(e) => setTmode(e.target.value)}><option value="activity">{t('mgr.set.fullActivity')}</option><option value="inout">{t('mgr.set.inoutOnly')}</option></select>
        </div>
        <div>
          <label>{t('mgr.set.lunchBreak')}</label>
          <select value={breaks} onChange={(e) => setBreaks(e.target.value)}><option value="no">{t('mgr.set.disabled')}</option><option value="yes">{t('mgr.set.enabled')}</option></select>
        </div>
      </div>

      <button style={{ marginTop: 16 }} onClick={save}>{t('mgr.set.saveBtn')}</button>

      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>{t('mgr.set.dataBackup')}</h3>
      {dataMsg && <div className="banner info">{dataMsg}</div>}
      <p className="small muted">{t('mgr.set.backupNote')}</p>
      <div className="row">
        <button className="btn-ghost" disabled={working} onClick={backup}>{t('mgr.set.download')}</button>
        <button className="btn-ghost" disabled={working} onClick={() => fileRef.current && fileRef.current.click()}>{t('mgr.set.restoreBtn')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={restore} />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{t('mgr.set.backupNote2')}</p>
    </div>
  );
}
