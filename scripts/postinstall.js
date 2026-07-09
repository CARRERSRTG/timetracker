// After the root install, install the desktop app's own dependencies (it is a
// standalone package, not a workspace, so electron-builder gets the normal
// self-contained node_modules layout). The env guard prevents the nested
// install from re-triggering this postinstall (which caused an infinite loop).
'use strict';
const { execSync } = require('node:child_process');
const path = require('node:path');

if (process.env.TT_SKIP_DESKTOP_INSTALL) process.exit(0);

const desktopDir = path.join(__dirname, '..', 'desktop');
try {
  execSync('npm install', {
    cwd: desktopDir,
    stdio: 'inherit',
    env: { ...process.env, TT_SKIP_DESKTOP_INSTALL: '1' },
  });
} catch (e) {
  console.error('desktop install failed:', e.message);
  process.exit(1);
}
