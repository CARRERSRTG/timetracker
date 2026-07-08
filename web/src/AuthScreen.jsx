import { useState } from 'react';
import { auth, authErrorMessage } from '@shared/lib/supabase.js';
import { useT } from './lib/i18n.js';
import LangToggle from './LangToggle.jsx';

export default function AuthScreen() {
  const t = useT();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({
    name: '',
    email: (() => {
      try { return localStorage.getItem('tt_lastEmail') || ''; } catch { return ''; }
    })(),
    pass: '',
  });
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (f.name.trim().length < 2) throw new Error('Please enter your name.');
        const result = await auth.signUp({ email: f.email, password: f.pass, name: f.name });
        if (!result.session) {
          setInfo(t('auth.confirmSent'));
          setMode('login');
        }
      } else {
        await auth.signIn(f.email, f.pass);
      }
      try { localStorage.setItem('tt_lastEmail', f.email.trim()); } catch { /* ignore */ }
    } catch (e) {
      setErr(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPw() {
    setErr('');
    setInfo('');
    if (!f.email.trim()) {
      setErr(t('auth.typeEmailFirst'));
      return;
    }
    try {
      await auth.resetPassword(f.email);
      setInfo(t('auth.resetSent', { email: f.email.trim() }));
    } catch (e) {
      setErr(authErrorMessage(e));
    }
  }

  return (
    <div className="center">
      <div className="authbox">
        <div className="brand" style={{ textAlign: 'center', marginBottom: 16 }}>
          Time<span>{t('brand.suffix')}</span>
        </div>
        <div className="card">
          <div className="between" style={{ alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{mode === 'login' ? t('auth.signin') : t('auth.create')}</h2>
            <LangToggle />
          </div>
          {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
          {info && <div className="banner ok" style={{ marginTop: 12 }}>{info}</div>}

          {mode === 'register' && (
            <>
              <label>{t('auth.name')}</label>
              <input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder={t('auth.namePlaceholder')} />
            </>
          )}

          <label>{t('auth.email')}</label>
          <input
            type="email"
            value={f.email}
            onChange={(e) => upd('email', e.target.value)}
            placeholder="you@example.com"
          />

          <label>{t('auth.password')}</label>
          <input
            type="password"
            value={f.pass}
            onChange={(e) => upd('pass', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="••••••••"
          />

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button className="link" onClick={resetPw}>{t('auth.forgot')}</button>
            </div>
          )}

          <button style={{ width: '100%', marginTop: 16 }} disabled={busy} onClick={submit}>
            {busy ? t('auth.busy') : mode === 'login' ? t('auth.signin') : t('auth.register')}
          </button>

          <div className="small muted" style={{ marginTop: 12, textAlign: 'center' }}>
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button className="link" onClick={() => { setMode('register'); setErr(''); setInfo(''); }}>
                  {t('auth.register')}
                </button>
              </>
            ) : (
              <>
                {t('auth.haveAccount')}{' '}
                <button className="link" onClick={() => { setMode('login'); setErr(''); setInfo(''); }}>
                  {t('auth.signin')}
                </button>
              </>
            )}
          </div>

          {mode === 'register' && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {t('auth.firstUserNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
