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
  appName: 'TimeTracker',
  currency: '$',
  timeZone: BROWSER_TZ,
  weekStartDay: 6, // 0=Sun ... 6=Sat (default Saturday)
  defaultWorkerType: 'remote',
  defaultTrackMode: 'activity',
  defaultBreaksEnabled: true,
  idleLimitMin: 5, // stop counting after this many minutes of no input (0 = off)
  smartIdle: true, // count input-idle time when the screen is active in a work app (desktop)
  workApps: ['Meet', 'Zoom', 'Teams', 'Webex', 'Skype', 'RingCentral', 'Slack', 'Claude', 'ChatGPT',
    'Docs', 'Sheets', 'Slides', 'Word', 'Excel', 'PowerPoint', 'Outlook', 'Gmail',
    'Visual Studio Code', 'VS Code', 'Figma', 'Notion', 'Loom', 'Jira', 'Linear'],
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

export function weekStartISO(x, weekStartDay) {
  const wsd = weekStartDay == null ? APP_SETTINGS.weekStartDay : Number(weekStartDay);
  const iso = typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
    ? x : dateISOInTz(tzMs(x), APP_SETTINGS.timeZone);
  const diff = (weekdayOfISO(iso) - wsd + 7) % 7;
  return shiftISO(iso, -diff);
}
export function weekEndISO(startISO) { return shiftISO(startISO, 6); }
export function addWeeks(startISO, n) { return shiftISO(startISO, n * 7); }
export function addDaysISO(iso, n) { return shiftISO(iso, n); }
export function thisWeekStart() { return weekStartISO(new Date()); }

// "Sat, Jul 4, 2026" for a YYYY-MM-DD string
export function fmtDayLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// "3 min ago" / "2 hrs ago" / "1 day ago"
export function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' hr' + (h > 1 ? 's' : '') + ' ago';
  const d = Math.floor(h / 24);
  return d + ' day' + (d > 1 ? 's' : '') + ' ago';
}

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

// --- pay-period helpers (weekly | biweekly | monthly) ---
// Biweekly blocks are anchored to a fixed Saturday so they stay consistent.
const BIWEEK_ANCHOR = '1970-01-03'; // a Saturday
function daysBetween(isoA, isoB) {
  const [ay, am, ad] = isoA.split('-').map(Number);
  const [by, bm, bd] = isoB.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function monthStartISO(iso) { return iso.slice(0, 7) + '-01'; }
function monthEndISO(iso) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}
function addMonthsISO(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function periodStartISO(x, payPeriod) {
  const p = payPeriod || APP_SETTINGS.payPeriod || 'weekly';
  if (p === 'monthly') {
    const iso = typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : dateISO(x);
    return monthStartISO(iso);
  }
  const wStart = weekStartISO(x);
  if (p === 'biweekly') {
    const weeks = Math.floor(daysBetween(BIWEEK_ANCHOR, wStart) / 7);
    return ((weeks % 2) + 2) % 2 === 0 ? wStart : shiftISO(wStart, -7);
  }
  return wStart; // weekly
}
export function periodEndISO(periodStart, payPeriod) {
  const p = payPeriod || APP_SETTINGS.payPeriod || 'weekly';
  if (p === 'monthly') return monthEndISO(periodStart);
  if (p === 'biweekly') return shiftISO(periodStart, 13);
  return shiftISO(periodStart, 6);
}
export function addPeriod(periodStart, n, payPeriod) {
  const p = payPeriod || APP_SETTINGS.payPeriod || 'weekly';
  if (p === 'monthly') return addMonthsISO(periodStart, n);
  if (p === 'biweekly') return shiftISO(periodStart, n * 14);
  return shiftISO(periodStart, n * 7);
}
export function thisPeriodStart(payPeriod) { return periodStartISO(new Date(), payPeriod); }
export function periodLabel(periodStart, payPeriod) {
  const p = payPeriod || APP_SETTINGS.payPeriod || 'weekly';
  if (p === 'weekly') return weekLabel(periodStart);
  const end = periodEndISO(periodStart, p);
  if (p === 'monthly') {
    const [y, m] = periodStart.split('-').map(Number);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(LOCALE, { month: 'long', timeZone: 'UTC' });
    return name + ' ' + y;
  }
  return fmtISOday(periodStart) + ' – ' + fmtISOday(end) + ', ' + end.split('-')[0];
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
