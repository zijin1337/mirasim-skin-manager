/* mirasim-skin: clove — effects engine.
   Original artwork only: butterflies are code-drawn SVG, smoke is CSS
   gradients. Perf contract: WAAPI transform/opacity animations only, rAF never
   runs while nothing is flying, one long-interval timeout drives the ambience
   (cancelled in quiet mode). Honors prefers-reduced-motion. */
(function () {
  'use strict';

  document.documentElement.setAttribute('data-skin', 'clove');

  var LS = {
    quiet: 'mirasim-skin-clove-quiet',
    pet: 'mirasim-skin-clove-pet',
    pos: 'mirasim-skin-clove-pet-pos',
  };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  var REDUCED = false;
  try { REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var PURPLE = '#9a63f5', PINK = '#ef6ee0', LILAC = '#c9a8ff', MINT = '#9beeea', CREAM = '#f7eefb';
  var BITS = [PURPLE, PINK, LILAC, MINT, CREAM];
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  var fx = null;   // ambience layer (pointer-events: none root)
  var uid = 0;

  /* ---------- butterfly: angular shard wings, after Clove's own ability
     icon (two blade-wings per side + a four-point sparkle) ---------- */
  function bfly(size, c1, c2) {
    var id = 'clg' + (++uid);
    var el = document.createElement('div');
    el.className = 'cl-bfly';
    el.style.width = el.style.height = size + 'px';
    el.innerHTML =
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs>' +
      '<g class="wl">' +
      '<path d="M11.6 12.6 L3 2.9 L1.4 7.4 L6.8 12 Z" fill="url(#' + id + ')" opacity=".96"/>' +
      '<path d="M11.6 13.2 L4.2 14.6 L6.6 18.3 L10.2 15.7 Z" fill="url(#' + id + ')" opacity=".8"/>' +
      '</g>' +
      '<g class="wr">' +
      '<path d="M12.4 12.6 L21 2.9 L22.6 7.4 L17.2 12 Z" fill="url(#' + id + ')" opacity=".96"/>' +
      '<path d="M12.4 13.2 L19.8 14.6 L17.4 18.3 L13.8 15.7 Z" fill="url(#' + id + ')" opacity=".8"/>' +
      '</g>' +
      '<path d="M12 10.4 L12.9 13 L12 17.2 L11.1 13 Z" fill="#f4eefc" opacity=".9"/>' +
      '<path d="M19.6 17.4 L20.1 18.9 L21.6 19.4 L20.1 19.9 L19.6 21.4 L19.1 19.9 L17.6 19.4 L19.1 18.9 Z" ' +
      'fill="#f4eefc" opacity=".85"/>' +
      '</svg>';
    return el;
  }

  /* ---------- particle burst ---------- */
  function burst(x, y, n, spread) {
    if (!fx) return;
    for (var i = 0; i < (n || 9); i++) {
      var b = document.createElement('div');
      b.className = 'cl-bit' + (Math.random() < 0.4 ? ' cl-star' : '');
      b.style.background = pick(BITS);
      b.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      fx.appendChild(b);
      var a = rand(0, Math.PI * 2), d = spread ? rand(spread * 0.4, spread) : rand(34, 88);
      b.animate([
        { transform: 'translate(' + x + 'px,' + y + 'px) scale(1)', opacity: 1 },
        { transform: 'translate(' + (x + Math.cos(a) * d) + 'px,' + (y + Math.sin(a) * d - 14) + 'px) scale(.15)', opacity: 0 }
      ], { duration: rand(480, 760), easing: 'cubic-bezier(.16,.8,.4,1)' })
        .onfinish = (function (el) { return function () { el.remove(); }; })(b);
    }
  }

  /* ---------- click feedback: halo + dust, sometimes a stowaway ---------- */
  function ring(x, y) {
    if (!fx) return;
    var r = document.createElement('div');
    r.className = 'cl-ring';
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    fx.appendChild(r);
    r.animate([
      { transform: 'translate(-50%,-50%) scale(.25)', opacity: .9 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }
    ], { duration: 460, easing: 'cubic-bezier(.2,.7,.3,1)' })
      .onfinish = function () { r.remove(); };
  }

  function miniBfly(x, y) {
    if (!fx) return;
    var el = bfly(13, pick([PURPLE, PINK, LILAC]), pick([PINK, MINT]));
    el.style.pointerEvents = 'none';
    fx.appendChild(el);
    el.animate([
      { transform: 'translate(' + x + 'px,' + y + 'px) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + (x + rand(-32, 32)) + 'px,' + (y - rand(70, 120)) + 'px) rotate(' + rand(-16, 16) + 'deg)', opacity: 0 }
    ], { duration: rand(800, 1100), easing: 'ease-out' })
      .onfinish = function () { el.remove(); };
  }

  /* ---------- flight: sampled quadratic bezier as WAAPI keyframes ---------- */
  function fly(el, p0, p1, p2, dur, spin) {
    var frames = [], N = 16;
    for (var i = 0; i <= N; i++) {
      var t = i / N, u = 1 - t;
      var x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
      var y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y + Math.sin(t * Math.PI * 3) * 9;
      var dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      var ang = spin ? Math.atan2(0, dx) * 0 + (dx < 0 ? -12 : 12) : 0;
      frames.push({ transform: 'translate(' + x + 'px,' + y + 'px) rotate(' + ang + 'deg)' });
    }
    return el.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' });
  }

  /* ---------- ambient butterflies ---------- */
  var ambientTimer = null;
  function quiet() { return lsGet(LS.quiet) === '1'; }

  function spawnCrossing(count, small) {
    if (!fx || REDUCED) return;
    if (fx.querySelectorAll('.cl-bfly').length > 14) return;   // hard cap
    var W = innerWidth, H = innerHeight;
    for (var i = 0; i < count; i++) {
      (function (i) {
        setTimeout(function () {
          if (!fx) return;
          var ltr = Math.random() < 0.5;
          var size = small ? rand(12, 18) : rand(14, 24);
          var el = bfly(size, pick([PURPLE, PINK, LILAC]), pick([PINK, MINT, LILAC]));
          var y0 = rand(H * 0.08, H * 0.7), y2 = rand(H * 0.08, H * 0.7);
          var p0 = { x: ltr ? -40 : W + 40, y: y0 };
          var p2 = { x: ltr ? W + 40 : -40, y: y2 };
          var p1 = { x: W / 2 + rand(-W * 0.2, W * 0.2), y: Math.min(y0, y2) - rand(40, 160) };
          fx.appendChild(el);
          var anim = fly(el, p0, p1, p2, rand(7000, 11000), true);
          anim.onfinish = function () { el.remove(); };
          el.addEventListener('click', function (ev) {
            var r = el.getBoundingClientRect();
            burst(r.left + r.width / 2, r.top + r.height / 2);
            try { anim.cancel(); } catch (e) {}
            el.remove();
            ev.stopPropagation();
          });
        }, i * rand(300, 900));
      })(i);
    }
  }

  function scheduleAmbient() {
    clearTimeout(ambientTimer);
    if (quiet() || REDUCED) return;
    ambientTimer = setTimeout(function () {
      spawnCrossing(2 + ((Math.random() * 2) | 0), true);
      scheduleAmbient();
    }, rand(40000, 90000));
  }

  /* ---------- swarm (Alt+Shift+B / NDY) ---------- */
  function swarm(n) { spawnCrossing(n || 10, false); }

  /* ---------- standing ambience: dust motes + wisps (quiet-aware) ---------- */
  var dust = null;
  function buildDust() {
    if (dust || !fx) return;
    dust = document.createElement('div');
    dust.className = 'cl-dust';
    for (var i = 0; i < 9; i++) {
      var s = document.createElement('i');
      var sz = rand(2, 4);
      s.style.left = rand(2, 98) + 'vw';
      s.style.width = s.style.height = sz + 'px';
      s.style.animationDuration = rand(15, 30) + 's';
      s.style.animationDelay = -rand(0, 30) + 's';
      dust.appendChild(s);
    }
    fx.appendChild(dust);
  }
  function applyQuiet() {
    var q = quiet();
    if (fx) fx.classList.toggle('cl-quiet', q);
    if (q) { if (dust) { dust.remove(); dust = null; } }
    else buildDust();
    if (crew) crew.setQuiet(q);
    scheduleAmbient();
  }

  /* ---------- usage popover: refresh control becomes one of ours ---------- */
  function dressUsageRefresh() {
    try {
      var el = document.querySelector(
        '[title*="刷新用量"],[aria-label*="刷新用量"],[title*="Refresh usage" i],[aria-label*="Refresh usage" i]');
      if (el && el.closest('[data-transcript-scroll],[data-turn-id]')) el = null;
      if (!el) {
        // structural fallback: the small icon-button inside the popover that
        // carries the "采集于 …" line. The transcript can quote that phrase,
        // so anything inside chat turns is off limits (v1 butterfly-ized a
        // copy button in the chat this way).
        var snap = document.evaluate('//*[contains(text(),"采集于")]', document, null, 7, null);
        for (var i2 = 0; i2 < snap.snapshotLength && !el; i2++) {
          var t = snap.snapshotItem(i2);
          if (t.closest('[data-transcript-scroll],[data-turn-id],.session-md')) continue;
          var anc = t;
          for (var k = 0; k < 5 && anc.parentElement; k++) anc = anc.parentElement;
          var btns = anc.querySelectorAll('button,[role="button"]');
          for (var j = 0; j < btns.length; j++) {
            var r = btns[j].getBoundingClientRect();
            if (btns[j].querySelector('svg') && r.width < 44 && r.height < 44) { el = btns[j]; break; }
          }
        }
      }
      if (!el || el.dataset.clBfly) return;
      el.dataset.clBfly = '1';
      // fires once per popover mount, i.e. exactly when the panel opens
      var pop = el.closest('[class*="z-[60]"]') || el.parentElement;
      if (pop && !quiet()) {
        var pr = pop.getBoundingClientRect();
        for (var n = 0; n < 2; n++) {
          (function (n) {
            setTimeout(function () {
              miniBfly(pr.left + rand(pr.width * 0.15, pr.width * 0.85), pr.bottom - 8);
            }, 120 + n * 220);
          })(n);
        }
      }
      var svg = el.querySelector('svg');
      if (svg) svg.style.display = 'none';
      var b = bfly(18, PURPLE, PINK);
      b.className = 'cl-refresh-bfly';
      b.style.pointerEvents = 'none';
      el.appendChild(b);
    } catch (e) {}
  }

  /* ---------- toast ---------- */
  function toast(txt) {
    var t = document.createElement('div');
    t.className = 'cl-toast';
    t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2700);
  }

  /* ---------- NOT DEAD YET ---------- */
  var ndyLast = 0;
  function showNDY(title) {
    var now = Date.now();
    if (now - ndyLast < 20000) return;
    ndyLast = now;
    var d = document.createElement('div');
    d.className = 'cl-ndy';
    d.innerHTML = '<b>NOT DEAD YET</b>';
    var sub = document.createElement('i');
    sub.textContent = title ? '「' + title + '」倒下了 — 会好起来的' : '倒下了 — 会好起来的';
    d.appendChild(sub);
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3600);
    swarm(5);
    if (pet && pet.resurrect) pet.resurrect();
  }

  /* ---------- the bridge: where knowledge of the app comes from ----------
     Loaded from the shared skins dir rather than bundled here, so other skins
     can render the same events with their own vocabulary. If it fails to load,
     or loads and never connects, nothing below ever runs and the pet stays
     exactly the decoration it was. */
  function withBridge(fn) {
    try {
      if (window.__mirasimAgents) { fn(window.__mirasimAgents); return; }
      var s = document.createElement('script');
      s.src = (window.__SKIN_ROOT || './') + '../_shared/agent-bridge.js';
      s.onload = function () { try { if (window.__mirasimAgents) fn(window.__mirasimAgents); } catch (e) {} };
      s.onerror = function () {};
      document.head.appendChild(s);
    } catch (e) {}
  }

  /* ---------- her entourage: one butterfly per live agent ----------
     Reads only the bridge's events. `crew` is null until a bridge shows up, so
     every call site has to tolerate its absence. */
  var crew = null;
  var STALL_MS = 90000;                       // matches the app's own `stalled`
  try { if (window.__CLOVE_STALL_MS) STALL_MS = +window.__CLOVE_STALL_MS; } catch (e) {}

  function Crew() {
    var MAX = 5;                              // six flying objects is noise
    var layer = document.createElement('div');
    layer.className = 'cl-agents';
    document.body.appendChild(layer);

    var items = new Map();                    // id -> item, the ones on screen
    var queue = [];                           // events past the cap, oldest first
    var bubbles = new Map();                  // id -> waiting bubble
    var badge = null, label = null, labelFor = null, stallTimer = null;

    function petCenter() {
      if (!pet || !pet.el) return null;
      var r = pet.el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    /* she moves, they all move: only the layer is repositioned */
    function moveTo(x, b) {
      layer.style.left = (x + 18) + 'px';
      layer.style.bottom = (b + 18) + 'px';
      bubbles.forEach(placeBubble);
    }

    /* One infinite WAAPI animation per butterfly — the perf contract says no
       rAF, and an ellipse sampled into keyframes is the same trick fly() uses
       for bezier flight. */
    function orbit(el) {
      var rx = rand(44, 86), ry = rand(18, 38);
      var ph = Math.random() * Math.PI * 2, dir = Math.random() < 0.5 ? 1 : -1;
      var frames = [], N = 24;
      for (var k = 0; k <= N; k++) {
        var a = ph + dir * (k / N) * Math.PI * 2;
        frames.push({
          transform: 'translate(' + (Math.cos(a) * rx).toFixed(1) + 'px,' +
                     (Math.sin(a) * ry - 30).toFixed(1) + 'px)',
        });
      }
      return el.animate(frames, { duration: rand(9000, 17000), iterations: Infinity, easing: 'linear' });
    }

    function add(e, silent) {
      var it = items.get(e.id);
      if (it) { it.ev = e; return it; }
      if (items.size >= MAX) {
        for (var q = 0; q < queue.length; q++) if (queue[q].id === e.id) return null;
        queue.push(e);
        renderBadge();
        return null;
      }
      var el = bfly(22, PURPLE, PINK);
      el.className = 'cl-bfly cl-agent';
      layer.appendChild(el);
      it = { id: e.id, ev: e, el: el, anim: orbit(el), tickT: null, lastFlap: 0,
             urgent: false, stalled: false };
      if (quiet() || REDUCED) { try { it.anim.pause(); } catch (x) {} }
      items.set(e.id, it);
      bind(it);
      // `silent` is how an agent that was already running when the page loaded
      // arrives: same butterfly, no entrance — it did not just start.
      if (!silent && !quiet()) {
        var c = petCenter();
        if (c) burst(c.x, c.y, 6, 38);
      }
      applyStall(it);
      renderBadge();
      ensureStallTimer();
      return it;
    }

    function bind(it) {
      it.el.addEventListener('mouseenter', function () { showLabel(it); });
      it.el.addEventListener('mouseleave', hideLabel);
      it.el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var r = it.el.getBoundingClientRect();
        ring(r.left + r.width / 2, r.top + r.height / 2);
        focus(it.ev);
      });
    }

    function focus(e) {
      try { if (window.__mirasimAgents) window.__mirasimAgents.focus(e); } catch (x) {}
    }

    /* ---- hover: who is this, and what is it doing right now ---- */
    function sub(it) {
      if (it.ev.waiting) return '等你回答：' + it.ev.waiting;
      if (it.stalled) return '停滞 · ' + (it.ev.activity || '无动静');
      return it.ev.activity || '尚未开始';
    }

    function showLabel(it) {
      hideLabel();
      label = document.createElement('div');
      label.className = 'cl-agent-label';
      var b = document.createElement('b');
      b.textContent = it.ev.title || it.ev.id;
      var i = document.createElement('i');
      i.textContent = sub(it);
      label.appendChild(b);
      label.appendChild(i);
      document.body.appendChild(label);
      labelFor = it;
      var r = it.el.getBoundingClientRect();
      var lw = label.offsetWidth, lh = label.offsetHeight;
      label.style.left = Math.max(8, Math.min(r.left + r.width / 2 - lw / 2, innerWidth - lw - 8)) + 'px';
      label.style.top = Math.max(8, r.top - lh - 10) + 'px';
    }

    function hideLabel() {
      if (label) { label.remove(); label = null; labelFor = null; }
    }

    function refreshLabel(it) {
      if (labelFor === it && label) {
        var i = label.querySelector('i');
        if (i) i.textContent = sub(it);
      }
    }

    /* ---- a step landed (hard) or a bare sign of life (soft) ---- */
    function tick(e, hard) {
      var it = items.get(e.id);
      if (!it) { add(e, true); return; }
      it.ev = e;
      if (it.urgent && !e.waiting) clearUrgent(it);
      applyStall(it);
      refreshLabel(it);
      if (!hard) return;
      var now = Date.now();
      if (now - it.lastFlap < 250) return;   // a fast stream must not saturate the pulse
      it.lastFlap = now;
      // A finite animation on the SVG child, not a class with a removal timer:
      // a class that fails to come off leaves the butterfly permanently "busy",
      // and the orbit already owns the parent's transform.
      var svg = it.el.firstChild;
      if (!svg || !svg.animate) return;
      try {
        svg.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(1.3)' },
          { transform: 'scale(1)' },
        ], { duration: 380, easing: 'cubic-bezier(.3,1.4,.4,1)' });
      } catch (x) {}
    }

    /* Stall is judged by the SERVER's timestamp, not a local timer: an agent
       that went quiet ten minutes before this page loaded must look stalled on
       the first frame, not spend 90s pretending to be busy. */
    function applyStall(it) {
      var last = it.ev.lastActivityAt || 0;
      var st = !it.urgent && last > 0 && (Date.now() - last) > STALL_MS;
      if (st === it.stalled) return;
      it.stalled = st;
      it.el.classList.toggle('cl-stalled', st);
      refreshLabel(it);
    }

    function ensureStallTimer() {
      if (stallTimer || !items.size) return;
      stallTimer = setInterval(function () {
        if (!items.size) { clearInterval(stallTimer); stallTimer = null; return; }
        items.forEach(applyStall);
      }, 3000);
    }

    /* ---- it needs you: the one state allowed to interrupt ---- */
    function waiting(e) {
      var it = items.get(e.id) || add(e, true);
      if (!it) return;
      it.ev = e;
      if (!it.urgent) {
        it.urgent = true;
        it.stalled = false;
        it.el.classList.remove('cl-stalled');
        it.el.classList.add('cl-urgent');
        try { it.anim.cancel(); } catch (x) {}
        // leave the orbit and hold above her, where the eye is already trained
        try {
          it.el.animate(
            [{ transform: 'translate(0,-30px)' }, { transform: 'translate(-6px,-96px)' }],
            { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
        } catch (x) {}
      }
      showBubble(it);
    }

    function clearUrgent(it) {
      it.urgent = false;
      it.el.classList.remove('cl-urgent');
      var b = bubbles.get(it.id);
      if (b) { b.remove(); bubbles.delete(it.id); }
      it.anim = orbit(it.el);
      if (quiet() || REDUCED) { try { it.anim.pause(); } catch (x) {} }
    }

    function showBubble(it) {
      var old = bubbles.get(it.id);
      if (old) old.remove();
      var el = document.createElement('div');
      el.className = 'cl-agent-bubble';
      var b = document.createElement('b');
      b.textContent = '等你回答';
      var s = document.createElement('s');
      s.textContent = it.ev.waiting || it.ev.title || '有一项确认等待你处理';
      var u = document.createElement('u');
      u.textContent = '去回答';
      u.addEventListener('click', function (ev) {
        ev.stopPropagation();
        focus(it.ev);
        el.remove();
        bubbles.delete(it.id);
      });
      el.appendChild(b);
      el.appendChild(s);
      el.appendChild(u);
      document.body.appendChild(el);
      bubbles.set(it.id, el);
      placeBubble(el);
    }

    function placeBubble(el) {
      var c = petCenter();
      if (!c) return;
      var w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(c.x - w / 2, innerWidth - w - 8)) + 'px';
      el.style.top = Math.max(8, c.y - h - 118) + 'px';
    }

    /* ---- it is over ---- */
    function leave(e, kind) {
      var keep = [];
      for (var q = 0; q < queue.length; q++) if (queue[q].id !== e.id) keep.push(queue[q]);
      queue = keep;
      var it = items.get(e.id);
      if (!it) { renderBadge(); return; }
      items.delete(e.id);
      if (labelFor === it) hideLabel();
      var bub = bubbles.get(e.id);
      if (bub) { bub.remove(); bubbles.delete(e.id); }
      clearTimeout(it.tickT);
      var r = it.el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      try { it.anim.cancel(); } catch (x) {}
      if (kind === 'failed') {
        burst(cx, cy, 14);
        it.el.remove();
        showNDY(e.title);
      } else {
        // a farewell arc, then light points. Deliberately no toast: every
        // finished turn announcing itself becomes unbearable within the hour.
        var a = null;
        try {
          a = it.el.animate([
            { transform: 'translate(0,-30px)', opacity: 1 },
            { transform: 'translate(' + rand(-30, 30).toFixed(0) + 'px,-104px)', opacity: 0 },
          ], { duration: 820, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
        } catch (x) {}
        var end = function () {
          if (!quiet()) burst(cx, cy - 74, 7, 44);
          it.el.remove();
        };
        if (a) a.onfinish = end; else end();
      }
      promote();
      renderBadge();
    }

    function promote() {
      while (items.size < MAX && queue.length) add(queue.shift(), true);
    }

    function renderBadge() {
      if (!queue.length) {
        if (badge) { badge.remove(); badge = null; }
        return;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'cl-agent-badge';
        layer.appendChild(badge);
      }
      badge.textContent = '+' + queue.length;
    }

    /* Quiet mode keeps the butterflies — they are information, not decoration —
       but grounds them. A waiting bubble still speaks. */
    function setQuiet(q) {
      items.forEach(function (it) {
        try { if (q) it.anim.pause(); else if (!it.urgent) it.anim.play(); } catch (x) {}
      });
    }

    function hello(list) {
      for (var i = 0; i < list.length; i++) {
        var it = add(list[i], true);
        if (it && list[i].waiting) waiting(list[i]);
      }
    }

    return {
      moveTo: moveTo, hello: hello, tick: tick, waiting: waiting, leave: leave,
      setQuiet: setQuiet,
      start: function (e) { add(e, false); },
      count: function () { return items.size; },
    };
  }

  /* ---------- pet ---------- */
  var pet = null;
  function Pet() {
    var el = document.createElement('div');
    el.className = 'cl-pet';
    el.appendChild(bfly(36, PURPLE, PINK));
    var W = function () { return innerWidth; };
    var saved = null;
    try { saved = JSON.parse(lsGet(LS.pos) || 'null'); } catch (e) {}
    var x = saved && saved.x != null ? saved.x : Math.max(20, W() - 120);
    var b = saved && saved.b != null ? saved.b : 110;
    function place() {
      x = Math.min(Math.max(6, x), W() - 42);
      el.style.left = x + 'px';
      el.style.bottom = Math.min(Math.max(8, b), innerHeight - 60) + 'px';
      if (crew) crew.moveTo(x, Math.min(Math.max(8, b), innerHeight - 60));
    }
    place();
    addEventListener('resize', place);
    document.body.appendChild(el);

    function center() {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    /* resurrect: burst → vanish → burst back (the whole point of clove) */
    var dead = false;
    function resurrect() {
      if (dead) return;
      dead = true;
      var c = center();
      burst(c.x, c.y, 12);
      el.style.opacity = '0';
      setTimeout(function () {
        var c2 = center();
        burst(c2.x, c2.y, 8);
        el.style.opacity = '1';
        dead = false;
      }, 950);
    }

    /* relocation flights */
    var flyTimer = null, menuOpen = false, dragging = false;
    function scheduleFly() {
      clearTimeout(flyTimer);
      if (REDUCED) return;
      flyTimer = setTimeout(function () {
        if (!dragging && !menuOpen && !dead && !document.hidden) {
          var nx = rand(30, W() - 80);
          el.classList.add('cl-flying');
          var dx = nx - x;
          var a = el.animate([
            { transform: 'translate(0,0)' },
            { transform: 'translate(' + dx * 0.5 + 'px,' + -rand(60, 140) + 'px)' },
            { transform: 'translate(' + dx + 'px,0)' }
          ], { duration: rand(2200, 3200), easing: 'ease-in-out' });
          a.onfinish = function () {
            el.classList.remove('cl-flying');
            x = nx; place();
            lsSet(LS.pos, JSON.stringify({ x: x, b: b }));
          };
        }
        scheduleFly();
      }, rand(60000, 150000));
    }
    scheduleFly();

    /* cursor spook: cheap check, long cooldown, no rAF loop */
    var lastSpook = 0;
    addEventListener('mousemove', function (ev) {
      var now = Date.now();
      if (now - lastSpook < 9000 || dead || dragging || REDUCED) return;
      var c = center();
      var dx = ev.clientX - c.x, dy = ev.clientY - c.y;
      if (dx * dx + dy * dy < 80 * 80) {
        lastSpook = now;
        el.classList.add('cl-flying');
        var a = el.animate([
          { transform: 'translate(0,0)' },
          { transform: 'translate(' + (dx < 0 ? 18 : -18) + 'px,-30px)' },
          { transform: 'translate(0,0)' }
        ], { duration: 620, easing: 'ease-out' });
        a.onfinish = function () { el.classList.remove('cl-flying'); };
      }
    }, { passive: true });

    /* drag with click discrimination */
    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var sx = ev.clientX, sy = ev.clientY, ox = x, ob = b, moved = false;
      dragging = true;
      el.classList.add('cl-drag');
      el.setPointerCapture(ev.pointerId);
      function mv(e2) {
        var dx = e2.clientX - sx, dy = e2.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        x = ox + dx; b = ob - dy; place();
      }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.classList.remove('cl-drag');
        dragging = false;
        if (moved) lsSet(LS.pos, JSON.stringify({ x: x, b: b }));
        else resurrect();                       // plain click
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
    });

    /* context menu */
    el.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var stale = document.querySelector('.cl-menu');
      if (stale) stale.remove();
      var m = document.createElement('div');
      m.className = 'cl-menu';
      function item(txt, fn) {
        var d = document.createElement('div');
        d.textContent = txt;
        d.onclick = function () { closeMenu(); fn(); };
        m.appendChild(d);
      }
      item('切换皮肤…（F9）', function () {
        if (window.__skinManager) window.__skinManager.open();
      });
      item('隐藏桌宠（Alt+Shift+M 唤回）', function () { hide(); });
      item(quiet() ? '安静模式：开 → 点击关闭' : '安静模式：关 → 点击开启', function () {
        lsSet(LS.quiet, quiet() ? null : '1');
        toast(quiet() ? '安静模式已开启 — 氛围全体休息' : '安静模式已关闭');
        applyQuiet();
      });
      item('换个位置', function () { clearTimeout(flyTimer); flyTimer = setTimeout(scheduleFly, 0); x = rand(30, W() - 80); place(); lsSet(LS.pos, JSON.stringify({ x: x, b: b })); });
      item('放一群蝴蝶（Alt+Shift+B）', function () { swarm(10); });
      m.style.left = Math.min(ev.clientX, innerWidth - 190) + 'px';
      m.style.top = Math.min(ev.clientY, innerHeight - 180) + 'px';
      document.body.appendChild(m);
      menuOpen = true;
      // Outside-close must IGNORE presses inside the menu: pointerdown fires
      // before click, so closing here would detach the item before its click
      // ever dispatches (this exact bug killed every menu action in v1).
      function outside(e2) {
        if (m.contains(e2.target)) return;
        closeMenu();
      }
      setTimeout(function () {
        addEventListener('pointerdown', outside, true);
      }, 0);
      function closeMenu() {
        removeEventListener('pointerdown', outside, true);
        if (m.isConnected) m.remove();
        menuOpen = false;
      }
    });

    function hide() {
      lsSet(LS.pet, 'off');
      el.remove();
      pet = null;
      toast('蝴蝶飞走了 — Alt+Shift+M 唤回');
    }

    return { el: el, resurrect: resurrect, hide: hide };
  }

  function togglePet() {
    if (pet) { pet.hide(); return; }
    lsSet(LS.pet, null);
    pet = Pet();
    var c = pet.el.getBoundingClientRect();
    burst(c.left + 18, c.top + 18, 8);
  }

  /* ---------- boot ---------- */
  function boot() {
    try {
      fx = document.createElement('div');
      fx.className = 'cl-fx';
      document.body.appendChild(fx);

      if (!REDUCED) {
        var intro = document.createElement('div');
        intro.className = 'cl-intro';
        document.body.appendChild(intro);
        setTimeout(function () { intro.remove(); }, 1400);
        setTimeout(function () { spawnCrossing(2, true); }, 700);   // opening flourish
      }

      if (lsGet(LS.pet) !== 'off') pet = Pet();
      applyQuiet();

      /* The dashboard half: butterflies stand in for live agents. Everything
         here is additive — with no bridge, none of it exists and she is the
         decoration she always was. */
      withBridge(function (ag) {
        try {
          crew = Crew();
          if (pet) {
            var pr = pet.el.getBoundingClientRect();
            crew.moveTo(pr.left, innerHeight - pr.bottom);
          }
          ag.on('hello', function (d) { crew.hello((d && d.alive) || []); });
          ag.on('start', function (e) { crew.start(e); });
          ag.on('activity', function (e) { crew.tick(e, true); });
          ag.on('beat', function (e) { crew.tick(e, false); });
          ag.on('waiting', function (e) { crew.waiting(e); });
          ag.on('done', function (e) { crew.leave(e, 'done'); });
          ag.on('failed', function (e) { crew.leave(e, 'failed'); });
          ag.on('gone', function (e) { crew.leave(e, 'gone'); });
        } catch (e) {
          try { console.warn('[clove] agent dashboard off:', e); } catch (x) {}
        }
      });

      window.addEventListener('keydown', function (e) {
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
        if (e.code === 'KeyB') { e.preventDefault(); swarm(11); }
        if (e.code === 'KeyM') { e.preventDefault(); togglePet(); }
      }, true);

      var lastClick = 0;
      window.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0 || !fx) return;
        var now = Date.now();
        if (now - lastClick < 90) return;   // drags and double-clicks: one halo
        lastClick = now;
        ring(ev.clientX, ev.clientY);
        burst(ev.clientX, ev.clientY, 5, 52);
        if (Math.random() < 0.14) miniBfly(ev.clientX, ev.clientY);
        // popovers mount right after the press that opens them
        setTimeout(dressUsageRefresh, 180);
      }, { capture: true, passive: true });
    } catch (e) {
      try { console.warn('[clove] fx disabled:', e); } catch (x) {}
    }
  }

  if (document.body) setTimeout(boot, 60);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
})();
