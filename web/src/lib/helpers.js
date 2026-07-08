// Time / money / week helpers, ported verbatim (behavior-wise) from
// reference/time_tracker_original.html.html. computePay and the week-start
// logic are reused exactly as the brief requires.

export const LOCALE = 'en-US';
export const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// A reasonable list of time zones (the browser zone is added if missing).
export const TZ_LIST = [
  'America/Tegucigalpa', 'America/Guatemala', 'America/El_Salvador', 'America/Managua',
  'America/Costa_Rica', 'America/Panama', 'America/Mexico_City', 'America/Chicago',
  'America/New_York', 'America/Denver', 'America/Los_Angeles', 'America/Bogota',
  'America/Lima', 'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'UTC', 'Europe/London', 'Europe/Madrid', 'Europe/Berlin', 'Asia/Manila', 'Asia/Kolkata',
];

// Global mutable settings, mirrored from the settings subscription (see
// syncAppSettings). Helpers read currency / weekStartDay / timeZone from here.
export let APP_SETTINGS = {
  currency: '$',
  timeZone: BROWSER_TZ,
  weekStartDay: 6, // 0=Sun ... 6=Sat (default Saturday)
  defaultWorkerType: 'remote',
  defaultTrackMode: 'activity',
  defaultBreaksEnabled: true,
  paymentMethods: ['Cash', 'Bank transfer', 'PayPal'],
};

export function syncAppSettings(s) {
  APP_SETTINGS = { ...APP_SETTINGS, ...s, timeZone: s.timeZone || APP_SETTINGS.timeZone || BROWSER_TZ };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export { DAYS };

function pad(n) { return String(n).padStart(2, '0'); }

export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h + ':' + pad(m) + ':' + pad(s);
}
export function fmtHrs(sec) { return (sec / 3600).toFixed(2) + ' h'; }
export function fmtHM(sec) {
  const m = Math.round((sec || 0) / 60), h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? h + 'h ' + mm + 'm' : mm + 'm';
}
export function money(n) {
  return APP_SETTINGS.currency + ' ' + (n || 0).toLocaleString(LOCALE, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// --- time-zone aware date helpers ---
function tzMs(x) { return x instanceof Date ? x.getTime() : typeof x === 'number' ? x : Date.now(); }
function dateISOInTz(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}
function weekdayOfISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dateISO(x) { return dateISOInTz(tzMs(x), APP_SETTINGS.timeZone); }

export function weekStartISO(x) {
  const iso = typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
    ? x : dateISOInTz(tzMs(x), APP_SETTINGS.timeZone);
  const diff = (weekdayOfISO(iso) - APP_SETTINGS.weekStartDay + 7) % 7;
  return shiftISO(iso, -diff);
}
export function weekEndISO(startISO) { return shiftISO(startISO, 6); }
export function addWeeks(startISO, n) { return shiftISO(startISO, n * 7); }
export function thisWeekStart() { return weekStartISO(new Date()); }

export function fmtISOday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  });
}
export function weekLabel(startISO) {
  const end = weekEndISO(startISO);
  const [ey] = end.split('-');
  return fmtISOday(startISO) + ' – ' + fmtISOday(end) + ', ' + ey;
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(LOCALE, {
    hour: '2-digit', minute: '2-digit', timeZone: APP_SETTINGS.timeZone,
  });
}
export function fmtDT(ms, opts) {
  return new Date(ms).toLocaleString(LOCALE, { ...(opts || {}), timeZone: APP_SETTINGS.timeZone });
}
export function breaksText(s) {
  if (!s || !s.breakEvents || !s.breakEvents.length) return null;
  return s.breakEvents
    .map((ev) => (ev.kind === 'lunch' ? '🍽' : '☕') + ' ' + fmtTime(ev.start) + '–' + (ev.end ? fmtTime(ev.end) : 'ongoing'))
    .join('   ');
}

// --- effective per-user settings (inherit global default) ---
export function effWorkerType(u) { return (u && u.workerType) || APP_SETTINGS.defaultWorkerType || 'remote'; }
export function effTrackMode(u) { return (u && u.trackMode) || APP_SETTINGS.defaultTrackMode || 'activity'; }
export function effBreaks(u) {
  return u && u.breaksEnabled ? u.breaksEnabled === 'yes' : !!APP_SETTINGS.defaultBreaksEnabled;
}

export function computePay(hoursWorked, a) {
  const rate = Number(a.hourlyRate) || 0;
  const otRate = Number(a.overtimeRate) || rate;
  const otThresh = a.overtimeThreshold === '' || a.overtimeThreshold == null ? Infinity : Number(a.overtimeThreshold);
  const wLimit = a.weeklyLimit === '' || a.weeklyLimit == null ? Infinity : Number(a.weeklyLimit);
  const billable = Math.min(hoursWorked, wLimit);
  const overLimit = Math.max(0, hoursWorked - wLimit);
  const reg = Math.min(billable, otThresh);
  const ot = Math.max(0, billable - otThresh);
  return { billable, overLimit, reg, ot, pay: reg * rate + ot * otRate, rate, otRate };
}
