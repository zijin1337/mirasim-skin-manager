// Re-apply the skin manager after a Mirasim app update.
//
// A Mirasim update ships a fresh official app.asar, which drops the loader —
// the skins themselves and the user's pick live outside the app and survive.
// This script notices that and re-runs install.mjs. Registered as a Windows
// scheduled task (see register-autosync.ps1) so it keeps working with no
// session or agent running.
//
//   node autosync.mjs          check, and reinstall if the loader is gone
//   node autosync.mjs --force  reinstall even if it looks installed
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import asar from '@electron/asar';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const RES = process.env.MIRASIM_RESOURCES
  || path.join(os.homedir(), 'AppData/Local/Programs/@mirasimdesktop/resources');
const ASAR = path.join(RES, 'app.asar');
const LOG = path.join(HERE, 'autosync.log');
const LOADER_NAME = 'mirasim-skinmgr-loader.js';

const log = (msg) => {
  const line = new Date().toISOString() + '  ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  // keep the log from growing without bound
  try {
    const s = fs.statSync(LOG);
    if (s.size > 200_000) {
      const keep = fs.readFileSync(LOG, 'utf8').split('\n').slice(-500).join('\n');
      fs.writeFileSync(LOG, keep);
    }
  } catch (e) {}
};

try {
  if (!fs.existsSync(ASAR)) { log('no app.asar at ' + ASAR + ' — app uninstalled? skipping'); process.exit(0); }

  // An update rewrites the asar; never touch one mid-write. mtime is useless
  // here (both the NSIS installer and fs.copyFileSync preserve the source
  // timestamp on Windows), so prove the file is settled and parseable instead.
  const st = fs.statSync(ASAR);
  if (st.size < 5_000_000) { log('asar only ' + st.size + ' bytes — looks incomplete, skipping'); process.exit(0); }

  let skinned = false;
  try {
    skinned = String(asar.getRawHeader(ASAR).headerString).includes(LOADER_NAME);
    JSON.parse(asar.extractFile(ASAR, 'package.json'));   // a truncated archive throws here
  } catch (e) {
    log('asar unreadable (' + e.message + ') — mid-update? retry next tick');
    process.exit(0);
  }

  const force = process.argv.includes('--force');
  if (skinned && !force) process.exit(0);   // steady state: silent, no log spam

  // settled? same size after a beat, or the installer is still copying
  const before = st.size;
  await new Promise((r) => setTimeout(r, 2000));
  if (fs.statSync(ASAR).size !== before) { log('asar size still changing — retry next tick'); process.exit(0); }

  let version = 'unknown';
  try { version = JSON.parse(asar.extractFile(ASAR, 'package.json')).version; } catch (e) {}
  log('loader missing (app ' + version + ') — reinstalling…');

  const out = execFileSync(process.execPath, [path.join(HERE, 'install.mjs')], {
    cwd: HERE, encoding: 'utf8', timeout: 300_000,
  });
  const lines = out.trim().split('\n').filter(Boolean);
  // surface patch misses loudly: a new app build can rename the literals the
  // titlebar/boot-color patches key off, and the skin still installs without them
  for (const w of lines.filter((l) => /WARNING/.test(l))) log(w.trim());
  log('install.mjs done: ' + lines.slice(-3).join(' | '));
  log('skin manager restored for app ' + version + ' — takes effect on the next app launch');
} catch (e) {
  log('FAILED: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  process.exit(1);
}
