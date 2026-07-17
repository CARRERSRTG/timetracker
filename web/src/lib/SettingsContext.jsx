import { createContext, useContext } from 'react';
import { APP_SETTINGS } from './helpers.js';

// Mirrors APP_SETTINGS into React so components re-render on live changes.
// The module global (APP_SETTINGS) is still the source the pure helpers read;
// this context exists only to trigger renders when settings change.
const SettingsContext = createContext(APP_SETTINGS);

export function SettingsProvider({ value, children }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
