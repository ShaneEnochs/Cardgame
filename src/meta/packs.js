// The shop: randomized 5-card packs bought with coins.
import { collectibleCards } from '../engine/cards.js';
import { PACK_COST, PACK_SIZE, LEGENDARY_CHANCE, addToCollection } from './profile.js';

/**
 * Roll a pack's contents. `rand` is injectable for tests (defaults to
 * Math.random — pack contents are the one place true randomness is wanted).
 */
export function rollPack(rand = Math.random) {
  const pool = collectibleCards();
  const legendaries = pool.filter((c) => c.legendary);
  const commons = pool.filter((c) => !c.legendary);
  const cards = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const from = rand() < LEGENDARY_CHANCE ? legendaries : commons;
    cards.push(from[Math.floor(rand() * from.length)].id);
  }
  return cards;
}

/** Buy and open a pack. Mutates the profile; caller persists it. */
export function buyPack(profile, rand = Math.random) {
  if (profile.coins < PACK_COST) throw new Error(`a pack costs ${PACK_COST} coins`);
  profile.coins -= PACK_COST;
  const cards = rollPack(rand);
  addToCollection(profile, cards);
  return cards;
}

export { PACK_COST, PACK_SIZE };
