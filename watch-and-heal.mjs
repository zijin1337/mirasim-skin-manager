// Resident watcher: reinstall the skin the moment an app update drops it,
// and SAY SO — a silent repair reads as a broken skin to the person watching
// the window.
//
// Why this exists: the scheduled task polls, and polling loses the race every
// time. An update lands seconds before the app relaunches; a once-a-minute
// tick shows up after the window has already read the unpatched files — and
// Windows' minute-level repetition also just skips beats after sleep/wake
// (observed: a 4-minute gap exactly across an update). Watching the
// filesystem removes the cadence from the problem.
//
//   node watch-and-heal.mjs           run resident (exits at once if one is
//                                     already running — safe to fire blindly)
//
// The scheduled task now fires THIS every minute: alive -> instant exit,
// dead -> becomes the new watcher. Watchdog semantics for free.
//
// Repairs are delegated to autosync.mjs, which owns every guard (size floor,
// parseability, settle recheck, payload-gap detection, logging). This file
// only decides WHEN to run it and tells the user what happened.
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const RES = process.env.MIRASIM_RESOURCES ||
  path.join(os.homedir(), 'AppData/Local/Programs/@mirasimdesktop/resources');
const UPD = path.join(os.homedir(), '.mirasim', 'app');
const LOG = path.join(HERE, 'autosync.log');   // one shared journal, one place to look
const MUTEX_PORT = 49337;                      // single-instance lock, cheapest kind

const log = (msg) => {
  const line = new Date().toISOString() + '  [watch] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
};

/* ---- the user-facing half: a toast when a repair lands ----
   Dependency-free: a hidden PowerShell with a Windows.Forms balloon, which
   Win11 renders as a normal toast. Fire-and-forget; a failed toast must never
   take the watcher down. */
function toast(text) {
  const ps =
    "Add-Type -AssemblyName System.Windows.Forms;" +
    "$n = New-Object System.Windows.Forms.NotifyIcon;" +
    "$n.Icon = [System.Drawing.SystemIcons]::Information;" +
    "$n.Visible = $true;" +
    "$n.ShowBalloonTip(12000, 'Clove 皮肤', '" + text.replace(/'/g, "''") + "', 'Info');" +
    "Start-Sleep -Seconds 12; $n.Dispose()";
  try {
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {}
}

/* ---- the repair: run autosync, read its own words for what happened ---- */
let healing = false;
// A repair REWRITES app.asar, which trips this very watch. Without a quiet
// window afterwards the thing chases its own tail: heal, write, detect, heal.
// It converged (the next pass finds the loader and exits), but it burned two
// pointless runs per update and made the log unreadable.
let quietUntil = 0;

function heal(why) {
  // Events arriving mid-repair are almost always the repair's own writes —
  // autosync is what rewrites app.asar. Re-running for them just logged a
  // phantom pass. A genuine update landing inside that window is rare and the
  // periodic backstop below catches it.
  if (healing) return;
  healing = true;
  log('change detected (' + why + ') — running autosync');
  execFile(process.execPath, [path.join(HERE, 'autosync.mjs')], {
    cwd: HERE, encoding: 'utf8', timeout: 300_000,
  }, (err, stdout) => {
    healing = false;
    const out = String(stdout || '');
    if (err && !out) log('autosync failed to run: ' + err.message);
    if (/skin manager restored/.test(out)) {
      // Only a repair that actually rewrote files needs to be ignored on the
      // way back. Arming this after a no-op pass (the startup sweep, usually)
      // swallowed a real update that landed inside the window.
      quietUntil = Date.now() + 10_000;
      toast('皮肤已自动修复 — 完全退出 Mirasim 再打开一次就回来了');
    }
  });
}

/* ---- debounce: an installer writes hundreds of files; react once ---- */
let timer = null;
function poke(why) {
  if (Date.now() < quietUntil) return;        // that was us
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (Date.now() < quietUntil) return;
    heal(why);
  }, 2500);
}

function watchDir(dir, label, filter) {
  if (!fs.existsSync(dir)) { log('cannot watch ' + label + ' — missing: ' + dir); return; }
  try {
    fs.watch(dir, (ev, file) => {
      if (filter && file && !filter(String(file))) return;
      poke(label + ': ' + ev + ' ' + (file || ''));
    });
    log('watching ' + label + ' (' + dir + ')');
  } catch (e) {
    log('watch failed on ' + label + ': ' + e.message);
  }
}

/* ---- single instance, then arm ---- */
const lock = net.createServer();
lock.once('error', () => process.exit(0));               // someone already holds it
lock.listen(MUTEX_PORT, '127.0.0.1', () => {
  log('resident (pid ' + process.pid + ')');

  // the full-installer path: resources/app.asar is replaced
  watchDir(RES, 'resources', (f) => f.toLowerCase().includes('app.asar'));
  // the payload path: a new version dir appears and state.json repoints
  watchDir(UPD, 'payload', () => true);

  // catch anything that happened while no watcher was alive
  heal('startup sweep');

  // belt and braces: filesystem watches can silently die across sleep on
  // Windows, so a slow internal tick backstops them
  setInterval(() => heal('periodic backstop'), 5 * 60_000).unref?.();
  setInterval(() => {}, 60_000);                          // hold the loop open
});
