import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine as E, newGame, put, give, setMana, mref, href } from './helpers.js';

test('mana climbs by one per turn and caps at 10', () => {
  let s = newGame();
  assert.equal(s.players.p1.mana, 1);
  for (let i = 0; i < 24; i++) s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p1.maxMana, 10);
  assert.equal(s.players.p2.maxMana, 10);
});

test('drawing from an empty deck deals escalating fatigue', () => {
  const s = newGame();
  s.players.p2.deck = [];
  let n = E.applyAction(s, { type: 'endTurn' }); // p2 draws from empty deck
  assert.equal(n.players.p2.fatigue, 1);
  assert.equal(n.players.p2.hero.hp, 29);
  n = E.applyAction(n, { type: 'endTurn' });
  n = E.applyAction(n, { type: 'endTurn' }); // p2's next turn: fatigue 2
  assert.equal(n.players.p2.fatigue, 2);
  assert.equal(n.players.p2.hero.hp, 27);
});

test('summoning sickness: a fresh minion cannot attack, charge can, rush hits minions only', () => {
  let s = newGame();
  setMana(s, 'p1', 10);
  const enemy = put(s, 'p2', 'goblin');
  const sickUid = give(s, 'p1', 'goblin').uid;
  const chargeUid = give(s, 'p1', 'spectre').uid;
  const rushUid = give(s, 'p1', 'wind_drake').uid;
  s = E.applyAction(s, { type: 'playCard', cardUid: sickUid });
  s = E.applyAction(s, { type: 'playCard', cardUid: chargeUid });
  s = E.applyAction(s, { type: 'playCard', cardUid: rushUid });
  const [sick, charge, rush] = s.players.p1.board.slice(-3);

  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: mref(sick), target: href('p2') }), /sickness/);
  // rush minion cannot go face on its first turn…
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: mref(rush), target: href('p2') }));
  // …but can hit a minion.
  const afterRush = E.applyAction(s, { type: 'attack', attacker: mref(rush), target: mref(s.players.p2.board[0]) });
  assert.equal(afterRush.players.p2.board.length, 0); // goblin died (3 atk vs 1 hp)
  // charge can go face immediately.
  const afterCharge = E.applyAction(s, { type: 'attack', attacker: mref(charge), target: href('p2') });
  assert.equal(afterCharge.players.p2.hero.hp, 26);
});

test('taunt forces attacks onto it; silence lifts the wall', () => {
  let s = newGame();
  const attacker = put(s, 'p1', 'worg');
  put(s, 'p2', 'goblin');
  const taunt = put(s, 'p2', 'dretch');
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: mref(attacker), target: href('p2') }), /taunt/);
  assert.throws(
    () => E.applyAction(s, { type: 'attack', attacker: mref(attacker), target: mref(s.players.p2.board[0]) }),
    /taunt/
  );
  const ok = E.applyAction(s, { type: 'attack', attacker: mref(attacker), target: mref(taunt) });
  assert.equal(ok.players.p2.board.length, 1); // dretch (1/3) died to 4 atk

  // Silenced taunt no longer blocks.
  let s2 = newGame();
  const atk2 = put(s2, 'p1', 'worg');
  const taunt2 = put(s2, 'p2', 'dretch');
  setMana(s2, 'p1', 10);
  const rug = give(s2, 'p1', 'rug_smothering');
  s2 = E.applyAction(s2, { type: 'playCard', cardUid: rug.uid, target: mref(taunt2) });
  const face = E.applyAction(s2, { type: 'attack', attacker: mref(atk2), target: href('p2') });
  assert.equal(face.players.p2.hero.hp, 26);
});

test('ward absorbs one damage instance completely', () => {
  let s = newGame();
  const warded = put(s, 'p2', 'faerie_dragon'); // 2/2 ward
  const attacker = put(s, 'p1', 'worg'); // 4/3
  s = E.applyAction(s, { type: 'attack', attacker: mref(attacker), target: mref(warded) });
  const survivor = s.players.p2.board[0];
  assert.equal(survivor.hp, 2, 'ward ate the hit');
  assert.equal(survivor.ward, false);
  assert.equal(s.players.p1.board[0].hp, 1, 'attacker still takes retaliation');
});

test('lifesteal heals the controller on combat damage', () => {
  let s = newGame();
  s.players.p1.hero.hp = 20;
  const ghoul = put(s, 'p1', 'crypt_ghoul'); // 4/2 lifesteal
  put(s, 'p2', 'cave_bear'); // 4/5
  s = E.applyAction(s, { type: 'attack', attacker: mref(ghoul), target: mref(s.players.p2.board[0]) });
  assert.equal(s.players.p1.hero.hp, 24);
});

test('freeze-on-damage freezes, frozen minions cannot attack, thaw at end of own turn', () => {
  let s = newGame();
  const frost = put(s, 'p1', 'frost_drake'); // 3/3 freeze
  const victim = put(s, 'p2', 'earth_elemental'); // 4/8 taunt
  s = E.applyAction(s, { type: 'attack', attacker: mref(frost), target: mref(victim) });
  assert.equal(s.players.p2.board[0].frozen, 1);

  s = E.applyAction(s, { type: 'endTurn' }); // now p2's turn; its minion is frozen
  const frozenRef = mref(s.players.p2.board[0]);
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: frozenRef, target: href('p1') }));
  s = E.applyAction(s, { type: 'endTurn' }); // end of p2's turn: thaw
  assert.equal(s.players.p2.board[0].frozen, 0);
});

test('Hold Monster freezes through two of the owner turns', () => {
  let s = newGame();
  const victim = put(s, 'p2', 'salamander');
  setMana(s, 'p1', 10);
  const hold = give(s, 'p1', 'hold_monster');
  s = E.applyAction(s, { type: 'playCard', cardUid: hold.uid, target: mref(victim) });
  assert.equal(s.players.p2.board[0].frozen, 2);
  s = E.applyAction(s, { type: 'endTurn' }); // p2 turn, frozen 2
  s = E.applyAction(s, { type: 'endTurn' }); // thaw tick -> 1
  assert.equal(s.players.p2.board[0].frozen, 1);
  s = E.applyAction(s, { type: 'endTurn' }); // p2 turn again, still frozen
  s = E.applyAction(s, { type: 'endTurn' });
  assert.equal(s.players.p2.board[0].frozen, 0);
});

test('armor absorbs before health', () => {
  let s = newGame();
  s.players.p2.hero.armor = 2;
  const orc = put(s, 'p1', 'orc'); // 3/2
  s = E.applyAction(s, { type: 'attack', attacker: mref(orc), target: href('p2') });
  assert.equal(s.players.p2.hero.armor, 0);
  assert.equal(s.players.p2.hero.hp, 29);
});

test('deathrattle chains resolve fully (AoE rattle killing small minions)', () => {
  let s = newGame();
  put(s, 'p2', 'magma_ooze'); // DR: 2 dmg all minions
  put(s, 'p2', 'goblin'); // 2/1 — will die to the rattle
  put(s, 'p1', 'human_skeleton'); // 2/1 — also dies
  const giant = put(s, 'p1', 'iron_golem'); // 7/7 kills the ooze
  s = E.applyAction(s, { type: 'attack', attacker: mref(giant), target: mref(s.players.p2.board[0]) });
  assert.equal(s.players.p2.board.length, 0);
  assert.deepEqual(s.players.p1.board.map((m) => m.cardId), ['iron_golem']);
  assert.equal(s.players.p1.board[0].hp, 7 - 4 - 2); // ooze retaliation + rattle
  assert.ok(s.players.p2.graveyard.includes('magma_ooze'));
});

test('hand limit burns drawn cards; board limit blocks minion play', () => {
  let s = newGame();
  const p1 = s.players.p1;
  while (p1.hand.length < 10) give(s, 'p1', 'goblin');
  const deckBefore = p1.deck.length;
  s = E.applyAction(s, { type: 'endTurn' });
  s = E.applyAction(s, { type: 'endTurn' }); // p1 draws with a full hand
  assert.equal(s.players.p1.hand.length, 10);
  assert.equal(s.players.p1.deck.length, deckBefore - 1);

  for (let i = 0; i < 7; i++) put(s, 'p1', 'goblin');
  setMana(s, 'p1', 10);
  const uid = s.players.p1.hand.find((c) => E.getCard(c.cardId).type === 'minion').uid;
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: uid }), /board is full/);
});

test('illegal actions throw and leave the previous state untouched', () => {
  const s = newGame();
  const before = JSON.stringify(s);
  assert.throws(() => E.applyAction(s, { type: 'playCard', cardUid: 'nonsense' }), E.IllegalAction);
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: href('p2'), target: href('p1') }), E.IllegalAction);
  assert.equal(JSON.stringify(s), before);
});

test('validateState rejects a hero mutated with foreign flags (the prototype bug)', () => {
  const s = newGame();
  s.players.p2.hero.__isHero = true;
  assert.throws(() => E.validateState(s), /foreign key/);
});

test('simultaneous hero deaths are a draw (Bodak both-hero burn)', () => {
  let s = newGame();
  s.players.p1.hero.hp = 2;
  s.players.p2.hero.hp = 2;
  setMana(s, 'p1', 10);
  const bodak = give(s, 'p1', 'bodak');
  s = E.applyAction(s, { type: 'playCard', cardUid: bodak.uid });
  assert.equal(s.winner, 'draw');
});

test('Death Knight equips a weapon; the hero can attack and it breaks at 0 durability', () => {
  let s = newGame();
  setMana(s, 'p1', 10);
  const dk = give(s, 'p1', 'death_knight');
  s = E.applyAction(s, { type: 'playCard', cardUid: dk.uid });
  assert.deepEqual(s.players.p1.weapon, { name: 'Soul Blade', atk: 3, durability: 2 });

  s = E.applyAction(s, { type: 'attack', attacker: href('p1'), target: href('p2') });
  assert.equal(s.players.p2.hero.hp, 27);
  assert.equal(s.players.p1.weapon.durability, 1);
  // once per turn
  assert.throws(() => E.applyAction(s, { type: 'attack', attacker: href('p1'), target: href('p2') }));
  s = E.applyAction(s, { type: 'endTurn' });
  s = E.applyAction(s, { type: 'endTurn' });
  const enemy = put(s, 'p2', 'orc'); // hero takes retaliation
  s = E.applyAction(s, { type: 'attack', attacker: href('p1'), target: mref(enemy) });
  assert.equal(s.players.p1.weapon, null, 'blade broke');
  assert.equal(s.players.p1.hero.hp, 27, 'hero took the orc retaliation');
});

test('deck rules: size, copy limit, legendary limit, no tokens', () => {
  assert.throws(() => E.validateDeck(['goblin']), /exactly 30/);
  const tooMany = ['goblin', 'goblin', 'goblin'];
  while (tooMany.length < 30) tooMany.push('orc');
  assert.throws(() => E.validateDeck(tooMany), /too many copies/i);
  const twoLegends = ['tarrasque', 'tarrasque'];
  while (twoLegends.length < 30) twoLegends.push(twoLegends.length % 2 ? 'goblin' : 'orc');
  assert.throws(() => E.validateDeck(twoLegends), /too many copies/i);
  const tokenDeck = ['t_sheep'];
  while (tokenDeck.length < 30) tokenDeck.push(tokenDeck.length % 2 ? 'goblin' : 'orc');
  assert.throws(() => E.validateDeck(tokenDeck), /token/);
});
