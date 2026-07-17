import { useEffect, useMemo, useRef, useState } from 'react';
import { sessions as sessionsApi, screenshots as screenshotsApi, auth as authApi } from '@shared/lib/supabase.js';
import {
  APP_SETTINGS, fmtClock, fmtHrs, fmtTime, money, dateISO, weekStartISO, thisWeekStart, timeAgo, effWorkerType, effTrackMode, effBreaks,
} from '../lib/helpers.js';
import { IS_DESKTOP, DESKTOP_SHOT_MIN, desktopGetActivity, desktopGetContext, desktopOnPower, subscribeShotsChanged } from '../lib/desktop.js';
import { queueSession } from '../lib/offlineQueue.js';
import { notify } from '../lib/notify.js';
import { useT } from '../lib/i18n.js';

const METER_BARS = 20; // rolling activity window shown as bars
const MOVEMENT_THRESHOLD = 0.005; // ≥0.5% of the sampled screen changed = "moving" (sensitive: a meeting/video/streaming Claude session counts)
const ACTIVE_WINDOW_SEC = 12;    // one input keeps you "active" this many seconds (gentler meter)

export default function Tracker({ profile, user, assignments, sessions }) {
  const t = useT();
  const trackMode = effTrackMode(user || profile);
  const breaksOn = effBreaks(user || profile);
  const isInOut = trackMode === 'inout';
  const LS_A = 'tt_lastAssign_' + profile.id;
  const LS_M = 'tt_lastMemo_' + profile.id;

  const [assignmentId, setAssignmentId] = useState(() => {
    try { return localStorage.getItem(LS_A) || ''; } catch { return ''; }
  });
  const [memo, setMemo] = useState(() => {
    try { return localStorage.getItem(LS_M) || ''; } catch { return ''; }
  });
  const [running, setRunning] = useState(false);
  const [worked, setWorked] = useState(0);
  const [onBreak, setOnBreak] = useState(null);
  const [breaks, setBreaks] = useState({ lunch: 0, brk: 0 });
  const [breakList, setBreakList] = useState([]);
  const [activePct, setActivePct] = useState(0);
  const [meter, setMeter] = useState(() => new Array(METER_BARS).fill(false));

  const breakEventsRef = useRef([]);
  const sessionIdRef = useRef(null);
  const startMsRef = useRef(0);
  const tickRef = useRef(null);
  const onBreakRef = useRef(null);
  const lunchRef = useRef(0);
  const brkRef = useRef(0);

  // --- activity metering (the fix: original never incremented these) ---
  const keystrokesRef = useRef(0);
  const clicksRef = useRef(0);
  const activeSecondsRef = useRef(0);
  const secHadEventRef = useRef(false); // ≥1 input event this second? (web)
  const lastActTotalRef = useRef(0);    // last keystrokes+clicks total (desktop delta)
  const limitHitRef = useRef(false);    // already notified about hitting the limit?
  const nearHitRef = useRef(false);     // already notified about nearing the limit?
  const idleStreakRef = useRef(0);      // consecutive seconds with no activity
  const activeWindowRef = useRef(0);    // seconds left in the current "active" window
  const idleRef = useRef(0);            // total seconds excluded as idle
  const screenSecRef = useRef(0);       // seconds credited via on-screen activity
  const ctxRef = useRef(null);          // last {app,title,movement} probe
  const ctxProbeRef = useRef(0);        // countdown to next context probe
  const [isIdle, setIsIdle] = useState(false);
  const [ctxApp, setCtxApp] = useState(''); // app recognized via on-screen motion (label)

  const smartIdle = APP_SETTINGS.smartIdle !== false;

  const selected = assignments.find((a) => a.id === assignmentId);
  const shotMin = Number(APP_SETTINGS.screenshotIntervalMin) || DESKTOP_SHOT_MIN;
  const wStart = thisWeekStart();
  const weekSecThisProj = useMemo(() => {
    if (!selected) return 0;
    return sessions
      .filter((s) => weekStartISO(s.date) === wStart && s.assignmentId === selected.id)
      .reduce((n, s) => n + (s.durationSeconds || 0), 0);
  }, [sessions, selected, wStart]);
  const wLimitSec = selected && selected.weeklyLimit !== '' && selected.weeklyLimit != null
    ? Number(selected.weeklyLimit) * 3600 : Infinity;
  const overLimit = weekSecThisProj + worked > wLimitSec;

  useEffect(() => {
    if (assignmentId && assignments.length && !assignments.find((a) => a.id === assignmentId)) setAssignmentId('');
  }, [assignments]); // eslint-disable-line react-hooks/exhaustive-deps

  // reset the weekly-limit notification latches when the project changes
  useEffect(() => { limitHitRef.current = false; nearHitRef.current = false; }, [assignmentId]);

  // notify when the employee reaches (or nears 90% of) their weekly limit
  useEffect(() => {
    if (!selected || wLimitSec === Infinity) return;
    const usedSec = weekSecThisProj + worked;
    if (usedSec >= wLimitSec && !limitHitRef.current) {
      limitHitRef.current = true; nearHitRef.current = true;
      notify({ title: t('notify.limitTitle'), body: t('notify.limitBody', { limit: (wLimitSec / 3600).toFixed(2), project: selected.project.name }), tag: 'limit-' + selected.id });
    } else if (usedSec >= wLimitSec * 0.9 && usedSec < wLimitSec && !nearHitRef.current) {
      nearHitRef.current = true;
      notify({ title: t('notify.nearTitle'), body: t('notify.nearBody', { used: (usedSec / 3600).toFixed(2), limit: (wLimitSec / 3600).toFixed(2), project: selected.project.name }), tag: 'near-' + selected.id });
    }
  }, [worked, weekSecThisProj, selected, wLimitSec]);
  useEffect(() => { try { if (assignmentId) localStorage.setItem(LS_A, assignmentId); } catch { /* ignore */ } }, [assignmentId]); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem(LS_M, memo); } catch { /* ignore */ } }, [memo]); // eslint-disable-line

  // warn before leaving while running
  useEffect(() => {
    const h = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [running]);

  // WEB metering: focus-gated input listeners — only count while this tab is
  // focused (browser limitation). On desktop we poll system-wide counters from
  // the ttDesktop bridge instead (see the tick loop), so skip these.
  useEffect(() => {
    if (!running || IS_DESKTOP) return;
    const onKey = () => { if (document.hasFocus()) { keystrokesRef.current++; secHadEventRef.current = true; } };
    const onClick = () => { if (document.hasFocus()) { clicksRef.current++; secHadEventRef.current = true; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [running]);

  // clean up the ticker if the component unmounts mid-run
  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  // #6 Auto-stop on lock/sleep (desktop): if the machine locks or sleeps while
  // tracking, stop the timer so we don't count away-from-keyboard time. Live
  // refs avoid a stale closure without re-subscribing every tick.
  const runningRef = useRef(false);
  const stopRef = useRef(null);
  runningRef.current = running;
  stopRef.current = stop;
  useEffect(() => {
    if (!IS_DESKTOP) return undefined;
    return desktopOnPower(() => {
      if (runningRef.current && stopRef.current) {
        notify({ title: 'Tracking stopped', body: 'Your screen locked or the computer went to sleep, so tracking was stopped.' });
        stopRef.current();
      }
    });
  }, []);

  function netSeconds(el) { return Math.max(0, el - lunchRef.current - brkRef.current - idleRef.current); }

  function breakEventsPayload() {
    return breakEventsRef.current.map((e) => ({ kind: e.kind, start: e.start, end: e.end || null }));
  }

  // Persist a session update. Retries a couple of times on transient failures;
  // if we're offline (or every retry fails) the patch is buffered locally and
  // synced on reconnect — so a dropped connection never loses tracked time.
  // The tracker keeps counting from local refs regardless of network, so the
  // buffered patch always carries the full up-to-date duration.
  async function writeSession(id, patch, tries = 3) {
    if (navigator.onLine) {
      for (let i = 0; i < tries; i++) {
        try { await sessionsApi.update(id, patch); return true; }
        catch { await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
      }
    }
    queueSession(id, patch);
    return 'queued';
  }

  async function start() {
    if (!selected) return;
    // One active session per user. If a live session already exists (e.g. left
    // running on another device or browser tab), force it closed before a new
    // one can begin — otherwise the same user double-counts time. The last 10s
    // tick already persisted duration/end_ms, so closing just flips is_live.
    try {
      await authApi.ensureSession().catch(() => {});
      const live = await sessionsApi.listLive(profile.id);
      const others = live.filter((s) => s.id !== sessionIdRef.current);
      if (others.length) {
        if (!window.confirm(t('track.liveConflict'))) return;
        for (const s of others) {
          await sessionsApi.update(s.id, { isLive: false, endMs: s.endMs || s.startMs || Date.now() }).catch(() => {});
        }
      }
    } catch { /* if the live-check fails (offline, etc.) fall through and start normally */ }
    lunchRef.current = 0; brkRef.current = 0; onBreakRef.current = null; breakEventsRef.current = [];
    keystrokesRef.current = 0; clicksRef.current = 0; activeSecondsRef.current = 0;
    secHadEventRef.current = false; lastActTotalRef.current = 0;
    idleStreakRef.current = 0; idleRef.current = 0; setIsIdle(false);
    ctxRef.current = null; ctxProbeRef.current = 0; setCtxApp(''); screenSecRef.current = 0;
    startMsRef.current = Date.now();
    setWorked(0); setOnBreak(null); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
    setActivePct(0); setMeter(new Array(METER_BARS).fill(false));
    const now = Date.now();
    const payload = {
      employeeUid: profile.id,
      employeeName: profile.name,
      projectId: selected.projectId,
      assignmentId: selected.id,
      memo: memo.trim(),
      weekOf: weekStartISO(now),
      date: dateISO(now),
      startMs: startMsRef.current,
      endMs: startMsRef.current,
      durationSeconds: 0,
      activeSeconds: 0,
      keystrokes: 0,
      clicks: 0,
      lunchSeconds: 0,
      breakSeconds: 0,
      breakEvents: [],
      manual: false,
      source: 'timer',
      isLive: true,
    };
    try {
      // Make sure our auth token is live before the first write. If it's stale,
      // Postgres RLS rejects the insert ("new row violates row-level security
      // policy") because auth.uid() comes back null — refresh so the user no
      // longer has to restart the app to clear it.
      await authApi.ensureSession().catch(() => {});
      let row;
      try {
        row = await sessionsApi.insert(payload);
      } catch (e) {
        // RLS rejection (Postgres 42501) → almost always a stale/absent JWT.
        // Force a fresh token and retry once before giving up.
        const msg = String((e && (e.message || e.code)) || '').toLowerCase();
        const isRls = msg.includes('row-level security') || msg.includes('42501') || e?.code === '42501';
        if (!isRls) throw e;
        await authApi.forceRefresh();
        row = await sessionsApi.insert(payload);
      }
      sessionIdRef.current = row.id;
      setRunning(true);
      // Confirm the clock started. On desktop the native floating toast (fired
      // from the main process on tt:start) is the primary cue; this in-app/OS
      // notification covers web + Android too.
      notify({ title: t('notify.startTitle'), body: t('notify.startBody', { project: selected.project?.name || selected.projectName || '' }), tag: 'start-' + selected.id });
      if (IS_DESKTOP && window.ttDesktop) {
        try { window.ttDesktop.start({ sessionId: row.id, intervalMin: shotMin }); } catch { /* ignore */ }
      }
    } catch (e) {
      const msg = String((e && (e.message || e.code)) || '').toLowerCase();
      if (msg.includes('row-level security') || msg.includes('42501') || e?.code === '42501') {
        alert('Could not start tracking: your login session expired. Please sign out and sign back in, then try again.');
      } else {
        alert('Could not start tracking: ' + (e.message || e));
      }
      return;
    }
    tickRef.current = setInterval(async () => {
      const el = Math.floor((Date.now() - startMsRef.current) / 1000);
      if (onBreakRef.current === 'lunch') lunchRef.current++;
      else if (onBreakRef.current === 'break') brkRef.current++;

      // an "active second" = a second in which ≥1 input event occurred, and we
      // weren't on a break. On desktop, read system-wide counters from the
      // bridge; on web, use the focus-gated flag.
      let hadEvent;
      if (IS_DESKTOP) {
        const act = await desktopGetActivity();
        let moves = 0;
        if (act) {
          keystrokesRef.current = act.keystrokes;
          clicksRef.current = act.clicks;
          moves = act.moves || 0;
        }
        // keystrokes + clicks + mouse-moves/scroll → any of them = activity
        const total = keystrokesRef.current + clicksRef.current + moves;
        hadEvent = total > lastActTotalRef.current;
        lastActTotalRef.current = total;
      } else {
        hadEvent = secHadEventRef.current;
        secHadEventRef.current = false;
      }
      // Gentler meter: any input keeps you "active" for a short window, so short
      // pauses (reading, thinking) still count as activity.
      if (hadEvent) activeWindowRef.current = ACTIVE_WINDOW_SEC;
      const windowedActive = activeWindowRef.current > 0;
      if (activeWindowRef.current > 0) activeWindowRef.current -= 1;

      // On-screen motion counts as activity even without keyboard/mouse input:
      // a meeting, a video, streaming text, a running Claude session all move the
      // screen. Probe periodically (capture isn't free) whenever there's no recent
      // input to fill in. No work-app allowlist — any real motion counts.
      let productiveNow = false;
      let appLabel = '';
      if (smartIdle && IS_DESKTOP && !onBreakRef.current && !windowedActive) {
        ctxProbeRef.current -= 1;
        if (ctxProbeRef.current <= 0) {
          ctxProbeRef.current = 4;
          desktopGetContext().then((c) => { if (c) ctxRef.current = c; }).catch(() => {});
        }
        const c = ctxRef.current || {};
        if ((c.movement || 0) >= MOVEMENT_THRESHOLD) {
          productiveNow = true; appLabel = c.app || c.title || ''; screenSecRef.current += 1;
        }
      }

      // The "are you still working?" prompt is removed: we never interrupt the
      // user and never discard time. The clock keeps counting; the activity %
      // simply reflects input + on-screen motion.
      const activeThisSec = (windowedActive || productiveNow) && !onBreakRef.current;
      if (activeThisSec) activeSecondsRef.current += 1;
      const idleNow = !activeThisSec && !onBreakRef.current;
      if (idleNow !== isIdle) setIsIdle(idleNow);
      if (appLabel !== ctxApp) setCtxApp(appLabel);

      const net = netSeconds(el);
      setWorked(net);
      setBreaks({ lunch: lunchRef.current, brk: brkRef.current });
      setActivePct(net > 0 ? Math.round((activeSecondsRef.current / net) * 100) : 0);
      setMeter((prev) => { const m = prev.slice(1); m.push(activeThisSec); return m; });

      // short live status for the manager's "Working now" monitor
      const liveNote = onBreakRef.current ? 'break' : productiveNow ? (appLabel || 'screen') : idleNow ? 'idle' : 'active';

      if (el > 0 && el % 10 === 0 && sessionIdRef.current) {
        writeSession(sessionIdRef.current, {
          endMs: Date.now(),
          durationSeconds: net,
          activeSeconds: activeSecondsRef.current,
          idleSeconds: idleRef.current,
          screenSeconds: screenSecRef.current,
          liveNote,
          keystrokes: keystrokesRef.current,
          clicks: clicksRef.current,
          lunchSeconds: lunchRef.current,
          breakSeconds: brkRef.current,
          breakEvents: breakEventsPayload(),
        });
      }
    }, 1000);
  }

  async function stop() {
    clearInterval(tickRef.current);
    tickRef.current = null;
    if (onBreakRef.current) {
      const now = Date.now(), arr = breakEventsRef.current;
      for (let i = arr.length - 1; i >= 0; i--) { if (!arr[i].end) { arr[i].end = now; break; } }
      onBreakRef.current = null; setOnBreak(null);
    }
    const el = Math.floor((Date.now() - startMsRef.current) / 1000);
    const net = netSeconds(el);
    const id = sessionIdRef.current;
    try {
      if (id) {
        const ok = await writeSession(id, {
          endMs: Date.now(),
          durationSeconds: net,
          activeSeconds: activeSecondsRef.current,
          idleSeconds: idleRef.current,
          screenSeconds: screenSecRef.current,
          liveNote: null,
          keystrokes: keystrokesRef.current,
          clicks: clicksRef.current,
          lunchSeconds: lunchRef.current,
          breakSeconds: brkRef.current,
          breakEvents: breakEventsPayload(),
          isLive: false,
        });
        if (!ok) alert('Could not save the entry after several tries. Check your connection — your time may not be recorded.');
      }
    } finally {
      if (IS_DESKTOP && window.ttDesktop) { try { window.ttDesktop.stop(); } catch { /* ignore */ } }
      sessionIdRef.current = null;
      setRunning(false); onBreakRef.current = null; setOnBreak(null); setIsIdle(false); setCtxApp('');
      setWorked(0); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
      setActivePct(0); setMeter(new Array(METER_BARS).fill(false));
    }
  }

  function toggleBreak(kind) {
    const now = Date.now();
    if (onBreakRef.current === kind) {
      const arr = breakEventsRef.current;
      for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].kind === kind && !arr[i].end) { arr[i].end = now; break; } }
      onBreakRef.current = null; setOnBreak(null);
    } else if (!onBreakRef.current) {
      breakEventsRef.current.push({ kind, start: now, end: null });
      onBreakRef.current = kind; setOnBreak(kind);
    }
    setBreakList(breakEventsRef.current.map((e) => ({ ...e })));
    if (sessionIdRef.current) sessionsApi.update(sessionIdRef.current, { breakEvents: breakEventsPayload() }).catch(() => {});
  }

  const startLabel = isInOut ? t('track.clockIn') : t('track.start');
  const stopLabel = isInOut ? t('track.clockOut') : t('track.stop');

  return (
    <>
      {assignments.length === 0 && (
        <div className="banner info">{t('track.noProjects')}</div>
      )}
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{t('track.title')}</h2>
          {running && IS_DESKTOP && (
            <span className="chip" style={{ background: '#3a2a12', color: '#ffcf8f' }}>
              {t('track.screenshotsOn', { n: shotMin })}
            </span>
          )}
          <span className="chip">{effWorkerType(user || profile) === 'remote' ? t('track.remote') : t('track.inhouse')}</span>
        </div>

        <label style={{ marginTop: 12 }}>{t('track.project')}</label>
        <div className="pbtns">
          {assignments.map((a) => (
            <button
              key={a.id}
              className={'pbtn' + (assignmentId === a.id ? ' sel' : '')}
              disabled={running}
              onClick={() => setAssignmentId(a.id)}
            >
              <div className="pn">{a.project.name}</div>
              <div className="pm">
                {a.project.location ? a.project.location + ' · ' : ''}
                {money(a.hourlyRate)}/h
              </div>
            </button>
          ))}
        </div>

        <label style={{ marginTop: 14 }}>{t('track.memoLabel')}</label>
        <input value={memo} disabled={running} onChange={(e) => setMemo(e.target.value)} placeholder={t('track.memoPlaceholder')} />

        {selected && wLimitSec !== Infinity && (
          <LimitBar usedSec={weekSecThisProj + worked} limitHours={Number(selected.weeklyLimit)} />
        )}
        {overLimit && (
          <div className="banner warn">{t('track.overWarning')}</div>
        )}

        <div className="hr" />

        <div className="row between tracker-controls">
          <div>
            <div className="timer-big">{fmtClock(worked)}</div>
            <div className="small muted">
              {running
                ? ctxApp ? t('track.activeApp', { app: ctxApp })
                  : isIdle ? t('track.idle')
                  : onBreak === 'lunch' ? t('track.onLunch') : onBreak === 'break' ? t('track.onBreak') : isInOut ? t('track.clockedIn') : t('track.running')
                : t('track.stopped')}
              {running && (lunchRef.current > 0 || brkRef.current > 0)
                ? <> · lunch {fmtClock(breaks.lunch)} · break {fmtClock(breaks.brk)}</> : null}
            </div>
            {running && (
              <div className="meter" style={{ maxWidth: 260 }}>
                {meter.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
              </div>
            )}
            {running && !onBreak && (
              <div className="small muted" style={{ marginTop: 6, maxWidth: 320 }}>
                {ctxApp ? t('track.srcScreen', { app: ctxApp }) : isIdle ? t('track.srcIdle') : t('track.srcInput')}
              </div>
            )}
          </div>
          <div className="right">
            {!running
              ? <button className="btn-ok" disabled={!selected} onClick={start}>{startLabel}</button>
              : <button className="btn-danger" onClick={stop}>{stopLabel}</button>}
          </div>
        </div>

        {running && breaksOn && (
          <div className="row breakbtns" style={{ marginTop: 12 }}>
            <button className={onBreak === 'lunch' ? 'btn-warn' : 'btn-ghost'} disabled={onBreak === 'break'} onClick={() => toggleBreak('lunch')}>
              {onBreak === 'lunch' ? 'End lunch' : '🍽 Lunch'}
            </button>
            <button className={onBreak === 'break' ? 'btn-warn' : 'btn-ghost'} disabled={onBreak === 'lunch'} onClick={() => toggleBreak('break')}>
              {onBreak === 'break' ? 'End break' : '☕ Break'}
            </button>
          </div>
        )}

        {running && breakList.length > 0 && (
          <div className="box" style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>Lunches & breaks</div>
            {breakList.map((ev, i) => (
              <div key={i} className="small">
                {ev.kind === 'lunch' ? '🍽 Lunch' : '☕ Break'} — out {fmtTime(ev.start)}
                {ev.end
                  ? <> · back {fmtTime(ev.end)} · <span className="muted">{fmtClock(Math.round((ev.end - ev.start) / 1000))}</span></>
                  : <span className="pill wait" style={{ marginLeft: 6 }}>ongoing</span>}
              </div>
            ))}
          </div>
        )}

        {running && (
          <div className="grid g4" style={{ marginTop: 14 }}>
            <div className="stat"><div className="n">{fmtTime(startMsRef.current)}</div><div className="l">{t('track.started')}</div></div>
            <div className="stat"><div className="n">{fmtHrs(worked)}</div><div className="l">{t('track.worked')}</div></div>
            <div className="stat"><div className="n">{activePct}%</div><div className="l">{t('track.activity')}</div></div>
            <div className="stat"><div className="n">{fmtClock(breaks.lunch + breaks.brk)}</div><div className="l">{t('track.lunchBreak')}</div></div>
            {idleRef.current > 0 && (
              <div className="stat"><div className="n">{fmtClock(idleRef.current)}</div><div className="l">{t('track.idleExcluded')}</div></div>
            )}
          </div>
        )}
      </div>

      <TrackedTotals sessions={sessions} selected={selected} />
      <LatestShot profile={profile} t={t} />
    </>
  );
}

// Upwork-style "Total hours tracked" for the current contract (selected project):
// hours today and hours this billable week (against the weekly limit if set).
// Reads the live session from `sessions` (updated on each 10s tick), so it stays
// current without double-counting.
function TrackedTotals({ sessions, selected }) {
  const today = dateISO(new Date());
  const wStart = thisWeekStart();
  const aid = selected?.id;
  const sumIf = (pred) => sessions.filter(pred).reduce((n, s) => n + (s.durationSeconds || 0), 0);
  const todaySec = sumIf((s) => s.date === today && (!aid || s.assignmentId === aid));
  const weekSec = sumIf((s) => weekStartISO(s.date) === wStart && (!aid || s.assignmentId === aid));
  const limit = selected && selected.weeklyLimit !== '' && selected.weeklyLimit != null ? Number(selected.weeklyLimit) : null;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'short' });
  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Total hours tracked</h2>
      {!selected && <p className="small muted" style={{ marginTop: 0 }}>Pick a project to see its today / this-week totals.</p>}
      <div className="grid g2" style={{ marginTop: 10 }}>
        <div className="stat">
          <div className="l">Today ({weekday})</div>
          <div className="n">{(todaySec / 3600).toFixed(2)} h</div>
        </div>
        <div className="stat">
          <div className="l">This week</div>
          <div className="n">
            {(weekSec / 3600).toFixed(2)} h
            {limit != null ? <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> of {limit.toFixed(0)} h</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Weekly hour-limit progress bar. Green under 80%, amber 80–100%, red over.
function LimitBar({ usedSec, limitHours }) {
  const t = useT();
  const usedH = usedSec / 3600;
  const pct = Math.min(100, (usedH / limitHours) * 100);
  const over = usedH > limitHours;
  const near = !over && pct >= 80;
  const color = over ? 'var(--danger)' : near ? 'var(--warn)' : 'var(--accent2)';
  const remaining = Math.max(0, limitHours - usedH);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="small muted">{t('track.weeklyLimitOn')}</span>
        <span className="small">
          <b>{usedH.toFixed(2)} h</b> / {limitHours.toFixed(2)} h
          {over ? <span className="pill off" style={{ marginLeft: 6 }}>{t('track.over')}</span>
            : <span className="muted"> · {t('track.left', { h: remaining.toFixed(2) })}</span>}
        </span>
      </div>
      <div style={{ background: 'var(--line)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, transition: 'width .3s, background .3s' }} />
      </div>
    </div>
  );
}

// Upwork-style "Latest screenshot" card on the tracker.
function LatestShot({ profile, t }) {
  const [shot, setShot] = useState(null);
  const [url, setUrl] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  // instant refresh the moment a shot uploads on this machine (don't wait for realtime)
  useEffect(() => subscribeShotsChanged(() => setRefreshKey((k) => k + 1)), []);
  useEffect(() => screenshotsApi.subscribeByEmployee(profile.id, (rows) => setShot(rows[0] || null)), [profile.id, refreshKey]);
  useEffect(() => {
    if (!shot?.path) { setUrl(''); return; }
    let ok = true;
    screenshotsApi.signedUrl(shot.path, 3600).then((u) => { if (ok) setUrl(u); }).catch(() => {});
    return () => { ok = false; };
  }, [shot?.path]);
  if (!shot) return null;
  const when = shot.takenAt ? timeAgo(new Date(shot.takenAt).getTime()) : '';
  // Blank slot: no activity in that segment → no screenshot was taken.
  if (!shot.path) {
    return (
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{t('track.latestShot')}</h2>
          <span className="small muted">{when}</span>
        </div>
        <div className="shot-blank" style={{ height: 180, maxWidth: 360, marginTop: 10 }}>{t('track.noActivitySeg')}</div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, shot.activityPercent || 0));
  const filled = Math.round(pct / 10);
  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t('track.latestShot')}</h2>
        <span className="small muted">{when}</span>
      </div>
      <a className="shot" href={url || undefined} target="_blank" rel="noopener noreferrer" style={{ display: 'block', maxWidth: 360, marginTop: 10 }}>
        {url ? <img src={url} alt="latest screenshot" style={{ height: 'auto' }} /> : <div className="shot-loading" style={{ height: 180 }} />}
        <div className="meter" style={{ marginTop: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
        </div>
        <div className="small muted">{shot.takenAt ? fmtTime(new Date(shot.takenAt).getTime()) : ''} · {pct}% activity</div>
      </a>
    </div>
  );
}

