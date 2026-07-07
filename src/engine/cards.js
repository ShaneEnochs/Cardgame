// Card database. The engine never hardcodes card stats or text — everything
// comes from data/cards.json via initCards(). In the browser the UI fetches
// the JSON; under Node the tests read it from disk. Call initCards() once
// before creating a game.

let DB = null;

export function initCards(json) {
  const byId = new Map();
  for (const c of json.cards) {
    if (byId.has(c.id)) throw new Error(`duplicate card id: ${c.id}`);
    byId.set(c.id, Object.freeze({ ...c }));
  }
  const powersById = new Map();
  for (const p of json.hero_powers) powersById.set(p.id, Object.freeze({ ...p }));
  DB = {
    meta: json.meta,
    byId,
    powersById,
    all: json.cards.map((c) => byId.get(c.id)),
    heroPowers: json.hero_powers.map((p) => powersById.get(p.id)),
  };
  return DB;
}

function db() {
  if (!DB) throw new Error('card database not initialised — call initCards() first');
  return DB;
}

export function getCard(id) {
  const c = db().byId.get(id);
  if (!c) throw new Error(`unknown card id: ${id}`);
  return c;
}

export function hasCard(id) {
  return db().byId.has(id);
}

export function getHeroPower(id) {
  const p = db().powersById.get(id);
  if (!p) throw new Error(`unknown hero power id: ${id}`);
  return p;
}

export function allCards() {
  return db().all;
}

export function allHeroPowers() {
  return db().heroPowers;
}

/** Cards that can appear in decks, packs and the collection (no tokens). */
export function collectibleCards() {
  return db().all.filter((c) => !c.token);
}

export function keywordCosts() {
  return db().meta.keyword_costs;
}

export function tribes() {
  return db().meta.tribes;
}
