// A heuristic opponent. It plays the real rules through the same applyAction
// path as a human: one action per call, re-evaluated against the fresh state
// (act-then-reassess), so it can never desync from the engine. It is meant to
// be sane rather than strong: it checks lethal, respects taunts and wards,
// trades favourably, uses its hero power, and spends its mana.

import { getCard, getHeroPower } from './cards.js';
import { effectOf, heroPowerEffectOf } from './registry.js';
import {
  canHeroAttack,
  canMinionAttack,
  effectiveCost,
  legalAttackTargets,
  resolveTargetSpec,
  targetCandidates,
} from './actions.js';
import { findMinion, heroRef, minionHasKeyword, minionRef, otherPlayer, BOARD_LIMIT } from './primitives.js';

function minionValue(m) {
  let v = m.atk + m.hp;
  if (minionHasKeyword(m, 'taunt')) v += 1;
  if (m.ward) v += 2;
  if (minionHasKeyword(m, 'lifesteal')) v += 1;
  return v;
}

function resolveTarget(state, ref) {
  return ref.kind === 'minion' ? findMinion(state, ref) : null;
}

/** Pick a target for a 'harm'/'help' effect. Returns {target, bonus}|null. */
function pickEffectTarget(state, playerId, def, sourceType) {
  const spec = resolveTargetSpec(def.target, state, playerId);
  if (!spec) return { target: null, bonus: 0 };
  const candidates = targetCandidates(state, playerId, spec, sourceType);
  if (candidates.length === 0) {
    // Battlecries fizzle gracefully; targeted spells are unplayable.
    return sourceType === 'battlecry' ? { target: null, bonus: 0 } : null;
  }
  const oppId = otherPlayer(playerId);

  if (def.aiHint === 'harm') {
    const enemyMinions = candidates.filter((r) => r.kind === 'minion' && r.player === oppId);
    if (enemyMinions.length > 0) {
      if (def.aiAmount) {
        const kills = enemyMinions
          .map((r) => resolveTarget(state, r))
          .filter((m) => m && !m.ward && m.hp <= def.aiAmount);
        if (kills.length > 0) {
          const best = kills.reduce((a, b) => (minionValue(a) >= minionValue(b) ? a : b));
          return { target: minionRef(best), bonus: 2.5 + minionValue(best) * 0.15 };
        }
      }
      const biggest = enemyMinions
        .map((r) => resolveTarget(state, r))
        .filter(Boolean)
        .reduce((a, b) => (a.atk >= b.atk ? a : b));
      // Chip damage into a big ward/health pool is still fine, but weight low.
      return { target: minionRef(biggest), bonus: biggest.atk * 0.2 };
    }
    const enemyHero = candidates.find((r) => r.kind === 'hero' && r.player === oppId);
    if (enemyHero) {
      const opp = state.players[oppId];
      const lethal = def.aiAmount && def.aiAmount >= opp.hero.hp + opp.hero.armor;
      return { target: enemyHero, bonus: lethal ? 100 : 0.3 };
    }
    if (sourceType === 'battlecry') {
      // Forced to point a harmful battlecry at our own side: least valuable.
      const own = candidates
        .map((r) => resolveTarget(state, r))
        .filter(Boolean)
        .sort((a, b) => minionValue(a) - minionValue(b))[0];
      return own ? { target: minionRef(own), bonus: -minionValue(own) * 0.3 } : { target: candidates[0], bonus: -1 };
    }
    return null; // don't cast harm spells at ourselves
  }

  if (def.aiHint === 'help') {
    const ownMinions = candidates.filter((r) => r.kind === 'minion' && r.player === playerId);
    if (def.aiHeal) {
      // Most damaged friendly character.
      const hurtHero = candidates.find((r) => r.kind === 'hero' && r.player === playerId);
      const heroMissing = hurtHero ? 30 - state.players[playerId].hero.hp : 0;
      const hurtMinions = ownMinions.map((r) => resolveTarget(state, r)).filter((m) => m && m.hp < m.maxHp);
      const worst = hurtMinions.sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
      if (heroMissing >= 4 && heroMissing >= (worst ? worst.maxHp - worst.hp : 0)) {
        return { target: hurtHero, bonus: 1 };
      }
      if (worst) return { target: minionRef(worst), bonus: 1 };
      return null; // nothing to heal
    }
    if (ownMinions.length === 0) return sourceType === 'battlecry' ? { target: null, bonus: 0 } : null;
    const best = ownMinions
      .map((r) => resolveTarget(state, r))
      .filter(Boolean)
      .reduce((a, b) => (a.atk >= b.atk ? a : b));
    return { target: minionRef(best), bonus: best.atk * 0.15 };
  }

  // No hint but a target spec: just take the first candidate.
  return { target: candidates[0], bonus: 0 };
}

/** Cheap per-card gates for untargeted spells so the AI doesn't waste them. */
function untargetedSpellScore(state, playerId, cardId) {
  const p = state.players[playerId];
  const opp = state.players[otherPlayer(playerId)];
  const enemyMinions = opp.board.filter((m) => m.hp > 0);
  const ownMinions = p.board.filter((m) => m.hp > 0);
  switch (cardId) {
    case 'cloudkill':
    case 'lightning_storm':
    case 'cone_cold':
    case 'entangle':
    case 'blade_barrier':
    case 'mass_dispel':
      return enemyMinions.length >= 2 ? 2 + enemyMinions.length * 0.4 : 0;
    case 'chain_lightning':
    case 'magic_missile':
      return enemyMinions.length >= 1 ? 1.6 : 0.6;
    case 'meteor':
      return enemyMinions.length >= 2 || opp.hero.hp + opp.hero.armor <= 12 ? 3 : 0;
    case 'blessing_might':
      return ownMinions.length >= 2 ? 2 : 0;
    case 'mass_heal':
      return p.hero.hp <= 24 || ownMinions.some((m) => m.hp < m.maxHp) ? 1.5 : 0;
    case 'healing_spirit':
      return p.hero.hp <= 26 ? 1.4 : 0.8;
    case 'shield_of_faith':
      return 1.2;
    case 'divination':
    case 'draught_insight':
    case 'contact_plane':
      return p.hand.length <= 7 ? 1.3 : 0;
    case 'raise_dead':
    case 'animate_dead':
      return p.graveyard.length > 0 && p.board.length < BOARD_LIMIT ? 2.2 : 0;
    case 'summon_swarm':
    case 'mirror_image':
      return p.board.length <= BOARD_LIMIT - 2 ? 1.6 : 0;
    case 'wish':
      return 2;
    default:
      return 1;
  }
}

function scorePlays(state, playerId, actions) {
  const p = state.players[playerId];
  for (const inst of p.hand) {
    const card = getCard(inst.cardId);
    const cost = effectiveCost(state, playerId, inst);
    if (cost > p.mana) continue;
    const def = effectOf(inst.cardId);

    if (card.type === 'minion') {
      if (p.board.length >= BOARD_LIMIT) continue;
      let score = 3 + card.cost * 0.25;
      let target = null;
      if (def?.target) {
        const picked = pickEffectTarget(state, playerId, def, 'battlecry');
        if (picked) {
          target = picked.target;
          score += picked.bonus;
        }
      }
      actions.push({ score, action: { type: 'playCard', cardUid: inst.uid, target } });
      continue;
    }

    // Spells.
    if (def?.target) {
      const picked = pickEffectTarget(state, playerId, def, 'spell');
      if (!picked) continue;
      // Don't burn special spells on tiny targets.
      const t = picked.target && resolveTarget(state, picked.target);
      if (def.aiHint === 'harm' && t && minionValue(t) < 4 && def.aiAmount >= 5) continue;
      actions.push({ score: 2 + picked.bonus, action: { type: 'playCard', cardUid: inst.uid, target: picked.target } });
    } else {
      const score = untargetedSpellScore(state, playerId, inst.cardId);
      if (score > 0) actions.push({ score, action: { type: 'playCard', cardUid: inst.uid, target: null } });
    }
  }
}

function scoreAttacks(state, playerId, actions) {
  const p = state.players[playerId];
  const opp = state.players[otherPlayer(playerId)];
  const oppHasTaunt = opp.board.some((m) => m.hp > 0 && minionHasKeyword(m, 'taunt'));

  // Lethal check: total face damage from every ready attacker.
  if (!oppHasTaunt) {
    let face = p.board.filter((m) => canMinionAttack(state, m) && !(m.sick && minionHasKeyword(m, 'rush') && !minionHasKeyword(m, 'charge') && !minionHasKeyword(m, 'haste'))).reduce((s, m) => s + m.atk, 0);
    if (canHeroAttack(state, playerId)) face += p.weapon.atk;
    if (face >= opp.hero.hp + opp.hero.armor) {
      const hitter = p.board.find((m) => canMinionAttack(state, m));
      if (hitter) {
        const targets = legalAttackTargets(state, playerId, minionRef(hitter));
        const faceRef = targets.find((r) => r.kind === 'hero');
        if (faceRef) {
          actions.push({ score: 1000, action: { type: 'attack', attacker: minionRef(hitter), target: faceRef } });
          return;
        }
      } else if (canHeroAttack(state, playerId)) {
        actions.push({ score: 1000, action: { type: 'attack', attacker: heroRef(playerId), target: heroRef(otherPlayer(playerId)) } });
        return;
      }
    }
  }

  for (const m of p.board) {
    if (!canMinionAttack(state, m)) continue;
    const aRef = minionRef(m);
    for (const tRef of legalAttackTargets(state, playerId, aRef)) {
      if (tRef.kind === 'hero') {
        actions.push({ score: 2 + m.atk * 0.15, action: { type: 'attack', attacker: aRef, target: tRef } });
        continue;
      }
      const d = findMinion(state, tRef);
      if (!d) continue;
      const kills = !d.ward && m.atk >= d.hp;
      const dies = !m.ward && d.atk >= m.hp;
      let score;
      if (kills && !dies) score = 6 + minionValue(d) * 0.25;
      else if (kills && dies) score = minionValue(d) >= minionValue(m) ? 4 + (minionValue(d) - minionValue(m)) * 0.2 : 0.8;
      else if (!kills && d.ward) score = 2.2; // pop the ward
      else if (!kills && !dies) score = 1.2;
      else score = oppHasTaunt ? 0.6 : 0.1; // suicide only if a taunt must be cleared
      actions.push({ score, action: { type: 'attack', attacker: aRef, target: tRef } });
    }
  }

  // Weapon attacks: face by default, or safe kills.
  if (canHeroAttack(state, playerId)) {
    const aRef = heroRef(playerId);
    for (const tRef of legalAttackTargets(state, playerId, aRef)) {
      if (tRef.kind === 'hero') {
        actions.push({ score: 1.8 + p.weapon.atk * 0.1, action: { type: 'attack', attacker: aRef, target: tRef } });
      } else {
        const d = findMinion(state, tRef);
        if (d && !d.ward && p.weapon.atk >= d.hp && d.atk <= 2) {
          actions.push({ score: 3.5, action: { type: 'attack', attacker: aRef, target: tRef } });
        } else if (d && oppHasTaunt) {
          actions.push({ score: 0.5, action: { type: 'attack', attacker: aRef, target: tRef } });
        }
      }
    }
  }
}

function scoreHeroPower(state, playerId, actions) {
  const p = state.players[playerId];
  if (p.heroPowerUsed) return;
  const power = getHeroPower(p.heroPower);
  if (p.mana < power.cost) return;
  const def = heroPowerEffectOf(p.heroPower);
  if (def.playable && !def.playable(state, playerId)) return;
  const opp = state.players[otherPlayer(playerId)];

  let target = null;
  let score = 1;
  switch (p.heroPower) {
    case 'tinkers_ward':
      score = 1.1;
      break;
    case 'emberspark': {
      const kill = opp.board.find((m) => m.hp === 1 && !m.ward && !m.elusive && !m.noTargetSpells);
      if (kill) {
        target = minionRef(kill);
        score = 5;
      } else {
        target = heroRef(otherPlayer(playerId));
        score = opp.hero.hp + opp.hero.armor <= 1 ? 1000 : 1;
      }
      break;
    }
    case 'mending_hand':
      if (p.hero.hp > 27) return;
      score = p.hero.hp <= 20 ? 2.5 : 1.2;
      break;
    case 'bone_call':
      score = 1.6;
      break;
    case 'scavenge':
      if (p.hand.length > 5) return; // don't gamble away a full hand
      score = 1.2;
      break;
    case 'forge_blade': {
      const picked = pickEffectTarget(state, playerId, def, 'heropower');
      if (!picked || !picked.target) return;
      target = picked.target;
      score = 1.3;
      break;
    }
    case 'warp_step': {
      const sickie = p.board.find(
        (m) => m.sick && m.atk > 0 && m.frozen === 0 && m.attacksUsed === 0 &&
          !minionHasKeyword(m, 'charge') && !minionHasKeyword(m, 'haste') && !minionHasKeyword(m, 'rush')
      );
      const worthHitting = opp.board.some((m) => m.hp > 0);
      if (!sickie || !worthHitting) return;
      target = minionRef(sickie);
      score = 2.2;
      break;
    }
    default:
      break;
  }
  actions.push({ score, action: { type: 'heroPower', target } });
}

/**
 * Pick the next action for the active player. Returns a complete action
 * object; {type:'endTurn'} when it has nothing worthwhile left.
 */
export function chooseAiAction(state) {
  if (state.winner) return null;
  const playerId = state.active;

  if (state.pendingChoice && state.pendingChoice.player === playerId) {
    // Scry: take the most expensive card (greedy but reasonable).
    let best = 0;
    state.pendingChoice.options.forEach((id, i) => {
      if (getCard(id).cost > getCard(state.pendingChoice.options[best]).cost) best = i;
    });
    return { type: 'choose', index: best };
  }

  const actions = [];
  scoreAttacks(state, playerId, actions);
  scorePlays(state, playerId, actions);
  scoreHeroPower(state, playerId, actions);

  actions.sort((a, b) => b.score - a.score);
  if (actions.length > 0 && actions[0].score >= 1) return actions[0].action;
  return { type: 'endTurn' };
}
