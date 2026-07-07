// The print shop: buy 5-card packs with coins earned from duels.
import { el, toast } from '../dom.js';
import { cardView } from '../cardView.js';
import { buyPack, PACK_COST, PACK_SIZE } from '../../meta/packs.js';
import { ownedCount } from '../../meta/profile.js';

export function renderShop(root, ctx) {
  let lastPack = null;

  function buy() {
    try {
      lastPack = buyPack(ctx.profile);
      ctx.saveProfile();
      draw();
    } catch (err) {
      toast(err.message);
    }
  }

  function draw() {
    root.replaceChildren(
      el(
        'div',
        { class: 'shop-wrap' },
        el('h2', {}, 'The print shop'),
        el('p', { style: 'color:var(--ink-soft); font-style:italic;' },
          'Freshly inked plates for the bestiary. Win duels to fill the purse.'),
        el(
          'div',
          { class: 'pack-offer' },
          el('div', { class: 'pack-art' }, 'BESTIARY PLATES'),
          el(
            'div',
            { style: 'flex:1; min-width:220px;' },
            el('h3', {}, `Plate pack — ${PACK_SIZE} random cards`),
            el('p', { style: 'color:var(--ink-soft); font-size:14px;' },
              'Any collectible card can turn up; roughly one pack in three carries a legendary.'),
            el('div', { style: 'font-family:var(--mono); margin: 6px 0 12px;' }, `${PACK_COST} coins · purse: ${ctx.profile.coins}`),
            el('button', { class: 'primary', disabled: ctx.profile.coins < PACK_COST, onclick: buy }, 'Buy a pack')
          )
        ),
        lastPack
          ? el(
              'div',
              {},
              el('h3', {}, 'Fresh off the press'),
              el(
                'div',
                { class: 'pack-reveal' },
                lastPack.map((id) => {
                  const node = cardView(id);
                  node.append(el('span', { class: 'owned-tag', text: `now ×${ownedCount(ctx.profile, id)}` }));
                  return node;
                })
              )
            )
          : null
      )
    );
  }

  draw();
}
