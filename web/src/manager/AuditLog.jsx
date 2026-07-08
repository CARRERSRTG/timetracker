import { useEffect, useState } from 'react';
import { audit as auditApi } from '@shared/lib/supabase.js';
import { fmtDT } from '../lib/helpers.js';

export default function AuditLog({ users }) {
  const [items, setItems] = useState([]);
  useEffect(() => auditApi.subscribeRecent(150, setItems), []);
  const uMap = {}; users.forEach((u) => { uMap[u.id] = u; });
  return (
    <div className="card">
      <h2>Audit log</h2>
      {items.length === 0 ? (
        <p className="muted">
          No activity recorded yet. Sensitive actions (payments, role changes, request approvals, deletions) will appear here.
        </p>
      ) : (
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="small nowrap">{it.at ? fmtDT(new Date(it.at).getTime(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…'}</td>
                <td className="small">{uMap[it.who] ? uMap[it.who].name : '—'}</td>
                <td className="small">{it.action}</td>
                <td className="small muted">{it.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
