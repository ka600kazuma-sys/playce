/* 受付QRの計算(画面・保存に依存しない。ES5)。サーバーが事前生成した「30秒ごとのトークン」を、端末の時計で切り替える。
   秘密鍵はここにない。端末の時計がずれていても、取得時のサーバー時刻との差(offset)で補正する。 */
(function (root) {
  'use strict';
  var SLOT = 30000, MAX = 1500;
  var Q = {};
  Q.SLOT_MS = SLOT;
  Q.slotAt = function (nowMs, offsetMs) { return Math.floor((nowMs + offsetMs) / SLOT); };
  // 取得時の端末時刻(送信前 t0・受信後 t1)とサーバー時刻から、端末の時計のずれを求める。
  Q.offsetOf = function (serverNow, t0, t1) { return Math.round(serverNow - (t0 + t1) / 2); };
  Q.slotOfToken = function (t) { var i = typeof t === 'string' ? t.indexOf('.') : -1; return i > 0 ? parseInt(t.slice(0, i), 10) : NaN; };
  // いまのトークン。無ければ null(期間外・端末の時計が大きくずれている)。
  Q.pick = function (tokens, nowMs, offsetMs) {
    var s = Q.slotAt(nowMs, offsetMs), first, i;
    if (!tokens || !tokens.length) { return null; }
    first = Q.slotOfToken(tokens[0]);
    if (isNaN(first)) { return null; }
    i = s - first;
    if (i >= 0 && i < tokens.length && Q.slotOfToken(tokens[i]) === s) { return tokens[i]; }
    return null;
  };
  Q.secondsLeft = function (nowMs, offsetMs) { return Math.ceil((SLOT - ((nowMs + offsetMs) % SLOT)) / 1000); };
  Q.urlFor = function (origin, eventId, token) { return origin + '/r/' + eventId + '/' + token; };
  // 保存・受信データの検証。不正なら null。
  Q.parse = function (o) {
    var i, ev, t;
    if (!o || typeof o !== 'object' || !o.event || !o.tokens || !o.tokens.length || o.tokens.length > MAX) { return null; }
    ev = o.event;
    if (typeof ev.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ev.id) || typeof ev.title !== 'string') { return null; }
    if (typeof o.origin !== 'string' || !/^https?:\/\/[A-Za-z0-9.:-]+$/.test(o.origin)) { return null; }
    if (typeof o.offset !== 'number' || isNaN(o.offset)) { return null; }
    for (i = 0; i < o.tokens.length; i += 1) {
      t = o.tokens[i];
      if (typeof t !== 'string' || !/^\d{1,9}\.[A-Za-z0-9_-]{32}$/.test(t)) { return null; }
    }
    return { event: { id: ev.id, title: ev.title.slice(0, 100), venue: String(ev.venue || '').slice(0, 100), multiplier: ev.multiplier === 2 || ev.multiplier === 3 ? ev.multiplier : 1 }, origin: o.origin, offset: o.offset, tokens: o.tokens, syncedAt: o.syncedAt || 0 };
  };
  Q.lastSlot = function (rec) { return Q.slotOfToken(rec.tokens[rec.tokens.length - 1]); };
  root.FuritaQr = Q;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { FuritaQr: Q }; }
}(typeof window !== 'undefined' ? window : this));
