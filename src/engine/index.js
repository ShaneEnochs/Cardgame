// Public engine surface. Importing this module registers all card effects.
import './effects.js';

export { initCards, getCard, getHeroPower, allCards, allHeroPowers, collectibleCards, keywordCosts, tribes } from './cards.js';
export { createGame, validateState, validateDeck, DECK_SIZE, MAX_COPIES, MAX_LEGENDARY_COPIES } from './state.js';
export {
  applyAction,
  IllegalAction,
  effectiveCost,
  legalTargetsForCard,
  legalTargetsForHeroPower,
  legalAttackTargets,
  canMinionAttack,
  canHeroAttack,
} from './actions.js';
export { heroRef, minionRef, otherPlayer, findMinion, HERO_MAX_HP, BOARD_LIMIT, HAND_LIMIT } from './primitives.js';
export { assertEffectCoverage } from './effects.js';
export { effectOf, heroPowerEffectOf } from './registry.js';
