// Shared test setup: loads the real card data and offers deck/game builders.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine/index.js';

const dataPath = fileURLToPath(new URL('../data/cards.json', import.meta.url));
export const CARD_DATA = JSON.parse(readFileSync(dataPath, 'utf8'));
E.initCards(CARD_DATA);
E.assertEffectCoverage();

export const engine = E;

/** A legal filler deck of vanilla cheap minions (2 copies of 15 cards). */
export function fillerDeck() {
  const vanilla = [
    'human_skeleton', 'goblin', 'manes', 'orc', 'lizardfolk', 'shambling_zombie',
    'worg', 'ogre_zombie', 'cave_bear', 'owlbear', 'goliath', 'clay_golem',
    'hill_giant', 'ettin', 'salamander',
  ];
  return vanilla.flatMap((id) => [id, id]);
}

/** Deck containing the given ids, padded with filler to 30 (still legal). */
export function deckWith(...ids) {
  const filler = fillerDeck();
  const deck = [...ids];
  while (deck.length < 30) deck.push(filler[deck.length - ids.length]);
  return deck.slice(0, 30);
}

export function newGame(opts = {}) {
  return E.createGame({
    seed: opts.seed ?? 42,
    first: opts.first ?? 'p1',
    p1: { name: 'Alice', deck: opts.p1Deck ?? fillerDeck(), heroPower: opts.p1Power ?? 'tinkers_ward' },
    p2: { name: 'Bob', deck: opts.p2Deck ?? fillerDeck(), heroPower: opts.p2Power ?? 'emberspark' },
  });
}

/* ---------------- direct-state helpers for focused tests ----------------
 * These bypass the action layer to set up scenarios, then tests exercise the
 * real applyAction() path. They keep the state valid.
 */

import { makeMinion, makeCardInstance } from '../src/engine/primitives.js';

/** Put a minion straight onto the board, ready to act. */
export function put(state, playerId, cardId, opts = {}) {
  const m = makeMinion(state, cardId, playerId, opts.overrides ?? {});
  m.sick = opts.sick ?? false;
  if (opts.frozen) m.frozen = opts.frozen;
  state.players[playerId].board.push(m);
  return m;
}

/** Put a card into hand and return its uid. */
export function give(state, playerId, cardId) {
  const inst = makeCardInstance(state, cardId);
  state.players[playerId].hand.push(inst);
  return inst;
}

/** Set available mana. */
export function setMana(state, playerId, n) {
  state.players[playerId].maxMana = Math.max(n, state.players[playerId].maxMana);
  state.players[playerId].mana = n;
}

export function mref(m) {
  return { kind: 'minion', player: m.controller, uid: m.uid };
}

export function href(playerId) {
  return { kind: 'hero', player: playerId };
}
