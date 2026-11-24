/* Furita engine: ES5 only (iOS 9.3.5 Safari). No DOM access. */
(function (root) {
  'use strict';
  var E = {};

  function activeNos(players) {
    var r = [], i;
    for (i = 0; i < players.length; i += 1) {
      if (players[i].active) { r.push(players[i].no); }
    }
    return r;
  }

  function playedNos(match) {
    var r = [], i, c;
    for (i = 0; i < match.courts.length; i += 1) {
      c = match.courts[i];
      r = r.concat(c.a, c.b);
    }
    return r;
  }

  function contains(arr, v) {
    var i;
    for (i = 0; i < arr.length; i += 1) { if (arr[i] === v) { return true; } }
    return false;
  }

  function restOf(players, match) {
    var act = activeNos(players), played = playedNos(match), r = [], i;
    for (i = 0; i < act.length; i += 1) {
      if (!contains(played, act[i])) { r.push(act[i]); }
    }
    return r;
  }

  function pairKey(x, y) { return x < y ? x + '-' + y : y + '-' + x; }

  /* stats from a list of matches. A match without .rest derives rest from currently active players. */
  function computeStats(players, matches) {
    var st = {}, pc = {}, oc = {}, i, j, k, m, c, played, rest, no, p;
    for (i = 0; i < players.length; i += 1) {
      p = players[i];
      st[p.no] = { plays: 0, rests: 0, pStreak: 0, rStreak: 0, base: p.base || 0 };
    }
    for (i = 0; i < matches.length; i += 1) {
      m = matches[i];
      played = playedNos(m);
      rest = m.rest ? m.rest : restOf(players, m);
      for (j = 0; j < played.length; j += 1) {
        no = played[j];
        if (st[no]) { st[no].plays += 1; st[no].pStreak += 1; st[no].rStreak = 0; }
      }
      for (j = 0; j < rest.length; j += 1) {
        no = rest[j];
        if (st[no]) { st[no].rests += 1; st[no].rStreak += 1; st[no].pStreak = 0; }
      }
      for (j = 0; j < players.length; j += 1) {
        no = players[j].no;
        if (!contains(played, no) && !contains(rest, no)) { st[no].pStreak = 0; st[no].rStreak = 0; }
      }
      for (j = 0; j < m.courts.length; j += 1) {
        c = m.courts[j];
        pc[pairKey(c.a[0], c.a[1])] = (pc[pairKey(c.a[0], c.a[1])] || 0) + 1;
        pc[pairKey(c.b[0], c.b[1])] = (pc[pairKey(c.b[0], c.b[1])] || 0) + 1;
        for (k = 0; k < 2; k += 1) {
          oc[pairKey(c.a[k], c.b[0])] = (oc[pairKey(c.a[k], c.b[0])] || 0) + 1;
          oc[pairKey(c.a[k], c.b[1])] = (oc[pairKey(c.a[k], c.b[1])] || 0) + 1;
        }
      }
    }
    return { st: st, pc: pc, oc: oc };
  }

  function shuffle(arr) {
    var a = arr.slice(0), i, j, t;
    for (i = a.length - 1; i > 0; i -= 1) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* cost of one court of 4 with the best of 3 splits; returns {cost, a, b} */
  function bestSplit(g, pc, oc) {
    var splits = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]], best = null, i, s, a0, a1, b0, b1, cost, x;
    for (i = 0; i < splits.length; i += 1) {
      s = splits[i];
      a0 = g[s[0]]; a1 = g[s[1]]; b0 = g[s[2]]; b1 = g[s[3]];
      x = pc[pairKey(a0, a1)] || 0; cost = x * x * 10;
      x = pc[pairKey(b0, b1)] || 0; cost += x * x * 10;
      x = oc[pairKey(a0, b0)] || 0; cost += x * x * 3;
      x = oc[pairKey(a0, b1)] || 0; cost += x * x * 3;
      x = oc[pairKey(a1, b0)] || 0; cost += x * x * 3;
      x = oc[pairKey(a1, b1)] || 0; cost += x * x * 3;
      if (!best || cost < best.cost) { best = { cost: cost, a: [a0, a1], b: [b0, b1] }; }
    }
    return best;
  }

  function costOf(cand, c, stats) {
    var i, cost = 0;
    for (i = 0; i < c; i += 1) { cost += bestSplit(cand.slice(i * 4, i * 4 + 4), stats.pc, stats.oc).cost; }
    return cost;
  }
  function layout(cand, c, stats) {
    var i, bs, courts = [];
    for (i = 0; i < c; i += 1) {
      bs = bestSplit(cand.slice(i * 4, i * 4 + 4), stats.pc, stats.oc);
      courts.push({ a: bs.a, b: bs.b });
    }
    return courts;
  }
  /* hill climbing: swap two players between positions while the cost drops */
  function improve(cand, c, stats) {
    var cur = costOf(cand, c, stats), changed = true, i, j, t, nc, guard = 0;
    while (changed && cur > 0 && guard < 20) {
      changed = false; guard += 1;
      for (i = 0; i < cand.length - 1; i += 1) {
        for (j = i + 1; j < cand.length; j += 1) {
          if (Math.floor(i / 4) === Math.floor(j / 4)) { continue; }
          t = cand[i]; cand[i] = cand[j]; cand[j] = t;
          nc = costOf(cand, c, stats);
          if (nc < cur) { cur = nc; changed = true; } else { t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
        }
      }
    }
    return cand;
  }

  /* Generate courts for the next match. matches = history (+ current + queue) already decided.
     Returns array of {a:[x,y], b:[x,y]} or null if fewer than 4 active players. */
  E.generate = function (players, matches, courtsWanted) {
    var act = activeNos(players), n = Math.floor(act.length / 4), c, stats, scored, i, sel, iter, best, bestCost, cand, cost, g, bs, courts, s, key;
    c = Math.min(courtsWanted, n);
    if (c < 1) { return null; }
    stats = computeStats(players, matches);
    scored = [];
    for (i = 0; i < act.length; i += 1) {
      s = stats.st[act[i]];
      key = (s.plays + s.base) - s.rStreak * 1.5 + s.pStreak * 2.2 + Math.random() * 0.6;
      scored.push({ no: act[i], key: key });
    }
    scored.sort(function (x, y) { return x.key - y.key; });
    sel = [];
    for (i = 0; i < c * 4; i += 1) { sel.push(scored[i].no); }
    best = null; bestCost = 1e9;
    for (iter = 0; iter < 30 && bestCost > 0; iter += 1) {
      cand = improve(shuffle(sel), c, stats);
      cost = costOf(cand, c, stats);
      if (cost < bestCost) { bestCost = cost; best = layout(cand, c, stats); }
    }
    return best;
  };

  E.activeNos = activeNos;
  E.playedNos = playedNos;
  E.restOf = restOf;
  E.computeStats = computeStats;
  E.contains = contains;
  root.Furita = E;
}(typeof window !== 'undefined' ? window : this));
