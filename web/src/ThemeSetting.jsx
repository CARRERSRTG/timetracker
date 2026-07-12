import { useTheme, setTheme } from './lib/theme.js';
import { useT } from './lib/i18n.js';

// Appearance control for the Settings views: a labeled Light/Dark segmented
// switch. The theme is a per-device preference (localStorage), so it applies
// immediately — no Save button needed.
export default function ThemeSetting() {
  const t = useT();
  const theme = useTheme();
  const opts = [
    { key: 'light', label: '☀️ ' + t('theme.light') },
    { key: 'dark', label: '🌙 ' + t('theme.dark') },
  ];
  return (
    <>
      <h3 style={{ color: 'var(--muted)' }}>{t('theme.appearance')}</h3>
      <div className="pbtns" style={{ marginTop: 4 }}>
        {opts.map((o) => (
          <button
            key={o.key}
            type="button"
            className={'pbtn' + (theme === o.key ? ' sel' : '')}
            onClick={() => setTheme(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>{t('theme.note')}</p>
    </>
  );
}
