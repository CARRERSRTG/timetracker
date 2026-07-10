// Single source of truth for the version shown in the UI. Bump this together
// with desktop/package.json on every release (see the release workflow).
// On desktop we prefer the real runtime version from the app (app.getVersion()
// via the ttDesktop bridge); this constant is the fallback and the web value.
export const APP_VERSION = '0.0.9';
