import { useEffect, useState } from 'react';

// Light / dark theme, persisted in localStorage and applied via a data-theme
// attribute on <html> (the CSS variables in styles.css switch on it). Default is
// dark (the app's original look). Applied immediately on import to avoid a flash.
const KEY = 'tt_theme';
let theme = (() => { try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; } })();

function apply(t) { try { document.documentElement.dataset.theme = t; } catch { /* ignore */ } }
apply(theme);

const subs = new Set();
export function getTheme() { return theme; }
export function setTheme(t) {
  theme = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  apply(theme);
  subs.forEach((f) => f(theme));
}
export function toggleTheme() { setTheme(theme === 'dark' ? 'light' : 'dark'); }
export function useTheme() {
  const [, force] = useState(theme);
  useEffect(() => { const f = (t) => force(t); subs.add(f); return () => subs.delete(f); }, []);
  return theme;
}
