import { el } from '../dom.js';

export function renderMenu(root, ctx) {
  const { stats } = ctx.profile;
  root.append(
    el(
      'div',
      { class: 'menu-wrap' },
      el('h1', { class: 'menu-title' }, 'Forgebound', el('br'), el('em', {}, 'Bestiary')),
      el('p', { class: 'menu-sub' }, 'A field guide with teeth. Two heroes, thirty life apiece, and 299 catalogued specimens.'),
      el(
        'div',
        { class: 'menu-list' },
        el(
          'button',
          { class: 'primary', onclick: () => ctx.navigate('setup', { mode: 'ai' }) },
          'Expedition — vs. the Archivist',
          el('small', {}, 'single player against the AI')
        ),
        el(
          'button',
          { onclick: () => ctx.navigate('setup', { mode: 'hotseat' }) },
          'Duel at the desk — two players',
          el('small', {}, 'hot-seat on this machine, hands hidden between turns')
        ),
        el(
          'button',
          { onclick: () => ctx.navigate('collection') },
          'Collection & deck ledger',
          el('small', {}, 'browse specimens, build decks')
        ),
        el(
          'button',
          { onclick: () => ctx.navigate('shop') },
          'The print shop',
          el('small', {}, 'spend coins on new plates')
        )
      ),
      el(
        'div',
        { class: 'menu-stats' },
        `Record: ${stats.wins} won · ${stats.losses} lost · ${stats.draws} drawn — ${ctx.profile.coins} coins in the purse.`
      )
    )
  );
}
