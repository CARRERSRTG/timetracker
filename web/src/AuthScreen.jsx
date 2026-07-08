import { useState } from 'react';
import { auth, authErrorMessage } from '@shared/lib/supabase.js';

export default function AuthScreen() {
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
          setInfo('Account created! Check your email to confirm it, then sign in.');
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
      setErr('Type your email above first, then tap "Forgot password".');
      return;
    }
    try {
      await auth.resetPassword(f.email);
      setInfo('Password reset email sent to ' + f.email.trim() + '. Check your inbox (and spam).');
    } catch (e) {
      setErr(authErrorMessage(e));
    }
  }

  return (
    <div className="center">
      <div className="authbox">
        <div className="brand" style={{ textAlign: 'center', marginBottom: 16 }}>
          Time<span>Tracker</span>
        </div>
        <div className="card">
          <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
          {err && <div className="banner err">{err}</div>}
          {info && <div className="banner ok">{info}</div>}

          {mode === 'register' && (
            <>
              <label>Name</label>
              <input value={f.name} onChange={(e) => upd('name', e.target.value)} placeholder="Your name" />
            </>
          )}

          <label>Email</label>
          <input
            type="email"
            value={f.email}
            onChange={(e) => upd('email', e.target.value)}
            placeholder="you@example.com"
          />

          <label>Password</label>
          <input
            type="password"
            value={f.pass}
            onChange={(e) => upd('pass', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="••••••••"
          />

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button className="link" onClick={resetPw}>Forgot password?</button>
            </div>
          )}

          <button style={{ width: '100%', marginTop: 16 }} disabled={busy} onClick={submit}>
            {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Register'}
          </button>

          <div className="small muted" style={{ marginTop: 12, textAlign: 'center' }}>
            {mode === 'login' ? (
              <>
                No account?{' '}
                <button className="link" onClick={() => { setMode('register'); setErr(''); setInfo(''); }}>
                  Register
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button className="link" onClick={() => { setMode('login'); setErr(''); setInfo(''); }}>
                  Sign in
                </button>
              </>
            )}
          </div>

          {mode === 'register' && (
            <p className="small muted" style={{ marginTop: 10 }}>
              The first registered user becomes the manager. After that, new
              accounts must be activated by a manager before they can track time.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
