import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { configOk, auth, profiles, settings as settingsApi } from '@shared/lib/supabase.js';
import { syncAppSettings, APP_SETTINGS } from './lib/helpers.js';
import { SettingsProvider } from './lib/SettingsContext.jsx';
import { initDesktopShots, IS_DESKTOP, desktopGetVersion, desktopOnUpdate, desktopGetUpdateState, desktopCheckUpdate, desktopInstallUpdate } from './lib/desktop.js';
import { initOfflineQueue, subscribeOfflineStatus } from './lib/offlineQueue.js';
import { APP_VERSION } from './lib/version.js';
import { ensureNotifyPermission } from './lib/notify.js';
import { useT } from './lib/i18n.js';
import LangToggle from './LangToggle.jsx';
import AuthScreen from './AuthScreen.jsx';
import ScreenshotToast from './employee/ScreenshotToast.jsx';
import NotificationToast from './NotificationToast.jsx';

// Code-split the two dashboards: an employee never downloads the manager bundle
// (payroll, reports, people, settings) and vice-versa, so first paint is smaller.
const EmployeeDashboard = lazy(() => import('./employee/EmployeeDashboard.jsx'));
const ManagerDashboard = lazy(() => import('./manager/ManagerDashboard.jsx'));

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = booting, null = signed out
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [appName, setAppName] = useState('TimeTracker');
  const [settings, setSettings] = useState(APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const profileRef = useRef(null);
  profileRef.current = profile;

  // desktop: register the screenshot upload handler once; it reads the current
  // employee uid at fire time (no-op in the web build)
  useEffect(() => { initDesktopShots(() => profileRef.current?.id); }, []);

  // offline buffering: flush any queued session updates / screenshots on
  // reconnect (works on web too; most valuable on the desktop app)
  useEffect(() => { initOfflineQueue(); }, []);

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
    return settingsApi.subscribe((s) => { syncAppSettings(s); setSettings({ ...APP_SETTINGS }); setAppName(s.appName || 'TimeTracker'); setSettingsLoaded(true); });
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
  if (!settingsLoaded) return <BootScreen label="Loading…" onSignOut={() => auth.signOut()} />;

  return (
    <SettingsProvider value={settings}>
      <Shell profile={profile} appName={appName} onSignOut={() => auth.signOut()} />
    </SettingsProvider>
  );
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
  // Prefer the desktop app's real runtime version; fall back to the build constant.
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => {
    let ok = true;
    desktopGetVersion().then((v) => { if (ok && v) setVersion(v); });
    return () => { ok = false; };
  }, []);
  const edition = IS_DESKTOP ? 'Desktop' : 'Web';
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

      <UpdateBanner />

      {isAdmin && asEmployee && (
        <div className="banner info">{t('shell.viewingAsEmployee')}</div>
      )}

      <Suspense fallback={<p className="small muted" style={{ textAlign: 'center', marginTop: 40 }}>{t('shell.loading')}</p>}>
        {showEmployee ? <EmployeeDashboard profile={profile} /> : <ManagerDashboard profile={profile} />}
      </Suspense>

      <p className="small muted" style={{ textAlign: 'center', marginTop: 20 }}>
        {t('shell.focusNote')}
        <br />
        <span style={{ opacity: 0.7 }}>{appName || 'TimeTracker'} v{version} · {edition}</span>
        {IS_DESKTOP && <> · <button className="link" onClick={() => desktopCheckUpdate()}>Check for updates</button></>}
      </p>

      <ScreenshotToast />
      <NotificationToast />
      <OfflineIndicator />
    </div>
  );
}

// In-app auto-update banner: shows download progress and, when an update is
// ready, a "Restart & install" button. Desktop only; queries the cached state
// on mount so it catches events that fired before it subscribed. A manual
// "Check for updates" (footer) briefly shows checking/up-to-date/error too.
function UpdateBanner() {
  const [u, setU] = useState(null);
  useEffect(() => {
    if (!IS_DESKTOP) return undefined;
    let timer = null;
    const apply = (s) => {
      setU(s);
      clearTimeout(timer);
      // transient states (incl. the automatic launch check) shouldn't linger
      if (s && (s.state === 'none' || s.state === 'error')) timer = setTimeout(() => setU(null), 5000);
    };
    desktopGetUpdateState().then((s) => { if (s) apply(s); });
    const off = desktopOnUpdate(apply);
    return () => { off(); clearTimeout(timer); };
  }, []);
  if (!IS_DESKTOP || !u) return null;
  const s = u.state;
  if (s === 'ready') {
    return (
      <div className="banner ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span>✅ Version <b>{u.version}</b> is downloaded and ready to install.</span>
        <button className="btn-ok btn-sm" onClick={() => desktopInstallUpdate()}>Restart &amp; install now</button>
      </div>
    );
  }
  if (s === 'downloading') {
    return (
      <div className="banner info">
        ⬇ Downloading update{u.version ? ' v' + u.version : ''}… {u.percent != null ? u.percent + '%' : ''}
        <div style={{ background: 'var(--line)', borderRadius: 999, height: 6, overflow: 'hidden', marginTop: 6 }}>
          <div style={{ width: (u.percent || 0) + '%', height: '100%', background: 'var(--accent2)', transition: 'width .3s' }} />
        </div>
      </div>
    );
  }
  if (s === 'checking') return <div className="banner info">🔄 Checking for updates…</div>;
  if (s === 'none') return <div className="banner info">✓ You're on the latest version.</div>;
  if (s === 'error') return <div className="banner warn">⚠ Update check failed: {u.message || 'unknown error'}</div>;
  return null;
}

// Small honest status pill: shown only when offline or when items are still
// waiting to sync. Fixed to the bottom-left so it never blocks content.
function OfflineIndicator() {
  const [s, setS] = useState({ online: true, sessions: 0, shots: 0, total: 0 });
  useEffect(() => subscribeOfflineStatus(setS), []);
  if (s.online && s.total === 0) return null;
  const parts = [];
  if (s.sessions) parts.push(s.sessions + ' time' + (s.sessions > 1 ? ' updates' : ' update'));
  if (s.shots) parts.push(s.shots + ' screenshot' + (s.shots > 1 ? 's' : ''));
  const queued = parts.join(' + ');
  return (
    <div style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 9997, maxWidth: 320 }}
      className="box" title="Your work is saved on this device and will upload automatically.">
      <div className="small" style={{ fontWeight: 700 }}>
        {s.online ? '🔄 Syncing…' : '⚠ Offline'}
      </div>
      <div className="small muted">
        {s.total > 0
          ? `${queued} saved on this device — will sync ${s.online ? 'now' : 'when you\'re back online'}.`
          : 'No connection. Your tracked time is still being recorded locally.'}
      </div>
    </div>
  );
}
