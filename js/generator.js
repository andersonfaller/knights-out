/*
 * knights out — puzzle generator (browser global `KnightsGenerator`, or a Node module).
 *
 * Puzzles are solvable by construction: place the pieces on an all-dark board, play random
 * jumps, then light exactly the squares that were landed on an odd number of times. Replaying
 * the same jumps clears the board, provided every one of your jumps lands on a lit square —
 * which is checked before a puzzle is accepted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.KnightsGenerator = factory(root.KnightsEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  function shuffle(r, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * spec: { w, h, holes?, shape?, players?, shadows?, mirrors?, steps, tour? }
   *   shape — rows where "x" marks a hole (overrides `holes`)
   *   tour  — without echoes, steer the walk like Warnsdorff to cover more of the board
   * Returns { rows, line } or null when this attempt did not work out.
   */
  function construct(r, spec) {
    const { w, h, holes = 0, players = 1, shadows = 0, mirrors = 0, steps, shape, tour } = spec;
    const n = w * h;
    const exists = new Uint8Array(n).fill(1);
    if (shape) {
      shape.forEach((row, y) => [...row].forEach((ch, x) => (exists[y * w + x] = ch === 'x' ? 0 : 1)));
    } else {
      const cells = shuffle(r, [...Array(n).keys()]);
      for (let i = 0; i < holes; i++) exists[cells[i]] = 0;
    }

    const echoes = shadows + mirrors;
    const free = shuffle(r, [...Array(n).keys()].filter((i) => exists[i]));
    const pieces = [...Array(players).fill('K'), ...Array(shadows).fill('S'), ...Array(mirrors).fill('M')];
    if (free.length < pieces.length + 2) return null;
    // Same order as the engine: your knights first, then echoes, each in reading order.
    const placed = pieces
      .map((kind, i) => ({ kind, i: free[i] }))
      .sort((a, b) => (a.kind === 'K' ? 0 : 1) - (b.kind === 'K' ? 0 : 1) || a.i - b.i);
    const kinds = placed.map((p) => p.kind);
    const startPos = placed.map((p) => p.i);

    const blank = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) row += exists[y * w + x] ? '.' : 'x';
      blank.push(row);
    }
    const L = E.createLevel(blank);
    const pos = startPos.slice();
    const landings = [];
    const visited = new Set(startPos.slice(0, players));
    const line = [];

    const freshDegree = (t) => {
      let d = 0;
      for (let j = 0; j < 8; j++) {
        const u = L.jump[t * 8 + j];
        if (u >= 0 && !visited.has(u) && !pos.includes(u)) d++;
      }
      return d;
    };

    for (let step = 0; step < steps; step++) {
      let options = [];
      for (let k = 0; k < players; k++) {
        for (let j = 0; j < 8; j++) {
          const t = L.jump[pos[k] * 8 + j];
          if (t < 0 || pos.includes(t)) continue;
          // Without echoes nothing relights, so a knight can never revisit a square.
          if (!echoes && visited.has(t)) continue;
          options.push({ k, j, t });
        }
      }
      if (!options.length) {
        if (!echoes && step >= Math.ceil(steps * 0.8)) break;
        return null;
      }
      if (tour && r() < 0.85) {
        const best = Math.min(...options.map((o) => freshDegree(o.t)));
        options = options.filter((o) => freshDegree(o.t) === best);
      }
      let m = pick(r, options);
      if (visited.has(m.t) && r() < 0.7) m = pick(r, options);
      pos[m.k] = m.t;
      visited.add(m.t);
      landings.push({ cell: m.t, player: true });
      line.push({ k: m.k, j: m.j, to: m.t });
      for (let e = players; e < kinds.length; e++) {
        const t = L.jump[pos[e] * 8 + (kinds[e] === 'S' ? m.j : E.MIRROR[m.j])];
        if (t < 0 || pos.includes(t)) continue;
        pos[e] = t;
        landings.push({ cell: t, player: false });
      }
    }

    const parity = new Uint8Array(n);
    for (const l of landings) parity[l.cell] ^= 1;

    // Each of your landings needs its square lit at that moment: an even number of later landings.
    for (let a = 0; a < landings.length; a++) {
      if (!landings[a].player) continue;
      let later = 0;
      for (let b = a + 1; b < landings.length; b++) if (landings[b].cell === landings[a].cell) later++;
      if (later % 2) return null;
    }
    for (let k = 0; k < players; k++) if (parity[startPos[k]]) return null;

    const grid = blank.map((row) => [...row]);
    for (let i = 0; i < n; i++) if (exists[i]) grid[Math.floor(i / w)][i % w] = parity[i] ? 'o' : '.';
    kinds.forEach((kind, idx) => {
      const i = startPos[idx];
      grid[Math.floor(i / w)][i % w] = parity[i] ? kind.toLowerCase() : kind;
    });
    let rows = grid.map((row) => row.join(''));
    // Without echoes, dark squares never matter: trim empty edges (and shift the line to match).
    if (!echoes) {
      const t = trim(rows);
      rows = t.rows;
      const tw = rows[0].length;
      for (const m of line) m.to = (Math.floor(m.to / w) - t.top) * tw + (m.to % w) - t.left;
    }
    return { rows, line };
  }

  /** Drops edge rows and columns holding nothing but dark squares and holes. */
  function trim(rows) {
    const busy = (ch) => ch !== '.' && ch !== 'x';
    let top = 0;
    let bottom = rows.length - 1;
    while (top < bottom && ![...rows[top]].some(busy)) top++;
    while (bottom > top && ![...rows[bottom]].some(busy)) bottom--;
    rows = rows.slice(top, bottom + 1);
    const col = (x) => rows.some((row) => busy(row[x]));
    let left = 0;
    let right = rows[0].length - 1;
    while (left < right && !col(left)) left++;
    while (right > left && !col(right)) right--;
    return { rows: rows.map((row) => row.slice(left, right + 1)), top, left };
  }

  /** Share of random games won. `smart` never picks a move that loses on the spot. */
  function playouts(L, games, r, smart = false) {
    let wins = 0;
    for (let g = 0; g < games; g++) {
      let s = E.cloneState(L.start);
      for (let t = 0; t < 400; t++) {
        if (E.isWin(s)) {
          wins++;
          break;
        }
        let moves = E.legalMoves(L, s);
        if (smart) {
          const safe = moves.filter((m) => {
            const ns = E.playFast(L, s, m.k, m.j);
            return E.isWin(ns) || (!E.hopeless(L, ns) && E.legalMoves(L, ns).length > 0);
          });
          if (safe.length) moves = safe;
        }
        if (!moves.length) break;
        const m = pick(r, moves);
        s = E.playFast(L, s, m.k, m.j);
      }
    }
    return wins / games;
  }

  /** How a line uses the echoes: squares they light that you then use, squares they put out, bumps. */
  function echoUse(L, moves) {
    let s = E.cloneState(L.start);
    const litByEcho = new Set();
    let bridges = 0;
    let assists = 0;
    let bumps = 0;
    for (const m of moves) {
      const { state, events } = E.play(L, s, m.k, m.j);
      for (const ev of events) {
        if (ev.k < L.players) {
          if (litByEcho.has(ev.to)) bridges++;
          litByEcho.delete(ev.to);
        } else if (ev.blocked) bumps++;
        else if (ev.lit) litByEcho.add(ev.to);
        else assists++;
      }
      s = state;
    }
    return { bridges, assists, bumps };
  }

  /** True when `line` really clears the level under the engine's rules. */
  function replays(L, line) {
    let s = E.cloneState(L.start);
    for (const m of line) {
      if (!E.movesFor(L, s, m.k).some((l) => l.j === m.j)) return false;
      s = E.playFast(L, s, m.k, m.j);
    }
    return E.isWin(s);
  }

  /**
   * A fresh puzzle for the endless mode: of a handful of candidates, keep the one that careful
   * random play finds hardest.
   */
  function endless(r, spec, tries = 16) {
    let best = null;
    for (let t = 0; t < tries * 40 && tries > 0; t++) {
      const c = construct(r, spec);
      if (!c) continue;
      const L = E.createLevel(c.rows);
      if (E.isWin(L.start) || (spec.minLit && E.litCount(L.start) < spec.minLit)) continue;
      if (!replays(L, c.line)) continue;
      tries--;
      const score = playouts(L, 60, r, true);
      if (!best || score < best.score) best = { rows: c.rows, score };
    }
    return best && best.rows;
  }

  return { rng, pick, shuffle, construct, trim, replays, playouts, echoUse, endless };
});
