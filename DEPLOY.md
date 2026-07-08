# Deploying & operating Time Tracker

## 1. Web app → Vercel

The web app is a standard Vite build in `web/`. [web/vercel.json](web/vercel.json)
sets the framework, build command, output dir, and an SPA rewrite.

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In Vercel → **Add New Project** → import the repo.
3. Set **Root Directory** to `web`.
4. Add the two environment variables (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = `https://qklsxhzmbnglgzufdbmz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = *(your anon key)*
5. Deploy. Vercel auto-detects Vite and serves `dist/`.

The anon key is safe to expose — Row Level Security is the real boundary. Never
put the `service_role` key in the web app.

## 2. Supabase email (password reset + optional confirmation)

Out of the box Supabase sends auth emails from its shared address with low rate
limits — fine for testing, not for production.

1. Supabase Dashboard → **Authentication → Providers → Email**: decide whether
   **Confirm email** is on. If on, new users must click a link before they can
   sign in (they'll then still land on the pending-approval screen until a
   manager activates them).
2. **Authentication → Emails**: customize the templates (branding, Spanish copy).
3. For real sending volume, set up **SMTP** (Project Settings → Auth → SMTP) with
   a provider like Resend, SendGrid, or Amazon SES, and set a verified sender.
4. Add your Vercel URL under **Authentication → URL Configuration → Redirect URLs**
   so password-reset links point back to your deployed app.

## 3. Desktop auto-update (electron-updater)

The desktop app checks for updates on launch (packaged builds only) via
`electron-updater`. It's wired in [desktop/main.js](desktop/main.js) and
configured to publish to GitHub Releases in
[desktop/package.json](desktop/package.json) (`build.publish`).

1. Edit `build.publish` `owner`/`repo` to your GitHub repo.
2. Create a GitHub token with `repo` scope and export it as `GH_TOKEN`.
3. Build **and publish** a release:
   ```powershell
   npm run build --prefix web
   cd desktop
   ..\node_modules\.bin\electron-builder --win nsis --publish always
   ```
   This uploads the installer + `latest.yml` to a GitHub Release. Installed apps
   pick up the next version automatically. Bump `version` in
   `desktop/package.json` for each release.

If you don't want auto-update, remove the `publish` block; the updater no-ops
without it.

## 4. App icon

`desktop/package.json` references `build/icon.ico`. Provide a **256×256**
(multi-resolution) `desktop/build/icon.ico`:

- A source SVG lives at [desktop/build/icon.svg](desktop/build/icon.svg).
- Convert it to `.ico` with any tool, e.g. https://icoconvert.com, ImageMagick
  (`magick icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico`), or
  `electron-icon-builder`.

Until an `.ico` exists, electron-builder uses the default Electron icon (the
build still succeeds — it just logs a notice).

## 5. Screenshot retention & realtime (one-time SQL)

If not already applied, run the `REALTIME`, `MIGRATIONS`, and
`SCREENSHOT RETENTION` blocks from [supabase/schema.sql](supabase/schema.sql) in
the Supabase SQL editor (see the in-app prompts and README). Realtime powers
live updates and notifications; the pg_cron job auto-deletes old screenshots.
