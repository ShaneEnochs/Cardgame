import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine as E } from './helpers.js';
import {
  createProfileStore, newProfile, saveDeck, deleteDeck, validateProfileDeck,
  applyGameResult, STARTER_DECK, STORAGE_KEY, PACK_COST, PACK_SIZE,
} from '../src/meta/profile.js';
import { buyPack, rollPack } from '../src/meta/packs.js';
import { AI_DECKS } from '../src/meta/aidecks.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

test('a new profile has a legal starter deck it can actually build', () => {
  const p = newProfile();
  assert.equal(p.decks.length, 1);
  validateProfileDeck(p, p.decks[0].cards); // throws if illegal or unowned
  assert.equal(p.decks[0].cards.length, 30);
  assert.equal(p.decks[0].heroPower, STARTER_DECK.heroPower);
});

test('profile persists through the storage adapter and survives reloads', () => {
  const storage = fakeStorage();
  const store = createProfileStore(storage);
  const p = store.load();
  p.coins = 999;
  store.save(p);
  const reloaded = createProfileStore(storage).load();
  assert.equal(reloaded.coins, 999);
  assert.ok(storage.dump()[STORAGE_KEY].includes('"coins":999'));
});

test('corrupt storage falls back to a fresh profile instead of crashing', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const p = createProfileStore(storage).load();
  assert.equal(p.version, 1);
  assert.ok(p.coins > 0);
});

test('packs cost coins, contain 5 collectible cards, and land in the collection', () => {
  const p = newProfile();
  p.coins = PACK_COST;
  const before = Object.values(p.collection).reduce((a, b) => a + b, 0);
  const cards = buyPack(p, () => 0.5);
  assert.equal(cards.length, PACK_SIZE);
  assert.equal(p.coins, 0);
  const after = Object.values(p.collection).reduce((a, b) => a + b, 0);
  assert.equal(after, before + PACK_SIZE);
  assert.throws(() => buyPack(p), /costs/);
  for (const id of cards) assert.ok(!E.getCard(id).token, 'no tokens in packs');
});

test('pack legendary slots come from the legendary pool', () => {
  // rand < LEGENDARY_CHANCE picks a legendary; force it.
  const cards = rollPack(() => 0.0);
  for (const id of cards) assert.equal(E.getCard(id).legendary, true);
});

test('deckbuilding enforces ownership on top of engine rules', () => {
  const p = newProfile();
  // Tries to use 2 copies of a card the starter collection doesn't own.
  const cards = [...p.decks[0].cards.slice(0, 28), 'tarrasque', 'tarrasque'];
  assert.throws(() => saveDeck(p, { name: 'X', heroPower: 'emberspark', cards }), /too many copies/);
  const oneCopy = [...p.decks[0].cards.slice(0, 29), 'tarrasque'];
  assert.throws(() => saveDeck(p, { name: 'X', heroPower: 'emberspark', cards: oneCopy }), /you own 0/);

  // A legal edit of the starter deck saves fine.
  const deck = saveDeck(p, { name: 'Tweaked', heroPower: 'forge_blade', cards: p.decks[0].cards });
  assert.equal(p.decks.length, 2);
  assert.equal(deck.heroPower, 'forge_blade');
  deleteDeck(p, deck.id);
  assert.equal(p.decks.length, 1);
  assert.throws(() => deleteDeck(p, p.decks[0].id), /at least one/);
});

test('game results pay out coins and track stats', () => {
  const p = newProfile();
  const start = p.coins;
  const w = applyGameResult(p, { mode: 'ai', outcome: 'win' });
  const l = applyGameResult(p, { mode: 'ai', outcome: 'loss', bonusCoins: 20 });
  const h = applyGameResult(p, { mode: 'hotseat', outcome: 'win' });
  assert.equal(w, 60);
  assert.equal(l, 40); // 20 loss + 20 leprechaun bonus
  assert.equal(h, 30);
  assert.equal(p.coins, start + 130);
  assert.deepEqual(p.stats, { wins: 2, losses: 1, draws: 0, games: 3 });
});

test('all prebuilt AI decks are legal', () => {
  for (const deck of AI_DECKS) {
    E.validateDeck(deck.cards);
    assert.ok(deck.heroPower);
  }
});
