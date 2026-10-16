// Finds candidate levels for a slot: a generator spec plus filters on difficulty and on how the
// solution uses echo knights. Prints the best few to pick from by hand.
//
// usage: node tools/curate.mjs '<slot json>' [seed] [top]
//   slot: { spec, tries, lit: [min,max], par: [min,max], smart: [min,max], maxSols,
//           bridges: min, assists: min, bumps: min, prefer: 'hard' | 'easy' }
import { E, rng, construct, playouts, echoUse, show } from './lib.mjs';

// Echo levels count only solutions within this many jumps of the shortest one.
const SLACK = 2;

export function evaluate(rows, r, games = 400, cap = 200) {
  const L = E.createLevel(rows);
  const lit = E.litCount(L.start);
  const solve = E.solve(L, L.start, 3e5);
  if (solve.status !== 'solved') return null;
  // Without echoes every jump puts out exactly one light.
  let par = lit;
  let line = solve.moves;
  if (L.echoes) {
    const short = E.shortest(L, L.start, 6e5);
    if (!short || !short.moves) return null;
    par = short.moves.length;
    line = short.moves;
  }
  const sols = E.countSolutions(L, L.start, cap, 6e5, L.echoes ? par + SLACK : Infinity);
  if (!sols.complete || !sols.count) return null;
  const smart = playouts(L, games, r, true);
  const blind = playouts(L, games, r, false);
  const use = L.echoes ? echoUse(L, line) : { bridges: 0, assists: 0, bumps: 0 };
  return { rows, lit, sols: sols.count, par, smart, blind, ...use, solverNodes: solve.nodes, solverOk: true };
}

const inRange = (v, range) => !range || (v >= range[0] && v <= range[1]);

export function curate(slot, seed = 1) {
  const r = rng(seed);
  const tries = slot.tries || 400;
  const seen = new Set();
  const out = [];
  for (let t = 0; t < tries * 60 && seen.size < tries; t++) {
    const c = construct(r, slot.spec);
    if (!c) continue;
    const key = c.rows.join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    const L = E.createLevel(c.rows);
    if (!inRange(E.litCount(L.start), slot.lit)) continue;
    if (slot.noStartLit && /[smk]/.test(key)) continue;
    // Cheap screens first: a rough difficulty estimate, then the solution count with an early cap.
    if (slot.smart) {
      const rough = playouts(L, 120, r, true);
      if (rough < slot.smart[0] * 0.5 - 0.01 || rough > Math.min(1, slot.smart[1] * 1.5 + 0.03)) continue;
    }
    if (slot.maxSols) {
      let limit = Infinity;
      if (L.echoes) {
        const short = E.shortest(L, L.start, 2e5);
        if (!short || !short.moves) continue;
        limit = short.moves.length + SLACK;
      }
      const quick = E.countSolutions(L, L.start, slot.maxSols + 1, 2e5, limit);
      if (!quick.complete || quick.count > slot.maxSols || !quick.count) continue;
    }
    const f = evaluate(c.rows, r, slot.games || 400, slot.maxSols ? slot.maxSols + 1 : 200);
    if (!f) continue;
    if (!inRange(f.par, slot.par) || !inRange(f.smart, slot.smart)) continue;
    if (slot.maxSols && f.sols > slot.maxSols) continue;
    if ((slot.bridges || 0) > f.bridges || (slot.assists || 0) > f.assists || (slot.bumps || 0) > f.bumps) continue;
    if (slot.maxBridges !== undefined && f.bridges > slot.maxBridges) continue;
    if (slot.maxBumps !== undefined && f.bumps > slot.maxBumps) continue;
    out.push(f);
  }
  const dir = slot.prefer === 'easy' ? -1 : 1;
  out.sort((a, b) => dir * (a.smart - b.smart) || a.sols - b.sols);
  return out;
}

export function describe(f) {
  return (
    `lit ${f.lit}  par ${f.par}  sols ${f.sols}${E.createLevel(f.rows).echoes ? ` (≤ par+${SLACK})` : ''}  smart ${(f.smart * 100).toFixed(1)}%  blind ${(f.blind * 100).toFixed(1)}%` +
    `  bridges ${f.bridges} assists ${f.assists} bumps ${f.bumps}  solver ${f.solverNodes}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slot = JSON.parse(process.argv[2]);
  const seed = Number(process.argv[3] || 1);
  const top = Number(process.argv[4] || 4);
  const found = curate(slot, seed);
  console.log(`${found.length} matches`);
  for (const f of found.slice(0, top)) {
    console.log('\n' + describe(f));
    console.log(show(f.rows));
    console.log('  ' + JSON.stringify(f.rows));
  }
}
