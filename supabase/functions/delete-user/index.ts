// Admin-only "hard delete a user" Edge Function.
//
// The browser app only holds the public anon key, which (correctly) cannot delete
// rows from auth.users. This function runs with the service-role key server-side,
// verifies the caller is a manager, and deletes the auth user — which cascades to
// their profile, assignments, sessions, payrolls, requests and screenshots (see
// the on-delete-cascade FKs in schema.sql) and frees the email for re-use.
//
// Deploy:  supabase functions deploy delete-user
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Identify the caller from their JWT.
    const { data: callerData, error: cErr } = await admin.auth.getUser(jwt);
    if (cErr || !callerData?.user) return json({ error: 'Invalid session' }, 401);
    const callerId = callerData.user.id;

    // Caller must be a manager (admin).
    const { data: me } = await admin.from('profiles').select('role').eq('id', callerId).single();
    if (!me || me.role !== 'admin') return json({ error: 'Managers only' }, 403);

    const { userId } = await req.json().catch(() => ({}));
    if (!userId) return json({ error: 'Missing userId' }, 400);
    if (userId === callerId) return json({ error: 'You cannot delete your own account here.' }, 400);

    // Never delete the last remaining manager.
    const { data: target } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (target?.role === 'admin') {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if ((count ?? 0) <= 1) return json({ error: 'Cannot delete the only manager.' }, 400);
    }

    // Best-effort: remove the user's screenshot files (Storage isn't covered by
    // the DB cascade). Folder convention is <userId>/...
    try {
      const { data: files } = await admin.storage.from('screenshots').list(userId, { limit: 1000 });
      if (files?.length) {
        await admin.storage.from('screenshots').remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch (_e) { /* non-fatal */ }

    // Delete the auth user — everything else cascades via FKs.
    const { error: dErr } = await admin.auth.admin.deleteUser(userId);
    if (dErr) return json({ error: dErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
