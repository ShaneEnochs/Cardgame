// Collection browser + deck ledger. Click a card in the browser to add it to
// the working deck; click a row in the ledger to remove one copy.
import { collectibleCards, getCard, allHeroPowers, tribes } from '../../engine/cards.js';
import { MAX_COPIES, MAX_LEGENDARY_COPIES, DECK_SIZE, ownedCount, saveDeck, deleteDeck } from '../../meta/profile.js';
import { el, toast } from '../dom.js';
import { cardView } from '../cardView.js';

export function renderCollection(root, ctx) {
  const profile = ctx.profile;

  // Working copy of the selected deck (uncommitted until Save).
  let deckId = profile.decks[0].id;
  let working = loadWorking();

  function loadWorking() {
    const d = profile.decks.find((x) => x.id === deckId) ?? profile.decks[0];
    deckId = d.id;
    return { id: d.id, name: d.name, heroPower: d.heroPower, cards: [...d.cards] };
  }

  const filters = { search: '', tribe: 'all', ownedOnly: true };

  function deckCount(cardId) {
    return working.cards.filter((c) => c === cardId).length;
  }

  function tryAdd(cardId) {
    const card = getCard(cardId);
    const limit = card.legendary ? MAX_LEGENDARY_COPIES : MAX_COPIES;
    if (working.cards.length >= DECK_SIZE) return toast(`Decks hold exactly ${DECK_SIZE} cards.`);
    if (deckCount(cardId) >= limit) return toast(`Limit ${limit} cop${limit === 1 ? 'y' : 'ies'} of ${card.name}.`);
    if (deckCount(cardId) >= ownedCount(profile, cardId)) return toast(`You only own ${ownedCount(profile, cardId)}.`);
    working.cards.push(cardId);
    draw();
  }

  function removeOne(cardId) {
    const at = working.cards.indexOf(cardId);
    if (at !== -1) working.cards.splice(at, 1);
    draw();
  }

  function commit() {
    try {
      saveDeck(profile, working);
      ctx.saveProfile();
      toast(`Saved "${working.name}".`);
      draw();
    } catch (err) {
      toast(err.message);
    }
  }

  function newDeck() {
    working = { id: `deck_${Date.now().toString(36)}`, name: 'New deck', heroPower: 'emberspark', cards: [] };
    deckId = working.id;
    draw();
  }

  function removeDeck() {
    try {
      deleteDeck(profile, deckId);
      ctx.saveProfile();
      deckId = profile.decks[0].id;
      working = loadWorking();
      draw();
    } catch (err) {
      toast(err.message);
    }
  }

  function browser() {
    const q = filters.search.toLowerCase();
    let cards = collectibleCards().filter(
      (c) =>
        (!filters.ownedOnly || ownedCount(profile, c.id) > 0) &&
        (filters.tribe === 'all' || c.tribe === filters.tribe) &&
        (q === '' || c.name.toLowerCase().includes(q) || (c.text ?? '').toLowerCase().includes(q))
    );
    cards = cards.slice().sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

    return el(
      'div',
      { class: 'browser' },
      el(
        'div',
        { class: 'filters' },
        el('input', {
          type: 'text',
          placeholder: 'search name or text…',
          value: filters.search,
          oninput: (e) => {
            filters.search = e.target.value;
            drawBrowser();
          },
        }),
        el(
          'select',
          {
            onchange: (e) => {
              filters.tribe = e.target.value;
              drawBrowser();
            },
          },
          el('option', { value: 'all' }, 'all tribes'),
          [...tribes(), 'Spell'].map((t) => el('option', { value: t, selected: filters.tribe === t }, t))
        ),
        el(
          'label',
          { style: 'font-size:13px; display:flex; align-items:center; gap:4px;' },
          el('input', {
            type: 'checkbox',
            checked: filters.ownedOnly,
            onchange: (e) => {
              filters.ownedOnly = e.target.checked;
              drawBrowser();
            },
          }),
          'owned only'
        )
      ),
      el(
        'div',
        { class: 'grid' },
        cards.map((c) => {
          const owned = ownedCount(profile, c.id);
          const inDeck = deckCount(c.id);
          const node = cardView(c.id, {
            classes: [owned === 0 ? 'dim' : 'playable'],
            onclick: owned > 0 ? () => tryAdd(c.id) : undefined,
          });
          node.append(el('span', { class: 'owned-tag', text: `×${owned}` }));
          if (inDeck > 0) node.append(el('span', { class: 'in-deck-tag', text: `${inDeck} in deck` }));
          return node;
        })
      )
    );
  }

  function ledger() {
    const counts = new Map();
    for (const id of working.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
    const rows = [...counts.keys()]
      .sort((a, b) => getCard(a).cost - getCard(b).cost || getCard(a).name.localeCompare(getCard(b).name))
      .map((id) =>
        el(
          'div',
          { class: 'deck-row', onclick: () => removeOne(id), title: 'click to remove one copy' },
          el('span', { class: 'dcost', text: getCard(id).cost }),
          el('span', { class: 'dname', text: getCard(id).name }),
          el('span', { class: 'dcount', text: `×${counts.get(id)}` })
        )
      );

    const n = working.cards.length;
    return el(
      'div',
      { class: 'deck-panel' },
      el(
        'div',
        { class: 'deck-head' },
        el(
          'select',
          {
            onchange: (e) => {
              if (e.target.value === '__new__') return newDeck();
              deckId = e.target.value;
              working = loadWorking();
              draw();
            },
          },
          profile.decks.map((d) => el('option', { value: d.id, selected: d.id === deckId }, d.name)),
          el('option', { value: '__new__' }, '+ new deck')
        ),
        el('input', {
          type: 'text',
          value: working.name,
          oninput: (e) => (working.name = e.target.value),
        }),
        el(
          'select',
          { onchange: (e) => (working.heroPower = e.target.value) },
          allHeroPowers().map((p) =>
            el('option', { value: p.id, selected: p.id === working.heroPower }, `${p.name} — ${p.text}`)
          )
        ),
        el('div', { class: 'deck-count' + (n === DECK_SIZE ? ' full' : n > DECK_SIZE ? ' over' : ''), text: `${n} / ${DECK_SIZE} cards` })
      ),
      el('div', { class: 'deck-list' }, rows.length ? rows : el('div', { style: 'padding:10px; color:var(--ink-soft); font-style:italic;' }, 'Empty ledger — click cards on the left.')),
      el(
        'div',
        { class: 'deck-actions' },
        el('button', { class: 'primary', onclick: commit }, 'Save deck'),
        el('button', { class: 'quiet', onclick: removeDeck }, 'delete deck')
      )
    );
  }

  let browserBox;
  function drawBrowser() {
    const fresh = browser();
    browserBox.replaceWith(fresh);
    browserBox = fresh;
  }

  function draw() {
    browserBox = browser();
    root.replaceChildren(el('div', { class: 'builder' }, browserBox, ledger()));
  }

  draw();
}
