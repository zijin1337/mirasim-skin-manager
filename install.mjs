// Install the Mirasim skin manager.
//
//   node install.mjs             build + install loader into app.asar, deploy
//                                skins, rebuild manifest. Idempotent; run again
//                                after every Mirasim app update.
//   node install.mjs --restore   put the official asar back and strip the
//                                loader from the payload dirs (skins are kept).
//
// Paths can be overridden with MIRASIM_RESOURCES and MIRASIM_SKINS_DIR.
//
// Always rebuilds from a pristine official base: the current asar if it is
// unskinned (backing it up first), else the backup. A full app quit + relaunch
// is required after installing — while Mirasim runs the asar can be
// overwritten but not renamed, and the running process caches the old archive
// header. Skin SWITCHING afterwards is just a page reload.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import asar from '@electron/asar';
import { sync, SKINS_DIR } from './sync.mjs';


const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const RES = process.env.MIRASIM_RESOURCES
  || path.join(os.homedir(), 'AppData/Local/Programs/@mirasimdesktop/resources');
const SRC = path.join(RES, 'app.asar');
const BAK = SRC + '.skinmgr.bak';
const UPD = path.join(os.homedir(), '.mirasim', 'app');
const WORK = path.join(HERE, 'build');
const OUT = path.join(HERE, 'app.asar.skinmgr');
const LOADER_NAME = 'mirasim-skinmgr-loader.js';

const MARKERS = [['<!-- mirasim-skinmgr BEGIN -->', '<!-- mirasim-skinmgr END -->']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripBlocks = (html) => MARKERS.reduce(
  (h, [B, E]) => h.replace(new RegExp(esc(B) + '[\\s\\S]*?' + esc(E) + '\\n?\\s*', 'g'), ''), html);

const isSkinned = (asarPath) =>
  String(asar.getRawHeader(asarPath).headerString).includes(LOADER_NAME);

function loaderSource() {
  const src = fs.readFileSync(path.join(HERE, 'loader/loader.js'), 'utf8');
  const url = pathToFileURL(SKINS_DIR).href; // file:///C:/Users/.../.mirasim/skins
  return src.split('__SKINS_URL__').join(url); // placeholder also appears in a comment

}

function injectHtml(html, scriptSrc) {
  const [B, E] = MARKERS[0];
  const block = B + '\n    <script src="' + scriptSrc + '"></script>\n    ' + E + '\n  ';
  if (!html.includes('</head>')) throw new Error('no </head> in target html');
  return stripBlocks(html).replace('</head>', block + '</head>');
}

// Payload dirs (~/.mirasim/app/<ver>/{web,renderer}) are dormant today but
// cheap insurance if a future update switches back to payload loading.
function payloadDirs() {
  const dirs = [];
  if (!fs.existsSync(UPD)) return dirs;
  let vers = [];
  try {
    const good = JSON.parse(fs.readFileSync(path.join(UPD, 'state.json'), 'utf8')).good;
    if (good && fs.existsSync(path.join(UPD, good))) vers = [good];
  } catch (e) {}
  if (!vers.length) {
    vers = fs.readdirSync(UPD).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(-1);
  }
  for (const v of vers) for (const sub of ['web', 'renderer']) {
    const d = path.join(UPD, v, sub);
    if (fs.existsSync(path.join(d, 'index.html'))) dirs.push(d);
  }
  return dirs;
}

function restore() {
  if (!fs.existsSync(BAK)) throw new Error('no backup at ' + BAK);
  fs.copyFileSync(BAK, SRC);
  const src = BAK;
  console.log('restored official asar from', src);
  for (const d of payloadDirs()) {
    const idx = path.join(d, 'index.html');
    fs.writeFileSync(idx, stripBlocks(fs.readFileSync(idx, 'utf8')), 'utf8');
    fs.rmSync(path.join(d, LOADER_NAME), { force: true });
  }
  console.log('stripped loader from payload dirs. fully quit Mirasim and relaunch.');
}

function install() {
  if (!fs.existsSync(SRC)) {
    throw new Error('app.asar not found at ' + SRC +
      ' — set MIRASIM_RESOURCES to your Mirasim resources folder');
  }
  // 1. pick a pristine base (and keep the backup chain fresh across updates)
  let base;
  if (fs.existsSync(SRC) && !isSkinned(SRC)) {
    fs.copyFileSync(SRC, BAK);
    console.log('official asar → backup refreshed');
    base = SRC;
  } else if (fs.existsSync(BAK) && !isSkinned(BAK)) {
    base = BAK;
  } else {
    throw new Error('no pristine official asar available (reinstall Mirasim to reset)');
  }
  console.log('base:', base);

  // 2. rebuild the asar with the loader
  fs.rmSync(WORK, { recursive: true, force: true });
  asar.extractAll(base, WORK);

  // The window-controls strip (min/restore/close) is painted by the main
  // process — titleBarOverlay is hardcoded at window creation, so the stock
  // near-black clashes with a skinned header. Recolor it to the clove header
  // ink + lavender symbols. (Static per install; CSS can't reach this strip.)
  const mainPath = path.join(WORK, 'dist/main.cjs');
  let mc = fs.readFileSync(mainPath, 'utf8');
  // fully transparent strip: the page (and its gradients) shows through
  // behind the caption buttons; only the glyphs are drawn
  const OVERLAY_FROM = "'#1c1b19','symbolColor':'#e8e6e3'";
  const OVERLAY_TO = "'#00000000','symbolColor':'#e6dbfa'";
  let patched = false;
  if (mc.includes(OVERLAY_FROM)) {
    mc = mc.split(OVERLAY_FROM).join(OVERLAY_TO);
    patched = true;
    console.log('titleBarOverlay made transparent (symbols #e6dbfa)');
  } else {
    console.warn('WARNING: titleBarOverlay literal not found (app updated?) — strip stays stock');
  }
  // boot flash: BrowserWindow backgroundColor shows before the page paints
  const BOOTBG_FROM = "'backgroundColor':'#1c1b19'";
  const BOOTBG_TO = "'backgroundColor':'#120c1c'";
  if (mc.includes(BOOTBG_FROM)) {
    const n = mc.split(BOOTBG_FROM).length - 1;
    mc = mc.split(BOOTBG_FROM).join(BOOTBG_TO);
    patched = true;
    console.log('boot backgroundColor recolored (' + n + 'x) → #120c1c');
  }
  if (patched) fs.writeFileSync(mainPath, mc, 'utf8');

  const rendererDir = path.join(WORK, 'dist/renderer');
  fs.writeFileSync(path.join(rendererDir, LOADER_NAME), loaderSource(), 'utf8');
  const idx = path.join(rendererDir, 'index.html');
  fs.writeFileSync(idx, injectHtml(fs.readFileSync(idx, 'utf8'), './' + LOADER_NAME), 'utf8');
  return asar.createPackage(WORK, OUT).then(() => {
    fs.copyFileSync(OUT, SRC);
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.rmSync(OUT, { force: true });
    console.log('installed loader into', SRC);

    // 3. payload-dir insurance
    for (const d of payloadDirs()) {
      const pidx = path.join(d, 'index.html');
      fs.writeFileSync(path.join(d, LOADER_NAME), loaderSource(), 'utf8');
      fs.writeFileSync(pidx, injectHtml(fs.readFileSync(pidx, 'utf8'), './' + LOADER_NAME), 'utf8');
      console.log('loader also injected →', pidx);
    }

    // 4. deploy bundled skins (only same-name dirs are replaced; third-party
    //    skins in the directory are left untouched). Underscore-prefixed dirs
    //    are shared modules rather than skins — _shared/agent-bridge.js is the
    //    live-agent feed any skin can subscribe to. sync.mjs skips them when
    //    building the manifest, so they never show up in the picker.
    const srcRoot = path.join(HERE, 'skins');
    for (const s of fs.readdirSync(srcRoot, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const dst = path.join(SKINS_DIR, s.name);
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(path.join(srcRoot, s.name), dst, { recursive: true });
      console.log((s.name.startsWith('_') ? 'shared module deployed:' : 'skin deployed:'), s.name);
    }

    // 5. manifest
    sync();
    console.log('\ndone — fully quit Mirasim and relaunch. then press F9 to pick a skin.');
  });
}

if (process.argv.includes('--restore')) restore();
else await install();
