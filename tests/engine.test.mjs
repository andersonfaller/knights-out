// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const G = require('../js/generator.js');
const CHAPTERS = require('../js/levels.js');

const at = (L, x, y) => y * L.w + x;
const jumpIndex = (dx, dy) => E.JUMPS.findIndex(([a, b]) => a === dx && b === dy);

function replay(L, moves) {
  let s = E.cloneState(L.start);
  for (const m of moves) {
    assert.ok(
      E.legalMoves(L, s).some((l) => l.k === m.k && l.j === m.j),
      `illegal move ${JSON.stringify(m)}`,
    );
    s = E.play(L, s, m.k, m.j).state;
  }
  return s;
}

/** Plain breadth-first search over every reachable state, no pruning. */
function bruteSolvable(L, s) {
  const seen = new Set([E.stateKey(s)]);
  let frontier = [s];
  while (frontier.length) {
    const next = [];
    for (const st of frontier) {
      if (E.isWin(st)) return true;
      for (const m of E.legalMoves(L, st)) {
        const ns = E.playFast(L, st, m.k, m.j);
        const key = E.stateKey(ns);
        if (!seen.has(key)) {
          seen.add(key);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  return false;
}

test('parses boards, pieces and lit squares', () => {
  const L = E.createLevel(['Mo.', 'x.K', 'S.o']);
  assert.equal(L.w, 3);
  assert.equal(L.h, 3);
  assert.deepEqual(L.kinds, ['K', 'M', 'S']); // player first, then echoes in reading order
  assert.deepEqual(L.start.pos, [at(L, 2, 1), at(L, 0, 0), at(L, 0, 2)]);
  assert.equal(L.exists[at(L, 0, 1)], 0);
  assert.equal(E.litCount(L.start), 2);
  assert.ok(E.isLit(L.start, at(L, 1, 0)));
  assert.ok(E.isLit(L.start, at(L, 2, 2)));
});

test('a knight lands only on lit, free squares and puts them out', () => {
  const L = E.createLevel(['K..', '..o', '.o.']);
  const targets = E.legalMoves(L, L.start).map((m) => m.to).sort();
  assert.deepEqual(targets, [at(L, 2, 1), at(L, 1, 2)]);
  const { state, events } = E.play(L, L.start, 0, jumpIndex(2, 1));
  assert.equal(state.pos[0], at(L, 2, 1));
  assert.ok(!E.isLit(state, at(L, 2, 1)));
  assert.equal(E.litCount(state), 1);
  assert.deepEqual(events, [{ k: 0, from: 0, to: at(L, 2, 1), blocked: false, lit: false }]);
});

test('boards up to 64 squares use both halves of the bitmask', () => {
  const rows = ['K.......', '..o.....', '........', '........', '........', '........', '......o.', '........'];
  const L = E.createLevel(rows);
  assert.equal(E.litCount(L.start), 2);
  assert.ok(E.isLit(L.start, at(L, 6, 6)));
  const s = E.play(L, L.start, 0, jumpIndex(2, 1)).state;
  assert.equal(E.litCount(s), 1);
  assert.throws(() => E.createLevel(['.........', ...rows.map((r) => r + '.')]), /too large/);
});

test('a shadow copies the jump; landing on a dark square lights it', () => {
  const L = E.createLevel(['K....', '..o..', '.....', 'S....', '.....']);
  const { state, events } = E.play(L, L.start, 0, jumpIndex(2, 1));
  assert.equal(state.pos[1], at(L, 2, 4));
  assert.ok(E.isLit(state, at(L, 2, 4)));
  assert.equal(events[1].lit, true);
  assert.equal(E.litCount(state), 1);
});

test('a mirror copies the jump flipped left to right', () => {
  const L = E.createLevel(['K....', '..o.M', '..o..']);
  const { state } = E.play(L, L.start, 0, jumpIndex(2, 1));
  assert.equal(state.pos[1], at(L, 2, 2)); // (4,1) + (-2,1)
  assert.ok(E.isWin(state)); // it landed on the other light and put it out
  assert.equal(E.MIRROR[jumpIndex(2, 1)], jumpIndex(-2, 1));
});

test('echoes stay put at the edge, at holes and at taken squares', () => {
  // Edge: the shadow at (4,0) copying (+2,+1) would leave the board.
  const edge = E.createLevel(['K...S', '..o..']);
  const r1 = E.play(edge, edge.start, 0, jumpIndex(2, 1));
  assert.equal(r1.state.pos[1], edge.start.pos[1]);
  assert.equal(r1.events[1].blocked, true);

  // Hole: the shadow at (2,0) would land in the hole at (4,1).
  const hole = E.createLevel(['K.S..', '..o.x']);
  const r2 = E.play(hole, hole.start, 0, jumpIndex(2, 1));
  assert.equal(r2.state.pos[1], hole.start.pos[1]);
  assert.equal(r2.events[1].blocked, true);

  // Taken: the mirror at (4,0) wants (2,1), exactly where the knight just landed.
  const taken = E.createLevel(['K...M', '..o..']);
  const r3 = E.play(taken, taken.start, 0, jumpIndex(2, 1));
  assert.equal(r3.state.pos[1], taken.start.pos[1]);
  assert.equal(E.echoTargets(taken, taken.start, 0, jumpIndex(2, 1))[0].to, -1);

  // Two echoes aiming at one square: the first in reading order gets it, the other stays.
  const pair = E.createLevel(['K....', '..o..', '.....', 'S...M', '.....']);
  const r4 = E.play(pair, pair.start, 0, jumpIndex(2, 1));
  assert.equal(r4.state.pos[1], at(pair, 2, 4));
  assert.equal(r4.state.pos[2], at(pair, 4, 3));
  assert.equal(r4.events[2].blocked, true);
  assert.equal(E.litCount(r4.state), 1);
});

test('pruning never discards a solvable position', () => {
  const r = G.rng(42);
  let checked = 0;
  for (let t = 0; t < 4000 && checked < 150; t++) {
    const spec = { w: 4, h: 4, steps: 5 + (t % 5), players: 1 + (t % 2), holes: t % 3 };
    const c = G.construct(r, spec);
    if (!c) continue;
    const L = E.createLevel(c.rows);
    // Perturb the board a little so some positions are unsolvable.
    let s = E.cloneState(L.start);
    const free = [...Array(L.n).keys()].filter((i) => L.exists[i] && !s.pos.includes(i));
    const flip = free[Math.floor(r() * free.length)];
    if (flip !== undefined && r() < 0.5) {
      if (flip < 32) s.lo ^= 1 << flip;
      else s.hi ^= 1 << (flip - 32);
    }
    assert.equal(E.solve(L, s).status === 'solved', bruteSolvable(L, s), c.rows.join('/'));
    checked++;
  }
  assert.ok(checked >= 100);
});

test('generated puzzles are solved by the line that built them', () => {
  const r = G.rng(7);
  const specs = [
    { w: 5, h: 5, steps: 10, holes: 2 },
    { w: 5, h: 5, steps: 12, players: 2 },
    { w: 5, h: 5, steps: 6, shadows: 1 },
    { w: 5, h: 5, steps: 6, mirrors: 1, holes: 1 },
    { w: 6, h: 5, steps: 7, shadows: 1, mirrors: 1, players: 2 },
  ];
  for (const spec of specs) {
    let made = 0;
    for (let t = 0; t < 3000 && made < 20; t++) {
      const c = G.construct(r, spec);
      if (!c) continue;
      const L = E.createLevel(c.rows);
      assert.ok(E.isWin(replay(L, c.line)), c.rows.join('/'));
      made++;
    }
    assert.ok(made > 0, JSON.stringify(spec));
  }
});

test('solver lines replay to a win', () => {
  const r = G.rng(3);
  for (let t = 0, n = 0; t < 2000 && n < 40; t++) {
    const c = G.construct(r, { w: 5, h: 5, steps: 7, shadows: t % 2, mirrors: 1 - (t % 2) });
    if (!c) continue;
    const L = E.createLevel(c.rows);
    const res = E.solve(L, L.start);
    assert.equal(res.status, 'solved');
    assert.ok(E.isWin(replay(L, res.moves)));
    const short = E.shortest(L, L.start);
    assert.ok(short.moves.length <= res.moves.length);
    assert.ok(E.isWin(replay(L, short.moves)));
    n++;
  }
});

test('iterative deepening finds lines exactly as short as breadth-first search', () => {
  const r = G.rng(5);
  for (let t = 0, n = 0; t < 3000 && n < 40; t++) {
    const c = G.construct(r, { w: 5, h: 5, steps: 6, shadows: 1, mirrors: t % 2, players: 1 + (t % 3 === 0) });
    if (!c) continue;
    const L = E.createLevel(c.rows);
    // Start from a random position along the way, solvable or not.
    let s = E.cloneState(L.start);
    for (let k = Math.floor(r() * 4); k > 0; k--) {
      const ms = E.legalMoves(L, s);
      if (!ms.length) break;
      const m = ms[Math.floor(r() * ms.length)];
      s = E.playFast(L, s, m.k, m.j);
    }
    const bfs = E.shortest(L, s);
    const ids = E.solveShortest(L, s);
    if (bfs.moves) {
      assert.equal(ids.moves.length, bfs.moves.length);
      let st = s;
      for (const m of ids.moves) st = E.playFast(L, st, m.k, m.j);
      assert.ok(E.isWin(st));
    } else {
      assert.equal(ids.moves, null);
    }
    n++;
  }
});

test('every shipped level is solvable within the hint budget', () => {
  let n = 0;
  for (const chapter of CHAPTERS) {
    assert.equal(chapter.levels.length, 6, chapter.name);
    for (const level of chapter.levels) {
      const L = E.createLevel(level.rows);
      assert.ok(!E.isWin(L.start), level.rows.join('/'));
      for (let k = 0; k < L.players; k++) assert.ok(!E.isLit(L.start, L.start.pos[k]), 'knight on a lit square');
      const res = E.solve(L, L.start, 250000);
      assert.equal(res.status, 'solved', `${chapter.name}: ${level.rows.join('/')}`);
      assert.ok(E.isWin(replay(L, res.moves)));
      n++;
    }
  }
  assert.equal(n, 36);
});

test('endless puzzles come out solvable for every mode spec', () => {
  const r = G.rng(11);
  const specs = [
    { w: 4, h: 5, steps: 9, holes: 2 },
    { w: 5, h: 5, shadows: 1, steps: 6 },
    { w: 5, h: 5, shadows: 1, mirrors: 1, steps: 7 },
  ];
  for (const spec of specs) {
    const rows = G.endless(r, spec, 6);
    assert.ok(rows, JSON.stringify(spec));
    const L = E.createLevel(rows);
    assert.equal(E.solve(L, L.start).status, 'solved');
  }
});
