import { useTheme, toggleTheme } from './lib/theme.js';

// Sun/moon button that flips between light and dark, persisted in localStorage.
export default function ThemeToggle() {
  const theme = useTheme();
  const dark = theme !== 'light';
  return (
    <button
      className="btn-ghost btn-sm"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={toggleTheme}
      style={{ lineHeight: 1 }}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
