# knights out

A knight's-move puzzle about putting out lights. Open `index.html` in a browser — there is no
build step and no dependencies beyond two Google Fonts.

## Rules

- Your knight jumps in an L. It may only land on a **lit** square, and landing puts that light out.
- **Shadow knights** copy every jump you make, in the same direction.
- **Mirror knights** copy it flipped left ↔ right.
- Echo knights land anywhere: a lit square goes out, a dark one lights up. If their jump would
  leave the board, fall into a gap or hit another piece, they stay put.
- Turn every square dark to win.

Without echoes a level is a path puzzle (visit every light exactly once). Echoes turn it into a
timing puzzle: they can put lights out for you, light up the stepping stone you need, or wreck a
square you already cleared — and sometimes the only way to hold one still is to bounce it off a
wall.

## Playing

- 36 levels in six chapters, introducing one idea at a time. Up to three unsolved levels can be
  skipped, so one hard level never blocks progress.
- **Endless** mode builds a fresh puzzle on demand at three difficulties.
- **Hint** runs the solver from the current position: it either shows a good next jump or says how
  many moves to undo to get out of a dead end.
- On desktop, hover over a square to preview where the echoes would land; on touch screens, press
  and hold. Keys: `Z` undo, `R` restart, `H` hint, `Esc` levels.
- Progress and the sound setting are kept in `localStorage`.

## Project layout

| path | what |
| --- | --- |
| `index.html`, `css/style.css` | page and styles (SVG sprite inline; no frameworks) |
| `js/engine.js` | rules, solver and dead-end pruning — shared by the game and the tools |
| `js/generator.js` | puzzle construction (solvable by construction) and endless mode |
| `js/levels.js` | the level set, generated — do not edit by hand |
| `js/game.js` | rendering, input, animation, sound, progress |
| `tools/` | level search and curation (Node) |
| `tests/` | engine tests |

## Levels

Puzzles are built backwards: place the pieces on a dark board, play random jumps, and light
exactly the squares that were landed on an odd number of times. Replaying the jumps clears the
board, so every puzzle has a solution. The tools then score candidates with the solver (number of
solutions, shortest solution) and with random play that avoids obvious blunders, and keep the ones
that match each slot's difficulty and teach the intended idea (an echo lighting a square you need,
an echo bumping into a wall, and so on).

```sh
node tools/build-levels.mjs              # rebuild js/levels.js from tools/chapters.json
node tools/build-levels.mjs --chapter 3  # search one chapter only (chapters can run in parallel)
node tools/curate.mjs '{"spec":{"w":5,"h":5,"steps":6,"shadows":1},"maxSols":1,"bridges":1}'
node --test                              # engine tests, including every shipped level
```

Search results are cached in `tools/.cache/` (ignored by git), so editing one slot in
`tools/chapters.json` only re-searches that slot.
