// Game state construction and invariant validation. The state is a single
// JSON-serializable object; applyAction() (actions.js) validates it after
// every action so a corrupt in-between state fails loudly instead of leaking
// into the next action.

import { getCard, getHeroPower, hasCard } from './cards.js';
import { HAND_LIMIT, BOARD_LIMIT, HERO_MAX_HP, makeCardInstance, verb } from './primitives.js';
import { seedRng, shuffle } from './rng.js';

export const DECK_SIZE = 30;
export const MAX_COPIES = 2;
export const MAX_LEGENDARY_COPIES = 1;

/** Throws if `cardIds` isn't a legal 30-card deck. */
export function validateDeck(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length !== DECK_SIZE) {
    throw new Error(`a deck must contain exactly ${DECK_SIZE} cards`);
  }
  const counts = new Map();
  for (const id of cardIds) {
    const card = getCard(id);
    if (card.token) throw new Error(`${id} is a token and can't be in a deck`);
    counts.set(id, (counts.get(id) || 0) + 1);
    const limit = card.legendary ? MAX_LEGENDARY_COPIES : MAX_COPIES;
    if (counts.get(id) > limit) {
      throw new Error(`too many copies of ${card.name} (limit ${limit})`);
    }
  }
}

function makePlayer(state, id, cfg) {
  validateDeck(cfg.deck);
  getHeroPower(cfg.heroPower); // validates
  const p = {
    id,
    name: cfg.name || id,
    hero: { hp: HERO_MAX_HP, armor: 0 },
    heroPower: cfg.heroPower,
    heroPowerUsed: false,
    heroAttacksUsed: 0,
    weapon: null, // {name, atk, durability}
    deck: [],
    hand: [],
    board: [],
    graveyard: [],
    mana: 0,
    maxMana: 0,
    fatigue: 0,
    coinsEarned: 0, // in-game coin grants (Leprechaun) credited to the profile at game end
  };
  state.players[id] = p;
  p.deck = cfg.deck.map((cardId) => makeCardInstance(state, cardId));
  shuffle(state, p.deck);
  return p;
}

/**
 * config: {
 *   seed: number,
 *   p1: { name, deck: [cardId x30], heroPower },
 *   p2: { name, deck: [cardId x30], heroPower },
 *   first: 'p1' | 'p2'   (default 'p1')
 * }
 */
export function createGame(config) {
  const first = config.first ?? 'p1';
  const state = {
    version: 1,
    seed: config.seed >>> 0,
    rngState: seedRng(config.seed),
    uidCounter: 0,
    turnNumber: 1,
    active: first,
    players: {},
    winner: null,
    pendingChoice: null, // {player, kind:'pick-card', options:[cardId], uids:[deckUid], prompt}
    delayed: [], // {player, effect: 'blade_barrier'}
    log: [],
  };
  makePlayer(state, 'p1', config.p1);
  makePlayer(state, 'p2', config.p2);

  const second = first === 'p1' ? 'p2' : 'p1';
  for (let i = 0; i < 3; i++) state.players[first].hand.push(state.players[first].deck.pop());
  for (let i = 0; i < 4; i++) state.players[second].hand.push(state.players[second].deck.pop());

  const fp = state.players[first];
  fp.maxMana = 1;
  fp.mana = 1;
  state.log.push({ turn: 1, text: `${verb(fp.name, 'goes')} first.` });
  return state;
}

/* ---------------- invariants ---------------- */

const HERO_KEYS = new Set(['hp', 'armor']);
const PLAYER_IDS = ['p1', 'p2'];

function fail(msg) {
  throw new Error(`invalid state: ${msg}`);
}

/**
 * Structural invariants, checked after every action. This is the guard
 * against the prototype's class of bugs: lingering selection state and
 * mutated hero objects can't survive a validation pass.
 */
export function validateState(state) {
  if (!PLAYER_IDS.includes(state.active)) fail(`bad active player ${state.active}`);
  if (![null, 'p1', 'p2', 'draw'].includes(state.winner)) fail(`bad winner ${state.winner}`);
  if (!Number.isInteger(state.rngState)) fail('rng state must be an integer');

  const uids = new Set();
  const seen = (uid, where) => {
    if (uids.has(uid)) fail(`duplicate uid ${uid} in ${where}`);
    uids.add(uid);
  };

  for (const pid of PLAYER_IDS) {
    const p = state.players[pid];
    if (!p) fail(`missing player ${pid}`);

    for (const key of Object.keys(p.hero)) {
      if (!HERO_KEYS.has(key)) fail(`hero of ${pid} carries a foreign key "${key}"`);
    }
    if (!Number.isInteger(p.hero.hp) || p.hero.hp > HERO_MAX_HP) fail(`${pid} hero hp out of range: ${p.hero.hp}`);
    if (!Number.isInteger(p.hero.armor) || p.hero.armor < 0) fail(`${pid} armor out of range`);

    if (!Number.isInteger(p.mana) || p.mana < 0 || p.mana > p.maxMana) fail(`${pid} mana ${p.mana}/${p.maxMana} out of range`);
    if (p.maxMana < 0 || p.maxMana > 10) fail(`${pid} maxMana out of range`);
    if (p.hand.length > HAND_LIMIT) fail(`${pid} hand over limit`);
    if (p.board.length > BOARD_LIMIT) fail(`${pid} board over limit`);
    if (p.weapon && (p.weapon.durability <= 0 || p.weapon.atk <= 0)) fail(`${pid} carries a broken weapon`);

    for (const c of [...p.hand, ...p.deck]) {
      seen(c.uid, `${pid} hand/deck`);
      if (!hasCard(c.cardId)) fail(`unknown card ${c.cardId} in ${pid} hand/deck`);
      if (!Number.isInteger(c.costDelta)) fail(`card ${c.uid} has bad costDelta`);
    }
    for (const m of p.board) {
      seen(m.uid, `${pid} board`);
      if (!hasCard(m.cardId)) fail(`unknown minion card ${m.cardId}`);
      if (m.controller !== pid) fail(`minion ${m.uid} on ${pid} board thinks its controller is ${m.controller}`);
      if (!PLAYER_IDS.includes(m.originalOwner)) fail(`minion ${m.uid} has bad originalOwner`);
      if (state.winner === null && m.hp <= 0) fail(`dead minion ${m.uid} left on board`);
      if (m.hp > m.maxHp) fail(`minion ${m.uid} hp ${m.hp} above max ${m.maxHp}`);
      if (m.atk < 0) fail(`minion ${m.uid} negative attack`);
      if (![0, 1, 2].includes(m.frozen)) fail(`minion ${m.uid} bad frozen counter`);
      if (m.attacksUsed < 0) fail(`minion ${m.uid} negative attacksUsed`);
      if (m.stolenUntilEndOfTurn && m.originalOwner === m.controller) {
        fail(`minion ${m.uid} marked stolen but controlled by its owner`);
      }
    }
    for (const g of p.graveyard) {
      if (!hasCard(g)) fail(`unknown card ${g} in ${pid} graveyard`);
    }
  }

  if (state.pendingChoice) {
    const pc = state.pendingChoice;
    if (!PLAYER_IDS.includes(pc.player)) fail('pendingChoice has no valid player');
    if (!Array.isArray(pc.options) || pc.options.length === 0) fail('pendingChoice with no options');
  }
  for (const d of state.delayed) {
    if (!PLAYER_IDS.includes(d.player)) fail('delayed effect with bad player');
  }
  return true;
}
