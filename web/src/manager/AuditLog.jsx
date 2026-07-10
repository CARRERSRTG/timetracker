import { useEffect, useMemo, useState } from 'react';
import { audit as auditApi } from '@shared/lib/supabase.js';
import { fmtDT, fmtDayLong, dateISO } from '../lib/helpers.js';
import { useT } from '../lib/i18n.js';

// Audit log grouped by day, with person + action filters, instead of one long
// undifferentiated table.
export default function AuditLog({ users }) {
  const t = useT();
  const [items, setItems] = useState([]);
  const [who, setWho] = useState('');
  const [action, setAction] = useState('');
  useEffect(() => auditApi.subscribeRecent(300, setItems), []);

  const uMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const actionTypes = useMemo(() => Array.from(new Set(items.map((i) => i.action))).sort(), [items]);

  const filtered = items.filter((i) => (!who || i.who === who) && (!action || i.action === action));

  // group by day
  const byDay = {};
  filtered.forEach((i) => {
    const d = i.at ? dateISO(new Date(i.at)) : 'unknown';
    (byDay[d] = byDay[d] || []).push(i);
  });
  const days = Object.keys(byDay).sort().reverse();

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t('mgr.audit.title')}</h2>
        <div className="row">
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('mgr.audit.allPeople')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('mgr.audit.allActions')}</option>
            {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          {t('mgr.audit.empty')}
        </p>
      ) : days.map((d) => (
        <details key={d} open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            {d === 'unknown' ? t('mgr.audit.unknownDate') : fmtDayLong(d)} <span className="chip" style={{ marginLeft: 6 }}>{byDay[d].length}</span>
          </summary>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>{t('mgr.audit.time')}</th><th>{t('mgr.audit.who')}</th><th>{t('mgr.audit.action')}</th><th>{t('mgr.audit.detail')}</th></tr></thead>
            <tbody>
              {byDay[d].map((it) => (
                <tr key={it.id}>
                  <td className="small nowrap">{it.at ? fmtDT(new Date(it.at).getTime(), { hour: '2-digit', minute: '2-digit' }) : '…'}</td>
                  <td className="small">{uMap[it.who]?.name || '—'}</td>
                  <td className="small"><span className="chip">{it.action}</span></td>
                  <td className="small muted">{it.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
