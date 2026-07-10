'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Bridge exposed to the shared React UI. The app checks
// IS_DESKTOP = !!(window.ttDesktop && window.ttDesktop.isDesktop).
contextBridge.exposeInMainWorld('ttDesktop', {
  isDesktop: true,

  // begin a tracking session: start screenshots + reset/begin global metering
  start: (opts) => ipcRenderer.invoke('tt:start', opts),

  // end the session: stop screenshots + global metering
  stop: () => ipcRenderer.invoke('tt:stop'),

  // register a callback fired each time a screenshot is captured.
  // cb receives { sessionId, dataUrl }. Returns an unsubscribe function.
  onShot: (cb) => {
    const listener = (_evt, data) => cb(data);
    ipcRenderer.on('tt:shot', listener);
    return () => ipcRenderer.removeListener('tt:shot', listener);
  },

  // current system-wide counters { keystrokes, clicks } since session start
  getActivity: () => ipcRenderer.invoke('tt:getActivity'),

  // smart-idle context: { app, title, movement } — movement is 0..1 fraction of
  // the screen that changed since the last probe
  getContext: () => ipcRenderer.invoke('tt:context'),

  // fired when the OS locks the screen or the machine sleeps; cb receives the
  // reason ('lock-screen' | 'suspend'). Returns an unsubscribe function.
  onPower: (cb) => {
    const listener = (_evt, reason) => cb(reason);
    ipcRenderer.on('tt:power', listener);
    return () => ipcRenderer.removeListener('tt:power', listener);
  },

  // the installed app version (from package.json), for the UI version label
  getVersion: () => ipcRenderer.invoke('tt:getVersion'),

  // tell the main process the upload outcome so the floating toast can update
  // its text ('saved' | 'queued' | 'error')
  notifyShotStatus: (status) => ipcRenderer.invoke('tt:shotStatus', status),
});
