// mirasim-skinmgr loader — the only thing installed into app.asar.
// Mounts the active skin from the external skins directory and owns the
// Alt+Shift+T picker. Any failure here must degrade to the stock UI.
//
// __SKINS_URL__ is replaced at install time with the absolute file:// URL of
// ~/.mirasim/skins (no trailing slash).
(function () {
  'use strict';
  if (window.__skinManager) return;

  var SKINS = '__SKINS_URL__';
  var KEY = 'mirasim-skinmgr-active';   // absent → DEFAULT_SKIN; 'off' → stock; else skin name
  var DEBUG_KEY = 'mirasim-skinmgr-debug';
  var DEFAULT_SKIN = 'clove';           // first-run default: the star skin, no hotkey needed
  var st = {
    active: '',      // skin name or '' for stock
    skins: null,     // manifest list, null until loaded
    manifestFailed: false,
    errors: {},      // name -> 'css' | 'js'
    panel: null,
  };

  function beacon(stage) {
    try {
      if (localStorage.getItem(DEBUG_KEY) !== '1') return;
      fetch('http://127.0.0.1:51791/beacon?stage=' + encodeURIComponent(stage) +
            '&skin=' + encodeURIComponent(st.active || 'none'))
        .catch(function () {});
    } catch (e) {}
  }

  function markError(kind) {
    st.errors[st.active] = kind;
    console.warn('[skinmgr] failed to load skin ' + kind + ' for "' + st.active + '"');
    beacon(kind + '-fail');
    if (st.panel) renderRows();
  }

  function mountActive() {
    if (!st.active) return;
    var root = SKINS + '/' + st.active + '/';
    window.__SKIN_ROOT = root;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = root + 'skin.css';
    link.onload = function () { beacon('css-ok'); };
    link.onerror = function () { markError('css'); };
    document.head.appendChild(link);

    var js = document.createElement('script');
    js.src = root + 'skin.js';
    js.onload = function () { beacon('js-ok'); };
    // A skin may ship CSS only — a missing skin.js is only reported, never
    // treated as breakage beyond the panel note.
    js.onerror = function () { markError('js'); };
    document.head.appendChild(js);
  }

  function loadManifest() {
    var s = document.createElement('script');
    s.src = SKINS + '/manifest.js';
    s.onload = function () {
      st.skins = Array.isArray(window.__mirasimSkins) ? window.__mirasimSkins : [];
      beacon('manifest-ok');
      if (st.panel) renderRows();
    };
    s.onerror = function () {
      st.manifestFailed = true;
      beacon('manifest-fail');
      if (st.panel) renderRows();
    };
    document.head.appendChild(s);
  }

  // ---------- picker panel ----------

  var css = {
    wrap: 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(10,8,16,.55);backdrop-filter:blur(3px);' +
      'font-family:system-ui,sans-serif;',
    box: 'min-width:320px;max-width:420px;max-height:70vh;overflow:auto;border-radius:12px;' +
      'background:rgba(28,24,38,.96);color:#f2eefb;border:1px solid rgba(255,255,255,.14);' +
      'box-shadow:0 18px 60px rgba(0,0,0,.55);padding:10px;',
    title: 'font-size:13px;letter-spacing:.18em;opacity:.65;padding:6px 10px 10px;',
    row: 'display:flex;align-items:center;gap:10px;padding:10px;border-radius:9px;' +
      'cursor:pointer;border:1px solid transparent;',
    rowCur: 'background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.22);',
    rowDim: 'opacity:.45;cursor:default;',
    swatch: 'width:16px;height:16px;border-radius:5px;flex:none;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);',
    label: 'font-size:14px;font-weight:600;',
    desc: 'font-size:12px;opacity:.62;margin-top:2px;',
    hint: 'padding:12px;font-size:12.5px;opacity:.75;line-height:1.6;',
  };

  function pick(name) {
    try { localStorage.setItem(KEY, name || 'off'); } catch (e) {}
    location.reload();
  }

  function row(name, label, accent, desc) {
    var cur = name === st.active;
    var bad = st.errors[name] === 'css'; // css missing = skin effectively dead
    var r = document.createElement('div');
    r.style.cssText = css.row + (cur ? css.rowCur : '') + (bad ? css.rowDim : '');
    var sw = document.createElement('div');
    sw.style.cssText = css.swatch + 'background:' + (accent || '#888') + ';';
    var tx = document.createElement('div');
    var l1 = document.createElement('div');
    l1.style.cssText = css.label;
    l1.textContent = label + (cur ? '  ·  当前' : '') + (bad ? '  ⚠ 文件缺失' : '');
    var l2 = document.createElement('div');
    l2.style.cssText = css.desc;
    l2.textContent = desc || '';
    tx.appendChild(l1); l2.textContent && tx.appendChild(l2);
    r.appendChild(sw); r.appendChild(tx);
    if (!bad && !cur) {
      r.onmouseenter = function () { r.style.background = 'rgba(255,255,255,.06)'; };
      r.onmouseleave = function () { r.style.background = ''; };
    }
    if (!bad) r.onclick = function () { pick(name); };
    return r;
  }

  function renderRows() {
    var box = st.panel.firstChild;
    while (box.childNodes.length > 1) box.removeChild(box.lastChild);
    box.appendChild(row('', '原版', '#5a5a66', '关闭所有皮肤'));
    if (st.skins && st.skins.length) {
      st.skins.forEach(function (s) {
        if (s && s.name) box.appendChild(row(s.name, s.label || s.name, s.accent, s.description));
      });
    } else {
      var hint = document.createElement('div');
      hint.style.cssText = css.hint;
      hint.textContent = st.manifestFailed
        ? '未找到皮肤清单 — 请双击 同步皮肤.cmd 后刷新（Ctrl+R）。'
        : (st.skins ? '皮肤目录是空的 — 丢皮肤文件夹进去后双击 同步皮肤.cmd。' : '正在读取皮肤清单…');
      box.appendChild(hint);
    }
  }

  function open() {
    if (st.panel) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = css.wrap;
    var box = document.createElement('div');
    box.style.cssText = css.box;
    var title = document.createElement('div');
    title.style.cssText = css.title;
    title.textContent = 'MIRASIM SKINS · F9 面板 · F5 重载';
    box.appendChild(title);
    wrap.appendChild(box);
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    st.panel = wrap;
    renderRows();
    (document.body || document.documentElement).appendChild(wrap);
  }

  function close() {
    if (!st.panel) return;
    st.panel.remove();
    st.panel = null;
  }

  function toggle() { st.panel ? close() : open(); }

  // ---------- boot ----------

  try {
    try {
      var raw = localStorage.getItem(KEY);
      st.active = raw === null ? DEFAULT_SKIN : (raw === 'off' ? '' : raw);
    } catch (e) {}
    beacon('boot');
    mountActive();
    loadManifest();

    window.addEventListener('keydown', function (e) {
      var bare = !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      // The app ships without a native menu, so stock reload accelerators are
      // gone — F5 restores an in-page reload (how skin edits take effect).
      if (e.code === 'F5' && bare) {
        e.preventDefault();
        e.stopPropagation();
        location.reload();
        return;
      }
      // Alt+Shift can be eaten by the Windows input-language switcher, so F9
      // works as a bare spare key.
      var combo = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT';
      if (!combo && !(e.code === 'F9' && bare)) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);

    window.__skinManager = {
      open: open, close: close, toggle: toggle, pick: pick,
      get active() { return st.active; },
      get skins() { return st.skins; },
      get errors() { return st.errors; },
    };
  } catch (e) {
    // Degrade to the stock UI; never let the manager break the app.
    try { console.warn('[skinmgr] disabled:', e); } catch (x) {}
  }
})();
