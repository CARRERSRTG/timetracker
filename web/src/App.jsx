import { useEffect, useRef, useState } from 'react';
import { configOk, auth, profiles, settings as settingsApi } from '@shared/lib/supabase.js';
import { syncAppSettings } from './lib/helpers.js';
import { initDesktopShots } from './lib/desktop.js';
import { ensureNotifyPermission } from './lib/notify.js';
import { useT } from './lib/i18n.js';
import LangToggle from './LangToggle.jsx';
import AuthScreen from './AuthScreen.jsx';
import EmployeeDashboard from './employee/EmployeeDashboard.jsx';
import ManagerDashboard from './manager/ManagerDashboard.jsx';
import ScreenshotToast from './employee/ScreenshotToast.jsx';
import NotificationToast from './NotificationToast.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = booting, null = signed out
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [appName, setAppName] = useState('TimeTracker');
  const profileRef = useRef(null);
  profileRef.current = profile;

  // desktop: register the screenshot upload handler once; it reads the current
  // employee uid at fire time (no-op in the web build)
  useEffect(() => { initDesktopShots(() => profileRef.current?.id); }, []);

  // ask for OS-notification permission once signed in
  useEffect(() => { if (user) ensureNotifyPermission(); }, [user]);

  useEffect(() => {
    if (!configOk) { setUser(null); return; }
    auth.getSession().then((session) => setUser(session?.user ?? null)).catch(() => setUser(null));
    return auth.onAuthStateChange((u) => setUser(u));
  }, []);

  // keep the global helper settings (currency, week start, timezone) in sync
  useEffect(() => {
    if (!user) return;
    return settingsApi.subscribe((s) => { syncAppSettings(s); setAppName(s.appName || 'TimeTracker'); });
  }, [user]);

  useEffect(() => {
    if (!user) { setProfile(null); setProfileError(''); return; }
    setProfileError('');
    return profiles.subscribe(user.id, (p) => {
      setProfile(p);
      if (!p) setProfileError('Waiting for your profile to be created…');
    });
  }, [user]);

  if (profile && profile.active === false) return <PendingApproval onSignOut={() => auth.signOut()} />;

  if (!configOk) return <ConfigNotice />;
  if (user === undefined) return <BootScreen label="Loading…" />;
  if (!user) return <AuthScreen />;
  if (!profile) return <BootScreen label={profileError || 'Setting up your account…'} onSignOut={() => auth.signOut()} />;

  return <Shell profile={profile} appName={appName} onSignOut={() => auth.signOut()} />;
}

function BootScreen({ label, onSignOut }) {
  return (
    <div className="center">
      <div className="authbox" style={{ textAlign: 'center' }}>
        <div className="muted">{label}</div>
        {onSignOut && (
          <button className="btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}

function PendingApproval({ onSignOut }) {
  const t = useT();
  return (
    <div className="center">
      <div className="authbox card" style={{ textAlign: 'center' }}>
        <div className="brand" style={{ marginBottom: 10 }}>Time<span>{t('brand.suffix')}</span></div>
        <div className="banner info">{t('pending.title')}</div>
        <p className="small muted">{t('pending.body')}</p>
        <button className="btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={onSignOut}>{t('shell.signOut')}</button>
      </div>
    </div>
  );
}

function ConfigNotice() {
  return (
    <div className="center">
      <div className="authbox card">
        <div className="brand" style={{ marginBottom: 10 }}>Time<span>Tracker</span></div>
        <div className="banner err">Supabase is not configured.</div>
        <p className="small muted">
          Copy web/.env.example to web/.env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </p>
      </div>
    </div>
  );
}

function Shell({ profile, appName, onSignOut }) {
  const t = useT();
  const isAdmin = profile.role === 'admin';
  const [asEmployee, setAsEmployee] = useState(false);
  const showEmployee = !isAdmin || asEmployee;
  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">{appName || 'TimeTracker'}</div>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="small muted nowrap">{profile.name}</span>
          <span className={'chip ' + (isAdmin ? 'tag-admin' : 'tag-emp')}>
            {isAdmin ? t('shell.manager') : t('shell.employee')}
          </span>
          {isAdmin && (
            <button className="btn-ghost btn-sm" onClick={() => setAsEmployee((v) => !v)}>
              {asEmployee ? t('shell.backToManager') : t('shell.viewAsEmployee')}
            </button>
          )}
          <LangToggle />
          <button className="btn-ghost btn-sm" onClick={onSignOut}>{t('shell.signOut')}</button>
        </div>
      </div>

      {isAdmin && asEmployee && (
        <div className="banner info">{t('shell.viewingAsEmployee')}</div>
      )}

      {showEmployee ? <EmployeeDashboard profile={profile} /> : <ManagerDashboard profile={profile} />}

      <p className="small muted" style={{ textAlign: 'center', marginTop: 20 }}>
        {t('shell.focusNote')}
      </p>

      <ScreenshotToast />
      <NotificationToast />
    </div>
  );
}
