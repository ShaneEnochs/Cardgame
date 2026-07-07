// The action layer. The engine only ever receives *complete* actions
// ({type, ...refs}); picking a card and then choosing its target is UI-side
// state that never touches the game state. applyAction() clones, validates
// legality, applies, processes deaths, checks the winner, then runs the
// structural validator — an action either fully happens or throws.

import { getCard, getHeroPower } from './cards.js';
import { effectOf, heroPowerEffectOf } from './registry.js';
import {
  BOARD_LIMIT,
  dealDamage,
  drawCard,
  findMinion,
  heroRef,
  log,
  makeMinion,
  minionHasKeyword,
  minionRef,
  otherPlayer,
  poss,
  processDeaths,
  verb,
} from './primitives.js';
import { validateState } from './state.js';

export class IllegalAction extends Error {}

function illegal(msg) {
  throw new IllegalAction(msg);
}

/* ---------------- costs and auras ---------------- */

/** Effective mana cost of a card instance in hand (auras + cost riders). */
export function effectiveCost(state, playerId, cardInst) {
  const card = getCard(cardInst.cardId);
  let cost = card.cost + cardInst.costDelta;
  if (card.tribe === 'Dragon') {
    // Ancient Red Dragon aura: your Dragons cost (1) less per copy in play.
    for (const m of state.players[playerId].board) {
      if (m.cardId === 'ancient_red' && !m.silenced) cost -= 1;
    }
  }
  return Math.max(0, cost);
}

/* ---------------- targeting ---------------- */

/**
 * A target spec describes what an effect may point at:
 *   { side: 'any'|'enemy'|'friendly', kinds: ['minion','hero'], filter? }
 * Specs may also be a function (state, playerId) => spec|null for cards whose
 * targeting depends on board state (e.g. Rust Monster).
 */
export function resolveTargetSpec(spec, state, playerId) {
  if (!spec) return null;
  return typeof spec === 'function' ? spec(state, playerId) : spec;
}

/**
 * Candidates for a spec. `sourceType` drives untargetability:
 *  - elusive minions can't be targeted by *enemy* spells/battlecries/powers;
 *  - Tarrasque-style minions can't be targeted by spells/hero powers at all.
 * Attacks are never blocked by either.
 */
export function targetCandidates(state, playerId, spec, sourceType) {
  spec = resolveTargetSpec(spec, state, playerId);
  if (!spec) return [];
  const refs = [];
  const sides =
    spec.side === 'any' ? ['p1', 'p2'] : spec.side === 'friendly' ? [playerId] : [otherPlayer(playerId)];
  for (const pid of sides) {
    if (spec.kinds.includes('hero')) refs.push(heroRef(pid));
    if (spec.kinds.includes('minion')) {
      for (const m of state.players[pid].board) {
        if (m.hp <= 0) continue;
        if (sourceType !== 'attack') {
          if (m.elusive && m.controller !== playerId) continue;
          if (m.noTargetSpells && (sourceType === 'spell' || sourceType === 'heropower')) continue;
        }
        refs.push(minionRef(m));
      }
    }
  }
  if (!spec.filter) return refs;
  return refs.filter((ref) =>
    ref.kind === 'hero' ? spec.filter(state, { kind: 'hero', player: ref.player }) : spec.filter(state, findMinion(state, ref))
  );
}

function sameRef(a, b) {
  return a && b && a.kind === b.kind && a.player === b.player && (a.kind === 'hero' || a.uid === b.uid);
}

/** Legal targets for playing a card from hand (UI + AI helper). */
export function legalTargetsForCard(state, playerId, cardUid) {
  const inst = state.players[playerId].hand.find((c) => c.uid === cardUid);
  if (!inst) return [];
  const def = effectOf(inst.cardId);
  if (!def?.target) return [];
  const card = getCard(inst.cardId);
  const sourceType = card.type === 'spell' ? 'spell' : 'battlecry';
  return targetCandidates(state, playerId, def.target, sourceType);
}

export function legalTargetsForHeroPower(state, playerId) {
  const def = heroPowerEffectOf(state.players[playerId].heroPower);
  if (!def.target) return [];
  return targetCandidates(state, playerId, def.target, 'heropower');
}

/* ---------------- attack legality ---------------- */

export function canMinionAttack(state, m) {
  if (m.hp <= 0 || m.atk <= 0) return false;
  if (m.attacksUsed >= 1 || m.frozen > 0) return false;
  if (m.sick && !minionHasKeyword(m, 'charge') && !minionHasKeyword(m, 'haste') && !minionHasKeyword(m, 'rush')) {
    return false;
  }
  return true;
}

export function canHeroAttack(state, playerId) {
  const p = state.players[playerId];
  return !!p.weapon && p.weapon.durability > 0 && p.heroAttacksUsed < 1;
}

/** Legal defender refs for an attacker (taunt + rush rules). */
export function legalAttackTargets(state, playerId, attackerRef) {
  const oppId = otherPlayer(playerId);
  const opp = state.players[oppId];
  const taunts = opp.board.filter((m) => m.hp > 0 && minionHasKeyword(m, 'taunt'));

  let minionOnly = false;
  if (attackerRef.kind === 'minion') {
    const m = findMinion(state, attackerRef);
    if (!m) return [];
    // A summoning-sick rush minion may only hit minions this turn.
    if (m.sick && minionHasKeyword(m, 'rush') && !minionHasKeyword(m, 'charge') && !minionHasKeyword(m, 'haste')) {
      minionOnly = true;
    }
  }

  if (taunts.length > 0) return taunts.map(minionRef);
  const refs = opp.board.filter((m) => m.hp > 0).map(minionRef);
  if (!minionOnly) refs.push(heroRef(oppId));
  return refs;
}

/* ---------------- action handlers ---------------- */

function handlePlayCard(state, action) {
  const p = state.players[state.active];
  const inst = p.hand.find((c) => c.uid === action.cardUid);
  if (!inst) illegal('that card is not in your hand');
  const card = getCard(inst.cardId);
  const cost = effectiveCost(state, p.id, inst);
  if (p.mana < cost) illegal(`not enough mana (${cost} needed)`);
  if (card.type === 'minion' && p.board.length >= BOARD_LIMIT) illegal('your board is full');

  const def = effectOf(inst.cardId);
  const sourceType = card.type === 'spell' ? 'spell' : 'battlecry';
  let target = action.target ?? null;
  const spec = def ? resolveTargetSpec(def.target, state, p.id) : null;
  if (spec) {
    const candidates = targetCandidates(state, p.id, spec, sourceType);
    if (candidates.length === 0) {
      if (card.type === 'spell') illegal('no legal targets');
      target = null; // battlecry fizzles, minion still comes down
    } else {
      if (!target) illegal('this card needs a target');
      if (!candidates.some((c) => sameRef(c, target))) illegal('illegal target');
    }
  } else {
    target = null;
  }

  p.mana -= cost;
  p.hand.splice(p.hand.indexOf(inst), 1);

  if (card.type === 'minion') {
    const m = makeMinion(state, inst.cardId, p.id);
    if (minionHasKeyword(m, 'charge') || minionHasKeyword(m, 'haste')) m.sick = false;
    p.board.push(m);
    log(state, `${verb(p.name, 'plays')} ${card.name}.`);
    if (def?.battlecry) {
      def.battlecry({ state, player: p.id, opponent: otherPlayer(p.id), self: m, target });
    }
  } else {
    log(state, `${verb(p.name, 'casts')} ${card.name}.`);
    def.run({ state, player: p.id, opponent: otherPlayer(p.id), target });
  }
  processDeaths(state);
}

function handleAttack(state, action) {
  const p = state.players[state.active];
  const attackerRef = action.attacker;
  const targetRef = action.target;
  if (!targetRef) illegal('attack needs a target');

  const legal = legalAttackTargets(state, p.id, attackerRef);
  if (!legal.some((r) => sameRef(r, targetRef))) {
    illegal(targetRef.kind === 'hero' || legal.length ? 'a taunt minion blocks that attack' : 'illegal attack target');
  }

  let attackerName;
  let attackPower;
  if (attackerRef.kind === 'hero') {
    if (attackerRef.player !== p.id) illegal('not your hero');
    if (!canHeroAttack(state, p.id)) illegal('your hero cannot attack');
    attackerName = p.name;
    attackPower = p.weapon.atk;
  } else {
    const m = findMinion(state, attackerRef);
    if (!m || m.controller !== p.id) illegal('not your minion');
    if (!canMinionAttack(state, m)) {
      illegal(m && m.sick ? 'that minion has summoning sickness' : 'that minion cannot attack');
    }
    attackerName = getCard(m.cardId).name;
    attackPower = m.atk;
  }

  const defender = targetRef.kind === 'minion' ? findMinion(state, targetRef) : null;
  const defenderName = defender ? getCard(defender.cardId).name : state.players[targetRef.player].name;
  const retaliation = defender ? defender.atk : 0;
  log(state, `${verb(attackerName, 'attacks')} ${defenderName}.`);

  // Simultaneous combat damage: both hits land even if the first one kills.
  dealDamage(state, targetRef, attackPower, attackerRef.kind === 'minion' ? attackerRef : null);
  if (retaliation > 0) {
    dealDamage(state, attackerRef, retaliation, targetRef.kind === 'minion' ? targetRef : null);
  }

  if (attackerRef.kind === 'hero') {
    p.heroAttacksUsed += 1;
    p.weapon.durability -= 1;
    if (p.weapon.durability <= 0) {
      log(state, `${poss(p.name)} ${p.weapon.name} breaks.`);
      p.weapon = null;
    }
  } else {
    const m = findMinion(state, attackerRef);
    if (m) {
      m.attacksUsed += 1;
      if (m.elusive === 'until-attack') m.elusive = null;
    }
  }
  processDeaths(state);
}

function handleHeroPower(state, action) {
  const p = state.players[state.active];
  const power = getHeroPower(p.heroPower);
  const def = heroPowerEffectOf(p.heroPower);
  if (p.heroPowerUsed) illegal('hero power already used this turn');
  if (p.mana < power.cost) illegal(`not enough mana (${power.cost} needed)`);

  let target = action.target ?? null;
  const spec = resolveTargetSpec(def.target, state, p.id);
  if (spec) {
    const candidates = targetCandidates(state, p.id, spec, 'heropower');
    if (candidates.length === 0) illegal('no legal targets for your hero power');
    if (!target) illegal('your hero power needs a target');
    if (!candidates.some((c) => sameRef(c, target))) illegal('illegal target');
  } else {
    target = null;
  }
  if (def.playable && !def.playable(state, p.id)) illegal('hero power cannot be used right now');

  p.mana -= power.cost;
  p.heroPowerUsed = true;
  log(state, `${verb(p.name, 'uses')} ${power.name}.`);
  def.run({ state, player: p.id, opponent: otherPlayer(p.id), target });
  processDeaths(state);
}

function expireEndOfTurn(state, endingPlayerId) {
  // "This turn" effects expire at the end of the turn they were applied in,
  // whichever board the minion sits on.
  for (const pid of ['p1', 'p2']) {
    for (const m of state.players[pid].board) {
      if (m.tempAtk !== 0) {
        m.atk = Math.max(0, m.atk - m.tempAtk);
        m.tempAtk = 0;
      }
      m.tempKeywords = [];
      if (m.elusive === 'turn') m.elusive = null;
    }
  }
  // Hand back temporary steals (Ultroloth, Mind Flayer).
  const ending = state.players[endingPlayerId];
  for (const m of [...ending.board]) {
    if (!m.stolenUntilEndOfTurn) continue;
    const home = state.players[m.originalOwner];
    ending.board.splice(ending.board.indexOf(m), 1);
    m.stolenUntilEndOfTurn = false;
    if (home.board.length >= BOARD_LIMIT) {
      // Nowhere to return to: the minion is crushed out of existence.
      log(state, `${getCard(m.cardId).name} has nowhere to return to and perishes.`);
      home.graveyard.push(m.cardId);
      continue;
    }
    m.controller = m.originalOwner;
    m.sick = true;
    home.board.push(m);
    log(state, `${getCard(m.cardId).name} returns to ${home.name}.`);
  }
  // Frozen minions thaw at the end of their controller's turn.
  for (const m of ending.board) {
    if (m.frozen > 0) m.frozen -= 1;
  }
}

function startTurn(state, playerId) {
  const p = state.players[playerId];
  p.maxMana = Math.min(10, p.maxMana + 1);
  p.mana = p.maxMana;
  p.heroPowerUsed = false;
  p.heroAttacksUsed = 0;
  for (const m of p.board) {
    m.sick = false;
    m.attacksUsed = 0;
  }
  for (const pid of ['p1', 'p2']) {
    for (const m of state.players[pid].board) m.damagedThisTurn = false;
  }
  log(state, `— ${poss(p.name)} turn ${state.turnNumber} —`);

  // Delayed effects (Blade Barrier) fire at the start of their owner's turn.
  const due = state.delayed.filter((d) => d.player === playerId);
  state.delayed = state.delayed.filter((d) => d.player !== playerId);
  for (const d of due) {
    if (d.effect === 'blade_barrier') {
      log(state, 'The blade barrier whirls again.');
      for (const m of state.players[otherPlayer(playerId)].board) {
        if (m.hp > 0) dealDamage(state, minionRef(m), 1);
      }
    }
  }
  processDeaths(state);
  drawCard(state, playerId);
}

function handleEndTurn(state) {
  const ending = state.active;
  expireEndOfTurn(state, ending);
  processDeaths(state);
  state.active = otherPlayer(ending);
  state.turnNumber += 1;
  startTurn(state, state.active);
}

function handleChoose(state, action) {
  const pc = state.pendingChoice;
  if (!pc) illegal('nothing to choose');
  if (pc.player !== state.active) illegal('not your choice');
  const idx = action.index;
  if (!Number.isInteger(idx) || idx < 0 || idx >= pc.options.length) illegal('bad choice index');

  if (pc.kind === 'pick-card') {
    const p = state.players[pc.player];
    const uid = pc.uids[idx];
    const at = p.deck.findIndex((c) => c.uid === uid);
    if (at !== -1) {
      const [c] = p.deck.splice(at, 1);
      if (p.hand.length >= 10) {
        log(state, `${poss(p.name)} hand is full — ${getCard(c.cardId).name} burns away.`);
      } else {
        p.hand.push(c);
        log(state, `${verb(p.name, 'draws')} ${getCard(c.cardId).name}.`);
      }
    }
  }
  state.pendingChoice = null;
}

/* ---------------- top level ---------------- */

function checkWinner(state) {
  if (state.winner !== null) return;
  const p1Dead = state.players.p1.hero.hp <= 0;
  const p2Dead = state.players.p2.hero.hp <= 0;
  if (p1Dead && p2Dead) state.winner = 'draw';
  else if (p1Dead) state.winner = 'p2';
  else if (p2Dead) state.winner = 'p1';
  if (state.winner) {
    log(state, state.winner === 'draw' ? 'Both heroes fall — a draw.' : `${verb(state.players[state.winner].name, 'wins')}.`);
  }
}

/**
 * Apply one complete action and return the next state. Throws IllegalAction
 * (previous state untouched) on any rule violation.
 */
export function applyAction(prev, action) {
  if (prev.winner !== null && action.type !== 'concede') illegal('the game is over');
  const state = structuredClone(prev);

  if (state.pendingChoice && action.type !== 'choose' && action.type !== 'concede') {
    illegal('a choice must be resolved first');
  }

  switch (action.type) {
    case 'playCard':
      handlePlayCard(state, action);
      break;
    case 'attack':
      handleAttack(state, action);
      break;
    case 'heroPower':
      handleHeroPower(state, action);
      break;
    case 'endTurn':
      handleEndTurn(state);
      break;
    case 'choose':
      handleChoose(state, action);
      break;
    case 'concede':
      state.winner = otherPlayer(state.active);
      log(state, `${verb(state.players[state.active].name, 'concedes')}.`);
      break;
    default:
      illegal(`unknown action type ${action.type}`);
  }

  checkWinner(state);
  validateState(state);
  return state;
}
