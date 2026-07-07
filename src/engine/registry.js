// Effect registry: cardId -> effect definition, heroPowerId -> definition.
// Kept in its own module so primitives.js (which needs to fire deathrattles)
// and effects.js (which defines them) don't import each other.

export const cardEffects = new Map();
export const heroPowerEffects = new Map();

export function defineCard(id, def) {
  if (cardEffects.has(id)) throw new Error(`effect already defined for ${id}`);
  cardEffects.set(id, def);
}

export function defineHeroPower(id, def) {
  heroPowerEffects.set(id, def);
}

export function effectOf(cardId) {
  return cardEffects.get(cardId) || null;
}

export function heroPowerEffectOf(powerId) {
  const def = heroPowerEffects.get(powerId);
  if (!def) throw new Error(`no effect defined for hero power ${powerId}`);
  return def;
}
