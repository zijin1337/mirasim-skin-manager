// Resident watcher: reinstall the skin the moment an app update drops it,
// and SAY SO — a silent repair reads as a broken skin to the person watching
// the window.
//
// Why this exists: polling loses the race every time. An update lands seconds
// before the app relaunches; a once-a-minute tick shows up after the window has
// already read the unpatched files — and Windows' minute-level repetition skips
// beats after sleep/wake besides. Watching the filesystem removes the cadence
// from the problem.
//
//   node watch-and-heal.mjs           run resident (exits at once if a healthy
//                                     one is already running — fire blindly)
//
// The scheduled task fires THIS every minute: healthy one alive -> instant
// exit, dead or WEDGED -> replaced. Watchdog semantics for free.
//
// Repairs are delegated to autosync.mjs, which owns every guard (size floor,
// parseability, settle recheck, payload-gap detection, logging). This file only
// decides WHEN to run it and tells the user what happened.
//
// The failure this file is now shaped around: a repair that never returns.
// `healing` was a plain boolean, and when one execFile callback never fired
// (machine slept mid-run) the flag stuck true — every later detection was
// swallowed by its own guard for 24 hours while the process sat there looking
// alive and the mutex told the watchdog everything was fine. A liveness flag
// that can only be cleared by the thing it guards is not a safety mechanism.
// Hence: a deadline on the flag, self-termination past it, and a heartbeat so
// the next instance can reap a wedged predecessor instead of bouncing off the
// lock.
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const RES = process.env.MIRASIM_RESOURCES ||
  path.join(os.homedir(), 'AppData/Local/Programs/@mirasimdesktop/resources');
const UPD = path.join(os.homedir(), '.mirasim', 'app');
const LOG = path.join(HERE, 'autosync.log');    // one shared journal, one place to look
const BEAT = path.join(HERE, 'watch-heartbeat.json');
const MUTEX_PORT = 49337;                       // single-instance lock, cheapest kind

const HEAL_TIMEOUT = 300_000;                   // autosync's own execFile limit
// Past this, the repair is not slow, it is wedged. Overridable so the tests can
// exercise the recovery without waiting minutes.
const STUCK_MS = Number(process.env.MIRASIM_WATCH_STUCK_MS || 360_000);
const BEAT_MS = 60_000;
const STALE_BEAT_MS = Number(process.env.MIRASIM_WATCH_STALE_MS || 240_000);

const log = (msg) => {
  const line = new Date().toISOString() + '  [watch] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
};

/* ---- the user-facing half: a toast when a repair lands ----
   Dependency-free: a hidden PowerShell balloon, which Win11 renders as a
   normal toast. Fire-and-forget; a failed toast must never take us down. */
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

/* ---- heartbeat: how a later instance tells alive from wedged ---- */
function beat(state) {
  try {
    fs.writeFileSync(BEAT, JSON.stringify({
      pid: process.pid, at: Date.now(), state: state,
      // Which COPY of the toolchain this is. Two checkouts exist on this
      // machine and they share one mutex port; a stray watcher from the other
      // one held the lock for a day while the live copy bounced off it in
      // silence, so the holder has to be able to name itself.
      home: HERE,
    }), 'utf8');
  } catch (e) {}
}

function readBeat() {
  try { return JSON.parse(fs.readFileSync(BEAT, 'utf8')); } catch (e) { return null; }
}

/* ---- the repair ---- */
let healing = false;
let healingSince = 0;
// A repair REWRITES app.asar, which trips this very watch. Without a quiet
// window afterwards the thing chases its own tail: heal, write, detect, heal.
let quietUntil = 0;

/* Past the deadline the callback is never coming. Do not carry on with a
   half-known state — die and let the watchdog start a clean one. This gets its
   OWN tick rather than riding on heal(): hanging the check off the next
   detection meant a wedged watcher on a quiet disk stayed wedged until the
   5-minute backstop, and the whole point is not to depend on something else
   happening. */
function exitIfWedged() {
  if (!healing) return;
  const stuckFor = Date.now() - healingSince;
  if (stuckFor < STUCK_MS) return;
  log('a repair has been stuck for ' + Math.round(stuckFor / 1000) +
      's — exiting so the watchdog replaces me');
  beat('wedged');
  process.exit(1);
}

function heal(why) {
  if (healing) { exitIfWedged(); return; }
  healing = true;
  healingSince = Date.now();
  beat('healing');
  log('change detected (' + why + ') — running autosync');
  execFile(process.execPath, [path.join(HERE, 'autosync.mjs')], {
    cwd: HERE, encoding: 'utf8', timeout: HEAL_TIMEOUT,
  }, (err, stdout) => {
    healing = false;
    beat('idle');
    const out = String(stdout || '');
    if (err && !out) log('autosync failed to run: ' + err.message);
    if (/skin manager restored/.test(out)) {
      // Only a repair that actually rewrote files needs ignoring on the way
      // back. Arming this after a no-op pass swallowed a real update once.
      quietUntil = Date.now() + 10_000;
      toast('皮肤已自动修复 — 完全退出 Mirasim 再打开一次就回来了');
    }
  });
}

/* ---- debounce: an installer writes hundreds of files; react once ---- */
let timer = null;
function poke(why) {
  if (Date.now() < quietUntil) return;          // that was us
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (Date.now() < quietUntil) return;
    heal(why);
  }, 2500);
}

/* ---- watches, re-armable ----
   fs.watch handles die silently across sleep on Windows, and a dead handle
   looks exactly like a quiet disk. Rebuilding them on every backstop tick
   costs nothing and removes the whole failure class. */
const handles = [];

function armWatches() {
  while (handles.length) {
    try { handles.pop().close(); } catch (e) {}
  }
  watchDir(RES, 'resources', (f) => f.toLowerCase().includes('app.asar'));
  watchDir(UPD, 'payload', () => true);
}

function watchDir(dir, label, filter) {
  if (!fs.existsSync(dir)) { log('cannot watch ' + label + ' — missing: ' + dir); return; }
  try {
    const h = fs.watch(dir, (ev, file) => {
      if (filter && file && !filter(String(file))) return;
      poke(label + ': ' + ev + ' ' + (file || ''));
    });
    h.on('error', (e) => log('watch error on ' + label + ': ' + e.message));
    handles.push(h);
  } catch (e) {
    log('watch failed on ' + label + ': ' + e.message);
  }
}

/* ---- reap a wedged predecessor, then take the lock ---- */
function reapIfWedged() {
  const b = readBeat();
  if (!b || !b.pid || b.pid === process.pid) return false;
  const age = Date.now() - (b.at || 0);
  if (age < STALE_BEAT_MS) return false;        // it is alive and keeping time
  try {
    process.kill(b.pid, 0);                     // does it still exist?
  } catch (e) {
    return false;                               // already gone; the lock will free itself
  }
  log('predecessor pid ' + b.pid + ' last beat ' + Math.round(age / 1000) +
      's ago (state ' + b.state + ') — wedged, killing it');
  try { process.kill(b.pid, 'SIGKILL'); } catch (e) {}
  return true;
}

function arm() {
  log('resident (pid ' + process.pid + ')');
  beat('idle');
  armWatches();
  log('watching resources (' + RES + ') and payload (' + UPD + ')');

  heal('startup sweep');                        // whatever happened while nobody watched

  setInterval(() => {
    armWatches();                               // re-arm handles that died in sleep
    heal('periodic backstop');
  }, 5 * 60_000);
  setInterval(() => {
    beat(healing ? 'healing' : 'idle');
    exitIfWedged();
  }, BEAT_MS);
}

function takeLockAndArm(retried) {
  const lock = net.createServer();
  lock.once('error', () => {
    // Someone holds the port. Healthy, or wedged and holding it hostage?
    if (!retried && reapIfWedged()) {
      setTimeout(() => takeLockAndArm(true), 1500);
      return;
    }
    // Say who has it before standing down. A silent exit here is what let a
    // watcher from the other checkout hold the lock for a day unnoticed: the
    // live copy dutifully stepped aside every minute and never said a word,
    // and its log looked like a dead process rather than a blocked one.
    const b = readBeat();
    if (b && b.home && b.home !== HERE) {
      log('standing down — a watcher from a DIFFERENT copy holds the lock: ' +
          b.home + ' (pid ' + b.pid + '). Only one copy should be scheduled.');
    }
    process.exit(0);
  });
  lock.listen(MUTEX_PORT, '127.0.0.1', arm);
}

takeLockAndArm(false);
