// The set's balance model, ported from the card build script:
//   stat budget: atk + hp + Σ keyword_costs ≈ cost*2 + 1
// A minion is "on curve" when its deviation from that budget is within
// TOLERANCE. A handful of cards are intentional outliers (see NOTES.md) and
// are allowlisted here — the audit fails if anything else drifts, and also if
// an allowlisted card stops being an outlier (so the list stays honest).

import { allCards, keywordCosts } from './cards.js';

export const TOLERANCE = 2;

// Intentional outliers. The spec says six; the data carries no labels and
// exactly five sit outside ±2 under the stated model. Leprechaun (-2, the
// deliberate joke card) is the likely sixth — kept OUT of this list until
// confirmed, since at -2 it still passes the tolerance check.
export const INTENTIONAL_OUTLIERS = new Set([
  'tarrasque', // +7: the 10-mana finisher
  'nosferatu', // -4: pays for its snowballing on-kill trigger
  'lich', // -3: pays for AoE + draw
  'mummy_lord', // -3: pays for the token flood
  'wailing_banshee', // -3: pays for AoE + silence
]);

export function auditMinion(card) {
  const costs = keywordCosts();
  const keywordValue = card.keywords.reduce((s, k) => s + (costs[k] ?? 0), 0);
  const value = card.atk + card.hp + keywordValue;
  const budget = card.cost * 2 + 1;
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    statline: `${card.atk}/${card.hp}`,
    keywords: card.keywords,
    value,
    budget,
    deviation: value - budget,
    legendary: card.legendary,
    intentional: INTENTIONAL_OUTLIERS.has(card.id),
  };
}

/** Audit every non-token minion. Tokens aren't priced — they cost no mana. */
export function auditSet() {
  const rows = allCards()
    .filter((c) => c.type === 'minion' && !c.token)
    .map(auditMinion);
  return {
    rows,
    violations: rows.filter((r) => Math.abs(r.deviation) > TOLERANCE && !r.intentional),
    staleAllowlist: rows.filter((r) => r.intentional && Math.abs(r.deviation) <= TOLERANCE),
  };
}
