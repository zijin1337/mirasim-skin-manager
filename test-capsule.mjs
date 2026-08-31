// 胶囊渲染冒烟测试：最小 DOM 垫片 + 固定 __ggTelemetry，跑 render 后断言药丸/面板内容。
// 覆盖纯格式化（usd/百分比/火花线/离线态），不验证真实 CSS 布局（那靠 mirasim 里肉眼）。
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

// 胶囊现为共享模块（_shared）；两份副本目录名不同：work=skins-src，发布仓=skins
function capsulePath() {
  for (const rel of ['./skins-src/_shared/telemetry-capsule.js', './skins/_shared/telemetry-capsule.js']) {
    const u = new URL(rel, import.meta.url);
    if (existsSync(u)) return u;
  }
  throw new Error('telemetry-capsule.js not found in _shared/');
}

function makeDom() {
  const byId = {};
  function mk(tag) {
    const el = {
      tag, id: '', className: '', _html: '', style: {}, textContent: '',
      children: [],
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      _on: {},
      addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); },
      removeEventListener() {}, remove() {},
      appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      contains(n) { return n === this; },
      fire(t, ev) { (this._on[t] || []).forEach((f) => f(ev || { stopPropagation() {} })); },
    };
    return el;
  }
  const doc = {
    _byId: byId,
    head: mk('head'), body: mk('body'), documentElement: mk('html'),
    createElement: mk,
    getElementById: (id) => byId[id] || null,
    addEventListener() {}, removeEventListener() {},
  };
  return doc;
}

function loadCapsule(telemetry) {
  const code = readFileSync(capsulePath(), 'utf8');
  const document = makeDom();
  const window = {
    __ggTelemetry: telemetry,
    __SKIN_ROOT: './',
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  const ctx = {
    window, document, Event: function () {},
    setInterval() {}, setTimeout(fn) { /* 不自动跑，避免副作用 */ },
    Date, Math, Intl,
  };
  // 暴露 render 需要的全局
  const f = new Function(...Object.keys(ctx), code + '\n;return {toggle:()=>{},get:()=>window.__ggCapsule};');
  f(...Object.values(ctx));
  return document;
}

const FIX = {
  at: Math.floor(Date.now() / 1000),
  connected: true,
  centsPerUnit: 0.31,
  plan: { label: 'MAX', validUntil: '2027-08-11', account: '…7c3e93' },
  windows: [
    { name: '5h', label: '5 小时', usedUnits: 28577, budgetUnits: 156800, usedPct: 18.2, remainPct: 82,
      pacePct: 63.7, deltaText: '匀速省 45%', usedUsd: 88.6, budgetUsd: 486, remainUsd: 397,
      reqCount: 340, burnPerHour: 5.6, resetText: '01:48:53', exhaustText: '够到重置', spark: [1, 3, 6, 10, 18] },
    { name: '7d', label: '7 天', usedUnits: 182308, budgetUnits: 560000, usedPct: 32.6, remainPct: 67,
      pacePct: 5.4, deltaText: '匀速快 27%', usedUsd: 565, budgetUsd: 1736, remainUsd: 1171,
      reqCount: 1434, burnPerHour: 2.5, resetText: '6天15:06:46', exhaustText: '9/2 01:58尽', spark: [5, 12, 20, 28, 32] },
  ],
  totals: { today: { usd: 168, reqs: 332 }, week: { usd: 168, reqs: 332 }, month: { usd: 2355, reqs: 4443 }, rolling30: { usd: 2448, reqs: 4600 } },
  live: { model: 'Fable 5', tokPerSec: 34, secPerTurn: 14.5 },
};

test('药丸显示最紧窗口 + 剩余美元', () => {
  const doc = loadCapsule(FIX);
  const cap = doc.getElementById('gg-cap');
  assert.ok(cap, '药丸已创建');
  // 最紧 = usedPct 最大 = 7 天(32.6)
  assert.match(cap.innerHTML, /7 天/);
  assert.match(cap.innerHTML, /67%/);
  assert.match(cap.innerHTML, /\$1,171/); // remainUsd
});

test('离线态：药丸置灰、文案离线', () => {
  const stale = { ...FIX, at: Math.floor(Date.now() / 1000) - 60 };
  const doc = loadCapsule(stale);
  const cap = doc.getElementById('gg-cap');
  assert.ok(cap.classList.contains('off'), 'stale → off');
});

test('面板：卡片/累计/吞吐/火花线齐全', () => {
  const doc = loadCapsule(FIX);
  const cap = doc.getElementById('gg-cap');
  cap.fire('click'); // 展开
  const panel = doc.getElementById('gg-panel');
  const h = panel.innerHTML;
  assert.match(h, /Mirasim 遥测/);
  assert.match(h, /MAX/);
  assert.match(h, /5 小时/);
  assert.match(h, /7 天/);
  assert.match(h, /匀速快 27%/);       // 7天 deltaText
  assert.match(h, /9\/2 01:58尽/);      // exhaust
  assert.match(h, /<polyline/);         // 火花线
  assert.match(h, /已花/);              // 累计区
  assert.match(h, /近 30 天 \$2,448/);  // 大字用滚动 30 天
  assert.match(h, /今日/);              // 三个小行
  assert.match(h, /本周/);
  assert.match(h, /本月/);
  assert.match(h, /Fable 5/);           // live
  assert.match(h, /34 tok\/s/);
});

test('从未收到数据（没装 glassgauge）：完全隐身，不留离线药丸', () => {
  const doc = loadCapsule(null);
  const cap = doc.getElementById('gg-cap');
  // 要么根本没创建，要么创建了也 display:none
  assert.ok(!cap || cap.style.display === 'none', '无数据时药丸不可见');
});
