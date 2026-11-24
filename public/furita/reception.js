/* 受付QRの表示(ES5・iOS 9.3.5向け: let/const/arrow/template/fetch/Promise を使わない)。
   開催前にネットにつないで、ふりた用コードで「開催情報+30秒ごとのトークン一覧」を取得して保存。開催中はオフラインでQR表示・30秒更新ができる。
   QR画面は、タイマー等の画面とは別の要素(#rq)で、上に重ねて表示する。裏のタイマー・音・番号抽選は止めない・作り直さない。 */
(function () {
  'use strict';
  var Q = window.FuritaQr, KEY = 'furita.rq.v1';
  var rec = null, shown = false, lastSlot = -1, timerIv = null, rootEl = null, msg = '';
  var R = {};

  function load() {
    var raw = null, o;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) { return null; }
    try { o = Q.parse(JSON.parse(raw)); } catch (e2) { o = null; }
    return o;
  }
  function store(o) { try { window.localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  rec = load();

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function dateText(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }

  /* ---- 取得(XMLHttpRequest。iOS 9でも使える) ---- */
  R.sync = function (code, done) {
    var x = new XMLHttpRequest(), t0 = Date.now();
    x.open('POST', '/api/furita/sync', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('X-Requested-With', 'furita');
    x.timeout = 20000;
    x.onload = function () {
      var j, o, t1 = Date.now();
      if (x.status === 429) { done('混み合っています。少し待ってからやり直してください'); return; }
      if (x.status !== 200) { done('コードが正しくないか、期限切れです。PLAYCEの管理画面で発行し直してください'); return; }
      try { j = JSON.parse(x.responseText); } catch (e) { done('取得できませんでした(応答が不正)'); return; }
      o = Q.parse({ event: j.event, origin: j.origin, tokens: j.tokens, offset: Q.offsetOf(j.serverNow, t0, t1), syncedAt: t1 });
      if (!o) { done('取得できませんでした(内容が不正)'); return; }
      if (!store(o)) { done('この端末に保存できません(プライベートブラウズ等)'); return; }
      rec = o; lastSlot = -1;
      done('');
    };
    x.onerror = x.ontimeout = function () { done('通信できません。インターネットにつないでやり直してください'); };
    x.send(JSON.stringify({ code: code }));
  };
  R.clear = function () { try { window.localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ } rec = null; lastSlot = -1; };
  R.info = function () {
    if (!rec) { return null; }
    return { title: rec.event.title, venue: rec.event.venue, multiplier: rec.event.multiplier, count: rec.tokens.length, syncedAt: rec.syncedAt, validUntil: (Q.lastSlot(rec) + 1) * Q.SLOT_MS - rec.offset, expired: Date.now() + rec.offset >= (Q.lastSlot(rec) + 1) * Q.SLOT_MS, drift: Math.abs(rec.offset) };
  };

  /* ---- QR描画(canvas。外部の画像・通信を使わない) ---- */
  function draw(canvas, text) {
    var qr, n, q = 4, cell, size, ctx, r, c;
    qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    n = qr.getModuleCount();
    size = 400; cell = Math.floor(size / (n + q * 2));
    canvas.width = canvas.height = cell * (n + q * 2);
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (r = 0; r < n; r += 1) { for (c = 0; c < n; c += 1) { if (qr.isDark(r, c)) { ctx.fillRect((c + q) * cell, (r + q) * cell, cell, cell); } } }
  }

  function ensureRoot() {
    if (rootEl) { return; }
    rootEl = document.createElement('div');
    rootEl.id = 'rq';
    rootEl.className = 'rq';
    rootEl.style.display = 'none';
    document.body.appendChild(rootEl);
    rootEl.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== rootEl) { if (el.getAttribute && el.getAttribute('data-rq') === 'close') { R.hide(); return; } el = el.parentNode; }
    }, false);
  }
  function build() {
    var h = '<div class="rq-head"><span class="rq-brand">PLAYCE</span><span class="rq-timer" id="rq-timer"></span></div>';
    if (!rec) {
      h += '<div class="rq-body"><h2>受付QRが未設定です</h2><p class="rq-note">インターネットにつないだ状態で、設定タブに「ふりた用コード」を入れて取得してください。</p><button type="button" class="rq-back" data-rq="close">ふりたに戻る</button></div>';
    } else {
      h += '<div class="rq-body"><h2>' + esc(rec.event.title) + '</h2>';
      if (rec.event.multiplier > 1) { h += '<p class="rq-multi">本日はスタンプ' + rec.event.multiplier + '倍DAY!</p>'; }
      h += '<div class="rq-qr"><canvas id="rq-canvas" width="10" height="10"></canvas><div class="rq-ng" id="rq-ng"></div></div>';
      h += '<p class="rq-note">スマホのカメラで読み取ってください(30秒ごとに切り替わります)</p><div class="rq-bar"><div id="rq-barin"></div></div><p class="rq-sec" id="rq-sec"></p>';
      h += '<button type="button" class="rq-back" data-rq="close">ふりたに戻る</button></div>';
    }
    rootEl.innerHTML = h;
    lastSlot = -1;
  }
  function refresh() {
    var now, slot, tok, c, ng, t, tm;
    if (!shown) { return; }
    now = Date.now();
    tm = document.getElementById('rq-timer');
    if (tm && R.timerText) { t = R.timerText(); tm.firstChild ? (tm.firstChild.nodeValue = t) : (tm.appendChild(document.createTextNode(t))); }
    if (!rec) { return; }
    slot = Q.slotAt(now, rec.offset);
    tok = Q.pick(rec.tokens, now, rec.offset);
    c = document.getElementById('rq-canvas'); ng = document.getElementById('rq-ng');
    if (!c || !ng) { return; }
    if (!tok) {
      c.style.visibility = 'hidden'; ng.style.display = 'block';
      ng.innerHTML = '<b>QRの有効期間外です</b><br>インターネットにつないで、設定タブから取得し直してください。<br>(端末の時刻がずれていると、ここに出ることがあります)';
      lastSlot = -1;
    } else if (slot !== lastSlot) {
      ng.style.display = 'none'; c.style.visibility = 'visible';
      draw(c, Q.urlFor(rec.origin, rec.event.id, tok));
      lastSlot = slot;
    }
    document.getElementById('rq-barin').style.width = Math.round((Q.secondsLeft(now, rec.offset) / 30) * 100) + '%';
    document.getElementById('rq-sec').firstChild ? (document.getElementById('rq-sec').firstChild.nodeValue = '切り替えまで ' + Q.secondsLeft(now, rec.offset) + ' 秒') : document.getElementById('rq-sec').appendChild(document.createTextNode('切り替えまで ' + Q.secondsLeft(now, rec.offset) + ' 秒'));
  }
  R.show = function () { ensureRoot(); build(); rootEl.style.display = 'block'; shown = true; refresh(); if (!timerIv) { timerIv = setInterval(refresh, 500); } };
  R.hide = function () { shown = false; if (rootEl) { rootEl.style.display = 'none'; rootEl.innerHTML = ''; } if (timerIv) { clearInterval(timerIv); timerIv = null; } };
  R.isShown = function () { return shown; };
  R.timerText = null; /* app.js が設定(QR表示中も、動いているタイマーの残り時間を見えるように) */
  R.dateText = dateText;
  window.FuritaRq = R;
}());
