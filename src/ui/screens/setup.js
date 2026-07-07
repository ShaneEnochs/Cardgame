// Pre-duel muster: pick deck and hero power per player, then start the game.
import { allHeroPowers } from '../../engine/cards.js';
import { createGame } from '../../engine/state.js';
import { randomAiDeck } from '../../meta/aidecks.js';
import { el } from '../dom.js';

function powerSelect(selectedId, onchange) {
  const select = el(
    'select',
    { onchange: (e) => onchange(e.target.value) },
    allHeroPowers().map((p) => el('option', { value: p.id, selected: p.id === selectedId }, `${p.name} (${p.cost})`))
  );
  return select;
}

function playerPanel(ctx, title, choice) {
  const powerDesc = el('div', { class: 'power-desc' });
  const syncDesc = () => {
    const p = allHeroPowers().find((x) => x.id === choice.heroPower);
    powerDesc.textContent = p ? p.text : '';
  };

  const deckSelect = el(
    'select',
    {
      onchange: (e) => {
        choice.deckId = e.target.value;
        const deck = ctx.profile.decks.find((d) => d.id === choice.deckId);
        choice.heroPower = deck.heroPower;
        panel.querySelector('select.power').replaceWith(makePowerSelect());
        syncDesc();
      },
    },
    ctx.profile.decks.map((d) => el('option', { value: d.id, selected: d.id === choice.deckId }, d.name))
  );

  function makePowerSelect() {
    const s = powerSelect(choice.heroPower, (v) => {
      choice.heroPower = v;
      syncDesc();
    });
    s.classList.add('power');
    return s;
  }

  const panel = el(
    'div',
    { class: 'setup-panel' },
    el('h3', { text: title }),
    el('label', { text: 'deck' }),
    deckSelect,
    el('label', { text: 'hero power' }),
    makePowerSelect(),
    powerDesc
  );
  syncDesc();
  return panel;
}

export function renderSetup(root, ctx) {
  const mode = ctx.params?.mode ?? 'ai';
  const defaultDeck = ctx.profile.decks[0];

  const p1 = { deckId: defaultDeck.id, heroPower: defaultDeck.heroPower };
  const p2 = { deckId: defaultDeck.id, heroPower: defaultDeck.heroPower };
  const aiDeck = randomAiDeck();

  const cols = el('div', { class: 'setup-cols' }, playerPanel(ctx, mode === 'ai' ? 'You' : 'Player One', p1));
  if (mode === 'hotseat') {
    cols.append(playerPanel(ctx, 'Player Two', p2));
  } else {
    cols.append(
      el(
        'div',
        { class: 'setup-panel' },
        el('h3', { text: 'The Archivist (AI)' }),
        el('label', { text: 'deck' }),
        el('div', {}, `${aiDeck.name} — its own ledger, drawn from the full catalogue`),
        el('label', { text: 'hero power' }),
        el('div', {}, allHeroPowers().find((p) => p.id === aiDeck.heroPower).name)
      )
    );
  }

  function start() {
    const deck1 = ctx.profile.decks.find((d) => d.id === p1.deckId);
    const first = Math.random() < 0.5 ? 'p1' : 'p2';
    let config;
    if (mode === 'ai') {
      config = {
        seed: Math.floor(Math.random() * 2 ** 31),
        first,
        p1: { name: 'You', deck: deck1.cards, heroPower: p1.heroPower },
        p2: { name: 'The Archivist', deck: aiDeck.cards, heroPower: aiDeck.heroPower },
      };
    } else {
      const deck2 = ctx.profile.decks.find((d) => d.id === p2.deckId);
      config = {
        seed: Math.floor(Math.random() * 2 ** 31),
        first,
        p1: { name: 'Player One', deck: deck1.cards, heroPower: p1.heroPower },
        p2: { name: 'Player Two', deck: deck2.cards, heroPower: p2.heroPower },
      };
    }
    ctx.session = {
      mode,
      state: createGame(config),
      // In hot-seat the viewing seat follows the active player behind a pass
      // screen; vs AI the human is always p1.
      view: mode === 'ai' ? 'p1' : first,
      passPending: mode === 'hotseat',
      rewardsApplied: false,
      aiTimer: null,
    };
    ctx.navigate('game');
  }

  root.append(
    el('h2', {}, mode === 'ai' ? 'Expedition — vs. the Archivist' : 'Duel at the desk'),
    cols,
    el(
      'div',
      { class: 'setup-actions' },
      el('button', { class: 'primary', onclick: start }, 'Begin the duel'),
      el('button', { onclick: () => ctx.navigate('menu') }, 'back')
    )
  );
}
