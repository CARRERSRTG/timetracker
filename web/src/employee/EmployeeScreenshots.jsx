import { useEffect, useState } from 'react';
import { screenshots as screenshotsApi, sessions as sessionsApi } from '@shared/lib/supabase.js';
import { subscribeShotsChanged } from '../lib/desktop.js';
import WorkDiary from '../WorkDiary.jsx';

// Employee Work Diary — own screenshots, Upwork-style (date nav + hourly groups),
// with the ability to delete a shot (RLS allows own-delete).
export default function EmployeeScreenshots({ profile }) {
  const [shots, setShots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => subscribeShotsChanged(() => setRefreshKey((k) => k + 1)), []);
  useEffect(() => screenshotsApi.subscribeByEmployee(profile.id, setShots), [profile.id, refreshKey]);
  useEffect(() => sessionsApi.subscribeByEmployee(profile.id, setSessions), [profile.id]);

  async function del(s) {
    if (busy) return;
    if (!confirm('Delete this screenshot? This removes it permanently, for your manager too.')) return;
    setBusy(true);
    try { await screenshotsApi.deleteWithFile({ id: s.id, path: s.path }); }
    catch (e) { alert('Could not delete: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Work diary</h2>
      <WorkDiary shots={shots} sessions={sessions} onDelete={del} />
      <p className="small muted" style={{ marginTop: 12 }}>
        One screenshot per ~10-minute segment (up to 6/hour), taken at a random time. The bar shows that segment's activity. Deleting a shot removes it for your manager too.
      </p>
    </div>
  );
}
