# Time Tracker — Project Brief (read this first)

An Upwork-style time tracker. Two clients, one backend:

- **Web app** (Vite + React) → deployed on **Vercel**. The "lite" tracker:
  timer, projects, requests, payroll, receipts, manager approvals. Activity
  only counts while the browser tab is focused; **no screenshots** (browsers
  can't do silent screen capture).
- **Desktop app** (Electron, **Windows target**) → the full tracker: silent
  screenshots on a timer + real system-wide keyboard/mouse activity metering.
- **Backend:** **Supabase** (Postgres + Auth + Storage). Schema and RLS are
  already written in `supabase/schema.sql` — run it once in the Supabase SQL
  editor. Do NOT hand-edit the DB; change `schema.sql` and re-apply.

## Roles
- `admin` (manager) and `employee`. **First user to sign up becomes admin**
  (enforced by a DB trigger — see schema.sql).
- Employees track time and file **requests** to adjust/add/delete time.
  Managers approve requests, manage projects/assignments/rates, run payroll,
  mark weeks paid, and print receipts.

## Target structure
```
timetracker/
├── CLAUDE.md
├── shared/          # React components + Supabase data layer (imported by web & desktop)
│   ├── lib/supabase.js     # createClient + typed data helpers (replaces all Firebase calls)
│   └── components/         # ported from the original single-file app
├── web/             # Vite app; imports ../shared; deploys to Vercel
├── desktop/         # Electron; loads the same React UI + injects window.ttDesktop bridge
└── supabase/
    └── schema.sql   # already done
```
The web and desktop apps render the **same** React components. Desktop adds a
preload bridge exposing `window.ttDesktop` (the app already checks
`IS_DESKTOP = !!window.ttDesktop`), which provides `.start()`, `.stop()`,
`.onShot()`, and activity counters.

## Environment
- Supabase keys go in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (anon key is safe to ship — RLS is the real security boundary). Never commit `.env`.

## Build order (do these in sequence, verify each before moving on)
1. **DONE** — `supabase/schema.sql` (tables + RLS + storage bucket + first-user-is-admin trigger).
2. **Shared data layer** — `shared/lib/supabase.js`. Port every Firestore call
   from the original app to Supabase: `collection().onSnapshot` →
   `supabase.from().select()` + `supabase.channel()` realtime subscriptions;
   `.add()/.update()` → `.insert()/.update()`. Auth: Firebase auth → Supabase
   `auth.signUp/signInWithPassword/onAuthStateChange`.
3. **Web app on Vercel** — Vite scaffold, port the React components, get login →
   track → manager approve → payroll working end to end. Deploy.
4. **Desktop (Electron, Windows)** — wrap the same UI. Screenshots via Electron
   `desktopCapturer` uploaded to the `screenshots` Supabase Storage bucket at the
   configured interval (default 10 min). System-wide activity via a native module
   (**use `uiohook-napi`** — the maintained global keyboard/mouse hook; `iohook`
   is abandoned). Package with `electron-builder` for Windows (NSIS installer).
5. **Real activity metering (both clients)** — replaces the currently-dead meter.

## Fixes to bake in during the rebuild (these were bugs in the original)
- **Activity meter was never wired up.** Original wrote `keystrokes/clicks/
  activeSeconds: 0` but nothing incremented them. Implement for real:
  - Web: focus-gated `keydown`/`mousedown` listeners → counters → written into
    the session row on each tick.
  - Desktop: `uiohook-napi` global counters (works even when unfocused).
  - Define "active second" = a second in which ≥1 input event occurred; show
    activity % = active_seconds / duration_seconds.
- **Abandoned sessions.** If the app closes mid-run the session was never
  finalized. Use the new `is_live` column: set `true` on start, `false` on stop;
  on app load, find the user's own `is_live` sessions and close them out using
  `end_ms`/last tick.
- **Payroll privacy.** RLS now scopes payroll reads to owner-or-admin (the old
  Firebase rules let any employee read everyone's pay). Keep it that way.
- **Never ship the "test" security rules.** RLS is already correct in schema.sql.

## Original source
The old single-file Firebase version is kept for reference at
`reference/time_tracker_original.html` — port its UI/logic, discard its Firebase
plumbing. Its components are plain `React.createElement` (no JSX/Babel), so they
drop in with minimal changes.

## Conventions
- Money/time helpers, week-start logic, and `computePay` (regular/OT/weekly-limit)
  already exist in the original — reuse them verbatim.
- Weeks are configurable (default start = Saturday) and timezone-aware; keep that.
