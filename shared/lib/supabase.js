// Supabase data layer — replaces every Firebase/Firestore call from
// reference/time_tracker_original.html.html. Imported by both web/ and desktop/.
//
// Row <-> app object convention: Postgres columns are snake_case, the app
// (ported from the original Firestore version) works in camelCase. Conversion
// is one level deep only — jsonb columns (payload, lines, adjustments, data,
// break_events) are passed through untouched, since their keys are free-form
// app data, not table columns.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configOk = Boolean(supabaseUrl && supabaseAnonKey);

if (!configOk) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env file.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const DEFAULT_SETTINGS = {
  currency: '$',
  weekStartDay: 6,
  payPeriod: 'weekly',
  paymentMethods: ['Cash', 'Bank transfer', 'PayPal'],
  defaultWorkerType: 'remote',
  defaultTrackMode: 'activity',
  defaultBreaksEnabled: true,
  adjustmentTypes: ['Bonus', 'Advance', 'Deduction'],
  screenshotIntervalMin: 10,
  companyName: '', companyAddress: '', companyTaxId: '',
  companyPhone: '', companyEmail: '',
};

// ---------------------------------------------------------------------
// key case conversion (shallow — see note above)
// ---------------------------------------------------------------------
function toCamelKey(k) { return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }
function toSnakeKey(k) { return k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()); }

function rowToCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v;
  return out;
}

function toSnakeRow(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toSnakeKey(k)] = v;
  return out;
}

// ---------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------
const AUTH_ERROR_MAP = {
  'Invalid login credentials': 'Wrong email or password.',
  'User already registered': 'That email is already registered.',
  'Password should be at least 6 characters.': 'Password must be at least 6 characters.',
  'Unable to validate email address: invalid format': 'Invalid email.',
};

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong.';
  const msg = err.message || String(err);
  return AUTH_ERROR_MAP[msg] || msg;
}

export const auth = {
  // name is stored in auth user_metadata; the on_auth_user_created trigger
  // copies it into profiles.name and decides admin-vs-employee.
  async signUp({ email, password, name }) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  // callback(user|null, session|null)
  onAuthStateChange(callback) {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null, session);
    });
    return () => sub.subscription.unsubscribe();
  },
};

// ---------------------------------------------------------------------
// generic realtime list helper (initial select + refetch on any change)
// ---------------------------------------------------------------------
function subscribeList(table, { query, realtimeFilter, orderBy } = {}, callback) {
  let cancelled = false;

  async function load() {
    let q = supabase.from(table).select('*');
    if (query) q = query(q);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    const { data, error } = await q;
    if (cancelled) return;
    if (error) { console.error(`[${table}] load failed`, error); return; }
    callback((data || []).map(rowToCamel));
  }

  load();

  const changeConfig = { event: '*', schema: 'public', table };
  if (realtimeFilter) changeConfig.filter = realtimeFilter;
  const channel = supabase
    .channel(`${table}:${realtimeFilter || 'all'}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', changeConfig, load)
    .subscribe();

  return () => { cancelled = true; supabase.removeChannel(channel); };
}

function makeCrud(table) {
  return {
    async insert(data) {
      const { data: row, error } = await supabase.from(table).insert(toSnakeRow(data)).select().single();
      if (error) throw error;
      return rowToCamel(row);
    },
    async update(id, patch) {
      const { error } = await supabase.from(table).update(toSnakeRow(patch)).eq('id', id);
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },
    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error) throw error;
      return rowToCamel(data);
    },
  };
}

// ---------------------------------------------------------------------
// profiles (was: users)
// ---------------------------------------------------------------------
export const profiles = {
  async get(id) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (error) throw error;
    return rowToCamel(data);
  },
  async update(id, patch) {
    const { error } = await supabase.from('profiles').update(toSnakeRow(patch)).eq('id', id);
    if (error) throw error;
  },
  async remove(id) {
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  },
  // fires with the profile object, or null while it doesn't exist yet
  subscribe(id, callback) {
    return subscribeList('profiles', {
      query: (q) => q.eq('id', id),
      realtimeFilter: `id=eq.${id}`,
    }, (rows) => callback(rows[0] || null));
  },
  subscribeAll(callback) {
    return subscribeList('profiles', { orderBy: { column: 'created_at' } }, callback);
  },
};

// ---------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------
export const projects = {
  ...makeCrud('projects'),
  subscribeAll(callback) {
    return subscribeList('projects', { orderBy: { column: 'created_at' } }, callback);
  },
};

// ---------------------------------------------------------------------
// assignments
// ---------------------------------------------------------------------
export const assignments = {
  ...makeCrud('assignments'),
  subscribeByEmployee(employeeUid, callback) {
    return subscribeList('assignments', {
      query: (q) => q.eq('employee_uid', employeeUid),
      realtimeFilter: `employee_uid=eq.${employeeUid}`,
    }, callback);
  },
  subscribeAll(callback) {
    return subscribeList('assignments', {}, callback);
  },
  async listByEmployee(employeeUid) {
    const { data, error } = await supabase.from('assignments').select('*').eq('employee_uid', employeeUid);
    if (error) throw error;
    return (data || []).map(rowToCamel);
  },
};

// ---------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------
export const sessions = {
  ...makeCrud('sessions'),
  subscribeByEmployee(employeeUid, callback) {
    return subscribeList('sessions', {
      query: (q) => q.eq('employee_uid', employeeUid),
      realtimeFilter: `employee_uid=eq.${employeeUid}`,
    }, callback);
  },
  subscribeFromDate(startISO, callback) {
    return subscribeList('sessions', { query: (q) => q.gte('date', startISO) }, callback);
  },
  subscribeDateRange(startISO, endISO, callback) {
    return subscribeList('sessions', { query: (q) => q.gte('date', startISO).lte('date', endISO) }, callback);
  },
  async listByProject(projectId) {
    const { data, error } = await supabase.from('sessions').select('*').eq('project_id', projectId);
    if (error) throw error;
    return (data || []).map(rowToCamel);
  },
  // abandoned-session recovery: sessions still marked is_live from a prior run
  async listLive(employeeUid) {
    const { data, error } = await supabase
      .from('sessions').select('*').eq('employee_uid', employeeUid).eq('is_live', true);
    if (error) throw error;
    return (data || []).map(rowToCamel);
  },
};

// ---------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------
export const requests = {
  ...makeCrud('requests'),
  subscribeByEmployee(employeeUid, callback) {
    return subscribeList('requests', {
      query: (q) => q.eq('employee_uid', employeeUid),
      realtimeFilter: `employee_uid=eq.${employeeUid}`,
    }, callback);
  },
  subscribeAll(callback) {
    return subscribeList('requests', {}, callback);
  },
};

// ---------------------------------------------------------------------
// payrolls
// ---------------------------------------------------------------------
export const payrolls = {
  ...makeCrud('payrolls'),
  subscribeByEmployee(employeeUid, callback) {
    return subscribeList('payrolls', {
      query: (q) => q.eq('employee_uid', employeeUid),
      realtimeFilter: `employee_uid=eq.${employeeUid}`,
    }, callback);
  },
  subscribeByWeek(weekOf, callback) {
    return subscribeList('payrolls', { query: (q) => q.eq('week_of', weekOf) }, callback);
  },
  async upsert(row) {
    const { data, error } = await supabase.from('payrolls').upsert(toSnakeRow(row)).select().single();
    if (error) throw error;
    return rowToCamel(data);
  },
};

// ---------------------------------------------------------------------
// settings — single 'app' row, all options live in the jsonb `data` column
// ---------------------------------------------------------------------
export const settings = {
  async get() {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 'app').single();
    if (error) throw error;
    return { ...DEFAULT_SETTINGS, ...data.data };
  },
  subscribe(callback) {
    return subscribeList('settings', {
      query: (q) => q.eq('id', 'app'),
      realtimeFilter: `id=eq.app`,
    }, (rows) => {
      const row = rows[0];
      callback(row ? { ...DEFAULT_SETTINGS, ...row.data } : DEFAULT_SETTINGS);
    });
  },
  async update(patch) {
    const current = await this.get();
    const merged = { ...current, ...patch };
    const { error } = await supabase.from('settings').update({ data: merged }).eq('id', 'app');
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------
export const audit = {
  async log(action, detail) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit').insert({ who: user?.id ?? null, action, detail: detail || '' });
    } catch (e) { /* best-effort, matches original .catch(()=>{}) */ }
  },
  subscribeRecent(limitN, callback) {
    return subscribeList('audit', { orderBy: { column: 'at', ascending: false } }, (rows) => {
      callback(rows.slice(0, limitN || 150));
    });
  },
};

// ---------------------------------------------------------------------
// screenshots — private storage bucket, path: <employeeUid>/<sessionId>/<ts>.jpg
// ---------------------------------------------------------------------
export const screenshots = {
  async upload({ employeeUid, sessionId, blob, date }) {
    const path = `${employeeUid}/${sessionId || 'misc'}/${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('screenshots')
      .upload(path, blob, { contentType: 'image/jpeg' });
    if (upErr) throw upErr;
    const { data, error } = await supabase
      .from('screenshots')
      .insert({ employee_uid: employeeUid, session_id: sessionId || null, path, date: date || null })
      .select().single();
    if (error) throw error;
    return rowToCamel(data);
  },
  async signedUrl(path, expiresIn = 3600) {
    const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
  subscribeByEmployee(employeeUid, callback) {
    return subscribeList('screenshots', {
      query: (q) => q.eq('employee_uid', employeeUid),
      realtimeFilter: `employee_uid=eq.${employeeUid}`,
      orderBy: { column: 'taken_at', ascending: false },
    }, callback);
  },
  // admin view: most recent shots across everyone (RLS lets admin read all)
  subscribeRecent(limitN, callback) {
    return subscribeList('screenshots', {
      orderBy: { column: 'taken_at', ascending: false },
    }, (rows) => callback(rows.slice(0, limitN || 120)));
  },
  async remove(id) {
    const { error } = await supabase.from('screenshots').delete().eq('id', id);
    if (error) throw error;
  },
  // manual retention: delete shots older than `days`, both the storage files
  // and the metadata rows. Returns how many were removed.
  async purgeOlderThan(days = 14) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase
      .from('screenshots').select('id,path').lt('taken_at', cutoff);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return 0;
    const paths = rows.map((r) => r.path).filter(Boolean);
    if (paths.length) {
      const { error: sErr } = await supabase.storage.from('screenshots').remove(paths);
      if (sErr) throw sErr;
    }
    const { error: dErr } = await supabase.from('screenshots').delete().lt('taken_at', cutoff);
    if (dErr) throw dErr;
    return rows.length;
  },
};
