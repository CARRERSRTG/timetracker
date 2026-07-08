import { getLang, setLang, useT } from './lib/i18n.js';

// Small language switcher (English / Español), persisted in localStorage.
export default function LangToggle() {
  const t = useT();
  return (
    <select
      aria-label={t('lang.label')}
      value={getLang()}
      onChange={(e) => setLang(e.target.value)}
      style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
    >
      <option value="en">EN</option>
      <option value="es">ES</option>
    </select>
  );
}
