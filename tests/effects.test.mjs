import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine as E, newGame, put, give, setMana, mref, href } from './helpers.js';

function play(s, playerId, cardId, target) {
  setMana(s, playerId, 10);
  const inst = give(s, playerId, cardId);
  return E.applyAction(s, { type: 'playCard', cardUid: inst.uid, target });
}

test('every card in the set has its effects implemented', () => {
  E.assertEffectCoverage(); // throws on gaps
});

test('targeted battlecry requires a target when candidates exist, fizzles when none', () => {
  let s = newGame();
  put(s, 'p2', 'salamander');
  setMana(s, 'p1', 10);
  const yr = give(s, 'p1', 'young_red');
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: yr.uid }), /needs a target/);
  s = E.applyAction(s, { type: 'playCard', cardUid: yr.uid, target: mref(s.players.p2.board[0]) });
  assert.equal(s.players.p2.board[0].hp, 3);

  // No minions anywhere: the same battlecry fizzles but the body resolves.
  let s2 = newGame();
  s2 = play(s2, 'p1', 'young_red');
  assert.equal(s2.players.p1.board.length, 1);
});

test('spells with no legal target are unplayable', () => {
  const s = newGame();
  setMana(s, 'p1', 10);
  const bolt = give(s, 'p1', 'firebolt'); // needs a minion
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: bolt.uid }), /no legal targets/);
});

test('Banshee: -3 attack only for the current turn', () => {
  let s = newGame();
  const big = put(s, 'p2', 'hill_giant'); // 6/6
  s = play(s, 'p1', 'banshee', mref(big));
  assert.equal(s.players.p2.board[0].atk, 3);
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p2.board[0].atk, 6, 'expires at end of turn');
});

test('Banishment: bounced minion costs (2) more', () => {
  let s = newGame();
  put(s, 'p2', 'goblin'); // 1-cost
  s = play(s, 'p1', 'banishment', mref(s.players.p2.board[0]));
  const bounced = s.players.p2.hand.find((c) => c.cardId === 'goblin');
  assert.ok(bounced);
  assert.equal(E.effectiveCost(s, 'p2', bounced), 3);
});

test('Demilich discards the lowest-cost card and nukes for its cost', () => {
  let s = newGame();
  s.players.p1.hand = [];
  give(s, 'p1', 'fireball'); // cost 4
  give(s, 'p1', 'goblin'); // cost 1 — discarded
  put(s, 'p2', 'shambling_zombie'); // 2/3
  s = play(s, 'p1', 'demilich');
  assert.deepEqual(s.players.p1.hand.map((c) => c.cardId), ['fireball']);
  assert.equal(s.players.p2.board[0].hp, 2);
  assert.equal(s.players.p2.hero.hp, 29);
});

test('Phoenix returns to the battlefield with 1 health', () => {
  let s = newGame();
  const phoenix = put(s, 'p2', 'phoenix');
  s = play(s, 'p1', 'fireball', mref(phoenix));
  assert.equal(s.players.p2.board.length, 1);
  assert.equal(s.players.p2.board[0].cardId, 'phoenix');
  assert.equal(s.players.p2.board[0].hp, 1);
});

test('Dracolich returns to hand on death', () => {
  let s = newGame();
  const drac = put(s, 'p2', 'dracolich');
  s = play(s, 'p1', 'fireball', mref(drac));
  s = play(s, 'p1', 'fireball', mref(s.players.p2.board[0]));
  assert.ok(s.players.p2.hand.some((c) => c.cardId === 'dracolich'));
  assert.equal(s.players.p2.board.length, 0);
});

test('Ultroloth steals a minion until end of turn, then it returns asleep', () => {
  let s = newGame();
  put(s, 'p2', 'salamander');
  s = play(s, 'p1', 'ultroloth');
  assert.equal(s.players.p1.board.length, 2);
  const stolen = s.players.p1.board.find((m) => m.cardId === 'salamander');
  assert.equal(stolen.sick, false, 'temporary steals arrive ready');
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p2.board.length, 1);
  assert.equal(s.players.p2.board[0].cardId, 'salamander');
  assert.equal(s.players.p2.board[0].stolenUntilEndOfTurn, false);
});

test('a temporary steal with no room to return perishes', () => {
  let s = newGame();
  put(s, 'p2', 'salamander');
  s = play(s, 'p1', 'ultroloth');
  for (let i = 0; i < 7; i++) put(s, 'p2', 'goblin'); // fill the home board
  s = E.applyAction(s, { type: 'endTurn' });
  assert.ok(!s.players.p2.board.some((m) => m.cardId === 'salamander'));
  assert.ok(s.players.p2.graveyard.includes('salamander'));
});

test('Dominate takes control permanently; the minion arrives asleep', () => {
  let s = newGame();
  put(s, 'p2', 'salamander');
  s = play(s, 'p1', 'dominate', mref(s.players.p2.board[0]));
  const stolen = s.players.p1.board[0];
  assert.equal(stolen.cardId, 'salamander');
  assert.equal(stolen.sick, true);
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p1.board.length, 1, 'permanent steal does not bounce back');
});

test('Polymorph transforms without triggering deathrattles', () => {
  let s = newGame();
  const spider = put(s, 'p2', 'giant_spider'); // DR: two spiderlings
  s = play(s, 'p1', 'polymorph', mref(spider));
  assert.deepEqual(s.players.p2.board.map((m) => m.cardId), ['t_sheep']);
  assert.equal(s.players.p2.graveyard.length, 0);
});

test('silence strips buffs back to printed stats and keeps damage', () => {
  let s = newGame();
  const m = put(s, 'p1', 'worg'); // 4/3
  s = play(s, 'p1', 'enlarge', mref(m)); // now 7/6
  s.players.p1.board[0].hp = 4; // took 2 damage
  s.active = 'p2';
  s = play(s, 'p2', 'counterspell', mref(s.players.p1.board[0]));
  // Silence reverts to printed 4/3 keeping the 2 damage -> 4/1; then 2 damage kills it.
  assert.equal(s.players.p1.board.length, 0);

  // Silence alone can't kill: it floors at 1 hp.
  let s2 = newGame();
  const m2 = put(s2, 'p1', 'worg');
  s2 = play(s2, 'p1', 'enlarge', mref(m2)); // 7/6
  s2.players.p1.board[0].hp = 2; // 4 damage taken, more than printed hp
  s2.active = 'p2';
  s2 = play(s2, 'p2', 'mass_dispel');
  const after = s2.players.p1.board[0];
  assert.equal(after.atk, 4);
  assert.equal(after.maxHp, 3);
  assert.equal(after.hp, 1);
});

test('Tarrasque: untargetable by spells and hero powers, still attackable and battlecry-targetable', () => {
  let s = newGame({ p2Power: 'emberspark' });
  const big = put(s, 'p1', 'tarrasque');
  // enemy spell cannot target it
  setMana(s, 'p2', 10);
  s.active = 'p2';
  const bolt = give(s, 'p2', 'firebolt');
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: bolt.uid, target: mref(big) }), /(no legal targets|illegal target)/);
  // enemy hero power cannot target it
  assert.throws(() => E.applyAction(s, { type: 'heroPower', target: mref(big) }), /illegal target/);
  // battlecry damage CAN target it (only spells/hero powers are excluded)
  const yr = give(s, 'p2', 'young_red');
  const afterBc = E.applyAction(s, { type: 'playCard', cardUid: yr.uid, target: mref(big) });
  assert.equal(afterBc.players.p1.board[0].ward, false, 'battlecry popped the ward');
  // attacks can hit it
  const attacker = put(s, 'p2', 'worg');
  const afterAtk = E.applyAction(s, { type: 'attack', attacker: mref(attacker), target: mref(big) });
  assert.ok(afterAtk);
});

test('Invisible Stalker cannot be targeted by enemies until it attacks', () => {
  let s = newGame();
  s = play(s, 'p1', 'invisible_stalker');
  const stalker = s.players.p1.board[0];
  assert.equal(stalker.elusive, 'until-attack');

  s.active = 'p2';
  setMana(s, 'p2', 10);
  const bolt = give(s, 'p2', 'firebolt');
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: bolt.uid, target: mref(stalker) }), /(no legal targets|illegal target)/);

  // friendly effects can still target it
  s.active = 'p1';
  s = play(s, 'p1', 'bless', mref(stalker));
  assert.equal(s.players.p1.board[0].atk, 6);

  // after it attacks, it becomes targetable
  s = E.applyAction(s, { type: 'endTurn' });
  s = E.applyAction(s, { type: 'endTurn' });
  s = E.applyAction(s, { type: 'attack', attacker: mref(s.players.p1.board[0]), target: href('p2') });
  assert.equal(s.players.p1.board[0].elusive, null);
});

test('Ancient Red Dragon makes your Dragons cost (1) less while in play', () => {
  let s = newGame();
  put(s, 'p1', 'ancient_red');
  const dragon = give(s, 'p1', 'young_red'); // 4-cost dragon
  const beast = give(s, 'p1', 'cave_bear'); // 4-cost non-dragon
  assert.equal(E.effectiveCost(s, 'p1', dragon), 3);
  assert.equal(E.effectiveCost(s, 'p1', beast), 4);
});

test('scry (Emerald Mind Dragon) creates a choice; other actions are blocked until resolved', () => {
  let s = newGame();
  s = play(s, 'p1', 'gem_emerald');
  assert.ok(s.pendingChoice);
  assert.equal(s.pendingChoice.options.length, 3);
  assert.throws(() => E.applyAction(s, { type: 'endTurn' }), /choice/);
  const handBefore = s.players.p1.hand.length;
  const deckBefore = s.players.p1.deck.length;
  const wanted = s.pendingChoice.options[1];
  s = E.applyAction(s, { type: 'choose', index: 1 });
  assert.equal(s.pendingChoice, null);
  assert.equal(s.players.p1.hand.length, handBefore + 1);
  assert.equal(s.players.p1.deck.length, deckBefore - 1);
  assert.equal(s.players.p1.hand.at(-1).cardId, wanted);
});

test('Leprechaun grants 20 profile coins and a Wish on death', () => {
  let s = newGame();
  put(s, 'p1', 'leprechaun');
  s.active = 'p2';
  s = play(s, 'p2', 'firebolt', mref(s.players.p1.board[0]));
  assert.equal(s.players.p1.coinsEarned, 20);
  assert.ok(s.players.p1.hand.some((c) => c.cardId === 'wish'));
});

test('Raise Dead and Animate Dead pull from the graveyard', () => {
  let s = newGame();
  s.players.p1.graveyard.push('salamander', 'tarrasque');
  s = play(s, 'p1', 'raise_dead');
  assert.equal(s.players.p1.board.length, 1);
  s = play(s, 'p1', 'animate_dead');
  const animated = s.players.p1.board.at(-1);
  assert.equal(animated.cardId, 'tarrasque', 'highest cost dead minion');
  assert.equal(animated.hp, 1);
});

test('Blade Barrier hits now and again at the start of your next turn', () => {
  let s = newGame();
  put(s, 'p2', 'shambling_zombie'); // 2/3
  s = play(s, 'p1', 'blade_barrier');
  assert.equal(s.players.p2.board[0].hp, 2);
  assert.equal(s.delayed.length, 1);
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p2.board[0].hp, 2, 'nothing on the opponent turn');
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p2.board[0].hp, 1, 'fires at start of caster turn');
  assert.equal(s.delayed.length, 0);
});

test('Turn Undead destroys enemy Undead but only damages anything else', () => {
  let s = newGame();
  const undead = put(s, 'p2', 'ogre_zombie'); // 5/4 Undead
  const beast = put(s, 'p2', 'cave_bear'); // 4/5 Beast
  s = play(s, 'p1', 'turn_undead', mref(undead));
  assert.ok(!s.players.p2.board.some((m) => m.cardId === 'ogre_zombie'));
  s = play(s, 'p1', 'turn_undead', mref(beast));
  assert.equal(s.players.p2.board[0].hp, 1);
});

test('Rust Monster eats a random enemy Construct when one exists, otherwise debuffs', () => {
  let s = newGame();
  put(s, 'p2', 'clay_golem');
  s = play(s, 'p1', 'rust_monster'); // no target needed
  assert.equal(s.players.p2.board.length, 0);

  let s2 = newGame();
  const bear = put(s2, 'p2', 'cave_bear');
  s2 = play(s2, 'p1', 'rust_monster', mref(bear));
  assert.equal(s2.players.p2.board[0].atk, 2);
});

test('Harpy forces an enemy minion to fight one of its own allies', () => {
  let s = newGame();
  const zombie = put(s, 'p2', 'ogre_zombie'); // 5/4
  put(s, 'p2', 'goblin'); // 2/1 — the only possible victim
  s = play(s, 'p1', 'harpy', mref(zombie));
  assert.ok(!s.players.p2.board.some((m) => m.cardId === 'goblin'), 'goblin died to its ally');
  assert.equal(s.players.p2.board.find((m) => m.cardId === 'ogre_zombie').hp, 2);
});

test('Marilith swings once per other friendly Fiend', () => {
  let s = newGame();
  put(s, 'p1', 'imp');
  put(s, 'p1', 'dretch');
  put(s, 'p1', 'cave_bear'); // not a fiend
  // no enemy minions: both swings go at the enemy hero for 7
  s = play(s, 'p1', 'marilith');
  assert.equal(s.players.p2.hero.hp, 30 - 14);
});

test('Aboleth swaps one random minion from each side', () => {
  let s = newGame();
  put(s, 'p1', 'goblin');
  put(s, 'p2', 'salamander');
  s = play(s, 'p1', 'aboleth');
  assert.ok(s.players.p1.board.some((m) => m.cardId === 'salamander'));
  assert.ok(s.players.p2.board.some((m) => m.cardId === 'goblin'));
  assert.ok(s.players.p1.board.some((m) => m.cardId === 'aboleth'), 'aboleth itself never swaps');
});

test('Remorhaz grows +3/+3 only if its battlecry kills', () => {
  let s = newGame();
  const small = put(s, 'p2', 'goblin');
  s = play(s, 'p1', 'remorhaz', mref(small));
  assert.equal(s.players.p1.board[0].atk, 9);

  let s2 = newGame();
  const big = put(s2, 'p2', 'hill_giant');
  s2 = play(s2, 'p1', 'remorhaz', mref(big));
  assert.equal(s2.players.p1.board[0].atk, 6);
});

test('Barbed Devil deals 2 back whenever it survives damage', () => {
  let s = newGame();
  put(s, 'p2', 'barbed_devil'); // 4/4
  const attacker = put(s, 'p1', 'worg'); // 4/3: deals 4? no — barbed has 4hp, survives? 4-4=0 dies. use smaller.
  const poker = put(s, 'p1', 'goblin'); // 2/1
  s = E.applyAction(s, { type: 'attack', attacker: mref(poker), target: mref(s.players.p2.board[0]) });
  // goblin dealt 2, devil survived at 2, lashed back 2 killing the goblin (already dead from retaliation anyway)
  assert.equal(s.players.p2.board[0].hp, 2);
  assert.ok(!s.players.p1.board.some((m) => m.uid === poker.uid));
  assert.ok(s.players.p1.board.some((m) => m.uid === attacker.uid));
});

test('Nosferatu gains +2/+2 when it kills', () => {
  let s = newGame();
  const nos = put(s, 'p1', 'nosferatu'); // 6/6
  put(s, 'p2', 'goblin');
  s = E.applyAction(s, { type: 'attack', attacker: mref(nos), target: mref(s.players.p2.board[0]) });
  const after = s.players.p1.board[0];
  assert.equal(after.atk, 8);
  assert.equal(after.maxHp, 8);
});

test('Clockwork Titan summons one random Construct per Construct you control', () => {
  let s = newGame();
  put(s, 'p1', 'clay_golem');
  put(s, 'p1', 'iron_golem');
  s = play(s, 'p1', 'clockwork_titan');
  // 3 constructs counted (2 + titan itself) -> 3 summons, 6 total minions
  assert.equal(s.players.p1.board.length, 6);
  for (const m of s.players.p1.board) {
    assert.equal(E.getCard(m.cardId).tribe, 'Construct');
  }
});

test('Reforge destroys a friendly minion and adds two cards of its tribe', () => {
  let s = newGame();
  const bear = put(s, 'p1', 'cave_bear');
  s.players.p1.hand = [];
  s = play(s, 'p1', 'meld', mref(bear));
  assert.equal(s.players.p1.board.length, 0);
  assert.equal(s.players.p1.hand.length, 2);
  for (const c of s.players.p1.hand) {
    assert.equal(E.getCard(c.cardId).tribe, 'Beast');
  }
});

test('Nine-Tailed Fox casts a random spell from the deck for free', () => {
  let s = newGame();
  // Deck with exactly one spell so the "random" pick is deterministic.
  s.players.p1.deck = s.players.p1.deck.filter((c) => E.getCard(c.cardId).type === 'minion');
  const inst = { uid: 'spelltest', cardId: 'shield_of_faith', costDelta: 0 };
  s.players.p1.deck.push(inst);
  s = play(s, 'p1', 'ninetails');
  assert.equal(s.players.p1.hero.armor, 6, 'shield of faith was cast');
  assert.ok(!s.players.p1.deck.some((c) => c.uid === 'spelltest'), 'spell left the deck');
});

test('hero powers: once per turn, correct costs and targeting', () => {
  let s = newGame({ p1Power: 'emberspark' });
  setMana(s, 'p1', 10);
  s = E.applyAction(s, { type: 'heroPower', target: href('p2') });
  assert.equal(s.players.p2.hero.hp, 29);
  assert.equal(s.players.p1.mana, 8);
  assert.throws(() => E.applyAction(s, { type: 'heroPower', target: href('p2') }), /already used/);
});

test('Call the Bones summons a 1/1 Skeleton (power text overrides token stats)', () => {
  let s = newGame({ p1Power: 'bone_call' });
  setMana(s, 'p1', 2);
  s = E.applyAction(s, { type: 'heroPower' });
  const skel = s.players.p1.board[0];
  assert.equal(skel.cardId, 't_skeleton');
  assert.equal(skel.atk, 1);
  assert.equal(skel.hp, 1);
});

test("Warp Step lets a summoning-sick minion attack minions this turn", () => {
  let s = newGame({ p1Power: 'warp_step' });
  setMana(s, 'p1', 10);
  put(s, 'p2', 'goblin');
  const fresh = give(s, 'p1', 'cave_bear');
  s = E.applyAction(s, { type: 'playCard', cardUid: fresh.uid });
  const bear = s.players.p1.board[0];
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: mref(bear), target: mref(s.players.p2.board[0]) }), /sickness/);
  s = E.applyAction(s, { type: 'heroPower', target: mref(bear) });
  s = E.applyAction(s, { type: 'attack', attacker: mref(s.players.p1.board[0]), target: mref(s.players.p2.board[0]) });
  assert.equal(s.players.p2.board.length, 0);
});

test("Scavenger's Eye draws then discards at random", () => {
  let s = newGame({ p1Power: 'scavenge' });
  setMana(s, 'p1', 2);
  const hand = s.players.p1.hand.length;
  const deck = s.players.p1.deck.length;
  s = E.applyAction(s, { type: 'heroPower' });
  assert.equal(s.players.p1.hand.length, hand); // +1 draw, -1 discard
  assert.equal(s.players.p1.deck.length, deck - 1);
});
