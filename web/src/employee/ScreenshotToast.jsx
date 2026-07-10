// The "screenshot captured" popup is now a native always-on-top window owned by
// the desktop main process (see showShotToast in desktop/main.js), so it shows
// even when the app is minimized/hidden — like Upwork. This in-app toast is kept
// as a no-op to avoid a duplicate popup; the render tree still mounts it so the
// component contract is unchanged.
export default function ScreenshotToast() {
  return null;
}
