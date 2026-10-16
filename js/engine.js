/*
 * knights out — rules engine and solver.
 *
 * Shared by the game (browser global `KnightsEngine`) and the level tools (Node module).
 *
 * Rules
 *   - Every square of the board is either lit or dark. Some squares may be missing (holes).
 *   - You move your knights (K). A knight jumps in an L and may only land on a lit, free square.
 *   - Whenever any knight lands on a square, that square flips (lit <-> dark).
 *   - Echo knights copy every jump you make, right after you make it:
 *       shadow (S) jumps the same way you did,
 *       mirror (M) jumps the same way mirrored left/right.
 *     Echoes may land on dark squares (lighting them up). If their jump would leave the board,
 *     hit a hole or a taken square, they stay put.
 *   - The puzzle is solved when every square is dark.
 *
 * Level rows use one character per square:
 *   x hole   . dark   o lit
 *   K knight          (k: knight standing on a lit square)
 *   S shadow knight   (s: on a lit square)
 *   M mirror knight   (m: on a lit square)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KnightsEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [dx, dy] — order matters only for move ordering.
  const JUMPS = [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]];
  const MIRROR = JUMPS.map(([dx, dy]) => JUMPS.findIndex(([ex, ey]) => ex === -dx && ey === dy));

  const PLAYER = 'K';
  const SHADOW = 'S';
  const MIRRORED = 'M';

  // ---------------------------------------------------------------- bit helpers (64 squares max)

  function bitGet(s, i) {
    return i < 32 ? (s.lo >>> i) & 1 : (s.hi >>> (i - 32)) & 1;
  }

  function bitFlip(s, i) {
    if (i < 32) s.lo = (s.lo ^ (1 << i)) | 0;
    else s.hi = (s.hi ^ (1 << (i - 32))) | 0;
  }

  function popcount(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  // ---------------------------------------------------------------- level

  function createLevel(rows) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const n = w * h;
    if (n > 64) throw new Error('board too large (max 64 squares)');

    const exists = new Uint8Array(n);
    const start = { lo: 0, hi: 0, pos: [] };
    const pieces = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x] || 'x';
        if (ch === 'x' || ch === ' ') continue;
        const i = y * w + x;
        exists[i] = 1;
        if ('okms'.includes(ch)) bitFlip(start, i);
        const kind = ch.toUpperCase();
        if (kind === PLAYER || kind === SHADOW || kind === MIRRORED) pieces.push({ kind, i });
        else if (ch !== '.' && ch !== 'o') throw new Error(`unknown square "${ch}"`);
      }
    }

    // Player knights first, then echoes in reading order (echoes resolve in this order).
    pieces.sort((a, b) => (a.kind === PLAYER ? 0 : 1) - (b.kind === PLAYER ? 0 : 1) || a.i - b.i);
    const kinds = pieces.map((p) => p.kind);
    start.pos = pieces.map((p) => p.i);

    const jump = new Int8Array(n * 8).fill(-1);
    for (let i = 0; i < n; i++) {
      if (!exists[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      JUMPS.forEach(([dx, dy], j) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && exists[ny * w + nx]) jump[i * 8 + j] = ny * w + nx;
      });
    }

    const players = kinds.filter((k) => k === PLAYER).length;
    return { w, h, n, exists, jump, kinds, players, echoes: kinds.length - players, start };
  }

  function cloneState(s) {
    return { lo: s.lo, hi: s.hi, pos: s.pos.slice() };
  }

  function isLit(s, i) {
    return bitGet(s, i) === 1;
  }

  function litCount(s) {
    return popcount(s.lo) + popcount(s.hi);
  }

  function isWin(s) {
    return s.lo === 0 && s.hi === 0;
  }

  function occupant(s, i) {
    return s.pos.indexOf(i);
  }

  function stateKey(s) {
    return s.lo + ':' + s.hi + ':' + s.pos.join(',');
  }

  // ---------------------------------------------------------------- moves

  function movesFor(L, s, k) {
    const out = [];
    if (L.kinds[k] !== PLAYER) return out;
    const base = s.pos[k] * 8;
    for (let j = 0; j < 8; j++) {
      const t = L.jump[base + j];
      if (t >= 0 && bitGet(s, t) && s.pos.indexOf(t) < 0) out.push({ k, j, to: t });
    }
    return out;
  }

  function legalMoves(L, s) {
    const out = [];
    for (let k = 0; k < L.players; k++) out.push(...movesFor(L, s, k));
    return out;
  }

  function isStuck(L, s) {
    return !isWin(s) && legalMoves(L, s).length === 0;
  }

  /** Where every echo would go if knight `k` jumped with jump `j` (no state change). */
  function echoTargets(L, s, k, j) {
    const pos = s.pos.slice();
    pos[k] = L.jump[pos[k] * 8 + j];
    const out = [];
    for (let e = L.players; e < L.kinds.length; e++) {
      const jj = L.kinds[e] === SHADOW ? j : MIRROR[j];
      const t = L.jump[pos[e] * 8 + jj];
      const blocked = t < 0 || pos.indexOf(t) >= 0;
      out.push({ k: e, from: pos[e], to: blocked ? -1 : t, j: jj });
      if (!blocked) pos[e] = t;
    }
    return out;
  }

  /**
   * Plays knight `k` along jump `j` (assumed legal). Returns the new state and what happened,
   * in order: the knight's own jump first, then each echo (moved or blocked).
   */
  function play(L, s, k, j) {
    const next = cloneState(s);
    const from = next.pos[k];
    const to = L.jump[from * 8 + j];
    const events = [];
    next.pos[k] = to;
    bitFlip(next, to);
    events.push({ k, from, to, blocked: false, lit: false });

    for (let e = L.players; e < L.kinds.length; e++) {
      const jj = L.kinds[e] === SHADOW ? j : MIRROR[j];
      const ef = next.pos[e];
      const t = L.jump[ef * 8 + jj];
      if (t < 0 || next.pos.indexOf(t) >= 0) {
        events.push({ k: e, from: ef, to: -1, blocked: true, j: jj });
        continue;
      }
      next.pos[e] = t;
      bitFlip(next, t);
      events.push({ k: e, from: ef, to: t, blocked: false, lit: bitGet(next, t) === 1, j: jj });
    }
    return { state: next, events };
  }

  // Allocation-light version for search.
  function playFast(L, s, k, j) {
    const pos = s.pos.slice();
    const next = { lo: s.lo, hi: s.hi, pos };
    const to = L.jump[pos[k] * 8 + j];
    pos[k] = to;
    bitFlip(next, to);
    for (let e = L.players; e < L.kinds.length; e++) {
      const t = L.jump[pos[e] * 8 + (L.kinds[e] === SHADOW ? j : MIRROR[j])];
      if (t < 0 || pos.indexOf(t) >= 0) continue;
      pos[e] = t;
      bitFlip(next, t);
    }
    return next;
  }

  // ---------------------------------------------------------------- pruning (levels without echoes)

  /**
   * Without echoes nothing ever lights up again, so each knight walks a simple path over lit
   * squares. Returns true when the position can no longer be cleared.
   */
  function hopeless(L, s) {
    if (L.echoes > 0) return false;
    const n = L.n;
    const players = s.pos.slice(0, L.players);
    let terminals = 0;
    for (let c = 0; c < n; c++) {
      if (!bitGet(s, c)) continue;
      let lit = 0;
      let near = 0;
      const base = c * 8;
      for (let j = 0; j < 8; j++) {
        const t = L.jump[base + j];
        if (t < 0) continue;
        if (bitGet(s, t)) lit++;
        else if (players.indexOf(t) >= 0) near++;
      }
      if (lit + near === 0) return true;
      if (lit === 0 || (lit === 1 && near === 0)) terminals++;
    }
    if (terminals > players.length) return true;

    // Every group of lit squares needs its own knight next to it.
    const seen = new Uint8Array(n);
    const stack = [];
    let groups = 0;
    for (let c = 0; c < n; c++) {
      if (!bitGet(s, c) || seen[c]) continue;
      groups++;
      let reachable = false;
      seen[c] = 1;
      stack.push(c);
      while (stack.length) {
        const v = stack.pop();
        const base = v * 8;
        for (let j = 0; j < 8; j++) {
          const t = L.jump[base + j];
          if (t < 0) continue;
          if (bitGet(s, t)) {
            if (!seen[t]) {
              seen[t] = 1;
              stack.push(t);
            }
          } else if (players.indexOf(t) >= 0) reachable = true;
        }
      }
      if (!reachable) return true;
    }
    return groups > players.length;
  }

  function onwardDegree(L, s, t) {
    let d = 0;
    const base = t * 8;
    for (let j = 0; j < 8; j++) {
      const u = L.jump[base + j];
      if (u >= 0 && bitGet(s, u)) d++;
    }
    return d;
  }

  function orderedMoves(L, s) {
    const moves = legalMoves(L, s);
    if (L.echoes) {
      // Prefer jumps after which fewer lights remain (an echo putting one out too).
      for (const m of moves) m.score = litCount(playFast(L, s, m.k, m.j)) * 8 + onwardDegree(L, s, m.to);
    } else {
      // Warnsdorff: squares with the fewest ways onward first.
      for (const m of moves) m.score = onwardDegree(L, s, m.to);
    }
    moves.sort((a, b) => a.score - b.score);
    return moves;
  }

  // ---------------------------------------------------------------- solver

  /**
   * Depth-first search for any winning line from `s` (iterative, so long lines are fine).
   * Returns { status: 'solved' | 'unsolvable' | 'budget', moves, nodes }.
   */
  function solve(L, s, budget = 2e6) {
    if (isWin(s)) return { status: 'solved', moves: [], nodes: 0 };
    if (hopeless(L, s)) return { status: 'unsolvable', moves: null, nodes: 0 };
    const visited = new Set([stateKey(s)]);
    const stack = [{ st: s, moves: orderedMoves(L, s), i: 0, via: null }];
    let nodes = 0;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i >= top.moves.length) {
        stack.pop();
        continue;
      }
      const m = top.moves[top.i++];
      const next = playFast(L, top.st, m.k, m.j);
      const via = { k: m.k, j: m.j, to: m.to };
      if (isWin(next)) {
        const moves = stack.slice(1).map((f) => f.via);
        moves.push(via);
        return { status: 'solved', moves, nodes };
      }
      if (++nodes > budget) return { status: 'budget', moves: null, nodes };
      const key = stateKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (hopeless(L, next)) continue;
      stack.push({ st: next, moves: orderedMoves(L, next), i: 0, via });
    }
    return { status: 'unsolvable', moves: null, nodes };
  }

  /**
   * Shortest winning line by iterative deepening: depth-first search within a move limit that
   * grows by one each round. States that failed with some number of moves left are remembered
   * across rounds, and a position is cut when even perfect jumps could not put out its lights
   * in time. Returns { moves, nodes }, moves = null when there is no line within `maxMoves`, or
   * null when the budget ran out.
   */
  function solveShortest(L, s, budget = 1e6, maxMoves = 80) {
    const perMove = 1 + L.echoes;
    const failed = new Map();
    const line = [];
    let nodes = 0;
    let out = false;

    function dfs(st, left) {
      if (isWin(st)) return true;
      if (left === 0 || litCount(st) > left * perMove) return false;
      if (++nodes > budget) {
        out = true;
        return false;
      }
      const key = stateKey(st);
      const known = failed.get(key);
      if (known !== undefined && known >= left) return false;
      if (hopeless(L, st)) {
        failed.set(key, Infinity);
        return false;
      }
      for (const m of orderedMoves(L, st)) {
        line.push({ k: m.k, j: m.j, to: m.to });
        if (dfs(playFast(L, st, m.k, m.j), left - 1)) return true;
        line.pop();
        if (out) return false;
      }
      failed.set(key, left);
      return false;
    }

    for (let limit = Math.ceil(litCount(s) / perMove); limit <= maxMoves; limit++) {
      if (dfs(s, limit)) return { moves: line, nodes };
      if (out) return null;
    }
    return { moves: null, nodes };
  }

  /**
   * Counts solutions (capped).
   *
   * Without echoes nothing relights, so lines are at most as long as the number of lights; lines
   * that only differ by the order in which knights take turns are counted once.
   *
   * With echoes lines can wander indefinitely, so pass `maxMoves` to count only the lines of at
   * most that many jumps (exact, using the fact that one jump puts out at most 1 + echoes lights).
   */
  function countSolutions(L, s, cap = 1e6, budget = 3e6, maxMoves = Infinity) {
    const memo = new Map();
    const onStack = new Set();
    const bounded = maxMoves !== Infinity;
    const perMove = 1 + L.echoes;
    let nodes = 0;
    let out = false;
    const ordered = L.echoes === 0;

    function count(st, minK, depth) {
      if (isWin(st)) return 1;
      if (bounded && litCount(st) > (maxMoves - depth) * perMove) return 0;
      if (++nodes > budget || depth > 400) {
        out = true;
        return 0;
      }
      const key = stateKey(st) + (ordered ? '|' + minK : '') + (bounded ? '|' + depth : '');
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      if (onStack.has(key)) return 0;
      if (hopeless(L, st)) {
        memo.set(key, 0);
        return 0;
      }
      onStack.add(key);
      let total = 0;
      for (const m of legalMoves(L, st)) {
        if (ordered && m.k < minK) continue;
        total += count(playFast(L, st, m.k, m.j), ordered ? m.k : 0, depth + 1);
        if (total >= cap) {
          total = cap;
          break;
        }
      }
      onStack.delete(key);
      memo.set(key, total);
      return total;
    }

    const total = count(s, 0, 0);
    return { count: total, complete: !out, nodes };
  }

  /** Fewest-moves solution by breadth-first search (small levels only). */
  function shortest(L, s, budget = 3e6) {
    if (isWin(s)) return { moves: [], nodes: 0 };
    const parent = new Map([[stateKey(s), null]]);
    let frontier = [s];
    let nodes = 0;
    while (frontier.length) {
      const next = [];
      for (const st of frontier) {
        const key = stateKey(st);
        for (const m of legalMoves(L, st)) {
          const ns = playFast(L, st, m.k, m.j);
          const nk = stateKey(ns);
          if (parent.has(nk)) continue;
          parent.set(nk, { key, k: m.k, j: m.j, to: m.to });
          if (isWin(ns)) {
            const moves = [];
            for (let p = parent.get(nk); p; p = parent.get(p.key)) moves.unshift({ k: p.k, j: p.j, to: p.to });
            return { moves, nodes };
          }
          if (++nodes > budget) return null;
          if (!hopeless(L, ns)) next.push(ns);
        }
      }
      frontier = next;
    }
    return { moves: null, nodes };
  }

  return {
    JUMPS,
    MIRROR,
    PLAYER,
    SHADOW,
    MIRRORED,
    createLevel,
    cloneState,
    isLit,
    litCount,
    isWin,
    isStuck,
    occupant,
    stateKey,
    movesFor,
    legalMoves,
    echoTargets,
    play,
    playFast,
    hopeless,
    solve,
    solveShortest,
    countSolutions,
    shortest,
  };
});
