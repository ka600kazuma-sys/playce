/* Furita UI: ES5 only (iOS 9.3.5 Safari). No let/const/arrow/template/fetch/Promise. */
(function () {
  'use strict';
  var F = window.Furita;
  var KEY = 'furita.v1';
  var appEl = document.getElementById('app');
  var S, saveOk = true, loadFailed = false, saveBlocked = false;
  var view = 'timer', sel = null, customOpen = false, modal = null, notice = '', noticeTimer = null;
  var setupCount = 20;
  var T = { total: 420, rem: 420000, running: false, endAt: 0, done: false };
  var ctx = null, unlocked = false, alarmIv = null, alarmStop = null, alarmOn = false, alarmNodes = [];

  /* ---------- state / storage ---------- */
  function defaultState() {
    return { v: 1, courts: 3, seconds: 420, volume: 0.8, players: [], nextNo: 1, history: [], current: null, queue: [] };
  }
  function okMatch(m) {
    var i, c;
    if (!m || !Array.isArray(m.courts)) { return false; }
    for (i = 0; i < m.courts.length; i += 1) {
      c = m.courts[i];
      if (!c || !Array.isArray(c.a) || !Array.isArray(c.b) || c.a.length !== 2 || c.b.length !== 2) { return false; }
      if (typeof c.a[0] !== 'number' || typeof c.a[1] !== 'number' || typeof c.b[0] !== 'number' || typeof c.b[1] !== 'number') { return false; }
    }
    return true;
  }
  function fixNextNo(o) {
    var i, mx = 0;
    for (i = 0; i < o.players.length; i += 1) { if (o.players[i].no > mx) { mx = o.players[i].no; } }
    if (typeof o.nextNo !== 'number' || o.nextNo <= mx) { o.nextNo = mx + 1; }
  }
  function okState(o) {
    var i;
    if (!o || o.v !== 1 || !Array.isArray(o.players) || !Array.isArray(o.history) || !Array.isArray(o.queue) || !(o.courts > 0) || !(o.seconds > 0)) { return false; }
    for (i = 0; i < o.players.length; i += 1) { if (!o.players[i] || typeof o.players[i].no !== 'number') { return false; } }
    for (i = 0; i < o.history.length; i += 1) { if (!okMatch(o.history[i]) || !Array.isArray(o.history[i].rest)) { return false; } }
    for (i = 0; i < o.queue.length; i += 1) { if (!okMatch(o.queue[i])) { return false; } }
    if (o.current && !okMatch(o.current)) { return false; }
    return true;
  }
  function load() {
    var raw, o;
    try {
      raw = window.localStorage.getItem(KEY);
      if (raw) {
        o = JSON.parse(raw);
        if (okState(o)) { fixNextNo(o); return o; }
      }
    } catch (e) { /* ignore */ }
    try {
      if (raw) { loadFailed = true; window.localStorage.setItem(KEY + '.bak', raw); }
    } catch (e2) { saveBlocked = true; saveOk = false; }
    return defaultState();
  }
  function save() {
    if (saveBlocked) { saveOk = false; return; }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(S));
      saveOk = true;
    } catch (e) {
      saveOk = false;
    }
  }
  function say(msg) {
    notice = msg;
    if (noticeTimer) { clearTimeout(noticeTimer); }
    noticeTimer = setTimeout(function () { notice = ''; noticeTimer = null; render(); }, 6000);
  }

  /* ---------- helpers ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function secStr(s) { return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
  function playerBy(no) {
    var i;
    for (i = 0; i < S.players.length; i += 1) { if (S.players[i].no === no) { return S.players[i]; } }
    return null;
  }
  function activeCount() { return F.activeNos(S.players).length; }
  function allDecided() {
    var l = S.history.slice(0);
    if (S.current) { l.push(S.current); }
    return l.concat(S.queue);
  }
  function inCurrent(no) {
    return S.current ? F.contains(F.playedNos(S.current), no) : false;
  }
  function matchAt(idx) { return idx < 0 ? S.current : S.queue[idx]; }

  /* ---------- timer ---------- */
  function timerState() {
    if (T.running && T.endAt - Date.now() <= 0) { finishTimer(); }
    if (T.done) { return 'done'; }
    if (T.running) { return 'running'; }
    if (T.rem < T.total * 1000) { return 'paused'; }
    return 'idle';
  }
  function resetTimer() {
    stopAlarm();
    T.running = false; T.done = false;
    T.total = S.seconds; T.rem = T.total * 1000;
  }
  function timerStart() {
    ensureAudio();
    T.running = true; T.done = false;
    T.endAt = Date.now() + T.rem;
  }
  function finishTimer() {
    T.rem = 0; T.running = false; T.done = true;
    startAlarm();
  }
  function timerPause() {
    var left = T.endAt - Date.now();
    if (left <= 0) { finishTimer(); return; }
    T.rem = left;
    T.running = false;
  }
  function tick() {
    var left, el, st;
    if (!T.running) { return; }
    left = T.endAt - Date.now();
    if (left <= 0) {
      finishTimer();
      render();
      return;
    }
    el = document.getElementById('digits');
    if (el) { el.firstChild.nodeValue = secStr(Math.ceil(left / 1000)); }
    st = document.getElementById('tstate');
    if (st) { st.firstChild.nodeValue = '計時中'; }
  }

  /* ---------- audio (user-gesture unlock required on iOS) ---------- */
  function startNode(n, t) { if (n.start) { n.start(t); } else if (n.noteOn) { n.noteOn(t); } }
  function stopNode(n, t) { if (n.stop) { n.stop(t); } else if (n.noteOff) { n.noteOff(t); } }
  function ensureAudio() {
    var AC, b, s;
    try {
      AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return false; }
      if (!ctx) { ctx = new AC(); }
      if (ctx.state === 'suspended' && ctx.resume) { ctx.resume(); }
      if (!unlocked) {
        b = ctx.createBuffer(1, 1, 22050);
        s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        startNode(s, 0);
        unlocked = true;
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  /* end signal: three whistle blasts "pii, pii, pii" per cycle (repeats until stopped) */
  function burst() {
    var t, i, m, comp;
    if (!ensureAudio()) { return; }
    try {
      t = ctx.currentTime + 0.05;
      m = ctx.createGain();
      m.gain.value = 1;
      if (ctx.createDynamicsCompressor) {
        comp = ctx.createDynamicsCompressor();
        m.connect(comp);
        comp.connect(ctx.destination);
        alarmNodes.push(comp);
      } else {
        m.connect(ctx.destination);
      }
      alarmNodes.push(m);
      for (i = 0; i < 3; i += 1) { whistle(t + i * 0.95, m, 0.65); }
    } catch (e) { /* ignore */ }
  }
  /* pea-whistle layer: ~3kHz tones with fast tremolo (LFO on gain) */
  function whistle(t, dest, len) {
    var f = [2850, 3080], i, o, g, lfo, lg, amp = S.volume * 0.5;
    for (i = 0; i < f.length; i += 1) {
      o = ctx.createOscillator();
      g = ctx.createGain();
      lfo = ctx.createOscillator();
      lg = ctx.createGain();
      o.frequency.value = f[i];
      lfo.frequency.value = 26 + i * 4;
      lg.gain.value = amp * 0.6;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.02);
      g.gain.setValueAtTime(amp, t + len - 0.1);
      g.gain.linearRampToValueAtTime(0, t + len);
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(dest);
      alarmNodes.push(o, lfo, g, lg);
      startNode(o, t);
      startNode(lfo, t);
      stopNode(o, t + len + 0.02);
      stopNode(lfo, t + len + 0.02);
    }
  }
  function startAlarm() {
    stopAlarm();
    alarmOn = true;
    burst();
    alarmIv = setInterval(burst, 4000);
    alarmStop = setTimeout(stopAlarm, 60000);
  }
  function stopAlarm() {
    if (alarmIv) { clearInterval(alarmIv); alarmIv = null; }
    if (alarmStop) { clearTimeout(alarmStop); alarmStop = null; }
    alarmOn = false;
    while (alarmNodes.length > 0) {
      var nd = alarmNodes.pop();
      try { if (nd.frequency && nd.frequency.value) { stopNode(nd, 0); } nd.disconnect(); } catch (e) { /* already stopped */ }
    }
  }

  /* ---------- match operations ---------- */
  function makeFirst() {
    var c;
    if (S.current) { return; }
    c = F.generate(S.players, allDecided(), S.courts);
    if (!c) { say('参加者が4人以上必要です'); return; }
    S.current = { courts: c };
    sel = null;
    resetTimer();
    save();
  }
  function recordCurrent() {
    var m = S.current;
    S.history.push({ n: S.history.length + 1, courts: m.courts, rest: m.rest ? m.rest : F.restOf(S.players, m), ts: Date.now() });
  }
  function nextMatch() {
    var c;
    if (!S.current) { return; }
    recordCurrent();
    S.current = null;
    if (S.queue.length > 0) {
      S.current = S.queue.shift();
    } else {
      c = F.generate(S.players, allDecided(), S.courts);
      S.current = c ? { courts: c } : null;
      if (!c) { say('参加者が足りないため次の試合を作れません'); }
    }
    sel = null;
    resetTimer();
    save();
  }
  function prevMatch() {
    var rec, played, i;
    if (S.history.length === 0) { return; }
    rec = S.history[S.history.length - 1];
    played = F.playedNos({ courts: rec.courts });
    for (i = 0; i < played.length; i += 1) {
      if (!playerBy(played[i]) || !playerBy(played[i]).active) {
        say('退出済みの参加者がいるため戻せません。先に復帰してください');
        return;
      }
    }
    S.history.pop();
    if (S.current && S.current.courts.length === S.courts) { S.queue.unshift(S.current); }
    else if (S.current) { say('コート数が設定と違うため、現在の組み合わせは破棄しました'); }
    S.current = { courts: rec.courts, rest: rec.rest };
    sel = null;
    resetTimer();
    save();
  }
  function reshuffle() {
    var c = F.generate(S.players, S.history, S.courts);
    if (!c) { say('参加者が4人以上必要です'); return; }
    S.current = { courts: c };
    S.queue = [];
    sel = null;
    save();
  }
  function preplan(n) {
    var i, c;
    if (!S.current) { makeFirst(); if (!S.current) { return; } }
    for (i = 0; i < n; i += 1) {
      c = F.generate(S.players, allDecided(), S.courts);
      if (!c) { break; }
      S.queue.push({ courts: c });
    }
    save();
  }
  function findPos(match, no) {
    var i, c;
    for (i = 0; i < match.courts.length; i += 1) {
      c = match.courts[i];
      if (F.contains(c.a, no)) { return { arr: c.a, i: F.contains(c.a, no) ? indexOf(c.a, no) : -1 }; }
      if (F.contains(c.b, no)) { return { arr: c.b, i: indexOf(c.b, no) }; }
    }
    return null;
  }
  function indexOf(arr, v) {
    var i;
    for (i = 0; i < arr.length; i += 1) { if (arr[i] === v) { return i; } }
    return -1;
  }
  function swapNos(match, a, b) {
    var pa = findPos(match, a), pb = findPos(match, b), t, ri;
    if (pa && pb) {
      t = pa.arr[pa.i]; pa.arr[pa.i] = pb.arr[pb.i]; pb.arr[pb.i] = t;
    } else if (pa && !pb) {
      pa.arr[pa.i] = b;
      if (match.rest) { ri = indexOf(match.rest, b); if (ri >= 0) { match.rest[ri] = a; } else { delete match.rest; } }
    } else if (!pa && pb) {
      pb.arr[pb.i] = a;
      if (match.rest) { ri = indexOf(match.rest, a); if (ri >= 0) { match.rest[ri] = b; } else { delete match.rest; } }
    }
  }
  function chipTap(m, no) {
    var match = matchAt(m);
    if (!match) { return; }
    if (m === -1 && timerState() !== 'idle') { say('計時を始めた試合は入れ替えできません。リセットしてから操作してください'); return; }
    if (!sel || sel.m !== m) { sel = { m: m, no: no }; return; }
    if (sel.no === no) { sel = null; return; }
    swapNos(match, sel.no, no);
    sel = null;
    save();
  }

  /* ---------- participants ---------- */
  function avgPlays() {
    var st = F.computeStats(S.players, S.history).st, act = F.activeNos(S.players), i, sum = 0;
    if (act.length === 0) { return 0; }
    for (i = 0; i < act.length; i += 1) { sum += st[act[i]].plays + st[act[i]].base; }
    return Math.floor(sum / act.length);
  }
  function addPlayer() {
    if (S.nextNo > 99) { say('番号は99までです'); return; }
    var avg = avgPlays();
    S.players.push({ no: S.nextNo, active: true, base: avg });
    S.nextNo += 1;
    S.queue = [];
    save();
    say('参加者を追加しました(予定の事前作成は消えます)');
  }
  function leavePlayer(no) {
    var p = playerBy(no);
    if (!p) { return; }
    p.active = false;
    S.queue = [];
    save();
  }
  function subAndLeave(no) {
    var rest = F.restOf(S.players, S.current), st = F.computeStats(S.players, S.history).st, best = rest[0], i;
    for (i = 1; i < rest.length; i += 1) {
      if (st[rest[i]].plays + st[rest[i]].base < st[best].plays + st[best].base) { best = rest[i]; }
    }
    swapNos(S.current, no, best);
    if (S.current.rest) {
      var kept = [], k;
      for (k = 0; k < S.current.rest.length; k += 1) { if (S.current.rest[k] !== no) { kept.push(S.current.rest[k]); } }
      S.current.rest = kept;
    }
    leavePlayer(no);
  }
  function leaveFlow(no) {
    /* decided at confirm time, so a timer that ended meanwhile is handled correctly */
    if (inCurrent(no) && timerState() === 'done') { nextMatch(); }
    if (inCurrent(no)) {
      if (F.restOf(S.players, S.current).length > 0) { subAndLeave(no); }
      else { S.current = null; resetTimer(); leavePlayer(no); }
    } else {
      leavePlayer(no);
    }
  }
  function rejoinPlayer(no) {
    var p = playerBy(no), st;
    if (!p) { return; }
    st = F.computeStats(S.players, S.history).st[no];
    p.base = Math.max(0, avgPlays() - st.plays);
    p.active = true;
    S.queue = [];
    save();
  }
  function applySetup() {
    var i;
    S.players = [];
    for (i = 1; i <= setupCount; i += 1) { S.players.push({ no: i, active: true, base: 0 }); }
    S.nextNo = setupCount + 1;
    S.history = []; S.current = null; S.queue = [];
    sel = null;
    resetTimer();
    save();
  }

  /* ---------- rendering ---------- */
  function chip(m, no, big) {
    var on = sel && sel.m === m && sel.no === no;
    return '<button type="button" class="chip' + (on ? ' sel' : '') + '" data-act="chip" data-m="' + m + '" data-no="' + no + '">' + no + '</button>';
  }
  function plain(arr) { return arr.join('・'); }
  function courtsHtml(match, m, editable) {
    var h = '', i, c;
    for (i = 0; i < match.courts.length; i += 1) {
      c = match.courts[i];
      if (editable) {
        h += '<article class="court"><h3>コート ' + (i + 1) + '</h3><div class="players"><span class="team">' + chip(m, c.a[0]) + chip(m, c.a[1]) + '</span><b>対</b><span class="team">' + chip(m, c.b[0]) + chip(m, c.b[1]) + '</span></div></article>';
      } else {
        h += '<article class="court"><h3>コート ' + (i + 1) + '</h3><div class="players"><span>No.' + c.a[0] + ' No.' + c.a[1] + '</span><b>対</b><span>No.' + c.b[0] + ' No.' + c.b[1] + '</span></div></article>';
      }
    }
    return h;
  }
  function restChips(match, m) {
    var r = F.restOf(S.players, match), i, h = '';
    for (i = 0; i < r.length; i += 1) { h += chip(m, r[i]); }
    return h || '<span class="small">なし</span>';
  }

  function viewTimer() {
    var ts = timerState(), h, sec = S.seconds, p = [300, 420, 600], i, lab = ['5分', '7分', '10分'], isPreset = false, idle = ts === 'idle';
    h = '<div class="split"><section class="timer panel' + (ts === 'done' ? ' done' : '') + '"><h2>試合タイマー</h2>';
    h += '<div class="digits" id="digits">' + secStr(ts === 'running' ? Math.ceil((T.endAt - Date.now()) / 1000) : Math.ceil(T.rem / 1000)) + '</div>';
    h += '<p class="state' + (ts === 'done' ? ' end' : '') + '" id="tstate">' + ({ idle: '開始前', running: '計時中', paused: '一時停止中', done: '終了!' }[ts]) + '</p>';
    h += '<div class="presets">';
    for (i = 0; i < 3; i += 1) {
      if (sec === p[i]) { isPreset = true; }
      h += '<button type="button" data-act="preset" data-sec="' + p[i] + '"' + (idle ? '' : ' disabled') + (sec === p[i] ? ' class="chosen"' : '') + '>' + lab[i] + '</button>';
    }
    h += '<button type="button" data-act="custom"' + (idle ? '' : ' disabled') + (!isPreset ? ' class="chosen"' : '') + '>カスタム</button></div>';
    if (customOpen && idle) {
      h += '<div class="row"><button type="button" data-act="adj" data-d="-60">-1分</button> <button type="button" data-act="adj" data-d="-10">-10秒</button> <button type="button" data-act="adj" data-d="10">+10秒</button> <button type="button" data-act="adj" data-d="60">+1分</button></div>';
    }
    h += '<div class="controls"><button type="button" class="primary" data-act="tstart"' + (idle ? '' : ' disabled') + '>開始</button>';
    h += '<button type="button" data-act="tpause"' + (ts === 'running' ? '' : ' disabled') + '>一時停止</button>';
    h += '<button type="button" data-act="tresume"' + (ts === 'paused' ? '' : ' disabled') + '>再開</button>';
    h += '<button type="button" data-act="treset"' + (idle ? ' disabled' : '') + '>リセット</button></div>';
    if (alarmOn) { h += '<div class="row"><button type="button" class="danger" data-act="alarmoff">音を止める</button></div>'; }
    h += '</section><section class="match panel">';
    if (!S.current) {
      h += '<div class="head"><h2>試合なし</h2><button type="button" class="primary" data-act="makefirst">最初の試合を作る</button></div><p class="small">参加者タブで人数を設定してください(現在 ' + activeCount() + '人)</p>';
    } else {
      h += '<div class="head"><h2>第' + (S.history.length + 1) + '試合</h2><button type="button" data-act="prev"' + (S.history.length ? '' : ' disabled') + '>前の試合</button><button type="button" class="primary" data-act="next">次の試合</button></div>';
      h += courtsHtml(S.current, -1, false);
      h += '<p class="resting">休み: ' + (plain(F.restOf(S.players, S.current)) || 'なし') + '</p>';
    }
    h += '</section></div>';
    return h;
  }

  function viewMatches() {
    var h = '<div class="full">', i, q;
    if (!S.current) {
      return h + '<div class="toolbar"><h2>試合なし</h2><div class="actions"><button type="button" class="primary" data-act="makefirst">最初の試合を作る</button></div></div><p class="small">参加者 ' + activeCount() + '人。参加者タブで人数を設定してください。</p></div>';
    }
    h += '<div class="toolbar"><h2>第' + (S.history.length + 1) + '試合</h2><div class="actions"><button type="button" data-act="prev"' + (S.history.length ? '' : ' disabled') + '>前の試合</button><button type="button" data-act="reshuffle">作り直す</button><button type="button" class="primary" data-act="next">次の試合</button></div></div>';
    h += '<p class="small">番号を2回タップすると入れ替えできます(コート内どうし、または休みの人と)。</p>';
    h += '<div class="bigcourts">';
    for (i = 0; i < S.current.courts.length; i += 1) {
      var c = S.current.courts[i];
      h += '<article class="court"><h3>コート ' + (i + 1) + '</h3><div class="players"><span class="team">' + chip(-1, c.a[0]) + chip(-1, c.a[1]) + '</span><b>対</b><span class="team">' + chip(-1, c.b[0]) + chip(-1, c.b[1]) + '</span></div></article>';
    }
    h += '</div><p class="sub">休み</p><div class="chips">' + restChips(S.current, -1) + '</div>';
    h += '<div class="toolbar" style="margin-top:14px"><h2>予定</h2><div class="actions"><button type="button" data-act="preplan">+3試合を事前作成</button></div></div>';
    if (S.queue.length === 0) { h += '<p class="small">予定はありません。次の試合は押したときに自動で作ります。</p>'; }
    for (q = 0; q < S.queue.length; q += 1) {
      h += '<div class="qrow"><b>第' + (S.history.length + 2 + q) + '試合</b> ';
      for (i = 0; i < S.queue[q].courts.length; i += 1) {
        var d = S.queue[q].courts[i];
        h += ' &nbsp;C' + (i + 1) + ': ' + chip(q, d.a[0]) + chip(q, d.a[1]) + '対' + chip(q, d.b[0]) + chip(q, d.b[1]);
      }
      h += '<div class="small">休み: ' + restChips(S.queue[q], q) + '</div></div>';
    }
    return h + '</div>';
  }

  function personRow(p, stats) {
    var s = stats.st[p.no], streak = s.pStreak > 0 ? '出' + s.pStreak : (s.rStreak > 0 ? '休' + s.rStreak : '-');
    return '<tr' + (p.active ? '' : ' class="off"') + '><td>' + p.no + '</td><td>' + s.plays + '</td><td>' + s.rests + '</td><td>' + (p.active ? streak : '退出') + '</td><td>' +
      (p.active ? '<button type="button" data-act="leave" data-no="' + p.no + '">退出</button>' : '<button type="button" data-act="rejoin" data-no="' + p.no + '">復帰</button>') + '</td></tr>';
  }
  function tableHtml(list, stats) {
    var h = '<table class="people"><thead><tr><th>番号</th><th>出場</th><th>休み</th><th>連続</th><th>操作</th></tr></thead><tbody>', i;
    for (i = 0; i < list.length; i += 1) { h += personRow(list[i], stats); }
    return h + '</tbody></table>';
  }
  function viewPeople() {
    var stats = F.computeStats(S.players, S.history), half = Math.ceil(S.players.length / 2);
    var h = '<div class="full"><div class="toolbar"><h2>参加者 ' + activeCount() + '人</h2><div class="actions">';
    h += '<span class="stepper"><button type="button" data-act="setn" data-d="-1">-</button><span>' + setupCount + '人</span><button type="button" data-act="setn" data-d="1">+</button></span> ';
    h += '<button type="button" data-act="applysetup">人数を設定して番号を振る</button> <button type="button" class="primary" data-act="addplayer">途中参加 +1</button></div></div>';
    h += '<p class="small">出場・休みは終了した試合の集計です。連続: 出=連続出場、休=連続休み。</p>';
    if (S.players.length === 0) { return h + '<p class="sub">人数を決めて「人数を設定して番号を振る」を押してください。</p></div>'; }
    h += '<div class="roster-col">' + tableHtml(S.players.slice(0, half), stats) + '</div><div class="roster-col">' + tableHtml(S.players.slice(half), stats) + '</div><div class="clear"></div></div>';
    return h;
  }
  function viewHistory() {
    var h = '<div class="full"><div class="toolbar"><h2>試合履歴 ' + S.history.length + '試合</h2></div>', i, j, m, c;
    if (S.history.length === 0) { h += '<p class="small">まだ終了した試合はありません。</p>'; }
    for (i = S.history.length - 1; i >= 0; i -= 1) {
      m = S.history[i];
      h += '<p class="history-row panel"><b>第' + m.n + '試合</b>';
      for (j = 0; j < m.courts.length; j += 1) {
        c = m.courts[j];
        h += ' ／ C' + (j + 1) + ': ' + plain(c.a) + ' 対 ' + plain(c.b);
      }
      h += '<br>休み: ' + (plain(m.rest) || 'なし') + '</p>';
    }
    return h + '</div>';
  }
  function escH(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function viewRqSettings() {
    var i = window.FuritaRq.info(), h = '<div class="panel set-row"><span class="lbl">受付QR(PLAYCE連携)</span>';
    if (i) {
      h += '<br>取得済み: ' + escH(i.title) + (i.multiplier > 1 ? '(スタンプ' + i.multiplier + '倍DAY)' : '') + '<br>' + window.FuritaRq.dateText(i.syncedAt) + ' に取得 ／ QR ' + i.count + '枚分 ／ ' + window.FuritaRq.dateText(i.validUntil) + ' まで' + (i.expired ? ' <span class="warn">期限切れ</span>' : '') + (i.drift > 120000 ? ' <span class="warn">端末の時刻が約' + Math.round(i.drift / 60000) + '分ずれています(補正済み)</span>' : '');
    } else { h += '<br>まだ取得していません。'; }
    h += '<p class="small">開催前に、インターネットにつないで取得してください。取得後は、開催中にネットがなくても表示・30秒ごとの更新ができます。管理者のパスワードや鍵は、この端末に保存されません。</p>';
    h += '<input id="rqcode" type="text" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="ふりた用コード(XXXX-XXXX-XXXX)" style="font-size:22px;padding:10px;width:340px"> <button type="button" class="primary" data-act="rqsync">取得する</button>';
    if (i) { h += ' <button type="button" data-act="rqclear">取得データを消す</button>'; }
    return h + '</div>';
  }
  function viewSettings() {
    var h = '<div class="full"><div class="toolbar"><h2>設定</h2></div>';
    h += '<div class="panel set-row"><span class="lbl">コート数(次の振り分けから)</span><span class="stepper"><button type="button" data-act="courts" data-d="-1">-</button><span>' + S.courts + '</span><button type="button" data-act="courts" data-d="1">+</button></span></div>';
    h += '<div class="panel set-row"><span class="lbl">終了音の大きさ</span><span class="stepper"><button type="button" data-act="vol" data-d="-0.1">-</button><span>' + Math.round(S.volume * 10) + ' / 10</span><button type="button" data-act="vol" data-d="0.1">+</button></span> <button type="button" data-act="testsound">テスト再生</button>';
    h += '<p class="small">iPad本体の音量も上げてください。音が出ない場合は本体横のスイッチ(消音)も確認してください。</p></div>';
    h += '<div class="panel set-row"><span class="lbl">データ保存</span>' + (saveOk ? '端末内に保存できています' : '<span class="warn">保存できません(プライベートブラウズ等)</span>') + '<p class="small">試合の組み合わせ・履歴・参加者は端末内に保存されます。計時中の残り時間は保存されません。</p></div>';
    h += viewRqSettings();
    h += '<div class="panel set-row"><button type="button" class="danger" data-act="wipe">全データを消去</button></div></div>';
    return h;
  }

  function render() {
    var names = { timer: 'タイマー', matches: '試合', people: '参加者', history: '履歴', settings: '設定' }, order = ['timer', 'matches', 'people', 'history', 'settings'], i, h, sc = 0, old;
    old = appEl.querySelector('.full');
    if (old) { sc = old.scrollTop; }
    h = '<header><h1>Furita</h1><p>' + (saveOk ? '' : '<span class="warn">保存不可</span>') + 'ダブルス ／ ' + S.courts + 'コート ／ 参加 ' + activeCount() + '人</p></header><nav class="nav">';
    for (i = 0; i < order.length; i += 1) {
      h += '<button type="button" data-act="view" data-view="' + order[i] + '"' + (view === order[i] ? ' class="on"' : '') + '>' + names[order[i]] + '</button>';
    }
    h += '<button type="button" class="rq-open" data-act="rqshow">受付QR</button></nav><div class="content">';
    h += view === 'timer' ? viewTimer() : view === 'matches' ? viewMatches() : view === 'people' ? viewPeople() : view === 'history' ? viewHistory() : viewSettings();
    h += '</div>';
    if (notice) { h += '<div class="notice"><button type="button" data-act="noticeclose">閉じる</button>' + notice + '</div>'; }
    if (modal) {
      h += '<div class="guard" role="dialog"><div class="guard-card panel"><h2>' + modal.title + '</h2><p>' + modal.msg + '</p><div class="actions"><button type="button" data-act="mcancel">キャンセル</button><button type="button" class="' + (modal.danger ? 'danger' : 'primary') + '" data-act="mok">' + modal.ok + '</button></div></div></div>';
    }
    appEl.innerHTML = h;
    old = appEl.querySelector('.full');
    if (old && sc) { old.scrollTop = sc; }
  }

  function ask(title, msg, ok, danger, fn) { modal = { title: title, msg: msg, ok: ok, danger: danger, fn: fn }; }

  /* ---------- events ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function onAct(el) {
    var act = el.getAttribute('data-act'), d = parseFloat(el.getAttribute('data-d')), no = parseInt(el.getAttribute('data-no'), 10), ts = timerState();
    if (act === 'view') { view = el.getAttribute('data-view'); sel = null; }
    else if (act === 'preset') { if (ts === 'idle') { S.seconds = parseInt(el.getAttribute('data-sec'), 10); resetTimer(); customOpen = false; save(); } }
    else if (act === 'custom') { customOpen = !customOpen; }
    else if (act === 'adj') { if (ts === 'idle') { S.seconds = clamp(S.seconds + d, 10, 5999); resetTimer(); save(); } }
    else if (act === 'tstart') { if (ts === 'idle') { timerStart(); } }
    else if (act === 'tpause') { if (ts === 'running') { timerPause(); } }
    else if (act === 'tresume') { if (ts === 'paused') { timerStart(); } }
    else if (act === 'treset') {
      ask('タイマーをリセットしますか?', '残り時間を設定時間に戻します。', 'リセットする', false, function () { resetTimer(); });
    }
    else if (act === 'alarmoff') { if (S.current && ts === 'done') { nextMatch(); } else { resetTimer(); } }
    else if (act === 'makefirst') { makeFirst(); }
    else if (act === 'next') {
      if (ts !== 'done') {
        ask('次の試合へ進みますか?', ts === 'idle' ? 'この試合はまだ計時していません。このまま終了として記録します。' : 'タイマーはまだ終わっていません。この試合を終了として記録します。', '次へ進む', false, nextMatch);
      } else { nextMatch(); }
    }
    else if (act === 'prev') {
      ask('前の試合に戻りますか?', '第' + S.history.length + '試合を現在の試合に戻し、' + (S.current && S.current.courts.length !== S.courts ? '今の組み合わせは(コート数が設定と違うため)破棄されます。' : '今の組み合わせは次の予定になります。'), '前の試合に戻る', false, prevMatch);
    }
    else if (act === 'reshuffle') {
      if (ts !== 'idle') { say('計時を始めた試合は作り直せません。リセットしてから操作してください'); render(); return; }
      ask('この試合を作り直しますか?', '現在の組み合わせと事前作成した予定を破棄して、振り分け直します。', '作り直す', false, reshuffle);
    }
    else if (act === 'preplan') { preplan(3); }
    else if (act === 'chip') { chipTap(parseInt(el.getAttribute('data-m'), 10), no); }
    else if (act === 'leave') {
      var msg;
      if (!inCurrent(no)) { msg = '以後の振り分けから外れます。事前作成した予定は消えます。「復帰」で戻せます。'; }
      else if (ts === 'done') { msg = 'No.' + no + ' は終了した試合に出ています。この試合を記録してから退出します。次の試合に選ばれた場合は、休みの人と交代するか、試合を中止します。'; }
      else if (F.restOf(S.players, S.current).length > 0) { msg = '試合中のため、休みの人と自動で交代します(履歴には交代後の組み合わせが残ります)。'; }
      else { msg = '試合中で、交代できる休みの人がいません。現在の試合を中止(記録しない)して退出します。'; }
      ask('No.' + no + ' を退出しますか?', msg, '退出する', true, function () { leaveFlow(no); });
    }
    else if (act === 'rejoin') { rejoinPlayer(no); }
    else if (act === 'addplayer') { addPlayer(); }
    else if (act === 'setn') { setupCount = clamp(setupCount + d, 1, 99); }
    else if (act === 'applysetup') {
      ask('人数を設定しますか?', '参加者を1〜' + setupCount + '番で作り直します。現在の試合と履歴はすべて消えます。', '設定する', true, applySetup);
    }
    else if (act === 'courts') { var oc = S.courts; S.courts = clamp(S.courts + d, 1, 12); if (S.courts !== oc && S.queue.length) { S.queue = []; say('コート数を変えたため、事前作成した予定を消しました'); } save(); }
    else if (act === 'vol') { S.volume = clamp(Math.round((S.volume + d) * 10) / 10, 0.1, 1); save(); }
    else if (act === 'testsound') { burst(); }
    else if (act === 'rqshow') { window.FuritaRq.show(); }
    else if (act === 'rqsync') {
      var cv = document.getElementById('rqcode');
      say('取得しています…');
      window.FuritaRq.sync(cv ? cv.value : '', function (err) { say(err || '取得しました。「受付QR」ボタンで表示できます'); render(); });
    }
    else if (act === 'rqclear') { ask('取得したQRを消しますか?', '開催前に、もう一度取得する必要があります。', '消す', true, function () { window.FuritaRq.clear(); }); }
    else if (act === 'wipe') {
      ask('全データを消去しますか?', '参加者・試合・履歴・設定がすべて消えます。元に戻せません。', '消去する', true, function () { saveBlocked = false; S = defaultState(); setupCount = 20; resetTimer(); save(); });
    }
    else if (act === 'mok') { var fn = modal.fn; modal = null; fn(); save(); }
    else if (act === 'mcancel') { modal = null; }
    else if (act === 'noticeclose') { notice = ''; }
    render();
  }
  appEl.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== appEl) {
      if (el.getAttribute && el.getAttribute('data-act') && !el.disabled) { ensureAudio(); onAct(el); return; }
      el = el.parentNode;
    }
  }, false);
  document.addEventListener('touchmove', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.className && /(^| )(full|match)( |$)/.test(el.className)) { return; }
      el = el.parentNode;
    }
    e.preventDefault();
  }, false);

  /* ---------- QR画面から見えるタイマー(QR表示中も止めない・作り直さない) ---------- */
  window.FuritaRq.timerText = function () {
    var st = timerState(), left = st === 'running' ? Math.ceil((T.endAt - Date.now()) / 1000) : Math.ceil(T.rem / 1000);
    return (st === 'done' ? '試合終了 ' : st === 'running' ? '計時中 ' : st === 'paused' ? '一時停止 ' : '') + secStr(Math.max(0, left));
  };

  /* ---------- start ---------- */
  S = load();
  T.total = S.seconds; T.rem = T.total * 1000;
  setupCount = S.players.length || 20;
  render();
  if (loadFailed) { say(saveBlocked ? '保存データを読めず、退避もできません。このままでは保存しません。設定の「全データを消去」で初期化できます' : '保存データを読み込めませんでした。元データは別枠(furita.v1.bak)に退避しました'); render(); }
  setInterval(tick, 200);
}());
