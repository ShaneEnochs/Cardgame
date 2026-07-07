// Player profile: coins, collection, decks, stats. Persisted through an
// injected storage adapter (localStorage in the browser, a plain object in
// tests) so the whole meta layer runs headless under node --test.

import { getCard, allHeroPowers } from '../engine/cards.js';
import { validateDeck, DECK_SIZE, MAX_COPIES, MAX_LEGENDARY_COPIES } from '../engine/state.js';

export const STORAGE_KEY = 'forgebound.profile.v1';

/** The deck every new profile starts with (legal, curve-y, no legendaries). */
export const STARTER_DECK = {
  name: 'First March',
  heroPower: 'emberspark',
  cards: [
    'human_skeleton', 'human_skeleton',
    'merfolk', 'merfolk',
    'spark_bolt', 'spark_bolt',
    'bless', 'bless',
    'red_wyrmling', 'red_wyrmling',
    'shambling_zombie', 'shambling_zombie',
    'firebolt', 'firebolt',
    'guard_drake', 'guard_drake',
    'worg', 'worg',
    'fire_drake', 'fire_drake',
    'cave_bear', 'cave_bear',
    'clay_golem', 'clay_golem',
    'hill_giant', 'hill_giant',
    'salamander', 'salamander',
    'roc', 'roc',
  ],
};

/** Extra cards beyond the starter deck so deckbuilding has room to breathe. */
const STARTER_EXTRAS = [
  'dretch', 'dire_wolf', 'water_elemental', 'flesh_golem', 'cure_wounds',
  'lightning_storm', 'wight', 'giant_spider', 'hippogriff', 'draught_insight',
];

export const REWARDS = {
  aiWin: 60,
  aiLoss: 20,
  hotseat: 30, // both seats share the one local profile
};

export const PACK_COST = 100;
export const PACK_SIZE = 5;
export const LEGENDARY_CHANCE = 0.08;

function starterCollection() {
  const collection = {};
  for (const id of STARTER_DECK.cards) collection[id] = (collection[id] ?? 0) + 1;
  for (const id of STARTER_EXTRAS) collection[id] = (collection[id] ?? 0) + 2;
  return collection;
}

export function newProfile() {
  return {
    version: 1,
    coins: 150,
    collection: starterCollection(),
    decks: [
      {
        id: 'starter',
        name: STARTER_DECK.name,
        heroPower: STARTER_DECK.heroPower,
        cards: [...STARTER_DECK.cards],
      },
    ],
    stats: { wins: 0, losses: 0, draws: 0, games: 0 },
  };
}

export function createProfileStore(storage) {
  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return save(newProfile());
      const profile = JSON.parse(raw);
      if (profile.version !== 1) return save(newProfile()); // future: migrations
      return profile;
    } catch {
      return save(newProfile());
    }
  }

  function save(profile) {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  return { load, save };
}

/* ---------------- collection / decks ---------------- */

export function ownedCount(profile, cardId) {
  return profile.collection[cardId] ?? 0;
}

export function addToCollection(profile, cardIds) {
  for (const id of cardIds) {
    profile.collection[id] = (profile.collection[id] ?? 0) + 1;
  }
}

/** Deck legality within a profile: engine rules + you must own the copies. */
export function validateProfileDeck(profile, cards) {
  validateDeck(cards);
  const counts = new Map();
  for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > ownedCount(profile, id)) {
      throw new Error(`you own ${ownedCount(profile, id)} cop${ownedCount(profile, id) === 1 ? 'y' : 'ies'} of ${getCard(id).name}, deck needs ${n}`);
    }
  }
}

export function saveDeck(profile, { id = null, name, heroPower, cards }) {
  validateProfileDeck(profile, cards);
  if (!allHeroPowers().some((p) => p.id === heroPower)) throw new Error(`unknown hero power ${heroPower}`);
  if (!name || !name.trim()) throw new Error('a deck needs a name');
  const deck = { id: id ?? `deck_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`, name: name.trim(), heroPower, cards: [...cards] };
  const at = profile.decks.findIndex((d) => d.id === deck.id);
  if (at === -1) profile.decks.push(deck);
  else profile.decks[at] = deck;
  return deck;
}

export function deleteDeck(profile, deckId) {
  if (profile.decks.length <= 1) throw new Error('keep at least one deck');
  profile.decks = profile.decks.filter((d) => d.id !== deckId);
}

/* ---------------- economy ---------------- */

/**
 * Apply a finished game to the profile. `mode` is 'ai' | 'hotseat';
 * `outcome` is 'win' | 'loss' | 'draw' from the profile owner's perspective
 * (hot-seat games always count as the flat shared reward).
 * `bonusCoins` carries in-game coin grants (Leprechaun).
 */
export function applyGameResult(profile, { mode, outcome, bonusCoins = 0 }) {
  let earned = bonusCoins;
  profile.stats.games += 1;
  if (mode === 'hotseat') {
    // Both seats share this profile, so hot-seat pays a flat reward and
    // doesn't touch the personal win/loss record.
    earned += REWARDS.hotseat;
  } else {
    earned += outcome === 'win' ? REWARDS.aiWin : REWARDS.aiLoss;
    if (outcome === 'win') profile.stats.wins += 1;
    else if (outcome === 'loss') profile.stats.losses += 1;
    else profile.stats.draws += 1;
  }
  profile.coins += earned;
  return earned;
}

export { DECK_SIZE, MAX_COPIES, MAX_LEGENDARY_COPIES };
