import { useEffect, useMemo, useState } from 'react';
import { screenshots as screenshotsApi } from '@shared/lib/supabase.js';
import { fmtTime, fmtClock, dateISO, addDaysISO, fmtDayLong } from './lib/helpers.js';
import { useT } from './lib/i18n.js';

// Upwork-style Work Diary for one person: a date navigator, the day's total
// tracked time, and screenshots grouped by hour (6 per hour, ~every 10 min),
// each with a segmented activity bar + timestamp.
export default function WorkDiary({ shots, sessions = [], onDelete }) {
  const t = useT();
  const today = dateISO(new Date());
  const [date, setDate] = useState(today);
  const [urls, setUrls] = useState({});

  const dayShots = useMemo(
    () => shots.filter((s) => (s.date || (s.takenAt ? dateISO(new Date(s.takenAt)) : '')) === date),
    [shots, date],
  );

  useEffect(() => {
    let cancelled = false;
    const missing = dayShots.filter((s) => s.path && !urls[s.path]);
    if (!missing.length) return;
    Promise.all(missing.map(async (s) => {
      try { return [s.path, await screenshotsApi.signedUrl(s.path, 3600)]; } catch { return [s.path, null]; }
    })).then((pairs) => {
      if (cancelled) return;
      setUrls((prev) => { const next = { ...prev }; pairs.forEach(([p, u]) => { if (u) next[p] = u; }); return next; });
    });
    return () => { cancelled = true; };
  }, [dayShots]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSec = sessions.filter((s) => s.date === date).reduce((n, s) => n + (s.durationSeconds || 0), 0);

  // group the day's shots by clock hour
  const byHour = {};
  dayShots.forEach((s) => {
    const h = s.takenAt ? new Date(s.takenAt).getHours() : 0;
    (byHour[h] = byHour[h] || []).push(s);
  });
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const hourLabel = (h) => {
    const base = new Date(); base.setHours(h, 0, 0, 0);
    const end = new Date(base.getTime() + 3600000);
    return fmtTime(base.getTime()) + ' – ' + fmtTime(end.getTime());
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div className="between box" style={{ alignItems: 'center' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn-ghost btn-sm" onClick={() => setDate((d) => addDaysISO(d, -1))}>←</button>
          <b className="nowrap">{fmtDayLong(date)}</b>
          <button className="btn-ghost btn-sm" disabled={date >= today} onClick={() => setDate((d) => addDaysISO(d, 1))}>→</button>
          {date !== today && <button className="link" onClick={() => setDate(today)}>{t('mgr.diary.today')}</button>}
        </div>
        <div><b>{t('mgr.diary.total')} {fmtClock(totalSec)}</b> <span className="small muted">{t('mgr.diary.hrs')}</span></div>
      </div>

      {dayShots.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>{t('mgr.diary.noneDay')}</p>
      ) : hours.map((h) => (
        <div key={h} style={{ marginTop: 14 }}>
          <div className="small muted" style={{ fontWeight: 600 }}>🟢 {hourLabel(h)} · {byHour[h].length} {t('mgr.diary.shots')}</div>
          <div className="shotgrid" style={{ marginTop: 8 }}>
            {byHour[h].slice().sort((a, b) => new Date(a.takenAt || 0) - new Date(b.takenAt || 0)).map((s) => {
              const when = s.takenAt ? fmtTime(new Date(s.takenAt).getTime()) : '…';
              // Blank slot: the segment had no activity, so no screenshot was taken.
              if (!s.path) {
                return (
                  <div key={s.id} className="shot">
                    <div className="shot-blank">{t('mgr.diary.noActivity')}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>{when} · —</div>
                  </div>
                );
              }
              const url = urls[s.path];
              const pct = Math.max(0, Math.min(100, s.activityPercent || 0));
              const filled = Math.round(pct / 10);
              return (
                <div key={s.id} className="shot">
                  <a href={url || undefined} target="_blank" rel="noopener noreferrer">
                    {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
                  </a>
                  <div className="meter" title={t('mgr.diary.activityTitle', { pct })} style={{ marginTop: 4 }}>
                    {Array.from({ length: 10 }).map((_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
                  </div>
                  <div className="small muted">{when} · {pct}%</div>
                  {onDelete && (
                    <button className="btn-danger btn-sm" style={{ width: '100%', marginTop: 4, padding: '2px 6px' }} onClick={() => onDelete(s)}>{t('mgr.diary.delete')}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
