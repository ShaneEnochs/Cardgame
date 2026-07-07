// App bootstrap and router. Screens are functions of (root, ctx); all
// navigation goes through ctx.navigate so there's exactly one render path.
import { initCards, assertEffectCoverage } from '../engine/index.js';
import { createProfileStore } from '../meta/profile.js';
import { el, toast } from './dom.js';
import { renderMenu } from './screens/menu.js';
import { renderSetup } from './screens/setup.js';
import { renderGame } from './screens/game.js';
import { renderCollection } from './screens/collection.js';
import { renderShop } from './screens/shop.js';

const SCREENS = {
  menu: renderMenu,
  setup: renderSetup,
  game: renderGame,
  collection: renderCollection,
  shop: renderShop,
};

const TITLES = {
  menu: 'the reading room',
  setup: 'muster',
  game: 'the field',
  collection: 'collection & deck ledger',
  shop: 'the print shop',
};

async function boot() {
  const res = await fetch('data/cards.json');
  if (!res.ok) throw new Error(`could not load card data (${res.status})`);
  initCards(await res.json());
  assertEffectCoverage();

  const store = createProfileStore(window.localStorage);
  const ctx = {
    store,
    profile: store.load(),
    session: null, // live game session (set by setup, read by game screen)
    toast,
    navigate(screen, params = {}) {
      ctx.params = params;
      render(screen, ctx);
    },
    saveProfile() {
      store.save(ctx.profile);
    },
  };
  render('menu', ctx);
}

function render(screen, ctx) {
  const app = document.getElementById('app');
  app.replaceChildren();

  const inGame = screen === 'game';
  const masthead = el(
    'div',
    { class: 'masthead' },
    el('h1', {}, 'Forgebound ', el('span', { class: 'fb-no' }, '· Bestiary')),
    el('span', { class: 'crumbs', text: TITLES[screen] ?? '' }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'coin-purse', text: `${ctx.profile.coins} coins` }),
    !inGame && screen !== 'menu'
      ? el('button', { class: 'quiet', onclick: () => ctx.navigate('menu') }, 'back to menu')
      : null
  );
  app.append(masthead);

  const content = el('div', { class: 'screen' + (inGame ? ' no-pad' : '') });
  app.append(content);
  SCREENS[screen](content, ctx);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('app').replaceChildren(
    el('div', { class: 'boot' }, `The bestiary failed to open: ${err.message}`)
  );
});
