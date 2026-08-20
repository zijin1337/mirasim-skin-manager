// Assert the agent bridge's frame diffing, in plain node — no browser, no app.
//
// The diff is the one piece where a subtle bug is invisible in screenshots: a
// duplicated `done` fires a bubble every second, and a missing first-frame
// guard fabricates butterflies for work that started an hour ago. So it gets
// exact event-sequence assertions rather than eyeballing.
//
//   node test-diff.mjs
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));

// agent-bridge.js is a browser script, and how node interprets a bare .js
// depends on the nearest package.json — the published copy sets
// "type": "module", which turned require() into an ESM load and handed back an
// empty namespace. Evaluating the source directly works either way. Passing
// `window` as undefined keeps the file's install() branch dormant.
const src = fs.readFileSync(path.join(HERE, 'skins/_shared/agent-bridge.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'window', src)(mod, undefined);
const { diff, present } = mod.exports;
if (typeof diff !== 'function') {
  console.error('agent-bridge.js exported nothing — did its module.exports guard change?');
  process.exit(1);
}

let pass = 0, fail = 0;

/* Run a sequence of frames through diff() and assert the events each one
   produces. `expect` is an array of arrays: expect[i] is the event types the
   i-th frame must emit, in order. */
function scenario(name, frames, expect) {
  let prev = null;
  const got = [];
  for (const f of frames) {
    const r = diff(prev, f);
    prev = r.next;
    got.push(r.events.map((e) => e.type));
  }
  const a = JSON.stringify(got), b = JSON.stringify(expect);
  if (a === b) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       expected ' + b + '\n       got      ' + a); }
  return prev;
}

const ws = (o) => Object.assign({
  id: 'claude:a', title: 'task A', agent: 'claude', workdirs: ['C:\\repo'],
  sessionKeys: ['claude:a'], activity: null, waitingTitle: null,
  conclusion: null, running: 0, lastActivityAt: 0,
}, o);

console.log('\nagent-bridge diff()\n');

// The guard that matters most: two agents already running when the page loads.
scenario('first frame seeds silently, even with live agents',
  [[ws({ id: 'claude:a', running: 1 }), ws({ id: 'claude:b', running: 1 })]],
  [[]]);

scenario('reload during work emits nothing, then tracks the next step',
  [
    [ws({ running: 1, activity: 'Read a.ts' })],
    [ws({ running: 1, activity: 'Read a.ts' })],
    [ws({ running: 1, activity: 'Edit a.ts' })],
  ],
  [[], [], ['activity']]);

scenario('an idle workstream waking up is a start',
  [
    [ws({ running: 0 })],
    [ws({ running: 1, activity: 'Bash npm test' })],
  ],
  [[], ['start', 'activity']]);

// Measured against the live app: lastActivityAt advances every few seconds
// through a single long tool call, while `activity` holds still.
scenario('a bare heartbeat is a beat, not an activity',
  [
    [ws({ running: 1, activity: 'Bash npm test', lastActivityAt: 100 })],
    [ws({ running: 1, activity: 'Bash npm test', lastActivityAt: 200 })],
    [ws({ running: 1, activity: 'Bash npm test', lastActivityAt: 300 })],
    [ws({ running: 1, activity: 'Edit a.ts', lastActivityAt: 400 })],
  ],
  [[], ['beat'], ['beat'], ['activity']]);

scenario('an idle workstream does not beat',
  [
    [ws({ running: 0, lastActivityAt: 100 })],
    [ws({ running: 0, lastActivityAt: 200 })],
  ],
  [[], []]);

scenario('a brand-new id already running is a start',
  [
    [ws({ id: 'claude:a', running: 1 })],
    [ws({ id: 'claude:a', running: 1 }), ws({ id: 'claude:new', running: 1 })],
  ],
  [[], ['start']]);

scenario('a brand-new id that is merely waiting is not a start',
  [
    [ws({ id: 'claude:a', running: 1 })],
    [ws({ id: 'claude:a', running: 1 }), ws({ id: 'claude:new', waitingTitle: 'approve?' })],
  ],
  [[], ['waiting']]);

// The repeat guard: the feed re-sends the same conclusion in every frame.
scenario('done fires once, not once per frame',
  [
    [ws({ running: 1, activity: 'Edit a.ts' })],
    [ws({ running: 0, conclusion: { at: 1000, kind: 'done', text: 'all set' } })],
    [ws({ running: 0, conclusion: { at: 1000, kind: 'done', text: 'all set' } })],
    [ws({ running: 0, conclusion: { at: 1000, kind: 'done', text: 'all set' } })],
  ],
  [[], ['done'], [], []]);

scenario('a failed verdict is failed, not done',
  [
    [ws({ running: 1 })],
    [ws({ running: 0, conclusion: { at: 2000, kind: 'failed', text: 'API Error' } })],
  ],
  [[], ['failed']]);

scenario('a second turn concluding later fires again',
  [
    [ws({ running: 0, conclusion: { at: 1000, kind: 'done', text: 'first' } })],
    [ws({ running: 1, conclusion: { at: 1000, kind: 'done', text: 'first' } })],
    [ws({ running: 0, conclusion: { at: 5000, kind: 'done', text: 'second' } })],
  ],
  [[], ['start'], ['done']]);

scenario('stopping with no fresh verdict still ends the butterfly',
  [
    [ws({ running: 1 })],
    [ws({ running: 0 })],
  ],
  [[], ['done']]);

scenario('waiting fires on the question, not on every frame after',
  [
    [ws({ running: 1 })],
    [ws({ running: 1, waitingTitle: 'Allow Bash?' })],
    [ws({ running: 1, waitingTitle: 'Allow Bash?' })],
  ],
  [[], ['waiting'], []]);

scenario('a disappearing workstream is gone, exactly once',
  [
    [ws({ id: 'claude:a', running: 1 }), ws({ id: 'claude:b', running: 1 })],
    [ws({ id: 'claude:a', running: 1 })],
    [ws({ id: 'claude:a', running: 1 })],
  ],
  [[], ['gone'], []]);

scenario('an empty frame is survivable, not a crash',
  [[ws({ running: 1 })], [], []],
  [[], ['gone'], []]);

scenario('garbage in a frame is skipped, not thrown',
  [
    [ws({ running: 1 })],
    [null, undefined, {}, ws({ running: 1, activity: 'still here' })],
  ],
  [[], ['activity']]);

// Payload shape: the skin needs these fields to label and focus a butterfly.
const prev = diff(null, [ws({ running: 0 })]).next;
const e = diff(prev, [ws({ running: 1, activity: 'Read x' })]).events[0];
const shapeOk = e.id === 'claude:a' && e.title === 'task A' && e.agent === 'claude' &&
  e.workdir === 'C:\\repo' && Array.isArray(e.sessionKeys) && e.sessionKeys[0] === 'claude:a' &&
  e.activity === 'Read x';
if (shapeOk) { pass++; console.log('  ok   event payload carries title/agent/workdir/sessionKeys'); }
else { fail++; console.log('  FAIL event payload: ' + JSON.stringify(e)); }

// The first frame emits no events, so the already-running agents it describes
// have to reach the skin some other way or a page reload would show nothing
// until the current work finished.
{
  const seeded = diff(null, [
    ws({ id: 'claude:run', running: 1, activity: 'Read a.ts' }),
    ws({ id: 'claude:wait', running: 0, waitingTitle: 'approve?' }),
    ws({ id: 'claude:idle', running: 0 }),
  ]).next;
  const alive = present(seeded);
  const ids = alive.map((e) => e.id).sort();
  const ok = JSON.stringify(ids) === JSON.stringify(['claude:run', 'claude:wait']) &&
    alive.every((e) => e.type === 'present') &&
    alive.find((e) => e.id === 'claude:wait').waiting === 'approve?';
  if (ok) { pass++; console.log('  ok   present() lists exactly the live ones, idle excluded'); }
  else { fail++; console.log('  FAIL present(): ' + JSON.stringify(alive)); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
