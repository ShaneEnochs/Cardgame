// AI-vs-AI integration harness. Full games are played through the real
// applyAction path (which validates state after every action), with deck sets
// that collectively contain every collectible card in the set — so nearly
// every effect gets exercised in real play across the seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine as E, put } from './helpers.js';
import { chooseAiAction } from '../src/engine/ai.js';
import { nextFloat } from '../src/engine/rng.js';

const POWERS = ['tinkers_ward', 'emberspark', 'mending_hand', 'bone_call', 'scavenge', 'forge_blade', 'warp_step'];

function rngFrom(seed) {
  const box = { rngState: seed >>> 0 };
  return () => nextFloat(box);
}

/** Chunk every collectible card into legal 30-card decks (full set coverage). */
function coverageDecks() {
  const ids = E.collectibleCards().map((c) => c.id);
  const decks = [];
  for (let i = 0; i < ids.length; i += 30) decks.push(ids.slice(i, i + 30));
  const last = decks[decks.length - 1];
  const inLast = new Set(last);
  for (const id of ids) {
    if (last.length >= 30) break;
    if (inLast.has(id)) continue;
    const card = E.getCard(id);
    if (card.legendary) continue; // already one copy elsewhere is fine, but keep it simple
    last.push(id);
    inLast.add(id);
  }
  return decks.filter((d) => d.length === 30);
}

function randomDeck(rand) {
  const pool = E.collectibleCards().map((c) => c.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const deck = [];
  for (const id of pool) {
    if (deck.length >= 30) break;
    const copies = E.getCard(id).legendary ? 1 : rand() < 0.5 ? 2 : 1;
    for (let k = 0; k < copies && deck.length < 30; k++) deck.push(id);
  }
  return deck;
}

function playGame({ seed, p1Deck, p2Deck, p1Power, p2Power }) {
  let state = E.createGame({
    seed,
    p1: { name: 'Bot-1', deck: p1Deck, heroPower: p1Power },
    p2: { name: 'Bot-2', deck: p2Deck, heroPower: p2Power },
  });
  let steps = 0;
  while (state.winner === null) {
    steps += 1;
    assert.ok(steps < 3000, `game did not terminate (seed ${seed})`);
    const action = chooseAiAction(state);
    assert.ok(action, `AI returned no action in a live game (seed ${seed})`);
    state = E.applyAction(state, action); // validates state internally
  }
  return { state, steps };
}

test('coverage decks: AI vs AI games over the whole card pool terminate cleanly', () => {
  const decks = coverageDecks();
  assert.ok(decks.length >= 9, 'expected the pool to span at least 9 decks');
  const results = [];
  for (let i = 0; i < decks.length; i++) {
    const a = decks[i];
    const b = decks[(i + 1) % decks.length];
    const { state } = playGame({
      seed: 1000 + i,
      p1Deck: a,
      p2Deck: b,
      p1Power: POWERS[i % POWERS.length],
      p2Power: POWERS[(i + 3) % POWERS.length],
    });
    results.push(state.winner);
  }
  assert.ok(results.every((w) => ['p1', 'p2', 'draw'].includes(w)));
});

test('random-deck AI games across seeds stay legal and finish', () => {
  let wins = { p1: 0, p2: 0, draw: 0 };
  for (let g = 0; g < 20; g++) {
    const rand = rngFrom(777 + g * 13);
    const { state } = playGame({
      seed: 555 + g,
      p1Deck: randomDeck(rand),
      p2Deck: randomDeck(rand),
      p1Power: POWERS[Math.floor(rand() * POWERS.length)],
      p2Power: POWERS[Math.floor(rand() * POWERS.length)],
    });
    wins[state.winner] += 1;
  }
  assert.equal(wins.p1 + wins.p2 + wins.draw, 20);
  // Both sides should win sometimes — a 20-0 sweep would mean the AI or the
  // turn structure is broken for one seat.
  assert.ok(wins.p1 > 0 && wins.p2 > 0, `suspicious sweep: ${JSON.stringify(wins)}`);
});

test('the AI respects taunt and never emits an attack on a guarded hero', () => {
  const s = E.createGame({
    seed: 9,
    p1: { name: 'Bot', deck: coverageDecks()[0], heroPower: 'tinkers_ward' },
    p2: { name: 'Wall', deck: coverageDecks()[1], heroPower: 'tinkers_ward' },
  });
  s.players.p1.hand = [];
  s.players.p1.mana = 0;
  put(s, 'p1', 'worg');
  put(s, 'p2', 'dretch'); // taunt
  put(s, 'p2', 'goblin');

  // Drive the AI through its whole turn: any attack it emits must be legal
  // (applyAction throws otherwise) and must never point at the hero.
  let state = s;
  for (let i = 0; i < 20; i++) {
    const action = chooseAiAction(state);
    if (action.type === 'endTurn') break;
    if (action.type === 'attack') {
      assert.notEqual(action.target.kind, 'hero', 'attacked face through a taunt');
    }
    state = E.applyAction(state, action);
  }
});
