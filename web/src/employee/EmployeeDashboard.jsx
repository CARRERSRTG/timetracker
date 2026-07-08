import { useEffect, useRef, useState } from 'react';
import {
  profiles as profilesApi,
  assignments as assignmentsApi,
  projects as projectsApi,
  sessions as sessionsApi,
  requests as requestsApi,
} from '@shared/lib/supabase.js';
import { notify } from '../lib/notify.js';
import Tracker from './Tracker.jsx';
import EmployeeWeek from './EmployeeWeek.jsx';
import EmployeeRequests from './EmployeeRequests.jsx';
import EmployeeScreenshots from './EmployeeScreenshots.jsx';
import MyAccount from './MyAccount.jsx';

const REQ_LABEL = { add: 'Add time', adjust: 'Adjust time', delete: 'Delete time' };

export default function EmployeeDashboard({ profile }) {
  const [tab, setTab] = useState('track');
  const [me, setMe] = useState(profile);
  const [assignments, setAssignments] = useState([]);
  const [projects, setProjects] = useState({});
  const [sessions, setSessions] = useState([]);
  const [requests, setRequests] = useState([]);
  const prevReqStatus = useRef(null);

  // notify the employee when one of their requests gets approved/rejected
  useEffect(() => {
    const prev = prevReqStatus.current;
    if (prev) {
      requests.forEach((r) => {
        const was = prev.get(r.id);
        if (was === 'pending' && r.status !== 'pending') {
          notify({ title: `Request ${r.status}`, body: `Your "${REQ_LABEL[r.type] || r.type}" request was ${r.status}.`, tag: 'req-' + r.id });
        }
      });
    }
    prevReqStatus.current = new Map(requests.map((r) => [r.id, r.status]));
  }, [requests]);

  useEffect(() => profilesApi.subscribe(profile.id, (p) => p && setMe(p)), [profile.id]);
  useEffect(() => assignmentsApi.subscribeByEmployee(profile.id, setAssignments), [profile.id]);
  useEffect(() => projectsApi.subscribeAll((list) => {
    const m = {};
    list.forEach((p) => { m[p.id] = p; });
    setProjects(m);
  }), []);
  useEffect(() => sessionsApi.subscribeByEmployee(profile.id, setSessions), [profile.id]);
  useEffect(() => requestsApi.subscribeByEmployee(profile.id, setRequests), [profile.id]);

  // Abandoned-session recovery (the is_live fix): if a previous run closed
  // without finalizing, close out our own live sessions on load. The last 10s
  // tick already persisted duration/end_ms, so we just flip the flag.
  useEffect(() => {
    sessionsApi.listLive(profile.id).then((live) => {
      live.forEach((s) => { sessionsApi.update(s.id, { isLive: false }).catch(() => {}); });
    }).catch(() => {});
  }, [profile.id]);

  const myAssignments = assignments
    .map((a) => ({ ...a, project: projects[a.projectId] }))
    .filter((a) => a.project && !a.project.archived);
  const pendingReq = requests.filter((r) => r.status === 'pending').length;

  if (me && me.active === false) return <DeactivatedNotice />;

  return (
    <>
      <div className="tabs">
        <button className={tab === 'track' ? 'active' : ''} onClick={() => setTab('track')}>Track time</button>
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>My week</button>
        <button className={tab === 'req' ? 'active' : ''} onClick={() => setTab('req')}>
          My requests{pendingReq > 0 && <span className="badge">{pendingReq}</span>}
        </button>
        <button className={tab === 'shots' ? 'active' : ''} onClick={() => setTab('shots')}>My screenshots</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>My account</button>
      </div>

      {/* keep the Tracker mounted so a running timer survives tab switches */}
      <div style={{ display: tab === 'track' ? 'block' : 'none' }}>
        <Tracker profile={profile} user={me} assignments={myAssignments} sessions={sessions} />
      </div>
      {tab === 'week' && <EmployeeWeek profile={profile} assignments={myAssignments} sessions={sessions} />}
      {tab === 'req' && <EmployeeRequests profile={profile} assignments={myAssignments} sessions={sessions} requests={requests} />}
      {tab === 'shots' && <EmployeeScreenshots profile={profile} />}
      {tab === 'account' && <MyAccount me={me} />}
    </>
  );
}

function DeactivatedNotice() {
  return (
    <div className="card">
      <h2>Account deactivated</h2>
      <p className="muted">Your account has been deactivated. Contact your manager.</p>
    </div>
  );
}
