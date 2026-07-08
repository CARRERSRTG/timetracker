# Time Tracker — Desktop (Electron, Windows)

Wraps the same React UI as the web app and adds the two things a browser can't do:

- **Silent screenshots** on a timer (`desktopCapturer`), uploaded to the private
  `screenshots` Supabase Storage bucket.
- **System-wide keyboard/mouse metering** (`uiohook-napi`) that counts activity
  even when the window is unfocused.

The renderer checks `IS_DESKTOP = !!(window.ttDesktop && window.ttDesktop.isDesktop)`
and, when true, uses the bridge instead of the focus-gated web listeners.

## The `window.ttDesktop` bridge (preload.js)

| Method | Purpose |
| --- | --- |
| `isDesktop` | `true` — feature flag the UI checks |
| `start({ sessionId, intervalMin })` | begin screenshots + reset/begin global metering |
| `stop()` | stop screenshots + metering |
| `onShot(cb)` | `cb({ sessionId, dataUrl })` per capture; renderer uploads it |
| `getActivity()` | `{ keystrokes, clicks }` accumulated since `start()` |

Screenshots are captured in the **main** process and uploaded from the
**renderer** (which owns the authenticated Supabase client).

## Run in development

Two terminals from the repo root:

```bash
# 1) start the web UI (Vite dev server on :5173)
npm run dev --prefix web

# 2) launch Electron pointed at it
npm run dev --prefix desktop
```

`desktop`'s dev script sets `TT_DEV_URL=http://localhost:5173`, so the Electron
window loads the live dev UI (hot reload works).

## Package a Windows installer

```bash
npm run build --prefix web        # produces web/dist (loaded over file://)
npm run build --prefix desktop    # electron-builder → NSIS installer in desktop/dist
```

The build copies `web/dist` into the app resources (`resources/web`), which the
main process loads when `TT_DEV_URL` is not set.

## Notes / gotchas

- **uiohook-napi** is a native module. If its prebuilt binary is missing for
  your Node/Electron ABI, run `npx electron-rebuild -f -w uiohook-napi` in
  `desktop/`. The app still launches without it (global metering just disabled).
- On Windows, global hooks may prompt for accessibility/input permissions the
  first time — allow them.
- `.env` (Supabase keys) is baked into `web/dist` at web build time; the anon
  key is safe to ship (RLS is the security boundary).
