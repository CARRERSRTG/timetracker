import { useEffect, useMemo, useRef, useState } from 'react';
import { sessions as sessionsApi } from '@shared/lib/supabase.js';
import {
  APP_SETTINGS, fmtClock, fmtHrs, fmtTime, money, dateISO, weekStartISO, thisWeekStart, effWorkerType, effTrackMode, effBreaks,
} from '../lib/helpers.js';
import { IS_DESKTOP, DESKTOP_SHOT_MIN, desktopGetActivity } from '../lib/desktop.js';
import { notify } from '../lib/notify.js';

const METER_BARS = 20; // rolling activity window shown as bars

export default function Tracker({ profile, user, assignments, sessions }) {
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
      notify({ title: 'Weekly limit reached', body: `You've reached your ${(wLimitSec / 3600).toFixed(2)} h weekly limit on ${selected.project.name}. Time above the limit isn't billable.`, tag: 'limit-' + selected.id });
    } else if (usedSec >= wLimitSec * 0.9 && usedSec < wLimitSec && !nearHitRef.current) {
      nearHitRef.current = true;
      notify({ title: 'Approaching weekly limit', body: `You're at ${(usedSec / 3600).toFixed(2)} of ${(wLimitSec / 3600).toFixed(2)} h on ${selected.project.name}.`, tag: 'near-' + selected.id });
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

  function netSeconds(el) { return Math.max(0, el - lunchRef.current - brkRef.current); }

  function breakEventsPayload() {
    return breakEventsRef.current.map((e) => ({ kind: e.kind, start: e.start, end: e.end || null }));
  }

  async function start() {
    if (!selected) return;
    lunchRef.current = 0; brkRef.current = 0; onBreakRef.current = null; breakEventsRef.current = [];
    keystrokesRef.current = 0; clicksRef.current = 0; activeSecondsRef.current = 0;
    secHadEventRef.current = false; lastActTotalRef.current = 0;
    startMsRef.current = Date.now();
    setWorked(0); setOnBreak(null); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
    setActivePct(0); setMeter(new Array(METER_BARS).fill(false));
    const now = Date.now();
    try {
      const row = await sessionsApi.insert({
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
      });
      sessionIdRef.current = row.id;
      setRunning(true);
      if (IS_DESKTOP && window.ttDesktop) {
        try { window.ttDesktop.start({ sessionId: row.id, intervalMin: shotMin }); } catch { /* ignore */ }
      }
    } catch (e) {
      alert('Could not start tracking: ' + (e.message || e));
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
        if (act) {
          keystrokesRef.current = act.keystrokes;
          clicksRef.current = act.clicks;
        }
        const total = keystrokesRef.current + clicksRef.current;
        hadEvent = total > lastActTotalRef.current;
        lastActTotalRef.current = total;
      } else {
        hadEvent = secHadEventRef.current;
        secHadEventRef.current = false;
      }
      const activeThisSec = hadEvent && !onBreakRef.current;
      if (activeThisSec) activeSecondsRef.current++;

      const net = netSeconds(el);
      setWorked(net);
      setBreaks({ lunch: lunchRef.current, brk: brkRef.current });
      setActivePct(net > 0 ? Math.round((activeSecondsRef.current / net) * 100) : 0);
      setMeter((prev) => { const m = prev.slice(1); m.push(activeThisSec); return m; });

      if (el > 0 && el % 10 === 0 && sessionIdRef.current) {
        sessionsApi.update(sessionIdRef.current, {
          endMs: Date.now(),
          durationSeconds: net,
          activeSeconds: activeSecondsRef.current,
          keystrokes: keystrokesRef.current,
          clicks: clicksRef.current,
          lunchSeconds: lunchRef.current,
          breakSeconds: brkRef.current,
          breakEvents: breakEventsPayload(),
        }).catch(() => {});
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
      if (id) await sessionsApi.update(id, {
        endMs: Date.now(),
        durationSeconds: net,
        activeSeconds: activeSecondsRef.current,
        keystrokes: keystrokesRef.current,
        clicks: clicksRef.current,
        lunchSeconds: lunchRef.current,
        breakSeconds: brkRef.current,
        breakEvents: breakEventsPayload(),
        isLive: false,
      });
    } catch (e) {
      alert('Could not save the entry: ' + (e.message || e));
    } finally {
      if (IS_DESKTOP && window.ttDesktop) { try { window.ttDesktop.stop(); } catch { /* ignore */ } }
      sessionIdRef.current = null;
      setRunning(false); onBreakRef.current = null; setOnBreak(null);
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

  const startLabel = isInOut ? '▶ Clock in' : '▶ Start';
  const stopLabel = isInOut ? '■ Clock out' : '■ Stop';

  return (
    <>
      {assignments.length === 0 && (
        <div className="banner info">You have no projects assigned yet. Ask your manager to assign one.</div>
      )}
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>Track time</h2>
          {running && IS_DESKTOP && (
            <span className="chip" style={{ background: '#3a2a12', color: '#ffcf8f' }}>
              🖥 Screenshots on · every {shotMin} min
            </span>
          )}
          <span className="chip">{effWorkerType(user || profile) === 'remote' ? 'Remote' : 'In-house'}</span>
        </div>

        <label style={{ marginTop: 12 }}>Project</label>
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

        <label style={{ marginTop: 14 }}>Note / memo (what you're working on)</label>
        <input value={memo} disabled={running} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. designing the login screen" />

        {selected && wLimitSec !== Infinity && (
          <LimitBar usedSec={weekSecThisProj + worked} limitHours={Number(selected.weeklyLimit)} />
        )}
        {overLimit && (
          <div className="banner warn">You'll go over the weekly limit. Time above the limit is not billable.</div>
        )}

        <div className="hr" />

        <div className="row between tracker-controls">
          <div>
            <div className="timer-big">{fmtClock(worked)}</div>
            <div className="small muted">
              {running
                ? onBreak === 'lunch' ? '🍽 On lunch…' : onBreak === 'break' ? '☕ On break…' : isInOut ? 'Clocked in' : 'Running…'
                : 'Stopped'}
              {running && (lunchRef.current > 0 || brkRef.current > 0)
                ? <> · lunch {fmtClock(breaks.lunch)} · break {fmtClock(breaks.brk)}</> : null}
            </div>
            {running && (
              <div className="meter" style={{ maxWidth: 260 }}>
                {meter.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
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
            <div className="stat"><div className="n">{fmtTime(startMsRef.current)}</div><div className="l">Started</div></div>
            <div className="stat"><div className="n">{fmtHrs(worked)}</div><div className="l">Worked</div></div>
            <div className="stat"><div className="n">{activePct}%</div><div className="l">Activity</div></div>
            <div className="stat"><div className="n">{fmtClock(breaks.lunch + breaks.brk)}</div><div className="l">Lunch + break</div></div>
          </div>
        )}
      </div>

      <TodayList sessions={sessions} assignments={assignments} />
    </>
  );
}

// Weekly hour-limit progress bar. Green under 80%, amber 80–100%, red over.
function LimitBar({ usedSec, limitHours }) {
  const usedH = usedSec / 3600;
  const pct = Math.min(100, (usedH / limitHours) * 100);
  const over = usedH > limitHours;
  const near = !over && pct >= 80;
  const color = over ? 'var(--danger)' : near ? 'var(--warn)' : 'var(--accent2)';
  const remaining = Math.max(0, limitHours - usedH);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="small muted">Weekly limit on this project</span>
        <span className="small">
          <b>{usedH.toFixed(2)} h</b> / {limitHours.toFixed(2)} h
          {over ? <span className="pill off" style={{ marginLeft: 6 }}>over</span>
            : <span className="muted"> · {remaining.toFixed(2)} h left</span>}
        </span>
      </div>
      <div style={{ background: 'var(--line)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, transition: 'width .3s, background .3s' }} />
      </div>
    </div>
  );
}

function TodayList({ sessions, assignments }) {
  const aMap = {};
  assignments.forEach((a) => { aMap[a.id] = a; });
  const today = dateISO(new Date());
  const list = sessions.filter((s) => s.date === today).sort((a, b) => (b.startMs || 0) - (a.startMs || 0)).slice(0, 12);
  if (!list.length) return null;
  return (
    <div className="card">
      <h2>Today</h2>
      <table>
        <thead><tr><th>Project</th><th>Note</th><th className="right">Duration</th></tr></thead>
        <tbody>
          {list.map((s) => {
            const a = aMap[s.assignmentId];
            return (
              <tr key={s.id}>
                <td>{a ? a.project.name : '—'}</td>
                <td className="muted">
                  {s.memo || '—'}
                  {s.source === 'manual' ? <span className="pill on" style={{ marginLeft: 6 }}>added</span>
                    : s.source === 'adjusted' ? <span className="pill wait" style={{ marginLeft: 6 }}>adjusted</span> : null}
                </td>
                <td className="right nowrap">{fmtClock(s.durationSeconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
