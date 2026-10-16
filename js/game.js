/* knights out — game controller (rendering, input, progress, sound). */
(function () {
  'use strict';

  const E = window.KnightsEngine;
  const G = window.KnightsGenerator;
  const CHAPTERS = window.KNIGHTS_CHAPTERS;

  const JUMP_MS = 320;
  const ECHO_DELAY = 150;
  const HINT_BUDGET = 250000;

  // ------------------------------------------------------------------ levels

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const LEVELS = [];
  CHAPTERS.forEach((chapter, c) => {
    chapter.levels.forEach((level, i) => {
      LEVELS.push({ ...level, chapter: c, number: i + 1, id: hash(level.rows.join('/')) });
    });
  });

  const ENDLESS = [
    {
      key: 'squire',
      name: 'squire',
      blurb: 'gentle',
      specs: [
        { w: 4, h: 5, steps: 9, holes: 2 },
        { w: 5, h: 5, steps: 11, holes: 3 },
        { w: 5, h: 5, players: 2, steps: 11, holes: 2 },
        { w: 4, h: 4, shadows: 1, steps: 4 },
      ],
    },
    {
      key: 'knight',
      name: 'knight',
      blurb: 'tricky',
      specs: [
        { w: 5, h: 5, steps: 16, holes: 2, tour: true, minLit: 15 },
        { w: 5, h: 5, shadows: 1, steps: 6 },
        { w: 5, h: 5, mirrors: 1, steps: 6, holes: 1 },
        { w: 6, h: 5, players: 2, steps: 18, holes: 2, tour: true, minLit: 16 },
      ],
    },
    {
      key: 'champion',
      name: 'champion',
      blurb: 'fiendish',
      specs: [
        { w: 6, h: 6, steps: 26, holes: 3, tour: true, minLit: 24 },
        { w: 5, h: 6, shadows: 1, steps: 9, holes: 1 },
        { w: 6, h: 5, mirrors: 1, steps: 9, holes: 1 },
        { w: 5, h: 5, shadows: 1, mirrors: 1, steps: 7 },
      ],
    },
  ];

  // ------------------------------------------------------------------ storage

  const STORE_KEY = 'knights-out:v2';
  const save = { solved: {}, sound: true, last: 0, endless: {} };
  try {
    Object.assign(save, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
  } catch {
    /* storage unavailable: play without saving */
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(save));
    } catch {
      /* storage unavailable */
    }
  }

  const isSolved = (i) => !!save.solved[LEVELS[i].id];
  // Up to three unsolved levels may be skipped.
  function isOpen(i) {
    let skipped = 0;
    for (let j = 0; j < i; j++) if (!isSolved(j)) skipped++;
    return skipped <= 3;
  }

  // ------------------------------------------------------------------ sound

  const sfx = (() => {
    let ctx = null;
    let noiseBuf = null;

    function audio() {
      if (!save.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, dur, { type = 'sine', gain = 0.1, slide = 0, delay = 0 } = {}) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + delay;
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(a.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    function hiss(dur, { gain = 0.08, freq = 1200, q = 0.7, sweep = 0, delay = 0 } = {}) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + delay;
      const src = a.createBufferSource();
      src.buffer = noiseBuf;
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, t);
      if (sweep) f.frequency.exponentialRampToValueAtTime(freq + sweep, t + dur);
      f.Q.value = q;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(a.destination);
      src.start(t);
      src.stop(t + dur + 0.05);
    }

    return {
      jump: () => hiss(0.16, { gain: 0.035, freq: 2400, sweep: -1200 }),
      out: () => {
        hiss(0.42, { gain: 0.11, freq: 700, q: 0.5, sweep: 900 });
        tone(392, 0.22, { gain: 0.035, slide: -140 });
      },
      ignite: () => {
        hiss(0.3, { gain: 0.06, freq: 500, sweep: 2200 });
        tone(196, 0.4, { type: 'triangle', gain: 0.07, slide: 196 });
      },
      bump: () => tone(120, 0.14, { gain: 0.12, slide: -40 }),
      select: () => tone(1046, 0.06, { gain: 0.03 }),
      nope: () => tone(150, 0.09, { type: 'square', gain: 0.02 }),
      hint: () => {
        tone(988, 0.16, { gain: 0.04 });
        tone(1318, 0.22, { gain: 0.035, delay: 0.08 });
      },
      win: () =>
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          tone(f, 0.9, { type: 'triangle', gain: 0.06, delay: 0.1 + i * 0.09 }),
        ),
      stuck: () => {
        tone(311, 0.3, { type: 'triangle', gain: 0.06 });
        tone(233, 0.5, { type: 'triangle', gain: 0.06, delay: 0.2 });
      },
    };
  })();

  // ------------------------------------------------------------------ dom

  const $ = (id) => document.getElementById(id);
  const dom = {
    viewGame: $('view-game'),
    viewMenu: $('view-menu'),
    label: $('level-label'),
    tip: $('level-tip'),
    stage: $('stage'),
    board: $('board'),
    tiles: $('tiles'),
    pieces: $('pieces'),
    veil: $('veil'),
    cardKicker: $('card-kicker'),
    cardTitle: $('card-title'),
    cardText: $('card-text'),
    cardActions: $('card-actions'),
    counter: document.querySelector('.counter'),
    lightsLeft: $('lights-left'),
    lightsLabel: $('lights-label'),
    undo: $('btn-undo'),
    restart: $('btn-restart'),
    hint: $('btn-hint'),
    status: $('status'),
    menu: $('btn-menu'),
    help: $('help'),
    sound: $('btn-sound'),
    chapters: $('chapters'),
    endlessModes: $('endless-modes'),
    topbar: document.querySelector('.topbar'),
    levelHead: document.querySelector('.level-head'),
    hud: document.querySelector('.hud'),
  };

  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const knightSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#i-knight"/></svg>';
  const KIND_NAME = { K: 'knight', S: 'shadow knight', M: 'mirror knight' };

  // ------------------------------------------------------------------ game state

  const game = {
    mode: 'level',
    levelIndex: 0,
    endless: null,
    rows: null,
    L: null,
    state: null,
    history: [],
    selected: 0,
    over: false,
    animating: false,
    timers: [],
    hint: null,
    tileEls: [],
    pieceEls: [],
    ghostEls: [],
    suppressClick: false,
    pressTimer: 0,
    pendingCard: null,
    cardTimer: 0,
    hintLine: null,
  };

  function later(ms, fn) {
    game.timers.push(setTimeout(fn, ms));
  }

  /** Finish any running animation at once and show the real state (and any card due). */
  function flush() {
    if (game.animating || game.timers.length) {
      game.timers.forEach(clearTimeout);
      game.timers = [];
      const wasAnimating = game.animating;
      game.animating = false;
      game.pieceEls.forEach((el) => el.classList.remove('hop', 'bump', 'jumping'));
      render();
      if (wasAnimating) settle(false);
    }
    if (game.pendingCard) {
      clearTimeout(game.cardTimer);
      const show = game.pendingCard;
      game.pendingCard = null;
      show();
    }
  }

  /** Shows an end-of-game card after a short pause; an interrupt shows it at once. */
  function cardSoon(show, ms) {
    game.pendingCard = show;
    game.cardTimer = setTimeout(() => {
      game.pendingCard = null;
      show();
    }, ms);
  }

  // ------------------------------------------------------------------ building a board

  function startLevel(i) {
    game.mode = 'level';
    game.levelIndex = i;
    game.endless = null;
    save.last = i;
    persist();
    const level = LEVELS[i];
    const chapter = CHAPTERS[level.chapter];
    dom.label.innerHTML = `${chapter.name} · <b>${level.number}</b> of ${chapter.levels.length}`;
    dom.tip.textContent = level.tip || '';
    build(level.rows);
  }

  function startEndless(key) {
    const mode = ENDLESS.find((m) => m.key === key);
    game.mode = 'endless';
    game.endless = mode;
    const r = G.rng((Math.random() * 2 ** 32) >>> 0);
    let rows = null;
    for (let t = 0; !rows && t < 20; t++) rows = G.endless(r, G.pick(r, mode.specs), 16);
    if (!rows) rows = LEVELS[LEVELS.length - 1].rows;
    const L = E.createLevel(rows);
    const parts = [];
    if (L.players > 1) parts.push(`${L.players} knights`);
    if (L.kinds.includes('S')) parts.push('a shadow');
    if (L.kinds.includes('M')) parts.push('a mirror');
    dom.label.innerHTML = `endless · <b>${mode.name}</b>`;
    dom.tip.textContent = parts.length ? `With ${parts.join(' and ')}.` : '';
    build(rows);
  }

  function build(rows) {
    flush();
    game.rows = rows;
    game.L = E.createLevel(rows);
    game.state = E.cloneState(game.L.start);
    game.history = [];
    game.over = false;
    game.hint = null;
    game.hintLine = null;
    game.selected = firstMovable(0);
    hideCard();
    setStatus('');

    const L = game.L;
    dom.tiles.innerHTML = '';
    dom.pieces.innerHTML = '';
    game.tileEls = [];
    for (let i = 0; i < L.n; i++) {
      const x = i % L.w;
      const y = (i - x) / L.w;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tile' + ((x + y) % 2 ? ' alt' : '') + (L.exists[i] ? '' : ' hole');
      el.dataset.i = i;
      if (L.exists[i]) {
        el.innerHTML = `<span class="flame"><span class="flame-body" style="--delay:${(-Math.random() * 2).toFixed(2)}s;--flicker:${(1.4 + Math.random() * 0.8).toFixed(2)}s"></span></span>`;
      } else {
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
      }
      dom.tiles.appendChild(el);
      game.tileEls.push(el);
    }

    game.pieceEls = L.kinds.map((kind) => {
      const el = document.createElement('div');
      el.className = `piece piece--${kind}`;
      el.innerHTML = `<div class="piece-body">${knightSvg}</div>` + (kind === 'K' ? '' : '<span class="stay">×</span>');
      dom.pieces.appendChild(el);
      return el;
    });
    game.ghostEls = L.kinds.map((kind) => {
      if (kind === 'K') return null;
      const el = document.createElement('div');
      el.className = `ghost ghost--${kind}`;
      el.innerHTML = knightSvg;
      dom.pieces.appendChild(el);
      return el;
    });

    dom.board.classList.remove('won', 'stuck', 'enter');
    void dom.board.offsetWidth;
    dom.board.classList.add('enter');
    showView('game');
    layout();
    render();
  }

  function layout() {
    if (!game.L) return;
    const { w, h } = game.L;
    const width = Math.min(document.documentElement.clientWidth, 720) - 32;
    const narrow = width < 420;
    const gap = narrow ? 4 : 5;
    const pad = narrow ? 8 : 10;
    const chrome = dom.topbar.offsetHeight + dom.levelHead.offsetHeight + dom.hud.offsetHeight + 70;
    const height = Math.max(260, window.innerHeight - chrome);
    const byW = (width - 2 * pad - (w - 1) * gap) / w;
    const byH = (height - 2 * pad - (h - 1) * gap) / h;
    const tile = Math.floor(Math.max(34, Math.min(byW, byH, 82)));
    const s = dom.board.style;
    s.setProperty('--tile', tile + 'px');
    s.setProperty('--gap', gap + 'px');
    s.setProperty('--pad', pad + 'px');
    s.setProperty('--cols', w);
  }

  // ------------------------------------------------------------------ rendering

  function firstMovable(prefer) {
    const L = game.L;
    const s = game.state;
    if (prefer < L.players && E.movesFor(L, s, prefer).length) return prefer;
    for (let k = 0; k < L.players; k++) if (E.movesFor(L, s, k).length) return k;
    return Math.min(prefer, L.players - 1);
  }

  function coords(i) {
    const x = i % game.L.w;
    return [x, (i - x) / game.L.w];
  }

  function placePiece(el, i) {
    const [x, y] = coords(i);
    el.style.setProperty('--x', x);
    el.style.setProperty('--y', y);
  }

  function squareName(i) {
    const [x, y] = coords(i);
    return String.fromCharCode(97 + x) + (game.L.h - y);
  }

  function render() {
    const { L, state } = game;
    const targets = new Set();
    if (!game.over && !game.animating) for (const m of E.movesFor(L, state, game.selected)) targets.add(m.to);

    game.tileEls.forEach((el, i) => {
      if (!L.exists[i]) return;
      const lit = E.isLit(state, i);
      el.classList.toggle('lit', lit);
      el.classList.toggle('target', targets.has(i));
      el.classList.toggle('hint', !!game.hint && game.hint.to === i);
      el.classList.remove('peek');
      const who = E.occupant(state, i);
      el.setAttribute(
        'aria-label',
        `${squareName(i)}, ${lit ? 'lit' : 'dark'}` +
          (who >= 0 ? `, ${KIND_NAME[L.kinds[who]]}` : '') +
          (targets.has(i) ? ', jump here' : ''),
      );
    });

    game.pieceEls.forEach((el, k) => {
      placePiece(el, state.pos[k]);
      el.classList.toggle('selected', k === game.selected && !game.over);
      el.classList.toggle('hint', !!game.hint && game.hint.k === k);
      el.classList.remove('staying');
    });
    hidePreview();

    const left = E.litCount(state);
    dom.lightsLeft.textContent = left;
    dom.lightsLabel.textContent = left === 1 ? 'light left' : 'lights left';
    dom.counter.classList.toggle('done', left === 0);
    dom.undo.disabled = !game.history.length || (game.over && E.isWin(state));
    dom.restart.disabled = !game.history.length;
    dom.hint.disabled = game.over && E.isWin(state);
  }

  function setStatus(text, warn = false) {
    dom.status.textContent = text;
    dom.status.classList.toggle('warn', warn);
  }

  // echo preview ------------------------------------------------------

  function showPreview(to) {
    hidePreview();
    const { L, state } = game;
    if (!L.echoes || game.animating || game.over) return;
    const move = E.movesFor(L, state, game.selected).find((m) => m.to === to);
    if (!move) return;
    game.tileEls[to].classList.add('peek');
    for (const t of E.echoTargets(L, state, move.k, move.j)) {
      if (t.to < 0) {
        game.pieceEls[t.k].classList.add('staying');
      } else {
        const g = game.ghostEls[t.k];
        placePiece(g, t.to);
        g.classList.add('show');
      }
    }
  }

  function hidePreview() {
    game.ghostEls.forEach((g) => g && g.classList.remove('show'));
    game.pieceEls.forEach((el) => el.classList.remove('staying'));
    game.tileEls.forEach((el) => el.classList.remove('peek'));
  }

  // ------------------------------------------------------------------ input

  function onTile(i) {
    if (game.suppressClick) {
      game.suppressClick = false;
      return;
    }
    flush();
    const { L, state } = game;
    if (game.over || !L.exists[i]) return;

    const who = E.occupant(state, i);
    if (who >= 0 && who < L.players) {
      if (who !== game.selected) {
        game.selected = who;
        game.hint = null;
        sfx.select();
        render();
      }
      return;
    }

    let move = E.movesFor(L, state, game.selected).find((m) => m.to === i);
    if (!move) {
      const others = E.legalMoves(L, state).filter((m) => m.to === i);
      if (others.length === 1) move = others[0];
    }
    if (move) {
      doMove(move.k, move.j);
      return;
    }

    sfx.nope();
    const el = game.tileEls[i];
    el.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
    if (who >= L.players) setStatus(`That's a ${KIND_NAME[L.kinds[who]]} — it moves only when you do.`);
    else if (E.isLit(state, i)) setStatus('Knights jump in an L: two squares one way, one to the side.');
    else setStatus('Your knight can only land on a lit square.');
  }

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function puff(i) {
    const el = document.createElement('span');
    el.className = 'smoke';
    el.innerHTML = '<i></i><i></i><i></i>';
    game.tileEls[i].appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function spark(i) {
    const el = document.createElement('span');
    el.className = 'spark';
    game.tileEls[i].appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function doMove(k, j) {
    flush();
    const before = game.state;
    const { state, events } = E.play(game.L, before, k, j);
    game.history.push(before);
    game.state = state;
    game.selected = k;
    game.hint = null;
    game.animating = true;
    setStatus('');
    hidePreview();
    game.tileEls.forEach((el) => el.classList.remove('target', 'hint'));
    game.pieceEls.forEach((el) => el.classList.remove('selected', 'hint'));
    sfx.jump();

    events.forEach((ev, idx) => {
      const el = game.pieceEls[ev.k];
      const delay = idx === 0 ? 0 : ECHO_DELAY;
      later(delay, () => {
        if (ev.blocked) {
          const [dx, dy] = E.JUMPS[ev.j];
          el.style.setProperty('--bx', dx / 2);
          el.style.setProperty('--by', dy / 2);
          restartAnim(el, 'bump');
          later(120, sfx.bump);
          return;
        }
        el.classList.add('jumping');
        placePiece(el, ev.to);
        restartAnim(el, 'hop');
        later(JUMP_MS - 30, () => {
          el.classList.remove('jumping');
          const tile = game.tileEls[ev.to];
          tile.classList.toggle('lit', ev.lit);
          if (ev.lit) {
            spark(ev.to);
            sfx.ignite();
          } else {
            puff(ev.to);
            sfx.out();
          }
        });
      });
    });

    const total = (events.length > 1 ? ECHO_DELAY : 0) + JUMP_MS + 10;
    later(total, () => {
      game.timers = [];
      game.animating = false;
      game.pieceEls.forEach((el) => el.classList.remove('hop', 'bump'));
      game.selected = firstMovable(k);
      render();
      settle(true);
    });
  }

  /** After a move: detect a win or a dead end. */
  function settle(withFx) {
    const { L, state } = game;
    if (E.isWin(state)) {
      game.over = true;
      render();
      if (game.mode === 'level') {
        save.solved[LEVELS[game.levelIndex].id] = true;
        persist();
      } else {
        save.endless[game.endless.key] = (save.endless[game.endless.key] || 0) + 1;
        persist();
      }
      if (withFx) {
        const last = game.history.length ? state.pos[0] : 0;
        const [lx, ly] = coords(last);
        game.tileEls.forEach((el, i) => {
          const [x, y] = coords(i);
          el.style.setProperty('--d', Math.max(Math.abs(x - lx), Math.abs(y - ly)));
        });
        dom.board.classList.add('won');
        sfx.win();
      }
      cardSoon(showWin, withFx ? 750 : 0);
      return;
    }
    if (!E.legalMoves(L, state).length) {
      game.over = true;
      dom.board.classList.add('stuck');
      render();
      if (withFx) {
        sfx.stuck();
        game.pieceEls.forEach((el, k) => k < L.players && restartAnim(el, 'trapped'));
      }
      cardSoon(showStuck, withFx ? 450 : 0);
    }
  }

  function undo() {
    flush();
    if (!game.history.length) return;
    if (game.over && E.isWin(game.state)) return;
    game.state = game.history.pop();
    game.over = false;
    game.hint = null;
    dom.board.classList.remove('stuck', 'won');
    hideCard();
    setStatus('');
    game.selected = firstMovable(game.selected);
    dom.undo.classList.remove('glow');
    render();
  }

  function restart() {
    flush();
    if (!game.history.length) return;
    game.state = E.cloneState(game.L.start);
    game.history = [];
    game.over = false;
    game.hint = null;
    dom.board.classList.remove('stuck', 'won');
    hideCard();
    setStatus('');
    game.selected = firstMovable(0);
    dom.undo.classList.remove('glow');
    render();
  }

  /**
   * A winning line from the current position. A line already hinted is followed for as long as
   * the player sticks to it; with echoes the shortest line is preferred, so that following hint
   * after hint always gets closer to the end instead of wandering in circles.
   */
  function findLine() {
    const { L, state } = game;
    const key = E.stateKey(state);
    const kept = game.hintLine;
    if (kept && kept.key === key && kept.moves.length) return { status: 'solved', moves: kept.moves };
    if (L.echoes) {
      // Breadth-first is quickest on small positions, iterative deepening on big ones.
      const bfs = E.shortest(L, state, 60000);
      if (bfs) return bfs.moves ? { status: 'solved', moves: bfs.moves } : { status: 'unsolvable' };
      const ids = E.solveShortest(L, state, HINT_BUDGET);
      if (ids && ids.moves) return { status: 'solved', moves: ids.moves };
    }
    return E.solve(L, state, HINT_BUDGET);
  }

  function hint() {
    flush();
    const { L, state } = game;
    if (game.over && E.isWin(state)) return;
    const res = findLine();
    if (res.status === 'solved') {
      const m = res.moves[0];
      game.hintLine = { key: E.stateKey(E.playFast(L, state, m.k, m.j)), moves: res.moves.slice(1) };
      game.hint = m;
      game.selected = m.k;
      hideCard();
      render();
      sfx.hint();
      setStatus(L.players > 1 ? 'Try this knight, onto the ringed square.' : 'Try the ringed square.');
      return;
    }
    if (res.status === 'unsolvable') {
      let back = 0;
      let found = false;
      for (let h = game.history.length - 1; h >= 0 && back < 30; h--) {
        back++;
        const r = E.solve(L, game.history[h], HINT_BUDGET / 2);
        if (r.status === 'solved') {
          found = true;
          break;
        }
        if (r.status === 'budget') break;
      }
      dom.undo.classList.add('glow');
      setStatus(
        found ? `Dead end — undo ${back} move${back > 1 ? 's' : ''} to get back on track.` : 'Dead end from here — undo a few moves.',
        true,
      );
      return;
    }
    setStatus("Hmm, I can't see a way from here — try undoing a move or two.", true);
  }

  // ------------------------------------------------------------------ overlay card

  function showCard({ kicker, title, text, actions, soft = false }) {
    dom.veil.classList.toggle('soft', soft);
    dom.cardKicker.textContent = kicker;
    dom.cardTitle.innerHTML = title;
    dom.cardText.textContent = text;
    dom.cardActions.innerHTML = '';
    let primary = null;
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' btn-primary' : '');
      b.innerHTML = (a.icon && !a.trailing ? icon(a.icon) : '') + `<span>${a.label}</span>` + (a.icon && a.trailing ? icon(a.icon) : '');
      b.addEventListener('click', a.run);
      dom.cardActions.appendChild(b);
      if (a.primary) primary = b;
    }
    dom.veil.hidden = false;
    if (primary) primary.focus({ preventScroll: true });
  }

  function hideCard() {
    dom.veil.hidden = true;
  }

  function showWin() {
    const jumps = game.history.length;
    const text = `Cleared in ${jumps} jump${jumps === 1 ? '' : 's'}.`;
    if (game.mode === 'endless') {
      const n = save.endless[game.endless.key] || 1;
      showCard({
        kicker: `endless · ${game.endless.name}`,
        title: 'Lights <em>out.</em>',
        text: `${text} ${n} ${game.endless.name} puzzle${n === 1 ? '' : 's'} solved.`,
        actions: [
          { label: 'levels', icon: 'grid', run: openMenu },
          { label: 'another', icon: 'next', trailing: true, primary: true, run: () => startEndless(game.endless.key) },
        ],
      });
      return;
    }
    const level = LEVELS[game.levelIndex];
    const chapter = CHAPTERS[level.chapter];
    const next = nextLevel(game.levelIndex);
    const actions = [{ label: 'levels', icon: 'grid', run: openMenu }];
    if (next >= 0) {
      actions.push({ label: 'next', icon: 'next', trailing: true, primary: true, run: () => startLevel(next) });
    } else {
      actions.push({ label: 'endless', icon: 'dice', primary: true, run: () => startEndless('knight') });
    }
    const allDone = LEVELS.every((_, i) => isSolved(i));
    showCard({
      kicker: `${chapter.name} · ${level.number} of ${chapter.levels.length}`,
      title: allDone && next < 0 ? 'Every light <em>out.</em>' : 'Lights <em>out.</em>',
      text: allDone && next < 0 ? 'You cleared every level. Endless mode never runs dry.' : text,
      actions,
    });
  }

  function showStuck() {
    const left = E.litCount(game.state);
    showCard({
      kicker: 'no jumps left',
      title: 'Stuck.',
      text: `${left} light${left === 1 ? ' is' : 's are'} still burning.`,
      soft: true,
      actions: [
        { label: 'restart', icon: 'restart', run: restart },
        { label: 'undo', icon: 'undo', primary: true, run: undo },
      ],
    });
  }

  function nextLevel(i) {
    for (let j = i + 1; j < LEVELS.length; j++) if (!isSolved(j) && isOpen(j)) return j;
    for (let j = 0; j < LEVELS.length; j++) if (!isSolved(j) && isOpen(j)) return j;
    return i + 1 < LEVELS.length ? i + 1 : -1;
  }

  // ------------------------------------------------------------------ menu

  function showView(name) {
    dom.viewGame.hidden = name !== 'game';
    dom.viewMenu.hidden = name !== 'menu';
    dom.menu.setAttribute('aria-pressed', name === 'menu');
    if (name === 'game') layout();
  }

  function openMenu() {
    flush();
    hideCard();
    renderMenu();
    showView('menu');
    window.scrollTo(0, 0);
  }

  function closeMenu() {
    if (!game.L) return startLevel(0);
    showView('game');
    if (game.over) (E.isWin(game.state) ? showWin : showStuck)();
  }

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  function renderMenu() {
    dom.chapters.innerHTML = '';
    let base = 0;
    CHAPTERS.forEach((chapter, c) => {
      const first = base;
      base += chapter.levels.length;
      const solved = chapter.levels.filter((_, i) => isSolved(first + i)).length;
      const el = document.createElement('section');
      el.className = 'chapter' + (isOpen(first) ? '' : ' locked');
      const kinds = chapter.pieces || 'K';
      const pieces = [...kinds]
        .map((k) => `<span class="rule-ill rule-ill--${{ K: 'knight', S: 'shadow', M: 'mirror' }[k]} chapter-piece">${knightSvg}</span>`)
        .join('');
      el.innerHTML = `
        <div class="chapter-head">
          <h3><span class="chapter-num">${ROMAN[c]}</span>${chapter.name}<span class="chapter-pieces">${pieces}</span></h3>
          <span class="chapter-progress">${solved} / ${chapter.levels.length}</span>
          <p>${chapter.blurb}</p>
        </div>
        <div class="level-grid"></div>`;
      const grid = el.querySelector('.level-grid');
      chapter.levels.forEach((_, i) => {
        const idx = first + i;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lv';
        const open = isOpen(idx);
        if (isSolved(idx)) b.classList.add('solved');
        if (game.mode === 'level' && idx === game.levelIndex && game.L) b.classList.add('current');
        b.disabled = !open;
        b.innerHTML = open ? String(i + 1) : icon('lock');
        b.setAttribute('aria-label', `${chapter.name} level ${i + 1}${isSolved(idx) ? ', solved' : open ? '' : ', locked'}`);
        b.addEventListener('click', () => startLevel(idx));
        grid.appendChild(b);
      });
      dom.chapters.appendChild(el);
    });

    dom.endlessModes.innerHTML = '';
    for (const mode of ENDLESS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode';
      const n = save.endless[mode.key] || 0;
      b.innerHTML = `<b>${mode.name}</b><span>${mode.blurb}${n ? ` · ${n} solved` : ''}</span>`;
      b.addEventListener('click', () => startEndless(mode.key));
      dom.endlessModes.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ wiring

  dom.tiles.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) onTile(Number(t.dataset.i));
  });

  dom.tiles.addEventListener('pointerover', (e) => {
    const t = e.target.closest('.tile.target');
    if (t && e.pointerType === 'mouse') showPreview(Number(t.dataset.i));
  });
  dom.tiles.addEventListener('pointerout', (e) => {
    const t = e.target.closest('.tile');
    if (t && !t.contains(e.relatedTarget) && e.pointerType === 'mouse') hidePreview();
  });
  dom.tiles.addEventListener('focusin', (e) => {
    const t = e.target.closest('.tile.target');
    if (t) showPreview(Number(t.dataset.i));
  });
  dom.tiles.addEventListener('focusout', hidePreview);

  // Touch: press and hold a target to preview where the echoes would go.
  dom.tiles.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const t = e.target.closest('.tile.target');
    if (!t || !game.L.echoes) return;
    clearTimeout(game.pressTimer);
    game.pressTimer = setTimeout(() => {
      game.suppressClick = true;
      showPreview(Number(t.dataset.i));
    }, 320);
  });
  const endPress = () => {
    clearTimeout(game.pressTimer);
    if (game.suppressClick) setTimeout(hidePreview, 350);
  };
  dom.tiles.addEventListener('pointerup', endPress);
  dom.tiles.addEventListener('pointercancel', () => {
    endPress();
    game.suppressClick = false;
  });
  dom.tiles.addEventListener('contextmenu', (e) => e.preventDefault());

  dom.undo.addEventListener('click', undo);
  dom.restart.addEventListener('click', restart);
  dom.hint.addEventListener('click', hint);
  dom.menu.addEventListener('click', () => (dom.viewMenu.hidden ? openMenu() : closeMenu()));
  $('brand').addEventListener('click', (e) => {
    e.preventDefault();
    openMenu();
  });
  dom.veil.addEventListener('click', (e) => {
    if (e.target === dom.veil && !E.isWin(game.state)) hideCard();
  });

  $('btn-help').addEventListener('click', () => dom.help.showModal());
  $('help-close').addEventListener('click', () => dom.help.close());
  dom.help.addEventListener('click', (e) => {
    if (e.target === dom.help) dom.help.close();
  });

  function syncSound() {
    dom.sound.innerHTML = icon(save.sound ? 'sound' : 'mute');
    dom.sound.setAttribute('aria-label', save.sound ? 'Sound on' : 'Sound off');
    dom.sound.setAttribute('aria-pressed', save.sound);
  }
  dom.sound.addEventListener('click', () => {
    save.sound = !save.sound;
    persist();
    syncSound();
    sfx.select();
  });

  document.addEventListener('keydown', (e) => {
    if (dom.help.open || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (dom.viewMenu.hidden) openMenu();
      else closeMenu();
      return;
    }
    if (!dom.viewGame.hidden && !e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' || e.key === 'Backspace') undo();
      else if (key === 'r') restart();
      else if (key === 'h') hint();
      else return;
      e.preventDefault();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !dom.viewGame.hidden) {
      e.preventDefault();
      undo();
    }
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 60);
  });

  // ------------------------------------------------------------------ start

  syncSound();
  let first = save.last;
  if (!(first >= 0 && first < LEVELS.length) || !isOpen(first) || isSolved(first)) {
    first = LEVELS.findIndex((_, i) => !isSolved(i) && isOpen(i));
    if (first < 0) first = 0;
  }
  startLevel(first);
})();
