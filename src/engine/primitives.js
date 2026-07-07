// Effect primitives. Everything here operates on the game state through plain
// target descriptors ({kind:'hero'|'minion', player, uid}) — hero objects are
// never mutated with flags and no live object references cross action
// boundaries. Deaths are processed explicitly via processDeaths(), never as a
// side effect hidden inside damage application.

import { getCard } from './cards.js';
import { effectOf } from './registry.js';
import { pick, randInt } from './rng.js';

export const HERO_MAX_HP = 30;
export const BOARD_LIMIT = 7;
export const HAND_LIMIT = 10;

/* ---------------- refs and lookups ---------------- */

export function heroRef(playerId) {
  return { kind: 'hero', player: playerId };
}

export function minionRef(m) {
  return { kind: 'minion', player: m.controller, uid: m.uid };
}

export function otherPlayer(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

/** Resolve a minion ref to its live instance, or null if it left play. */
export function findMinion(state, ref) {
  if (!ref || ref.kind !== 'minion') return null;
  for (const pid of ['p1', 'p2']) {
    const m = state.players[pid].board.find((x) => x.uid === ref.uid);
    if (m) return m;
  }
  return null;
}

export function log(state, text) {
  state.log.push({ turn: state.turnNumber, text });
  if (state.log.length > 250) state.log.shift();
}

/* ---------------- instance construction ---------------- */

export function newUid(state, prefix) {
  state.uidCounter += 1;
  return `${prefix}${state.uidCounter}`;
}

export function makeCardInstance(state, cardId) {
  getCard(cardId); // validates
  return { uid: newUid(state, 'c'), cardId, costDelta: 0 };
}

export function makeMinion(state, cardId, controller, overrides = {}) {
  const card = getCard(cardId);
  if (card.type !== 'minion') throw new Error(`${cardId} is not a minion`);
  const atk = overrides.atk ?? card.atk;
  const hp = overrides.hp ?? card.hp;
  const m = {
    uid: newUid(state, 'm'),
    cardId,
    controller,
    originalOwner: controller,
    atk,
    hp,
    maxHp: hp,
    keywords: [...card.keywords],
    ward: card.keywords.includes('ward'),
    sick: true,
    attacksUsed: 0,
    frozen: 0,
    silenced: false,
    elusive: null, // null | 'until-attack' | 'turn'
    noTargetSpells: false, // Tarrasque-style: spells/hero powers can't target
    tempAtk: 0, // net delta that expires at end of the current turn
    tempKeywords: [],
    stolenUntilEndOfTurn: false,
    damagedThisTurn: false,
    lastDamagedBy: null, // {kind:'minion', uid} | {kind:'hero', player} — for magmin/nosferatu
  };
  // Static flags (e.g. Tarrasque's spell-immunity) apply however the minion
  // enters play — played, summoned, resurrected or transformed.
  effectOf(cardId)?.spawn?.({ state, self: m });
  return m;
}

export function minionHasKeyword(m, kw) {
  return m.keywords.includes(kw) || m.tempKeywords.includes(kw);
}

/* ---------------- summoning ---------------- */

/**
 * Summon a minion for `controller`. Returns the instance or null if the board
 * is full. `position` inserts at an index (deathrattles summon where the
 * minion died); default appends to the right end.
 */
export function summon(state, controller, cardId, { position = null, overrides = {}, asleep = true } = {}) {
  const board = state.players[controller].board;
  if (board.length >= BOARD_LIMIT) {
    log(state, `${getCard(cardId).name} can't be summoned — the board is full.`);
    return null;
  }
  const m = makeMinion(state, cardId, controller, overrides);
  if (!asleep) m.sick = false;
  const at = position === null ? board.length : Math.min(position, board.length);
  board.splice(at, 0, m);
  return m;
}

/* ---------------- damage / healing ---------------- */

/**
 * Deal damage to a target descriptor. Handles ward, armor, freeze-on-damage,
 * lifesteal and the survive-damage retaliation trigger. Does NOT remove dead
 * minions — callers run processDeaths() after the step completes.
 * Returns the damage actually applied to hp/armor (0 if warded or dead ref).
 */
export function dealDamage(state, targetRef, amount, sourceRef = null) {
  if (amount <= 0) return 0;
  const srcMinion = sourceRef ? findMinion(state, sourceRef) : null;

  let dealt = 0;
  if (targetRef.kind === 'hero') {
    const hero = state.players[targetRef.player].hero;
    const absorbed = Math.min(hero.armor, amount);
    hero.armor -= absorbed;
    hero.hp -= amount - absorbed;
    // Armor absorbs, but the full amount counts as dealt for lifesteal.
    dealt = amount;
  } else {
    const m = findMinion(state, targetRef);
    if (!m || m.hp <= 0) return 0;
    if (m.ward) {
      m.ward = false;
      log(state, `${getCard(m.cardId).name}'s ward shatters.`);
      return 0;
    }
    m.hp -= amount;
    m.damagedThisTurn = true;
    m.lastDamagedBy = sourceRef ? { ...sourceRef } : null;
    dealt = amount;

    // Freeze-on-damage keyword on the source minion.
    if (srcMinion && minionHasKeyword(srcMinion, 'freeze') && !srcMinion.silenced) {
      freezeMinion(state, targetRef, 1);
    }
    // Survive-damage retaliation (Barbed Devil). Bounded: every bounce costs hp.
    const def = effectOf(m.cardId);
    if (def?.retaliate && !m.silenced && m.hp > 0 && sourceRef) {
      const back = def.retaliate;
      log(state, `${getCard(m.cardId).name} lashes back for ${back}.`);
      dealDamage(state, sourceRef, back, minionRef(m));
    }
  }

  // Lifesteal heals the source minion's controller.
  if (dealt > 0 && srcMinion && minionHasKeyword(srcMinion, 'lifesteal') && !srcMinion.silenced) {
    heal(state, heroRef(srcMinion.controller), dealt);
  }
  return dealt;
}

export function heal(state, targetRef, amount) {
  if (amount <= 0) return 0;
  if (targetRef.kind === 'hero') {
    const hero = state.players[targetRef.player].hero;
    const healed = Math.min(amount, HERO_MAX_HP - hero.hp);
    hero.hp += healed;
    return healed;
  }
  const m = findMinion(state, targetRef);
  if (!m) return 0;
  const healed = Math.min(amount, m.maxHp - m.hp);
  m.hp += healed;
  return healed;
}

export function gainArmor(state, playerId, amount) {
  state.players[playerId].hero.armor += amount;
}

/* ---------------- deaths ---------------- */

/**
 * Remove dead minions and fire their deathrattles until the board is stable.
 * Active player's minions resolve first, in board order — deterministic.
 */
export function processDeaths(state) {
  for (let guard = 0; guard < 100; guard++) {
    const dead = [];
    for (const pid of [state.active, otherPlayer(state.active)]) {
      for (const m of state.players[pid].board) {
        if (m.hp <= 0) dead.push(m);
      }
    }
    if (dead.length === 0) return;

    for (const m of dead) {
      const board = state.players[m.controller].board;
      const idx = board.indexOf(m);
      if (idx === -1) continue; // already removed this sweep (shouldn't happen)
      board.splice(idx, 1);
      state.players[m.controller].graveyard.push(m.cardId);
      log(state, `${getCard(m.cardId).name} is destroyed.`);

      // Kill credit (Nosferatu-style triggers).
      const killer = m.lastDamagedBy ? findMinion(state, m.lastDamagedBy) : null;
      if (killer && killer.hp > 0 && !killer.silenced) {
        const kdef = effectOf(killer.cardId);
        if (kdef?.onKill) kdef.onKill({ state, self: killer, victim: m });
      }

      if (!m.silenced) {
        const def = effectOf(m.cardId);
        if (def?.deathrattle) {
          def.deathrattle({ state, self: m, controller: m.controller, position: idx });
        }
      }
    }
  }
  throw new Error('death processing did not converge');
}

/** Destroy outright (no damage step). Deathrattles still fire. */
export function destroyMinion(state, ref) {
  const m = findMinion(state, ref);
  if (!m) return;
  m.hp = 0;
  m.ward = false;
}

/* ---------------- hand / deck ---------------- */

export function drawCard(state, playerId, count = 1) {
  const p = state.players[playerId];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      p.fatigue += 1;
      log(state, `${p.name} draws from an empty deck — ${p.fatigue} fatigue damage.`);
      dealDamage(state, heroRef(playerId), p.fatigue);
      continue;
    }
    const c = p.deck.pop();
    if (p.hand.length >= HAND_LIMIT) {
      log(state, `${p.name}'s hand is full — ${getCard(c.cardId).name} burns away.`);
      continue;
    }
    p.hand.push(c);
  }
}

/** Add a fresh copy of a card to hand (burned if the hand is full). */
export function addToHand(state, playerId, cardId) {
  const p = state.players[playerId];
  if (p.hand.length >= HAND_LIMIT) {
    log(state, `${p.name}'s hand is full — ${getCard(cardId).name} burns away.`);
    return null;
  }
  const inst = makeCardInstance(state, cardId);
  p.hand.push(inst);
  return inst;
}

export function discardRandom(state, playerId) {
  const p = state.players[playerId];
  if (p.hand.length === 0) return null;
  const idx = randInt(state, p.hand.length);
  const [c] = p.hand.splice(idx, 1);
  log(state, `${p.name} discards ${getCard(c.cardId).name}.`);
  return c;
}

export function discardLowestCost(state, playerId) {
  const p = state.players[playerId];
  if (p.hand.length === 0) return null;
  const lowest = Math.min(...p.hand.map((c) => getCard(c.cardId).cost));
  const candidates = p.hand.filter((c) => getCard(c.cardId).cost === lowest);
  const c = pick(state, candidates);
  p.hand.splice(p.hand.indexOf(c), 1);
  log(state, `${p.name} discards ${getCard(c.cardId).name}.`);
  return c;
}

/** Return a board minion to its current controller's hand as a fresh card. */
export function bounceToHand(state, ref, { costDelta = 0 } = {}) {
  const m = findMinion(state, ref);
  if (!m) return;
  const board = state.players[m.controller].board;
  board.splice(board.indexOf(m), 1);
  const p = state.players[m.controller];
  if (p.hand.length >= HAND_LIMIT) {
    log(state, `${p.name}'s hand is full — ${getCard(m.cardId).name} is destroyed instead.`);
    state.players[m.controller].graveyard.push(m.cardId);
    return;
  }
  const inst = makeCardInstance(state, m.cardId);
  inst.costDelta = costDelta;
  p.hand.push(inst);
  log(state, `${getCard(m.cardId).name} returns to ${p.name}'s hand.`);
}

/* ---------------- stat changes / status ---------------- */

export function buff(state, ref, atk, hp) {
  const m = findMinion(state, ref);
  if (!m) return;
  m.atk = Math.max(0, m.atk + atk);
  if (hp > 0) {
    m.maxHp += hp;
    m.hp += hp;
  } else if (hp < 0) {
    // A -X health debuff lowers the ceiling; current hp is clamped to it
    // (existing damage is kept, a 0 ceiling kills).
    m.maxHp = Math.max(0, m.maxHp + hp);
    m.hp = Math.min(m.hp, m.maxHp);
  }
}

/** Attack change that expires at the end of the current turn. */
export function tempAtkChange(state, ref, delta) {
  const m = findMinion(state, ref);
  if (!m) return;
  const applied = Math.max(0, m.atk + delta) - m.atk;
  m.atk += applied;
  m.tempAtk += applied;
}

export function grantTempKeyword(state, ref, kw) {
  const m = findMinion(state, ref);
  if (!m) return;
  if (!minionHasKeyword(m, kw)) m.tempKeywords.push(kw);
}

export function grantKeyword(state, ref, kw) {
  const m = findMinion(state, ref);
  if (!m) return;
  if (!m.keywords.includes(kw)) m.keywords.push(kw);
  if (kw === 'ward') m.ward = true;
}

export function freezeMinion(state, ref, turns = 1) {
  const m = findMinion(state, ref);
  if (!m) return;
  m.frozen = Math.max(m.frozen, turns);
}

/**
 * Silence: back to printed stats (damage kept), no keywords, no text effects,
 * thawed, targetable again.
 */
export function silenceMinion(state, ref) {
  const m = findMinion(state, ref);
  if (!m) return;
  const card = getCard(m.cardId);
  const damage = m.maxHp - m.hp;
  m.keywords = [];
  m.tempKeywords = [];
  m.ward = false;
  m.silenced = true;
  m.frozen = 0;
  m.elusive = null;
  m.noTargetSpells = false;
  m.tempAtk = 0;
  m.atk = card.atk;
  m.maxHp = card.hp;
  m.hp = Math.max(1, m.maxHp - Math.min(damage, m.maxHp - 1));
  log(state, `${card.name} is silenced.`);
}

/* ---------------- control ---------------- */

/**
 * Move a minion to the other side. Permanent steals arrive asleep; temporary
 * ones (until end of turn) arrive ready and are handed back at end of turn.
 */
export function takeControl(state, ref, newController, { untilEndOfTurn = false } = {}) {
  const m = findMinion(state, ref);
  if (!m || m.controller === newController) return false;
  const to = state.players[newController].board;
  if (to.length >= BOARD_LIMIT) {
    log(state, `${state.players[newController].name}'s board is full — control doesn't change.`);
    return false;
  }
  const from = state.players[m.controller].board;
  from.splice(from.indexOf(m), 1);
  m.controller = newController;
  to.push(m);
  if (untilEndOfTurn) {
    m.stolenUntilEndOfTurn = true;
    m.sick = false;
    m.attacksUsed = 0;
  } else {
    m.stolenUntilEndOfTurn = false;
    m.sick = !(minionHasKeyword(m, 'charge') || minionHasKeyword(m, 'haste'));
    m.attacksUsed = 0;
  }
  log(state, `${getCard(m.cardId).name} switches sides.`);
  return true;
}

/** Replace a minion with a token (Polymorph). Not a death: no deathrattle. */
export function transformMinion(state, ref, intoCardId) {
  const m = findMinion(state, ref);
  if (!m) return;
  const board = state.players[m.controller].board;
  const idx = board.indexOf(m);
  const fresh = makeMinion(state, intoCardId, m.controller);
  fresh.sick = m.sick;
  board.splice(idx, 1, fresh);
  log(state, `${getCard(m.cardId).name} is transformed into ${getCard(intoCardId).name}.`);
}

/* ---------------- random target helpers ---------------- */

export function livingMinions(state, playerId) {
  return state.players[playerId].board.filter((m) => m.hp > 0);
}

/** All enemy character refs (hero + living minions) from `playerId`'s view. */
export function enemyCharacterRefs(state, playerId) {
  const opp = otherPlayer(playerId);
  return [heroRef(opp), ...livingMinions(state, opp).map(minionRef)];
}

export function randomEnemyCharacter(state, playerId) {
  return pick(state, enemyCharacterRefs(state, playerId)) ?? null;
}

export function randomEnemyMinion(state, playerId) {
  const list = livingMinions(state, otherPlayer(playerId)).map(minionRef);
  return pick(state, list) ?? null;
}

/** Deal `pellets` × `each` damage to random enemies, re-rolling per pellet. */
export function splitDamageAmongEnemies(state, playerId, pellets, each, sourceRef = null) {
  for (let i = 0; i < pellets; i++) {
    const t = randomEnemyCharacter(state, playerId);
    if (!t) return;
    dealDamage(state, t, each, sourceRef);
  }
}

export function damageAllEnemyMinions(state, playerId, amount, sourceRef = null) {
  for (const m of livingMinions(state, otherPlayer(playerId))) {
    dealDamage(state, minionRef(m), amount, sourceRef);
  }
}

export function damageAllMinions(state, amount, sourceRef = null) {
  for (const pid of ['p1', 'p2']) {
    for (const m of livingMinions(state, pid)) {
      dealDamage(state, minionRef(m), amount, sourceRef);
    }
  }
}

export function damageAllEnemies(state, playerId, amount, sourceRef = null) {
  dealDamage(state, heroRef(otherPlayer(playerId)), amount, sourceRef);
  damageAllEnemyMinions(state, playerId, amount, sourceRef);
}
