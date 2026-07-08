import { useEffect, useState } from 'react';
import { profiles as profilesApi } from '@shared/lib/supabase.js';
import { APP_SETTINGS, effWorkerType, effTrackMode, effBreaks } from '../lib/helpers.js';

export default function MyAccount({ me }) {
  const [f, setF] = useState(blank(me));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setF(blank(me)); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const methods = APP_SETTINGS.paymentMethods || [];

  async function save() {
    if (f.name.trim().length < 2) return;
    await profilesApi.update(me.id, {
      name: f.name.trim(),
      city: f.city.trim(),
      payMethod: f.payMethod,
      payDetails: f.payDetails.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const wt = effWorkerType(me), tm = effTrackMode(me), br = effBreaks(me);
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>My account</h2>
      {saved && <div className="banner ok">Saved.</div>}
      <label>Name</label>
      <input value={f.name} onChange={(e) => upd('name', e.target.value)} />
      <div className="grid g2">
        <div>
          <label>City</label>
          <input value={f.city} onChange={(e) => upd('city', e.target.value)} placeholder="San Pedro Sula" />
        </div>
        <div>
          <label>Email</label>
          <input value={me.email || ''} disabled />
        </div>
      </div>
      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>How I get paid</h3>
      <div className="grid g2">
        <div>
          <label>Payment method</label>
          <select value={f.payMethod} onChange={(e) => upd('payMethod', e.target.value)}>
            <option value="">(none)</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>Details (account / PayPal / phone)</label>
          <input value={f.payDetails} onChange={(e) => upd('payDetails', e.target.value)} placeholder="e.g. Banco Atlántida 0123..." />
        </div>
      </div>
      <button style={{ marginTop: 14 }} onClick={save}>Save</button>
      <div className="hr" />
      <h3 style={{ color: 'var(--muted)' }}>My setup (set by the manager)</h3>
      <div className="row">
        <span className="chip">{wt === 'remote' ? 'Remote' : 'In-house'}</span>
        <span className="chip">{tm === 'activity' ? 'Activity tracking' : 'Clock in / out only'}</span>
        <span className="chip">{br ? 'Lunch & break: on' : 'Lunch & break: off'}</span>
      </div>
    </div>
  );
}

function blank(me) {
  return {
    name: me.name || '',
    city: me.city || '',
    payMethod: me.payMethod || '',
    payDetails: me.payDetails || '',
  };
}
