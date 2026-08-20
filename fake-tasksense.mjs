// A fake app for skin development: serves the real renderer plus the skin
// under test, and replays a scripted tasksense feed over a real WebSocket.
//
//   node fake-tasksense.mjs                     basic lifecycle scenario
//   node fake-tasksense.mjs --scenario many     7 concurrent agents (cap test)
//   node fake-tasksense.mjs --port 8790
//
// Then open http://127.0.0.1:8788/ (or shoot it headless).
//
// Why the client drives the clock: the scenario advances only when the page
// asks for the next frame ({type:'__next'}), never on a server timer. That
// makes the whole timeline follow the PAGE's clock, so Chrome's
// --virtual-time-budget fast-forwards the feed and the animations together and
// a screenshot lands at a deterministic point in the story. A server-side timer
// would drift out of sync with virtual time and every shot would be a lottery.
//
// Two roots are served over http on ONE origin, and that is deliberate: an
// http document cannot load file:// subresources, so serving the renderer over
// http while the skin stayed on disk would silently load nothing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const RENDERER = path.join(HERE, 'build/dist/renderer');
const SKINS = path.join(HERE, 'skins');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(arg('port', 8788));
const SCENARIO = arg('scenario', 'basic');
const SKIN = arg('skin', 'clove');
const GAP = Number(arg('gap', 600));       // page-time ms between frames
const QUIET = argv.includes('--quiet');
// --nobridge: 404 the bridge so the skin's own loader fails, proving the pet
// still behaves exactly as it did before any of this existed.
const NOBRIDGE = argv.includes('--nobridge');

/* ---------------- scenarios ---------------- */

const W = (o) => Object.assign({
  id: 'claude:a', title: '把桌宠做成 subagent', agent: 'claude',
  workdirs: ['C:\\Users\\31394\\Documents\\ChatGPT\\Mirasim'],
  sessionKeys: ['claude:a'], activity: null, waitingTitle: null,
  conclusion: null, running: 0, lastActivityAt: 0, lane: 'digest', unread: 0,
}, o);

const IDLE = [
  W({ id: 'claude:idle1', title: '早前的会话 1', running: 0 }),
  W({ id: 'claude:idle2', title: '早前的会话 2', running: 0 }),
];

const A = (o) => W(Object.assign({ id: 'claude:a', title: '把桌宠做成 subagent' }, o));
const B = (o) => W(Object.assign({
  id: 'claude:b', title: '智能驾驶 · 视频管线',
  workdirs: ['C:\\Users\\31394\\Desktop\\智能驾驶'], sessionKeys: ['claude:b'],
}, o));

// Each entry: [label, workstreams]. The label is printed so a screenshot
// budget can be mapped back to a moment in the story.
const SCENARIOS = {
  basic: [
    ['seed: nothing running', IDLE],
    ['A starts', [...IDLE, A({ running: 1, activity: 'Read skin.js' })]],
    ['A works (1)', [...IDLE, A({ running: 1, activity: 'Grep tasksense' })]],
    ['A works (2)', [...IDLE, A({ running: 1, activity: 'Edit agent-bridge.js' })]],
    ['A works (3)', [...IDLE, A({ running: 1, activity: 'Bash node test-diff.mjs' })]],
    ['A works (4)', [...IDLE, A({ running: 1, activity: 'Write fake-tasksense.mjs' })]],
    ['A works (5)', [...IDLE, A({ running: 1, activity: 'Bash git commit' })]],
    ['B joins', [...IDLE, A({ running: 1, activity: 'Bash git commit' }),
      B({ running: 1, activity: 'Read tsconfig.json' })]],
    ['A goes quiet (stall begins)', [...IDLE, A({ running: 1, activity: 'Bash git commit', stale: 4000 }),
      B({ running: 1, activity: 'ffmpeg -i shot.mp4' })]],
    ['A still quiet', [...IDLE, A({ running: 1, activity: 'Bash git commit', stale: 4000 }),
      B({ running: 1, activity: 'ffmpeg -i shot.mp4' })]],
    ['A still quiet', [...IDLE, A({ running: 1, activity: 'Bash git commit', stale: 4000 }),
      B({ running: 1, activity: 'ffmpeg -i shot.mp4' })]],
    ['A asks you something', [...IDLE,
      A({ running: 1, activity: 'Bash git commit', stale: 4000, waitingTitle: '要我 force push 吗？' }),
      B({ running: 1, activity: 'ffmpeg -i shot.mp4' })]],
    ['A hold (waiting)', [...IDLE,
      A({ running: 1, activity: 'Bash git commit', stale: 4000, waitingTitle: '要我 force push 吗？' }),
      B({ running: 1, activity: 'ffmpeg -i shot.mp4' })]],
    ['B finishes', [...IDLE,
      A({ running: 1, activity: 'Bash git commit', waitingTitle: '要我 force push 吗？' }),
      B({ running: 0, conclusion: { at: 5000, kind: 'done', text: '首帧 QA 通过' } })]],
    ['A fails', [...IDLE,
      A({ running: 0, conclusion: { at: 6000, kind: 'failed', text: 'API Error: SSL mismatch' } }),
      B({ running: 0, conclusion: { at: 5000, kind: 'done', text: '首帧 QA 通过' } })]],
    ['settle', [...IDLE,
      A({ running: 0, conclusion: { at: 6000, kind: 'failed', text: 'API Error: SSL mismatch' } }),
      B({ running: 0, conclusion: { at: 5000, kind: 'done', text: '首帧 QA 通过' } })]],
    ['A archived (gone)', [...IDLE,
      B({ running: 0, conclusion: { at: 5000, kind: 'done', text: '首帧 QA 通过' } })]],
    ['quiet again', IDLE],
  ],

  // Seven at once: proves the cap of 5 plus a "+2" badge.
  many: (() => {
    const names = ['皮肤自检', '视频管线', '仓库巡检', 'GlassGauge', '发版脚本', '文档整理', '依赖升级'];
    const all = names.map((t, i) => W({
      id: 'claude:m' + i, title: t, sessionKeys: ['claude:m' + i],
      running: 1, activity: 'Read file-' + i + '.ts',
    }));
    const steps = [['seed', IDLE]];
    for (let n = 1; n <= 7; n++) steps.push([n + ' running', [...IDLE, ...all.slice(0, n)]]);
    steps.push(['hold at 7', [...IDLE, ...all]]);
    return steps;
  })(),

  // One agent that only ever needs the human.
  waiting: [
    ['seed', IDLE],
    ['starts', [...IDLE, A({ running: 1, activity: 'Bash rm -rf build' })]],
    ['asks', [...IDLE, A({ running: 1, activity: 'Bash rm -rf build', waitingTitle: '删掉 build/ 吗？' })]],
    ['hold', [...IDLE, A({ running: 1, activity: 'Bash rm -rf build', waitingTitle: '删掉 build/ 吗？' })]],
    ['hold', [...IDLE, A({ running: 1, activity: 'Bash rm -rf build', waitingTitle: '删掉 build/ 吗？' })]],
  ],
};

const steps = SCENARIOS[SCENARIO];
if (!steps) {
  console.error('unknown scenario: ' + SCENARIO + ' (have: ' + Object.keys(SCENARIOS).join(', ') + ')');
  process.exit(1);
}

/* ---------------- the page ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

// Strip the installed loader block and mount the skin under test directly:
// what is being exercised here is the skin plus the bridge, not the loader.
//
// Every injected script has to be EXTERNAL. The renderer ships
// `script-src 'self'` with no 'unsafe-inline', so an inline <script> here is
// silently dropped — which is why the loader is an external file in production
// too. Config and driver are therefore served as generated routes.
const DRIVER = `
<script src="/__config.js"></script>
<link rel="stylesheet" href="/skins/${SKIN}/skin.css">
${NOBRIDGE ? "" : "<script src=\"/skins/_shared/agent-bridge.js\"></script>"}
<script src="/skins/${SKIN}/skin.js"></script>
<script src="/__driver.js"></script>
`;


const CONFIG_JS = `window.__SKIN_ROOT = '/skins/${SKIN}/';
window.__CLOVE_STALL_MS = ${Number(arg('stall', 1500))};   /* the 90s threshold, compressed */
window.__FAKE_GAP = ${GAP};
window.__POKE_AT = ${Number(arg('poke', 0))};
try { localStorage.${QUIET ? "setItem('mirasim-skin-clove-quiet', '1')"
                          : "removeItem('mirasim-skin-clove-quiet')"}; } catch (e) {}
`;

/* Advance the story on the PAGE's clock so --virtual-time-budget moves the
   feed and the animations together. It rides the same WebSocket path but its
   own connection; the server's cursor is global, so either socket can pump. */
const DRIVER_JS = `(function () {
  var s = null, tick = null;
  function start() {
    s = new WebSocket('ws://' + location.host + '/ws');
    s.onopen = function () {
      /* Hand the server the PAGE's clock. Under --virtual-time-budget the page
         races ahead of real time, so timestamps stamped from the server's clock
         would read as minutes stale and every agent would look stalled. */
      try { s.send(JSON.stringify({ type: '__clock', now: Date.now() })); } catch (e) {}
      tick = setInterval(function () {
        try { s.send(JSON.stringify({ type: '__next' })); } catch (e) {}
      }, window.__FAKE_GAP || 600);
    };
    s.onclose = function () { clearInterval(tick); };
  }
  start();

  /* --poke: hover and click the first agent butterfly once the story has had
     time to produce one. Real listeners, real dispatch — the point is to prove
     the hover label mounts and that a click reaches tasksenseFocus, which the
     server then logs. */
  if (window.__POKE_AT) {
    setTimeout(function () {
      var el = document.querySelector('.cl-agent');
      if (!el) { console.warn('poke: no agent butterfly'); return; }
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      setTimeout(function () {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, 220);
    }, window.__POKE_AT);
  }
})();
`;

function indexHtml() {
  let html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  html = html.replace(/<!-- mirasim-skinmgr BEGIN -->[\s\S]*?<!-- mirasim-skinmgr END -->\s*/g, '');
  return html.replace('</head>', DRIVER + '</head>');
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nope: ' + path.basename(file)); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(indexHtml());
    return;
  }
  if (NOBRIDGE && url.endsWith('agent-bridge.js')) { res.writeHead(404); res.end('gone'); return; }
  if (url === '/__config.js' || url === '/__driver.js') {
    res.writeHead(200, { 'content-type': MIME['.js'] });
    res.end(url === '/__config.js' ? CONFIG_JS : DRIVER_JS);
    return;
  }
  // /skins/... -> skins/... ; everything else -> the renderer bundle
  const rel = url.replace(/^\/+/, '');
  const root = rel.startsWith('skins/') ? SKINS : RENDERER;
  const sub = rel.startsWith('skins/') ? rel.slice('skins/'.length) : rel;
  const file = path.join(root, sub);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('no'); return; }   // traversal
  serveFile(res, file);
});

/* ---------------- a minimal WebSocket server ----------------
   Hand-rolled rather than pulling in `ws`: this only ever sends small text
   frames and reads tiny ones, which is ~40 lines of RFC 6455. */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function textFrame(str) {
  const body = Buffer.from(str, 'utf8');
  const n = body.length;
  let head;
  if (n < 126) { head = Buffer.from([0x81, n]); }
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, body]);
}

// Pull whole text frames out of a client stream (client frames are masked).
function readFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 0x0f;
    const masked = (buf[i + 1] & 0x80) !== 0;
    let len = buf[i + 1] & 0x7f;
    let p = i + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.subarray(p, p + 4); p += 4; }
    if (p + len > buf.length) break;
    const body = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let k = 0; k < body.length; k++) body[k] ^= mask[k % 4];
    if (op === 1) out.push(body.toString('utf8'));
    if (op === 8) out.push('__close');
    i = p + len;
  }
  return { frames: out, rest: buf.subarray(i) };
}

let clients = 0;

/* One story, told once, watched by everyone.
   The page opens TWO sockets — the bridge subscribes, a tiny driver pumps the
   clock — so the scenario cursor has to be global. Keeping it per-connection
   meant the driver privately consumed the whole timeline while the bridge sat
   on the seed frame forever, and the skin drew nothing. */
let cursor = -1;
let clockBase = Date.now();       // the page's clock, learned from the driver
const subscribers = new Set();

/* Stamp lastActivityAt in the PAGE's time frame: frame N happened N gaps after
   the page started. `stale: ms` on a workstream freezes its stamp that far in
   the past, which is how a stalled agent is expressed. */
function stamp(workstreams, idx) {
  const at = clockBase + idx * GAP;
  return workstreams.map((w) => {
    const out = Object.assign({}, w, { lastActivityAt: at - (w.stale || 0) });
    delete out.stale;
    return out;
  });
}

function broadcast(o) {
  const buf = textFrame(JSON.stringify(o));
  for (const s of subscribers) { try { s.write(buf); } catch (e) {} }
}

function advance() {
  if (cursor + 1 >= steps.length) return;       // story over: hold on the last frame
  cursor++;
  const [label, workstreams] = steps[cursor];
  broadcast({ type: 'tasksense', workstreams: stamp(workstreams, cursor) });
  console.log(`  frame ${cursor}  t≈${(cursor * GAP / 1000).toFixed(1)}s  ${label}` +
    `  -> ${subscribers.size} subscriber(s)`);
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') +
    '\r\n\r\n');

  const id = ++clients;
  let pending = Buffer.alloc(0);
  const send = (o) => { try { socket.write(textFrame(JSON.stringify(o))); } catch (e) {} };

  socket.on('data', (chunk) => {
    const r = readFrames(Buffer.concat([pending, chunk]));
    pending = r.rest;
    for (const raw of r.frames) {
      if (raw === '__close') { subscribers.delete(socket); socket.end(); return; }
      let m = null;
      try { m = JSON.parse(raw); } catch (e) { continue; }
      if (m.type === 'watchTasksense' && m.on) {
        subscribers.add(socket);
        console.log(`  [${id}] subscribed (${subscribers.size} total)`);
        if (cursor < 0) advance();                       // seed the story
        else send({ type: 'tasksense', workstreams: stamp(steps[cursor][1], cursor) }); // catch up
      } else if (m.type === '__clock') {
        clockBase = Number(m.now) || Date.now();
      } else if (m.type === '__next') {
        advance();
      } else if (m.type === 'tasksenseFocus') {
        console.log(`  [${id}] FOCUS requested: ${JSON.stringify(m.sessionKeys)}`);
      } else {
        console.log(`  [${id}] -> ${raw.slice(0, 120)}`);
      }
    }
  });
  // One page load = one telling. When the last watcher goes away the story
  // rewinds, so every screenshot run starts from the seed frame instead of
  // resuming wherever the previous run stopped.
  const bye = () => {
    subscribers.delete(socket);
    if (!subscribers.size && cursor >= 0) { cursor = -1; console.log('  (rewound)'); }
  };
  socket.on('close', bye);
  socket.on('error', bye);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nfake tasksense on http://127.0.0.1:${PORT}/   skin=${SKIN}  scenario=${SCENARIO}`);
  console.log(`renderer: ${RENDERER}`);
  if (!fs.existsSync(path.join(RENDERER, 'index.html'))) {
    console.log('\n!! no renderer at that path — run `node install.mjs` once to extract build/\n');
  }
  console.log('\ntimeline (page-time; use --virtual-time-budget to land a shot):');
  steps.forEach(([label], i) => console.log(`  ${String(i).padStart(2)}  ${(i * GAP / 1000).toFixed(1)}s  ${label}`));
  console.log('');
});
