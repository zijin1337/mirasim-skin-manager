/* mirasim skins: agent bridge — the data layer, skin-agnostic on purpose.

   Subscribes to the app's own tasksense feed and turns successive frames into
   events a skin can render. Knows nothing about butterflies, masks, or colors;
   a skin subscribes and decides what a running agent LOOKS like.

     window.__mirasimAgents.on('start',    function (e) { ... })
     window.__mirasimAgents.on('activity', function (e) { ... })   // one tool step
     window.__mirasimAgents.on('waiting',  function (e) { ... })   // needs the human
     window.__mirasimAgents.on('done' | 'failed' | 'gone', ...)
     window.__mirasimAgents.focus(e)                               // jump to that session
     window.__mirasimAgents.state                                  // {connected, framesSeen, ...}

   Event payload: {type, id, title, agent, workdir, activity, text, sessionKeys}

   Protocol (measured against a live app, not guessed):
     -> {type:'watchTasksense', on:true}
     <- {type:'tasksense', workstreams:[{id,title,agent,workdirs,sessionKeys,
          activity,waitingTitle,conclusion:{at,kind,text},running,lastActivityAt}]}

   Failure posture: every path degrades to silence. No feed, no events, and the
   skin keeps whatever behavior it has without one. */
(function () {
  'use strict';

  /* ---------------- pure part: frame diffing ----------------
     Kept free of DOM and socket so it can be asserted in plain node
     (see work/mirasim-skins/test-diff.mjs). */

  function snap(w) {
    var c = w.conclusion || null;
    return {
      id: w.id,
      title: w.title || '',
      agent: w.agent || '',
      workdir: (w.workdirs && w.workdirs[0]) || '',
      sessionKeys: w.sessionKeys || [],
      activity: w.activity || null,
      running: w.running || 0,
      waitingTitle: w.waitingTitle || null,
      concludedAt: (c && c.at) || 0,
      conclusionKind: (c && c.kind) || null,
      conclusionText: (c && c.text) || '',
      lastActivityAt: w.lastActivityAt || 0,
    };
  }

  function ev(type, s) {
    return {
      type: type, id: s.id, title: s.title, agent: s.agent, workdir: s.workdir,
      sessionKeys: s.sessionKeys, activity: s.activity, text: s.conclusionText,
      waiting: s.waitingTitle || null, lastActivityAt: s.lastActivityAt,
    };
  }

  /* Everything that is alive right now, as `present` events.
     The first frame deliberately emits no start/done events — but the agents it
     describes are real and already working, so a skin still has to be able to
     draw them. `present` means "this was already running when we connected":
     same butterfly, no entrance fanfare. */
  function present(map) {
    var out = [];
    map.forEach(function (s) {
      if (s.running > 0 || s.waitingTitle) out.push(ev('present', s));
    });
    return out;
  }

  /* diff(prev, workstreams) -> {events, next}
     prev === null means "first frame since connect": seed the map and emit
     NOTHING. Without this, every page reload would fabricate a `start` for
     each already-running agent — a burst of butterflies for work that began
     minutes ago. */
  function diff(prev, workstreams) {
    var list = Array.isArray(workstreams) ? workstreams : [];
    var next = new Map();
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w && w.id) next.set(w.id, snap(w));
    }
    if (!prev) return { events: [], next: next };

    var events = [];
    next.forEach(function (s, id) {
      var p = prev.get(id);
      if (!p) {
        // an id we have never seen: only interesting if it is actually alive
        if (s.running > 0) events.push(ev('start', s));
        else if (s.waitingTitle) events.push(ev('waiting', s));
        return;
      }
      if (p.running === 0 && s.running > 0) events.push(ev('start', s));
      if (s.activity && s.activity !== p.activity) events.push(ev('activity', s));
      // `activity` is the label of the current tool step, so it holds still for
      // as long as that step runs — a long command looks identical to a hung
      // agent through that field alone. lastActivityAt keeps advancing while
      // anything at all happens (measured: it ticks every few seconds through a
      // single long Bash call), so it is the finer proof of life.
      else if (s.lastActivityAt > p.lastActivityAt && s.running > 0) events.push(ev('beat', s));
      if (s.waitingTitle && s.waitingTitle !== p.waitingTitle) events.push(ev('waiting', s));

      // A conclusion counts only when it is NEWER than the one already seen.
      // The feed re-sends the last conclusion in every frame, so without the
      // timestamp guard `done` would fire once per frame, forever.
      if (s.concludedAt > p.concludedAt) {
        events.push(ev(s.conclusionKind === 'failed' ? 'failed' : 'done', s));
      } else if (p.running > 0 && s.running === 0) {
        events.push(ev('done', s));   // stopped with no fresh verdict (cancelled)
      }
    });
    prev.forEach(function (p, id) {
      if (!next.has(id)) events.push(ev('gone', p));
    });
    return { events: events, next: next };
  }

  /* ---------------- live part: the socket ---------------- */

  function install(win) {
    var listeners = Object.create(null);
    var prev = null;
    var sock = null;
    var tries = 0;
    var BACKOFF = [5000, 15000, 60000];
    var state = { connected: false, framesSeen: 0, workstreams: 0, url: null };

    function emit(type, payload) {
      var fns = listeners[type];
      if (!fns) return;
      for (var i = 0; i < fns.length; i++) {
        try { fns[i](payload); } catch (e) {}   // one bad listener must not stop the rest
      }
    }

    function on(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
      return function () { off(type, fn); };
    }

    function off(type, fn) {
      var fns = listeners[type];
      if (!fns) return;
      var i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    }

    function post(obj) {
      try {
        if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
      } catch (e) {}
      return false;
    }

    /* ---- errands: dispatch, and claim the session it becomes ----
       The server answers a prompt with {accepted, clientRef, sessionKey} or
       {error, clientRef, message}, so an errand's session is claimed exactly —
       no guessing which new workstream is ours. */
    var pending = Object.create(null);
    var seq = 0;

    function newRef() {
      return 'clove-' + Date.now().toString(36) + '-' + (++seq) + '-' +
             Math.random().toString(36).slice(2, 8);
    }

    function settle(msg) {
      var cr = msg && msg.clientRef;
      var p = cr && pending[cr];
      if (!p) return false;             // not ours: a general error, or a stale ref
      delete pending[cr];
      win.clearTimeout(p.timer);
      if (msg.type === 'accepted') {
        p.resolve({ sessionKey: msg.sessionKey, taskId: msg.taskId, queued: msg.taskId === '' });
      } else {
        p.reject(new Error(msg.message || 'refused'));
      }
      return true;
    }

    function dispatch(opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        if (!state.connected) { reject(new Error('没有连上 Mirasim')); return; }
        if (!opts.prompt) { reject(new Error('空的差事')); return; }
        var cr = newRef();
        var frame = { type: 'prompt', clientRef: cr, prompt: String(opts.prompt) };
        // Only send what the caller asked for: omitted fields let the app fall
        // back to the user's own defaults for agent, model and effort.
        var carry = ['workdir', 'agent', 'model', 'effort', 'agentPreset', 'locale'];
        for (var i = 0; i < carry.length; i++) {
          if (opts[carry[i]]) frame[carry[i]] = opts[carry[i]];
        }
        pending[cr] = {
          resolve: resolve,
          reject: reject,
          timer: win.setTimeout(function () {
            delete pending[cr];
            reject(new Error('等了 20 秒没有回音'));
          }, 20000),
        };
        if (!post(frame)) {
          win.clearTimeout(pending[cr].timer);
          delete pending[cr];
          reject(new Error('socket 还没准备好'));
        }
      });
    }

    function stop(sessionKey) {
      if (!sessionKey) return false;
      return post({ type: 'stop', sessionKey: sessionKey });
    }

    function abandonPending(why) {
      var keys = Object.keys(pending);
      for (var i = 0; i < keys.length; i++) {
        var p = pending[keys[i]];
        delete pending[keys[i]];
        win.clearTimeout(p.timer);
        p.reject(new Error(why));
      }
    }

    function onFrame(msg) {
      if (!msg) return;
      if (msg.type === 'accepted' || msg.type === 'error') {
        if (settle(msg)) return;
      }
      if (msg.type !== 'tasksense') return;
      var firstSinceConnect = prev === null;
      var r = diff(prev, msg.workstreams);
      prev = r.next;
      state.framesSeen++;
      state.workstreams = r.next.size;
      if (firstSinceConnect) {
        var alive = present(r.next);
        state.alive = alive.length;
        emit('hello', { alive: alive });
      }
      for (var i = 0; i < r.events.length; i++) emit(r.events[i].type, r.events[i]);
      emit('frame', { count: r.next.size, events: r.events.length });
    }

    function connect(url) {
      state.url = url;
      var s;
      try { s = new win.WebSocket(url); } catch (e) { return retry(url); }
      sock = s;
      s.onopen = function () {
        tries = 0;
        state.connected = true;
        post({ type: 'watchTasksense', on: true });
        emit('connected', { url: url });
      };
      s.onmessage = function (e) {
        var m = null;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        onFrame(m);
      };
      s.onclose = function () {
        state.connected = false;
        // a reconnect re-seeds: the next first frame must not fabricate starts
        prev = null;
        abandonPending('连接断了，这件差事没派出去');
        emit('disconnected', {});
        retry(url);
      };
      s.onerror = function () {};
    }

    function retry(url) {
      var wait = BACKOFF[Math.min(tries, BACKOFF.length - 1)];
      tries++;
      win.setTimeout(function () { connect(url); }, wait);
    }

    /* Where does the server live? An http-served page is same-origin. The real
       renderer is a file:// document, so ask the preload bridge — the same
       trick the clove skin already used for its own socket. */
    function discover() {
      try {
        if (win.location.protocol.indexOf('http') === 0 && win.location.host) {
          connect((win.location.protocol === 'https:' ? 'wss://' : 'ws://') +
                  win.location.host + '/ws');
          return;
        }
        var m = win.mirasim;
        if (!m || typeof m.getServerInfo !== 'function') return;
        Promise.resolve().then(function () { return m.getServerInfo(); }).then(function (info) {
          var s = '';
          try { s = JSON.stringify(info); } catch (e) { s = String(info); }
          var hit = /(?:127\.0\.0\.1|localhost):(\d{2,5})/.exec(s) ||
                    /"port"\s*:\s*(\d{2,5})/.exec(s);
          if (hit) connect('ws://127.0.0.1:' + hit[1] + '/ws');
        }).catch(function () {});
      } catch (e) {}
    }

    var api = {
      on: on,
      off: off,
      state: state,
      /* jump the app to that workstream's session(s) */
      focus: function (e) {
        var keys = e && (e.sessionKeys || (e.id ? [e.id] : null));
        if (keys && keys.length) return post({ type: 'tasksenseFocus', sessionKeys: keys });
        return false;
      },
      /* send a real agent off on an errand; resolves with its sessionKey */
      dispatch: dispatch,
      stop: stop,
      __diff: diff,
    };
    win.__mirasimAgents = api;
    discover();
    return api;
  }

  if (typeof window !== 'undefined') {
    try { if (!window.__mirasimAgents) install(window); } catch (e) {}
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { diff: diff, snap: snap, present: present };
  }
})();
