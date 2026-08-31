/* 内嵌遥测胶囊（spec 2026-08-31）：右下角小药丸 + 点开富面板。
 *
 * 共享模块：由加载器无视当前皮肤（含"原版"）总是注入，所以停在原版也能看到胶囊。
 * 纯显示，零计算——数据由 glassgauge.exe 每 5s 写到 _shared/telemetry.js
 * （window.__ggTelemetry），本模块加载它并渲染。定位用 window.__GG_SHARED（加载器给的
 * _shared/ 绝对 URL），退回 __SKIN_ROOT。
 * 关键：**从未收到过数据（没装 glassgauge）时完全隐藏**，不给无关用户留一个离线药丸；
 * 收到过之后再断流才显示"离线"。深色 UI 浅字。
 */
(function () {
  'use strict';
  if (window.__ggCapsule) return;
  window.__ggCapsule = { v: 1 };

  var STALE_MS = 20000;
  var SHARED = window.__GG_SHARED || ((window.__SKIN_ROOT || './') + '../_shared/');
  var open = false;

  /* ---------- 样式（内联，仅本模块） ---------- */
  var css = [
    '#gg-cap,#gg-panel{position:fixed;z-index:2147483000;font:12px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#eef1f7;-webkit-user-select:none;user-select:none}',
    '#gg-cap{right:16px;bottom:16px;display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;cursor:pointer;',
    'background:rgba(20,24,34,.72);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);box-shadow:0 6px 20px rgba(0,0,0,.4)}',
    '#gg-cap:hover{background:rgba(28,34,48,.82)}',
    '#gg-cap .d{width:7px;height:7px;border-radius:50%;background:#56d364;box-shadow:0 0 7px #56d364;flex:none}',
    '#gg-cap.off .d{background:#7c8596;box-shadow:none}',
    '#gg-cap .n{font-weight:700}',
    '#gg-panel{right:16px;bottom:60px;width:320px;padding:14px;border-radius:16px;display:none;',
    'background:rgba(16,20,30,.9);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(22px) saturate(1.15);box-shadow:0 20px 50px rgba(0,0,0,.5)}',
    '#gg-panel.show{display:block}',
    '#gg-panel .hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
    '#gg-panel .hd .t{font-size:13.5px;font-weight:650}',
    '#gg-panel .hd .badge{font-size:9.5px;font-weight:750;letter-spacing:.6px;padding:2px 7px;border-radius:6px;color:#ffc861;background:rgba(255,200,97,.13);border:1px solid rgba(255,200,97,.4)}',
    '#gg-panel .hd .acc{font-size:10px;opacity:.5}',
    '#gg-panel .hd .exp{margin-left:auto;font-size:9.5px;opacity:.55}',
    '#gg-panel .card{margin-top:9px;padding:10px 11px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07)}',
    '#gg-panel .r1{display:flex;align-items:center;gap:7px}',
    '#gg-panel .r1 .w{font-size:12px;font-weight:600}',
    '#gg-panel .r1 .rem{margin-left:auto;font-size:10px;opacity:.6}',
    '#gg-panel .r1 .pct{font-size:17px;font-weight:800;letter-spacing:-.3px}',
    '#gg-panel .spark{flex:none}',
    '#gg-panel .bar{position:relative;height:6px;margin:8px 0 6px;border-radius:99px;background:rgba(255,255,255,.13)}',
    '#gg-panel .fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#3aa856,#56d364)}',
    '#gg-panel .tick{position:absolute;top:-2px;bottom:-2px;width:2px;border-radius:2px;background:rgba(255,255,255,.7)}',
    '#gg-panel .l{display:flex;font-size:10px;opacity:.72;margin-top:3px}',
    '#gg-panel .l .r{margin-left:auto}',
    '#gg-panel .l.dim{opacity:.5}',
    '#gg-panel .sec{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}',
    '#gg-panel .sec .h{font-size:9.5px;opacity:.5;letter-spacing:.5px;margin-bottom:5px}',
    '#gg-panel .big{font-size:20px;font-weight:800;color:#8fb8ff}',
    '#gg-panel .live{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:10.5px;opacity:.8}',
    '#gg-panel .foot{margin-top:10px;font-size:9.5px;opacity:.5;display:flex;align-items:center;gap:6px}',
    '#gg-panel .foot .d{width:6px;height:6px;border-radius:50%;background:#56d364}',
    '#gg-panel.stale .foot .d{background:#7c8596}',
  ].join('');

  function ensureStyle() {
    if (document.getElementById('gg-cap-style')) return;
    var st = document.createElement('style');
    st.id = 'gg-cap-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- helpers ---------- */
  function usd(v) {
    if (v == null) return '—';
    if (v >= 100) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 10) return '$' + v.toFixed(1);
    return '$' + v.toFixed(2);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function ago(sec) {
    if (sec < 60) return sec + '秒前';
    if (sec < 3600) return Math.floor(sec / 60) + '分前';
    return Math.floor(sec / 3600) + '小时前';
  }
  function statusColor(w) {
    // 落后于匀速线（快）偏橙提醒；否则绿
    return /快/.test(w.deltaText || '') ? '#e8a13d' : '#56d364';
  }
  function sparkSvg(arr) {
    if (!arr || arr.length < 2) return '';
    var w = 54, h = 16, lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
    var rng = hi - lo || 1;
    var pts = arr.map(function (v, i) {
      var x = (i / (arr.length - 1)) * w;
      var y = h - ((v - lo) / rng) * (h - 2) - 1;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline points="' + pts + '" fill="none" stroke="#8fb8ff" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/></svg>';
  }

  /* ---------- render ---------- */
  function tightest(wins) {
    return wins.reduce(function (a, b) { return (!a || b.usedPct > a.usedPct) ? b : a; }, null);
  }

  function render() {
    var d = window.__ggTelemetry;
    var cap = document.getElementById('gg-cap');
    var panel = document.getElementById('gg-panel');
    // 从未收到数据（没装 glassgauge）→ 完全隐身，不创建任何 DOM
    if (!d) {
      if (cap) cap.style.display = 'none';
      if (panel) panel.classList.remove('show');
      return;
    }
    ensureStyle();
    if (!cap) {
      cap = document.createElement('div'); cap.id = 'gg-cap';
      cap.addEventListener('click', toggle);
      document.body.appendChild(cap);
    }
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'gg-panel';
      document.body.appendChild(panel);
    }
    cap.style.display = '';
    var stale = !d.at || (Date.now() / 1000 - d.at) * 1000 > STALE_MS;
    cap.classList.toggle('off', stale || d.connected === false);

    if (!d.windows || !d.windows.length) {
      cap.innerHTML = '<span class="d"></span><span class="n">用量离线</span>';
    } else {
      var t = tightest(d.windows);
      cap.innerHTML = '<span class="d" style="' + (stale ? '' : 'background:' + statusColor(t) + ';box-shadow:0 0 7px ' + statusColor(t)) + '"></span>' +
        '<span>' + esc(t.label) + '</span><span class="n">' + t.remainPct + '%</span>' +
        '<span style="opacity:.65">剩 ' + usd(t.remainUsd) + '</span>';
    }

    panel.classList.toggle('show', open);
    panel.classList.toggle('stale', stale);
    if (open && d) panel.innerHTML = panelHtml(d, stale);
  }

  function panelHtml(d, stale) {
    var cards = (d.windows || []).map(function (w) {
      var col = statusColor(w);
      return '<div class="card">' +
        '<div class="r1"><span class="w">' + esc(w.label) + '</span>' + sparkSvg(w.spark) +
        '<span class="rem">剩 ' + w.remainPct + '%</span>' +
        '<span class="pct" style="color:' + col + '">' + w.usedPct + '%</span></div>' +
        '<div class="bar"><div class="fill" style="width:' + Math.min(100, w.usedPct) + '%"></div>' +
        '<div class="tick" style="left:' + w.pacePct + '%"></div></div>' +
        '<div class="l"><span>' + esc(w.usedUnits ? fmt(w.usedUnits) + ' / ' + fmt(w.budgetUnits) + ' 点' : '') + '</span>' +
        '<span class="r">' + (w.reqCount || 0) + ' 次</span></div>' +
        '<div class="l"><span>额度 ' + usd(w.usedUsd) + ' / ' + usd(w.budgetUsd) + ' 余 ' + usd(w.remainUsd) + '</span>' +
        '<span class="r">' + esc(w.deltaText) + '</span></div>' +
        '<div class="l dim"><span>⏱ ' + esc(w.resetText) + ' · ' + (w.burnPerHour || 0) + '%/h</span>' +
        '<span class="r">' + esc(w.exhaustText) + '</span></div>' +
        '</div>';
    }).join('');

    var tot = d.totals || {};
    var totRow = function (label, o) {
      if (!o) return '';
      return '<div class="l"><span>' + label + ' ' + usd(o.usd) + '</span><span class="r">' + (o.reqs || 0) + ' 次</span></div>';
    };
    var live = d.live ? '<div class="live">⚡ ' + esc(d.live.model) + ' · ' + d.live.tokPerSec + ' tok/s · ' + d.live.secPerTurn + ' s/轮' +
      (tot.today ? ' · 今日 ' + usd(tot.today.usd) + '/' + tot.today.reqs + '次' : '') + '</div>' : '';

    var freshAgo = d.at ? ago(Math.max(0, Math.floor(Date.now() / 1000 - d.at))) : '—';
    return '<div class="hd"><span class="t">Mirasim 遥测</span>' +
      (d.plan && d.plan.label ? '<span class="badge">' + esc(d.plan.label) + '</span>' : '') +
      (d.plan && d.plan.account ? '<span class="acc">' + esc(d.plan.account) + '</span>' : '') +
      '<span class="exp">' + (d.plan && d.plan.validUntil ? '到期 ' + esc(d.plan.validUntil) : '') + '</span></div>' +
      cards +
      '<div class="sec"><div class="h">已花 · 仅经 Mirasim</div>' +
      (tot.month ? '<div class="big">本月 ' + usd(tot.month.usd) + '</div>' : '') +
      totRow('本周', tot.week) + totRow('本月', tot.month) + '</div>' +
      live +
      '<div class="foot"><span class="d"></span>' + (stale ? '离线' : '精确') + ' · ' + freshAgo + '</div>';
  }

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  function toggle(e) {
    if (e) e.stopPropagation();
    open = !open;
    render();
    if (open) {
      setTimeout(function () {
        document.addEventListener('pointerdown', outside, true);
      }, 0);
    } else {
      document.removeEventListener('pointerdown', outside, true);
    }
  }
  function outside(e) {
    var panel = document.getElementById('gg-panel');
    var cap = document.getElementById('gg-cap');
    if (panel && (panel.contains(e.target) || (cap && cap.contains(e.target)))) return;
    open = false;
    document.removeEventListener('pointerdown', outside, true);
    render();
  }

  /* ---------- data pump: reload telemetry.js every 5s (cache-bust) ---------- */
  function pump() {
    var s = document.createElement('script');
    s.src = SHARED + 'telemetry.js?t=' + Date.now();
    s.onload = function () { this.remove(); };
    s.onerror = function () { this.remove(); render(); }; // 加载失败也刷新（有旧数据→离线；无→保持隐身）
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener('gg-telemetry', render);
  render();               // 先画（可能离线）
  pump();
  setInterval(pump, 5000);
  setInterval(render, 1000); // 新鲜度倒计时本地走动
})();
