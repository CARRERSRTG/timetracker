# Releasing the desktop app + turning on auto-update

Follow this on your **Windows machine** (not needed for the web app). This is
already configured for GitHub user **`CARRERSRTG`** and repo **`timetracker`**
(see `desktop/package.json` → `build.publish`). Auto-update is wired in the code;
these steps give it a release feed to check against.

---

## Part 1 — Create the GitHub repo (one time)

1. Go to <https://github.com/new>.
2. **Repository name:** `timetracker`
3. Leave it **Public** (simplest for auto-update). *(Private also works but the
   app then needs a token embedded — avoid unless you need the code private.)*
4. Do **NOT** check "Add a README / .gitignore / license" (the project already
   has files).
5. Click **Create repository**. Leave the page open — you'll copy the URL.

## Part 2 — Push your code to it (one time)

Open **PowerShell** in the project folder
(`C:\Users\andre\Documents\claude code work RTG\timetracker`) and run:

```powershell
git remote add origin https://github.com/CARRERSRTG/timetracker.git
git branch -M main
git push -u origin main
```

- If it asks you to sign in, a browser window opens — log in to GitHub and
  approve. (That uses Git Credential Manager; no token needed just to push.)
- Refresh the GitHub page — your code should be there.

## Part 3 — Make a Personal Access Token (one time)

electron-builder needs this to upload releases.

1. Go to <https://github.com/settings/tokens?type=beta> (Fine-grained tokens) →
   **Generate new token**.
   - **Token name:** `timetracker-release`
   - **Expiration:** 90 days (or longer)
   - **Repository access:** Only select repositories → pick `timetracker`
   - **Permissions → Repository permissions → Contents:** **Read and write**
   - Generate, then **copy the token** (you won't see it again).
   *(Classic tokens work too: <https://github.com/settings/tokens> → Generate →
   check the `repo` scope.)*

## Part 4 — Build and publish the first release

In PowerShell from the project root:

```powershell
$env:GH_TOKEN = "PASTE_YOUR_TOKEN_HERE"
npm install
npm run build --prefix web
cd desktop
..\node_modules\.bin\electron-builder --win nsis --publish always
cd ..
```

What this does:
- Builds the web UI, packages the Windows app, and **uploads** the installer
  (`Time Tracker Setup 0.0.0.exe`) plus a `latest.yml` manifest to a **GitHub
  Release** tagged `v0.0.0`.
- Check <https://github.com/CARRERSRTG/timetracker/releases> — you'll see it.

Hand that `.exe` to your employees to install. This is the full build (screenshots
+ global keystrokes + smart idle — all native modules included, because your
machine doesn't strip them like the cloud sandbox did).

## Part 5 — Ship an update (every time after)

1. Make your code changes.
2. Bump the version in `desktop/package.json`:
   ```jsonc
   "version": "0.0.1",   // was 0.0.0
   ```
3. Republish:
   ```powershell
   $env:GH_TOKEN = "PASTE_YOUR_TOKEN_HERE"
   npm run build --prefix web
   cd desktop
   ..\node_modules\.bin\electron-builder --win nsis --publish always
   cd ..
   ```
4. That's it. **Installed apps update themselves:** on next launch each app sees
   `0.0.1` in the feed, downloads it in the background, and prompts the user to
   restart into the new version. You don't redistribute the `.exe`.

## Part 6 — Prove auto-update works

1. Install `0.0.0` on a test PC and run it once (let it check — nothing newer yet).
2. Do Part 5 to publish `0.0.1`.
3. Close and reopen the `0.0.0` app. Within a few seconds it downloads `0.0.1`
   and shows a "restart to update" prompt. Restart → it's on `0.0.1`.

## Notes / troubleshooting

- **`GH_TOKEN` not set** → electron-builder builds but skips upload. Set it (Part 4).
- **404 / permission errors on publish** → the token lacks Contents:write, or the
  `owner`/`repo` in `desktop/package.json` don't match your actual repo.
- **`app-builder.exe ENOENT`** (the error we hit in the cloud) → only happens in
  the restricted sandbox; a normal `npm install` on your machine avoids it.
- The app only checks for updates in the **packaged** build, not `npm run dev`.
- Never commit your token. Setting `$env:GH_TOKEN` per session is safest.
