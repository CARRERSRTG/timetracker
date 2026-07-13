# delete-user Edge Function

Admin-only permanent user deletion. The browser app can't delete `auth.users`
(it only holds the anon key), so this function does it server-side with the
service-role key after verifying the caller is a manager. Deleting the auth user
cascades to their profile, assignments, sessions, payrolls, requests and
screenshots, and frees the email to be invited again.

## Deploy — Option A: Supabase dashboard (no CLI)
1. Dashboard → **Edge Functions** → **Create a function** → name it exactly
   `delete-user`.
2. Paste the contents of `index.ts` and **Deploy**.
3. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no
   secrets to set.

## Deploy — Option B: Supabase CLI
```bash
supabase link --project-ref qklsxhzmbnglgzufdbmz
supabase functions deploy delete-user
```

## Notes
- JWT verification stays ON (default). The app sends the manager's session token
  automatically via `supabase.functions.invoke`.
- Guards: can't delete yourself, can't delete the only manager.
