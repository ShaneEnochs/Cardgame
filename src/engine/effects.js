// Effect definitions for every card and hero power in the set. Importing this
// module populates the registry. Vanilla / pure-keyword cards need no entry:
// taunt, charge, haste, rush, ward, lifesteal and freeze-on-damage are engine
// mechanics. Everything here composes the primitives — no card mutates state
// shapes on its own.

import { allCards, collectibleCards, getCard } from './cards.js';
import { defineCard, defineHeroPower, effectOf } from './registry.js';
import { legalAttackTargets, resolveTargetSpec, targetCandidates } from './actions.js';
import * as P from './primitives.js';
import { pick, randInt } from './rng.js';

/* ---------------- target spec shorthands ---------------- */

const ANY_MINION = { side: 'any', kinds: ['minion'] };
const ENEMY_MINION = { side: 'enemy', kinds: ['minion'] };
const FRIENDLY_MINION = { side: 'friendly', kinds: ['minion'] };
const ANY_CHAR = { side: 'any', kinds: ['minion', 'hero'] };
const FRIENDLY_CHAR = { side: 'friendly', kinds: ['minion', 'hero'] };
const withFilter = (spec, filter) => ({ ...spec, filter });

/* ---------------- local helpers ---------------- */

function selfRef(self) {
  return P.minionRef(self);
}

/** Forced combat outside the normal attack action (Harpy, Marilith). */
function forceCombat(state, attackerRef, defenderRef) {
  const a = P.findMinion(state, attackerRef);
  if (!a || a.hp <= 0) return;
  const defender = defenderRef.kind === 'minion' ? P.findMinion(state, defenderRef) : null;
  const retaliation = defender ? defender.atk : 0;
  P.dealDamage(state, defenderRef, a.atk, attackerRef);
  if (retaliation > 0) P.dealDamage(state, attackerRef, retaliation, defenderRef);
}

function damageDistinctRandomEnemies(state, playerId, count, each, sourceRef = null) {
  const pool = P.enemyCharacterRefs(state, playerId);
  for (let i = 0; i < count && pool.length > 0; i++) {
    const [t] = pool.splice(randInt(state, pool.length), 1);
    P.dealDamage(state, t, each, sourceRef);
  }
}

/** Peek the top N cards of your deck; pendingChoice resolves which is drawn. */
function scry(state, playerId, n) {
  const p = state.players[playerId];
  const top = p.deck.slice(-n).reverse(); // last element of deck = top
  if (top.length === 0) {
    P.log(state, `${p.name} peers at an empty deck.`);
    return;
  }
  state.pendingChoice = {
    player: playerId,
    kind: 'pick-card',
    prompt: 'Choose a card to draw',
    options: top.map((c) => c.cardId),
    uids: top.map((c) => c.uid),
  };
}

function castRandomSpellFromDeck(state, playerId) {
  const p = state.players[playerId];
  const spells = p.deck.filter((c) => getCard(c.cardId).type === 'spell');
  if (spells.length === 0) {
    P.log(state, `${p.name}'s deck holds no spells.`);
    return;
  }
  const inst = pick(state, spells);
  p.deck.splice(p.deck.indexOf(inst), 1);
  const card = getCard(inst.cardId);
  const def = effectOf(inst.cardId);
  const spec = resolveTargetSpec(def.target, state, playerId);
  let target = null;
  if (spec) {
    const candidates = targetCandidates(state, playerId, spec, 'spell');
    if (candidates.length === 0) {
      P.log(state, `${card.name} fizzles — no target.`);
      return;
    }
    target = pick(state, candidates);
  }
  P.log(state, `${card.name} is cast from ${p.name}'s deck.`);
  def.run({ state, player: playerId, opponent: P.otherPlayer(playerId), target });
}

/* ---------------- definition factories ---------------- */

function bcDamage(amount, spec) {
  return {
    target: spec,
    aiHint: 'harm',
    aiAmount: amount, // lets the AI recognise kill targets
    battlecry({ state, self, target }) {
      if (target) P.dealDamage(state, target, amount, selfRef(self));
    },
  };
}

function bcAoE(fn) {
  return {
    aiHint: 'none',
    battlecry(ctx) {
      fn(ctx);
    },
  };
}

function bcBuff(atk, hp, spec = FRIENDLY_MINION) {
  return {
    target: spec,
    aiHint: 'help',
    battlecry({ state, target }) {
      if (target) P.buff(state, target, atk, hp);
    },
  };
}

function bcDebuff(atk, hp, spec = ENEMY_MINION) {
  return {
    target: spec,
    aiHint: 'harm',
    battlecry({ state, target }) {
      if (target) P.buff(state, target, atk, hp);
    },
  };
}

function bcFreeze(spec = ENEMY_MINION) {
  return {
    target: spec,
    aiHint: 'harm',
    battlecry({ state, target }) {
      if (target) P.freezeMinion(state, target, 1);
    },
  };
}

function bcDestroy(spec) {
  return {
    target: spec,
    aiHint: 'harm',
    aiAmount: 99, // outright removal
    battlecry({ state, target }) {
      if (target) P.destroyMinion(state, target);
    },
  };
}

function bcDraw(n) {
  return {
    aiHint: 'none',
    battlecry({ state, player }) {
      P.drawCard(state, player, n);
    },
  };
}

function bcHealHero(n) {
  return {
    aiHint: 'none',
    battlecry({ state, player }) {
      P.heal(state, P.heroRef(player), n);
    },
  };
}

function bcArmor(n, alsoDraw = 0) {
  return {
    aiHint: 'none',
    battlecry({ state, player }) {
      P.gainArmor(state, player, n);
      if (alsoDraw) P.drawCard(state, player, alsoDraw);
    },
  };
}

function drSummon(tokenId, count) {
  return {
    deathrattle({ state, controller, position }) {
      for (let i = 0; i < count; i++) P.summon(state, controller, tokenId, { position: position + i });
    },
  };
}

function drReturnToHand() {
  return {
    deathrattle({ state, controller, self }) {
      P.addToHand(state, controller, self.cardId);
    },
  };
}

function spell(def) {
  return def;
}

/* =================================================================
 * MINIONS
 * ================================================================= */

/* ---- Dragons ---- */
defineCard('young_red', bcDamage(2, ANY_MINION));
defineCard('adult_red', bcAoE(({ state, player, self }) => P.damageAllEnemyMinions(state, player, 3, selfRef(self))));
defineCard('ancient_red', {
  // The "your Dragons cost (1) less" aura lives in effectiveCost().
  aiHint: 'none',
  battlecry({ state, player, self }) {
    P.splitDamageAmongEnemies(state, player, 4, 1, selfRef(self));
  },
});
defineCard('adult_blue', bcFreeze());
defineCard('ancient_blue', bcAoE(({ state, player }) => {
  for (const m of P.livingMinions(state, P.otherPlayer(player))) P.freezeMinion(state, P.minionRef(m), 1);
}));
defineCard('ancient_green', {
  target: withFilter(ENEMY_MINION, (s, m) => m.atk <= 2),
  aiHint: 'harm',
  battlecry({ state, player, target }) {
    if (target) P.takeControl(state, target, player);
  },
});
defineCard('black_cavern', bcDestroy(withFilter(ENEMY_MINION, (s, m) => m.damagedThisTurn)));
defineCard('gold_suncrest', bcHealHero(8));
defineCard('silver_cloud', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    if (target) P.bounceToHand(state, target);
  },
});
defineCard('copper_canyon', bcDraw(1));
defineCard('brass_desert', bcAoE(({ state, player, self }) => P.damageAllEnemies(state, player, 1, selfRef(self))));
defineCard('gem_amethyst', bcArmor(3, 1));
defineCard('gem_emerald', {
  aiHint: 'none',
  battlecry({ state, player }) {
    scry(state, player, 3);
  },
});
defineCard('shadowfell_dragon', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 2, selfRef(self));
  },
});
defineCard('fire_drake', bcDamage(1, ANY_MINION));
defineCard('lightning_drake', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    const t = P.randomEnemyCharacter(state, player);
    if (t) P.dealDamage(state, t, 2, selfRef(self));
  },
});
defineCard('venom_wyvern', bcDestroy(withFilter(ENEMY_MINION, (s, m) => m.hp < m.maxHp)));
defineCard('magma_linnorm', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 3, selfRef(self));
  },
});
defineCard('clockwork_dragon', drSummon('t_sprocket', 2));
defineCard('dracolich', drReturnToHand());

/* ---- Undead ---- */
defineCard('giant_skeleton', {
  deathrattle({ state }) {
    P.damageAllMinions(state, 2);
  },
});
defineCard('flaming_skeleton', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyCharacter(state, controller);
    if (t) P.dealDamage(state, t, 1);
  },
});
defineCard('plague_zombie', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyMinion(state, controller);
    if (t) P.buff(state, t, -1, -1);
  },
});
defineCard('wight', drSummon('t_skeleton', 1));
defineCard('banshee', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    if (target) P.tempAtkChange(state, target, -3);
  },
});
defineCard('wailing_banshee', {
  target: ANY_MINION,
  aiHint: 'harm',
  battlecry({ state, player, self, target }) {
    P.damageAllEnemyMinions(state, player, 1, selfRef(self));
    if (target) P.silenceMinion(state, target);
  },
});
defineCard('mummy', {
  deathrattle({ state, controller }) {
    const t = pick(state, P.livingMinions(state, controller).map(P.minionRef));
    if (t) P.buff(state, t, 2, 2);
  },
});
defineCard('mummy_lord', drSummon('t_mummy', 2));
defineCard('true_vampire', bcHealHero(3));
defineCard('nosferatu', {
  onKill({ state, self }) {
    P.buff(state, P.minionRef(self), 2, 2);
    P.log(state, `${getCard(self.cardId).name} feasts and grows.`);
  },
});
defineCard('lich', bcAoE(({ state, player, self }) => {
  P.damageAllEnemyMinions(state, player, 3, selfRef(self));
  P.drawCard(state, player, 1);
}));
defineCard('demilich', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    const discarded = P.discardLowestCost(state, player);
    if (discarded) P.damageAllEnemies(state, player, getCard(discarded.cardId).cost, selfRef(self));
  },
});
defineCard('death_knight', {
  aiHint: 'none',
  battlecry({ state, player }) {
    state.players[player].weapon = { name: 'Soul Blade', atk: 3, durability: 2 };
    P.log(state, `${state.players[player].name} equips a Soul Blade (3/2).`);
  },
});
defineCard('revenant', drReturnToHand());
defineCard('shadow', bcDebuff(-1, 0));
defineCard('bone_naga', drSummon('t_skeleton_taunt', 1));

/* ---- Fiends ---- */
defineCard('bodak', bcAoE(({ state, player, self }) => {
  P.dealDamage(state, P.heroRef(player), 2, selfRef(self));
  P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 2, selfRef(self));
}));
defineCard('quasit', { deathrattle: ({ state, controller }) => P.drawCard(state, controller, 1) });
defineCard('succubus', bcAoE(({ state, opponent }) => P.discardRandom(state, opponent)));
defineCard('barbed_devil', { retaliate: 2 }); // its battlecry text describes this passive
defineCard('chain_devil', bcFreeze());
defineCard('horned_devil', bcDamage(3, ANY_MINION));
defineCard('ice_devil', bcAoE(({ state, player }) => {
  for (const m of P.livingMinions(state, P.otherPlayer(player))) P.freezeMinion(state, P.minionRef(m), 1);
}));
defineCard('hell_hound', bcAoE(({ state, player, self }) => P.damageAllEnemyMinions(state, player, 1, selfRef(self))));
defineCard('vrock', {
  deathrattle({ state }) {
    P.damageAllMinions(state, 2);
  },
});
defineCard('glabrezu', {
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 99,
  battlecry({ state, player, target }) {
    if (!target) return;
    P.destroyMinion(state, target);
    P.dealDamage(state, P.heroRef(player), 3);
  },
});
defineCard('nalfeshnee', bcSummonTokens('t_dretch', 2));
defineCard('marilith', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    const swings = state.players[player].board.filter(
      (m) => m.uid !== self.uid && m.hp > 0 && getCard(m.cardId).tribe === 'Fiend'
    ).length;
    for (let i = 0; i < swings; i++) {
      if (self.hp <= 0) break;
      const targets = legalAttackTargets(state, player, selfRef(self));
      if (targets.length === 0) break;
      forceCombat(state, selfRef(self), pick(state, targets));
      P.processDeaths(state);
    }
  },
});
defineCard('balor', {
  deathrattle({ state }) {
    P.damageAllMinions(state, 5);
  },
});
defineCard('pit_fiend', bcSummonTokens('t_lemure', 3));
defineCard('rakshasa', bcDraw(1));
defineCard('ultroloth', {
  aiHint: 'none',
  battlecry({ state, player }) {
    const t = P.randomEnemyMinion(state, player);
    if (t) P.takeControl(state, t, player, { untilEndOfTurn: true });
  },
});

/* ---- Elementals ---- */
defineCard('magma_mephit', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyCharacter(state, controller);
    if (t) P.dealDamage(state, t, 1);
  },
});
defineCard('steam_mephit', bcDamage(1, ANY_MINION));
defineCard('dust_mephit', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyMinion(state, controller);
    if (t) P.buff(state, t, -1, 0);
  },
});
defineCard('magmin', {
  deathrattle({ state, self }) {
    if (self.lastDamagedBy?.kind === 'minion') {
      const killer = P.findMinion(state, self.lastDamagedBy);
      if (killer) P.dealDamage(state, P.minionRef(killer), 2);
    }
  },
});
defineCard('fire_elemental', bcDamage(3, ANY_CHAR));
defineCard('greater_fire_ele', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    P.splitDamageAmongEnemies(state, player, 4, 1, selfRef(self));
  },
});
defineCard('invisible_stalker', {
  aiHint: 'none',
  battlecry({ self }) {
    self.elusive = 'until-attack';
  },
});
defineCard('efreeti', bcDamage(5, ANY_MINION));
defineCard('djinni', bcDraw(2));
defineCard('marid', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  aiAmount: 3,
  battlecry({ state, self, target }) {
    if (!target) return;
    P.freezeMinion(state, target, 1);
    P.dealDamage(state, target, 3, selfRef(self));
  },
});
defineCard('xorn', bcArmor(2));

/* ---- Constructs ---- */
defineCard('bone_golem', drSummon('t_skeleton', 2));
defineCard('shield_guardian', bcArmor(4));
defineCard('clockwork_defender', drSummon('t_sprocket', 1));
defineCard('clockwork_titan', {
  aiHint: 'none',
  battlecry({ state, player }) {
    const pool = collectibleCards().filter((c) => c.type === 'minion' && c.tribe === 'Construct');
    const count = state.players[player].board.filter((m) => m.hp > 0 && getCard(m.cardId).tribe === 'Construct').length;
    for (let i = 0; i < count; i++) {
      P.summon(state, player, pick(state, pool).id);
    }
  },
});
defineCard('homunculus', { deathrattle: ({ state, controller }) => P.drawCard(state, controller, 1) });
defineCard('rug_smothering', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    if (target) P.silenceMinion(state, target);
  },
});

/* ---- Giants ---- */
defineCard('fire_giant', bcDamage(3, ANY_MINION));
defineCard('cloud_giant', bcDraw(1));
defineCard('storm_giant', bcAoE(({ state, player, self }) => P.damageAllEnemyMinions(state, player, 4, selfRef(self))));
defineCard('cyclops', bcDamage(2, ANY_MINION));
defineCard('troll', drReturnToHand());
defineCard('venom_troll', {
  deathrattle({ state, controller }) {
    P.damageAllEnemies(state, controller, 2);
  },
});
defineCard('oni', bcAoE(({ state, player, self }) => {
  P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 2, selfRef(self));
  P.drawCard(state, player, 1);
}));
defineCard('fomorian', bcDebuff(-3, -3));
defineCard('firbolg', bcHealHero(4));

/* ---- Fey ---- */
defineCard('pixie', bcBuff(1, 1));
defineCard('sprite', {
  target: ANY_CHAR,
  aiHint: 'harm',
  battlecry({ state, player, self, target }) {
    if (target) P.dealDamage(state, target, 1, selfRef(self));
    P.drawCard(state, player, 1);
  },
});
defineCard('satyr', bcBuff(2, 0));
defineCard('dryad', bcSummonTokens('t_sapling', 2));
defineCard('green_hag', bcDebuff(-2, -2));
defineCard('night_hag', bcAoE(({ state, player, opponent }) => {
  P.discardRandom(state, opponent);
  P.drawCard(state, player, 1);
}));
defineCard('annis_hag', {
  target: ANY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    const m = P.findMinion(state, target);
    if (m && m.atk > 0) P.dealDamage(state, target, m.atk);
  },
});
defineCard('unicorn', {
  target: FRIENDLY_MINION,
  aiHint: 'help',
  battlecry({ state, target }) {
    if (target) P.grantKeyword(state, target, 'ward');
  },
});
defineCard('blink_dog', drReturnToHand());
defineCard('harpy', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    const victim = P.findMinion(state, target);
    if (!victim) return;
    const allies = P.livingMinions(state, victim.controller).filter((m) => m.uid !== victim.uid);
    if (allies.length === 0) return;
    const other = pick(state, allies);
    P.log(state, `${getCard(victim.cardId).name} is forced to attack ${getCard(other.cardId).name}.`);
    forceCombat(state, P.minionRef(victim), P.minionRef(other));
  },
});
defineCard('korred', bcArmor(3));
defineCard('nymph', {
  aiHint: 'none',
  battlecry({ state, player }) {
    for (let i = 0; i < 5; i++) {
      const hurt = [];
      if (state.players[player].hero.hp < P.HERO_MAX_HP) hurt.push(P.heroRef(player));
      for (const m of P.livingMinions(state, player)) {
        if (m.hp < m.maxHp) hurt.push(P.minionRef(m));
      }
      if (hurt.length === 0) return;
      P.heal(state, pick(state, hurt), 1);
    }
  },
});
defineCard('leprechaun', {
  deathrattle({ state, controller }) {
    state.players[controller].coinsEarned += 20;
    P.log(state, `${state.players[controller].name} pockets 20 coins.`);
    P.addToHand(state, controller, 'wish');
  },
});
defineCard('kitsune', bcDraw(1));
defineCard('ninetails', {
  aiHint: 'none',
  battlecry({ state, player }) {
    castRandomSpellFromDeck(state, player);
  },
});

/* ---- Beasts ---- */
defineCard('dire_wolf', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    const board = state.players[player].board;
    const i = board.indexOf(self);
    const adjacent = [board[i - 1], board[i + 1]].filter((m) => m && m.hp > 0);
    const t = pick(state, adjacent);
    if (t) P.buff(state, P.minionRef(t), 1, 0);
  },
});
defineCard('giant_spider', drSummon('t_spiderling', 2));
defineCard('giant_ape', bcDamage(4, ANY_MINION));
defineCard('phoenix', {
  deathrattle({ state, controller, position }) {
    const reborn = P.summon(state, controller, 'phoenix', { position });
    if (reborn) {
      reborn.hp = 1;
      P.log(state, 'The Phoenix rises again with 1 health.');
    }
  },
});
defineCard('thunderbird', bcAoE(({ state, player, self }) => {
  P.damageAllEnemies(state, player, 1, selfRef(self));
  P.damageAllEnemies(state, player, 1, selfRef(self));
}));
defineCard('rust_monster', {
  // If the enemy has a Construct, it eats a random one (no target needed);
  // otherwise it targets any minion for -2 Attack.
  target: (state, playerId) =>
    enemyConstructs(state, playerId).length > 0 ? null : ANY_MINION,
  aiHint: 'harm',
  battlecry({ state, player, target }) {
    const constructs = enemyConstructs(state, player);
    if (constructs.length > 0) {
      P.destroyMinion(state, P.minionRef(pick(state, constructs)));
    } else if (target) {
      P.buff(state, target, -2, 0);
    }
  },
});

function enemyConstructs(state, playerId) {
  return P.livingMinions(state, P.otherPlayer(playerId)).filter((m) => getCard(m.cardId).tribe === 'Construct');
}

/* ---- Aberrations ---- */
defineCard('beholder', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    damageDistinctRandomEnemies(state, player, 3, 2, selfRef(self));
    const t = P.randomEnemyMinion(state, player);
    if (t) P.silenceMinion(state, t);
  },
});
defineCard('death_tyrant', {
  deathrattle({ state, controller }) {
    P.damageAllEnemyMinions(state, controller, 3);
  },
});
defineCard('spectator', bcHealHero(3));
defineCard('mind_flayer', {
  target: withFilter(ENEMY_MINION, (s, m) => m.atk <= 3),
  aiHint: 'harm',
  battlecry({ state, player, target }) {
    if (target) P.takeControl(state, target, player, { untilEndOfTurn: true });
  },
});
defineCard('elder_brain', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    const count = state.players[player].board.filter((m) => m.hp > 0 && getCard(m.cardId).tribe === 'Aberration').length;
    for (let i = 0; i < count; i++) {
      P.drawCard(state, player, 1);
      P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 2, selfRef(self));
    }
  },
});
defineCard('intellect_devourer', {
  aiHint: 'none',
  battlecry({ state, player, opponent }) {
    const hand = state.players[opponent].hand;
    if (hand.length === 0) {
      P.log(state, `${state.players[opponent].name}'s hand is empty.`);
      return;
    }
    const c = pick(state, hand);
    P.log(state, `${state.players[player].name} glimpses ${getCard(c.cardId).name} in ${state.players[opponent].name}'s hand.`);
  },
});
defineCard('aboleth', {
  aiHint: 'none',
  battlecry({ state, player, opponent, self }) {
    const mine = P.livingMinions(state, player).filter((m) => m.uid !== self.uid);
    const theirs = P.livingMinions(state, opponent);
    if (mine.length === 0 || theirs.length === 0) return;
    const a = pick(state, mine);
    const b = pick(state, theirs);
    // 1-for-1 swap, so board limits can't be exceeded.
    state.players[player].board.splice(state.players[player].board.indexOf(a), 1);
    state.players[opponent].board.splice(state.players[opponent].board.indexOf(b), 1);
    a.controller = opponent;
    b.controller = player;
    for (const m of [a, b]) {
      m.sick = !(P.minionHasKeyword(m, 'charge') || P.minionHasKeyword(m, 'haste'));
      m.attacksUsed = 0;
      m.stolenUntilEndOfTurn = false;
    }
    state.players[opponent].board.push(a);
    state.players[player].board.push(b);
    P.log(state, `${getCard(a.cardId).name} and ${getCard(b.cardId).name} swap sides.`);
  },
});
defineCard('cloaker', {
  target: FRIENDLY_MINION,
  aiHint: 'help',
  battlecry({ state, target }) {
    const m = P.findMinion(state, target);
    if (m) m.elusive = 'turn';
  },
});
defineCard('gibbering_mouther', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyMinion(state, controller);
    if (t) P.buff(state, t, -2, 0);
  },
});
defineCard('nothic', {
  aiHint: 'none',
  battlecry({ state, player, opponent }) {
    const deck = state.players[opponent].deck;
    if (deck.length === 0) {
      P.log(state, `${state.players[opponent].name}'s deck is empty.`);
      return;
    }
    const top = deck[deck.length - 1];
    P.log(state, `${state.players[player].name} sees ${getCard(top.cardId).name} on top of ${state.players[opponent].name}'s deck.`);
  },
});
defineCard('mind_witness', bcAoE(({ state, player, self }) => {
  P.damageAllEnemies(state, player, 1, selfRef(self));
  P.drawCard(state, player, 1);
}));
defineCard('star_spawn_hulk', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 3, selfRef(self));
  },
});

/* ---- Monstrosities ---- */
defineCard('basilisk', bcDestroy(withFilter(ANY_MINION, (s, m) => m.atk <= 2)));
defineCard('medusa', bcDestroy(withFilter(ENEMY_MINION, (s, m) => m.atk <= 4)));
defineCard('chimera', bcDamage(2, ANY_MINION));
defineCard('manticore', {
  aiHint: 'none',
  battlecry({ state, player, self }) {
    damageDistinctRandomEnemies(state, player, 3, 1, selfRef(self));
  },
});
defineCard('gorgon', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyMinion(state, controller);
    if (t) P.buff(state, t, -3, 0);
  },
});
defineCard('purple_worm', {
  aiHint: 'none',
  battlecry({ state, player }) {
    const t = P.randomEnemyMinion(state, player);
    if (t) P.destroyMinion(state, t);
  },
});
defineCard('remorhaz', {
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 3,
  battlecry({ state, self, target }) {
    if (!target) return;
    P.dealDamage(state, target, 3, selfRef(self));
    const m = P.findMinion(state, target);
    if (!m || m.hp <= 0) P.buff(state, selfRef(self), 3, 3);
  },
});
defineCard('hydra', drSummon('t_hydra', 1));
defineCard('pyrohydra', bcAoE(({ state, player, self }) => {
  for (let head = 0; head < 3; head++) P.damageAllEnemies(state, player, 1, selfRef(self));
}));
defineCard('tarrasque', {
  spawn({ self }) {
    self.noTargetSpells = true;
  },
});
defineCard('kraken', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  aiAmount: 99,
  battlecry({ state, player, self, target }) {
    if (target) P.destroyMinion(state, target);
    P.dealDamage(state, P.heroRef(P.otherPlayer(player)), 4, selfRef(self));
  },
});
defineCard('androsphinx', bcDraw(1));
defineCard('umber_hulk', bcAoE(({ state, self }) => P.damageAllMinions(state, 2, selfRef(self))));
defineCard('yuanti_abomination', bcDamage(3, ANY_MINION));

/* ---- Humanoids ---- */
defineCard('kobold', bcBuff(1, 1, withFilter(FRIENDLY_MINION, (s, m) => getCard(m.cardId).tribe === 'Dragon')));
defineCard('kobold_inventor', bcAddRandomSpell());
defineCard('goblin_boss', bcSummonTokens('t_goblin', 2));
defineCard('hobgoblin', bcBuff(1, 0));
defineCard('orc_chieftain', bcRallyOthers(1));
defineCard('lizard_king', {
  target: withFilter(FRIENDLY_MINION, (s, m) => getCard(m.cardId).tribe === 'Beast'),
  aiHint: 'help',
  battlecry({ state, target }) {
    if (!target) return;
    P.buff(state, target, 2, 2);
    P.grantKeyword(state, target, 'taunt');
  },
});
defineCard('yuanti_pureblood', bcAddRandomSpell());
defineCard('sahuagin', { deathrattle: ({ state, controller }) => P.drawCard(state, controller, 1) });
defineCard('sahuagin_baron', bcRallyOthers(1));
defineCard('gnoll_pack_lord', bcSummonTokens('t_hyena', 1));

/* ---- Oozes ---- */
defineCard('gray_ooze', drSummon('t_ooze', 1));
defineCard('ochre_jelly', drSummon('t_jelly', 2));
defineCard('gelatinous_cube', {
  target: ENEMY_MINION,
  aiHint: 'harm',
  battlecry({ state, target }) {
    if (!target) return;
    P.silenceMinion(state, target);
    P.freezeMinion(state, target, 1);
  },
});
defineCard('black_pudding', drSummon('t_pudding', 2));
defineCard('void_ooze', {
  deathrattle({ state, controller }) {
    const t = P.randomEnemyMinion(state, controller);
    if (t) P.buff(state, t, -2, -2);
  },
});
defineCard('crystal_ooze', drSummon('t_ooze', 1));
defineCard('magma_ooze', {
  deathrattle({ state }) {
    P.damageAllMinions(state, 2);
  },
});

/* ---------------- shared minion factories (hoisted) ---------------- */

function bcSummonTokens(tokenId, count) {
  return {
    aiHint: 'none',
    battlecry({ state, player }) {
      for (let i = 0; i < count; i++) P.summon(state, player, tokenId);
    },
  };
}

function bcAddRandomSpell() {
  return {
    aiHint: 'none',
    battlecry({ state, player }) {
      const spells = collectibleCards().filter((c) => c.type === 'spell');
      P.addToHand(state, player, pick(state, spells).id);
    },
  };
}

function bcRallyOthers(atk) {
  return {
    aiHint: 'none',
    battlecry({ state, player, self }) {
      for (const m of P.livingMinions(state, player)) {
        if (m.uid !== self.uid) P.buff(state, P.minionRef(m), atk, 0);
      }
    },
  };
}

/* =================================================================
 * SPELLS
 * ================================================================= */

defineCard('spark_bolt', spell({
  target: ANY_CHAR,
  aiHint: 'harm',
  aiAmount: 2,
  run({ state, target }) {
    P.dealDamage(state, target, 2);
  },
}));
defineCard('magic_missile', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.splitDamageAmongEnemies(state, player, 3, 1);
  },
}));
defineCard('firebolt', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 3,
  run({ state, target }) {
    P.dealDamage(state, target, 3);
  },
}));
defineCard('fireball', spell({
  target: ANY_CHAR,
  aiHint: 'harm',
  aiAmount: 5,
  run({ state, target }) {
    P.dealDamage(state, target, 5);
  },
}));
defineCard('meteor', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.splitDamageAmongEnemies(state, player, 10, 1);
  },
}));
defineCard('cloudkill', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.damageAllEnemyMinions(state, player, 3);
  },
}));
defineCard('lightning_storm', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.damageAllEnemyMinions(state, player, 2);
  },
}));
defineCard('cone_cold', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (const m of P.livingMinions(state, P.otherPlayer(player))) {
      P.freezeMinion(state, P.minionRef(m), 1);
      P.dealDamage(state, P.minionRef(m), 1);
    }
  },
}));
defineCard('disintegrate', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 99,
  run({ state, target }) {
    P.destroyMinion(state, target);
  },
}));
defineCard('polymorph', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 99,
  run({ state, target }) {
    P.transformMinion(state, target, 't_sheep');
  },
}));
defineCard('banishment', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  run({ state, target }) {
    P.bounceToHand(state, target, { costDelta: 2 });
  },
}));
defineCard('hold_monster', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  run({ state, target }) {
    P.freezeMinion(state, target, 2);
  },
}));
defineCard('turn_undead', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 4,
  run({ state, player, target }) {
    const m = P.findMinion(state, target);
    if (!m) return;
    if (m.controller !== player && getCard(m.cardId).tribe === 'Undead') {
      P.destroyMinion(state, target);
    } else {
      P.dealDamage(state, target, 4);
    }
  },
}));
defineCard('counterspell', spell({
  target: ANY_MINION,
  aiHint: 'harm',
  aiAmount: 2,
  run({ state, target }) {
    P.silenceMinion(state, target);
    P.dealDamage(state, target, 2);
  },
}));
defineCard('power_word_kill', spell({
  target: withFilter(ANY_MINION, (s, m) => m.atk >= 5),
  aiHint: 'harm',
  aiAmount: 99,
  run({ state, target }) {
    P.destroyMinion(state, target);
  },
}));
defineCard('chain_lightning', spell({
  aiHint: 'none',
  run({ state, player }) {
    damageDistinctRandomEnemies(state, player, 3, 2);
  },
}));
defineCard('bless', spellBuff(1, 1));
defineCard('heroism', spell({
  target: FRIENDLY_MINION,
  aiHint: 'help',
  run({ state, target }) {
    P.buff(state, target, 2, 1);
    P.grantKeyword(state, target, 'taunt');
  },
}));
defineCard('enlarge', spellBuff(3, 3));
defineCard('haste_spell', spell({
  target: FRIENDLY_MINION,
  aiHint: 'help',
  run({ state, target }) {
    P.tempAtkChange(state, target, 2);
    P.grantTempKeyword(state, target, 'haste');
  },
}));
defineCard('divine_shield_spell', spell({
  target: FRIENDLY_MINION,
  aiHint: 'help',
  run({ state, target }) {
    P.grantKeyword(state, target, 'ward');
  },
}));
defineCard('blessing_might', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (const m of P.livingMinions(state, player)) P.buff(state, P.minionRef(m), 1, 1);
  },
}));
defineCard('cure_wounds', spell({
  target: FRIENDLY_CHAR,
  aiHint: 'help',
  run({ state, target }) {
    P.heal(state, target, 5);
  },
}));
defineCard('mass_heal', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.heal(state, P.heroRef(player), 3);
    for (const m of P.livingMinions(state, player)) P.heal(state, P.minionRef(m), 3);
  },
}));
defineCard('shield_of_faith', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.gainArmor(state, player, 6);
  },
}));
defineCard('divination', spellDraw(1));
defineCard('draught_insight', spellDraw(2));
defineCard('contact_plane', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.drawCard(state, player, 3);
    P.dealDamage(state, P.heroRef(player), 2);
  },
}));
defineCard('raise_dead', spell({
  aiHint: 'none',
  run({ state, player }) {
    const dead = state.players[player].graveyard;
    if (dead.length === 0) {
      P.log(state, 'No fallen minions to raise.');
      return;
    }
    P.summon(state, player, pick(state, dead));
  },
}));
defineCard('animate_dead', spell({
  aiHint: 'none',
  run({ state, player }) {
    const dead = state.players[player].graveyard;
    if (dead.length === 0) {
      P.log(state, 'No fallen minions to animate.');
      return;
    }
    const highest = Math.max(...dead.map((id) => getCard(id).cost));
    const choice = pick(state, dead.filter((id) => getCard(id).cost === highest));
    const m = P.summon(state, player, choice);
    if (m) m.hp = 1;
  },
}));
defineCard('wish', spell({
  aiHint: 'none',
  run({ state, player }) {
    const legendaries = collectibleCards().filter((c) => c.type === 'minion' && c.legendary);
    P.addToHand(state, player, pick(state, legendaries).id);
  },
}));
defineCard('summon_swarm', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (let i = 0; i < 3; i++) P.summon(state, player, 't_spiderling');
  },
}));
defineCard('healing_spirit', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.heal(state, P.heroRef(player), 4);
    P.drawCard(state, player, 1);
  },
}));
defineCard('web', spell({
  target: ENEMY_MINION,
  aiHint: 'harm',
  run({ state, target }) {
    P.freezeMinion(state, target, 1);
  },
}));
defineCard('entangle', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (const m of P.livingMinions(state, P.otherPlayer(player))) P.freezeMinion(state, P.minionRef(m), 1);
  },
}));
defineCard('blade_barrier', spell({
  aiHint: 'none',
  run({ state, player }) {
    P.damageAllEnemyMinions(state, player, 1);
    state.delayed.push({ player, effect: 'blade_barrier' });
  },
}));
defineCard('mirror_image', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (let i = 0; i < 2; i++) P.summon(state, player, 't_illusion');
  },
}));
defineCard('meld', spell({
  target: FRIENDLY_MINION,
  aiHint: 'none',
  run({ state, player, target }) {
    const m = P.findMinion(state, target);
    if (!m) return;
    const tribe = getCard(m.cardId).tribe;
    P.destroyMinion(state, target);
    const pool = collectibleCards().filter((c) => c.type === 'minion' && c.tribe === tribe);
    for (let i = 0; i < 2; i++) P.addToHand(state, player, pick(state, pool).id);
  },
}));
defineCard('dominate', spell({
  target: ENEMY_MINION,
  aiHint: 'harm',
  aiAmount: 99,
  run({ state, player, target }) {
    P.takeControl(state, target, player);
  },
}));
defineCard('mass_dispel', spell({
  aiHint: 'none',
  run({ state, player }) {
    for (const m of P.livingMinions(state, P.otherPlayer(player))) P.silenceMinion(state, P.minionRef(m));
  },
}));

/* ---------------- spell factories (hoisted) ---------------- */

function spellBuff(atk, hp) {
  return spell({
    target: FRIENDLY_MINION,
    aiHint: 'help',
    run({ state, target }) {
      P.buff(state, target, atk, hp);
    },
  });
}

function spellDraw(n) {
  return spell({
    aiHint: 'none',
    run({ state, player }) {
      P.drawCard(state, player, n);
    },
  });
}

/* =================================================================
 * SCRY BATTLECRIES (need scry defined above)
 * ================================================================= */

defineCard('mothman', {
  aiHint: 'none',
  battlecry({ state, player }) {
    scry(state, player, 2);
  },
});
defineCard('chupacabra', {
  deathrattle({ state, controller }) {
    P.heal(state, P.heroRef(controller), 2);
  },
});

/* =================================================================
 * HERO POWERS
 * ================================================================= */

defineHeroPower('tinkers_ward', {
  run({ state, player }) {
    P.gainArmor(state, player, 3);
  },
});
defineHeroPower('emberspark', {
  target: ANY_CHAR,
  aiHint: 'harm',
  run({ state, target }) {
    P.dealDamage(state, target, 1);
  },
});
defineHeroPower('mending_hand', {
  run({ state, player }) {
    P.heal(state, P.heroRef(player), 3);
  },
});
defineHeroPower('bone_call', {
  playable: (state, playerId) => state.players[playerId].board.length < P.BOARD_LIMIT,
  run({ state, player }) {
    // The power's text says 1/1; the 2/2 skeleton token is the deathrattle
    // version — see NOTES.md.
    P.summon(state, player, 't_skeleton', { overrides: { atk: 1, hp: 1 } });
  },
});
defineHeroPower('scavenge', {
  run({ state, player }) {
    P.drawCard(state, player, 1);
    P.discardRandom(state, player);
  },
});
defineHeroPower('forge_blade', {
  target: FRIENDLY_MINION,
  aiHint: 'help',
  run({ state, target }) {
    P.buff(state, target, 1, 1);
  },
});
defineHeroPower('warp_step', {
  target: FRIENDLY_MINION,
  aiHint: 'help',
  run({ state, target }) {
    P.grantTempKeyword(state, target, 'rush');
  },
});

/* ---------------- registry sanity ---------------- */

/**
 * Every card whose data implies a scripted effect must have one. Called by
 * tests and at app startup so an unimplemented card fails fast, loudly.
 */
export function assertEffectCoverage() {
  const missing = [];
  for (const card of allCards()) {
    const def = effectOf(card.id);
    if (card.type === 'spell') {
      if (!def?.run) missing.push(`${card.id} (spell)`);
      continue;
    }
    if (card.keywords.includes('battlecry') && !(def?.battlecry || def?.retaliate)) {
      missing.push(`${card.id} (battlecry)`);
    }
    if (card.keywords.includes('deathrattle') && !def?.deathrattle) {
      missing.push(`${card.id} (deathrattle)`);
    }
  }
  // Cards with rules text but no marker keyword.
  for (const id of ['nosferatu', 'tarrasque']) {
    const def = effectOf(id);
    if (!def || (!def.onKill && !def.spawn)) missing.push(`${id} (text effect)`);
  }
  if (missing.length > 0) {
    throw new Error(`cards without implemented effects:\n  ${missing.join('\n  ')}`);
  }
}
