// Shared card + minion renderers (hand, browser, board).
import { getCard, allCards } from '../engine/cards.js';
import { minionHasKeyword } from '../engine/primitives.js';
import { el } from './dom.js';

const KEYWORD_LABELS = {
  taunt: 'taunt',
  charge: 'charge',
  haste: 'haste',
  rush: 'rush',
  ward: 'ward',
  lifesteal: 'lifesteal',
  freeze: 'freezing',
  battlecry: 'battlecry',
  deathrattle: 'deathrattle',
};

let specimenIndex = null;
function specimenNo(cardId) {
  if (!specimenIndex) {
    specimenIndex = new Map();
    allCards().forEach((c, i) => specimenIndex.set(c.id, i + 1));
  }
  return String(specimenIndex.get(cardId) ?? 0).padStart(3, '0');
}

/** A full card face, used in hand, browser, shop and choice dialogs. */
export function cardView(cardId, opts = {}) {
  const card = getCard(cardId);
  const classes = ['card', `tribe-${card.tribe}`];
  if (card.type === 'spell') classes.push('spell');
  if (card.legendary) classes.push('legendary');
  if (opts.classes) classes.push(...opts.classes);

  const cost = opts.cost ?? card.cost;
  const node = el(
    'div',
    { class: classes.join(' '), title: card.text || card.name },
    el('div', { class: 'cost-tab', text: cost }),
    el('div', { class: 'specimen-no', text: `No. ${specimenNo(card.id)}` }),
    el('div', { class: 'cname', text: card.name }),
    el('div', { class: 'ctribe', text: card.tribe }),
    card.legendary ? el('div', { class: 'legend-mark', text: 'legendary' }) : null,
    el('div', { class: 'ctext', text: card.text || '' }),
    card.type === 'minion'
      ? el(
          'div',
          { class: 'cstats' },
          el('span', { class: 'atk', text: card.atk }),
          el('span', { class: 'hp', text: card.hp })
        )
      : null
  );
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  return node;
}

/** A minion plate on the battlefield. */
export function minionView(m, opts = {}) {
  const card = getCard(m.cardId);
  const classes = ['minion', `tribe-${card.tribe}`];
  if (opts.ready) classes.push('ready');
  if (opts.exhausted) classes.push('exhausted');
  if (opts.selected) classes.push('selected');
  if (opts.targetable) classes.push('targetable');
  if (m.frozen > 0) classes.push('frozen');

  const tags = [];
  for (const kw of ['taunt', 'rush', 'charge', 'haste', 'lifesteal', 'freeze']) {
    if (minionHasKeyword(m, kw)) tags.push(KEYWORD_LABELS[kw]);
  }
  if (m.silenced) tags.push('silenced');
  if (m.elusive) tags.push('hidden');

  const badges = [];
  if (m.ward) badges.push(el('span', { class: 'badge ward', text: 'W' }));
  if (m.sick && opts.mine && !minionHasKeyword(m, 'charge') && !minionHasKeyword(m, 'haste')) {
    badges.push(el('span', { class: 'badge sick', text: 'zZ' }));
  }

  const node = el(
    'div',
    { class: classes.join(' '), title: card.text || card.name },
    el('div', { class: 'badge-row' }, badges),
    el('div', { class: 'mname', text: card.name }),
    el('div', { class: 'mtags', text: tags.join(' · ') }),
    el(
      'div',
      { class: 'mstats' },
      el('span', { class: 'atk' + (m.atk > card.atk ? ' buffed' : ''), text: m.atk }),
      el('span', { class: 'hp' + (m.hp < m.maxHp ? ' hurt' : ''), text: m.hp })
    )
  );
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  return node;
}
