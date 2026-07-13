import { useEffect, useRef, useState } from 'react';
import {
  profiles as profilesApi,
  projects as projectsApi,
  assignments as assignmentsApi,
  sessions as sessionsApi,
  requests as requestsApi,
} from '@shared/lib/supabase.js';
import { notify } from '../lib/notify.js';
import { useT } from '../lib/i18n.js';
import Tracker from '../employee/Tracker.jsx';
import EmployeeWeek from '../employee/EmployeeWeek.jsx';
import MyAccount from '../employee/MyAccount.jsx';
import ManagerProjects from './ManagerProjects.jsx';
import ManagerAssignments from './ManagerAssignments.jsx';
import ManagerRequests from './ManagerRequests.jsx';
import ManagerReports from './ManagerReports.jsx';
import ManagerPeople from './ManagerPeople.jsx';
import ManagerSettings from './ManagerSettings.jsx';
import LiveMonitor from './LiveMonitor.jsx';
import Screenshots from './Screenshots.jsx';
import Insights from './Insights.jsx';
import AuditLog from './AuditLog.jsx';

export default function ManagerDashboard({ profile }) {
  const t = useT();
  const [tab, setTab] = useState('insights');
  const [me, setMe] = useState(profile);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [mySessions, setMySessions] = useState([]);
  const [requests, setRequests] = useState([]);
  const seenReqIds = useRef(null);

  // notify the manager when a new pending request arrives
  useEffect(() => {
    const seen = seenReqIds.current;
    if (seen) {
      requests.forEach((r) => {
        if (r.status === 'pending' && !seen.has(r.id)) {
          const who = r.payload?.employeeName || 'An employee';
          notify({ title: t('notify.newReqTitle'), body: t('notify.newReqBody', { who, type: t('reqtype.' + r.type) }), tag: 'newreq-' + r.id });
        }
      });
    }
    seenReqIds.current = new Set(requests.map((r) => r.id));
  }, [requests]);

  useEffect(() => profilesApi.subscribe(profile.id, (p) => p && setMe(p)), [profile.id]);
  useEffect(() => projectsApi.subscribeAll(setProjects), []);
  useEffect(() => profilesApi.subscribeAll(setUsers), []);
  useEffect(() => assignmentsApi.subscribeAll(setAssignments), []);
  useEffect(() => sessionsApi.subscribeByEmployee(profile.id, setMySessions), [profile.id]);
  useEffect(() => requestsApi.subscribeAll(setRequests), []);

  const pMap = {}; projects.forEach((p) => { pMap[p.id] = p; });
  const myAssignments = assignments
    .filter((a) => a.employeeUid === profile.id)
    .map((a) => ({ ...a, project: pMap[a.projectId] }))
    .filter((a) => a.project && !a.project.archived);
  const pending = requests.filter((r) => r.status === 'pending').length;

  const TABS = [
    ['insights', t('mgr.tab.insights')],
    ['live', t('mgr.tab.live')],
    ['reports', t('mgr.tab.reports')],
    ['requests', t('mgr.tab.requests')],
    ['projects', t('mgr.tab.projects')],
    ['assign', t('mgr.tab.assign')],
    ['people', t('mgr.tab.people')],
    ['shots', t('mgr.tab.shots')],
    ['audit', t('mgr.tab.audit')],
    ['config', t('mgr.tab.config')],
    ['track', t('tab.track')],
    ['myweek', t('tab.week')],
    ['account', t('tab.account')],
  ];

  const noProjects = projects.filter((p) => !p.archived).length === 0;
  const noEmployees = users.filter((u) => u.id !== profile.id).length === 0;

  return (
    <>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'requests' && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </div>

      {(noProjects || noEmployees) && tab === 'insights' && (
        <div className="banner info">
          <b>{t('mgr.start.title')}</b>{' '}
          {noProjects && <>{t('mgr.start.create')} <button className="link" onClick={() => setTab('projects')}>{t('mgr.start.project')}</button>, </>}
          {noProjects && <>{t('mgr.start.assignMid')} <button className="link" onClick={() => setTab('assign')}>{t('mgr.start.assignments')}</button>, </>}
          {noEmployees && <>{t('mgr.start.invite')} <button className="link" onClick={() => setTab('people')}>{t('mgr.start.employees')}</button> {t('mgr.start.inviteEnd')} </>}
          {t('mgr.start.thenUse')} <b>{t('mgr.start.viewAsEmp')}</b> {t('mgr.start.tryTracking')}
        </div>
      )}

      {/* keep the tracker mounted so a running timer survives tab switches */}
      <div style={{ display: tab === 'track' ? 'block' : 'none' }}>
        <Tracker profile={profile} user={me} assignments={myAssignments} sessions={mySessions} />
      </div>
      {tab === 'myweek' && <EmployeeWeek profile={profile} assignments={myAssignments} sessions={mySessions} />}
      {tab === 'account' && <MyAccount me={me} />}
      {tab === 'live' && <LiveMonitor users={users} projects={projects} />}
      {tab === 'insights' && <Insights users={users} projects={projects} assignments={assignments} />}
      {tab === 'projects' && <ManagerProjects projects={projects} assignments={assignments} users={users} />}
      {tab === 'assign' && <ManagerAssignments users={users} projects={projects} assignments={assignments} />}
      {tab === 'shots' && <Screenshots users={users} />}
      {tab === 'audit' && <AuditLog users={users} />}
      {tab === 'requests' && <ManagerRequests profile={profile} requests={requests} projects={pMap} assignments={assignments} />}
      {tab === 'people' && <ManagerPeople users={users} me={profile} />}
      {tab === 'config' && <ManagerSettings />}
      {tab === 'reports' && <ManagerReports profile={profile} users={users} projects={projects} assignments={assignments} />}
    </>
  );
}
