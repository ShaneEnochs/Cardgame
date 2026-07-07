// The duel screen. All selection/targeting state lives HERE, in plain local
// variables, and is wiped after every dispatch — the engine only ever sees
// complete actions and validates its state after each one. This is the
// structural fix for the prototype's lingering-target/mutated-hero bugs.
import {
  applyAction,
  canHeroAttack,
  canMinionAttack,
  effectiveCost,
  legalAttackTargets,
  legalTargetsForCard,
  legalTargetsForHeroPower,
} from '../../engine/actions.js';
import { getCard, getHeroPower } from '../../engine/cards.js';
import { heroRef, minionRef, otherPlayer, poss, verb } from '../../engine/primitives.js';
import { chooseAiAction } from '../../engine/ai.js';
import { applyGameResult } from '../../meta/profile.js';
import { el, toast } from '../dom.js';
import { cardView, minionView } from '../cardView.js';

const AI_STEP_MS = 600;

export function renderGame(root, ctx) {
  const session = ctx.session;
  if (!session) {
    ctx.navigate('menu');
    return;
  }

  // ---- UI-only selection state (never inside the engine state) ----
  let targeting = null; // {source, candidates:[ref], cardUid?}
  // The log floats over the board; on a phone that overlaps minions, so it
  // starts collapsed there and the player toggles it from the midline.
  let showLog = !(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches);

  const sameRef = (a, b) => a && b && a.kind === b.kind && a.player === b.player && (a.kind === 'hero' || a.uid === b.uid);
  const isCandidate = (ref) => targeting && targeting.candidates.some((c) => sameRef(c, ref));

  function myTurn() {
    const s = session.state;
    if (s.winner) return false;
    if (session.mode === 'ai') return s.active === 'p1';
    return !session.passPending && s.active === session.view;
  }

  function dispatch(action) {
    try {
      session.state = applyAction(session.state, action);
    } catch (err) {
      toast(err.message);
    }
    targeting = null; // unconditionally — no lingering selections, ever
    afterAction();
    draw();
  }

  function afterAction() {
    const s = session.state;
    if (s.winner) {
      applyRewards();
      return;
    }
    if (session.mode === 'hotseat' && s.active !== session.view && !s.pendingChoice) {
      session.passPending = true;
    }
  }

  function applyRewards() {
    if (session.rewardsApplied) return;
    session.rewardsApplied = true;
    const s = session.state;
    let outcome;
    let bonus;
    if (session.mode === 'ai') {
      outcome = s.winner === 'p1' ? 'win' : s.winner === 'draw' ? 'draw' : 'loss';
      bonus = s.players.p1.coinsEarned;
    } else {
      outcome = 'shared';
      bonus = s.players.p1.coinsEarned + s.players.p2.coinsEarned;
    }
    session.earned = applyGameResult(ctx.profile, {
      mode: session.mode === 'ai' ? 'ai' : 'hotseat',
      outcome,
      bonusCoins: bonus,
    });
    ctx.saveProfile();
  }

  // ---- AI driver: one action per tick through the same dispatch path ----
  function scheduleAi() {
    if (session.aiTimer || session.mode !== 'ai') return;
    const s = session.state;
    if (s.winner || s.active !== 'p2') return;
    session.aiTimer = setTimeout(() => {
      session.aiTimer = null;
      if (ctx.session !== session) return; // navigated away mid-turn
      const st = session.state;
      if (st.winner || st.active !== 'p2') {
        draw();
        return;
      }
      let action = chooseAiAction(st);
      try {
        session.state = applyAction(session.state, action);
      } catch (err) {
        // Defensive: a bad AI action must never wedge the game.
        console.error('AI action rejected', action, err);
        session.state = applyAction(session.state, { type: 'endTurn' });
      }
      afterAction();
      draw();
    }, AI_STEP_MS);
  }

  /* ---------------- click handlers ---------------- */

  function clickHandCard(inst) {
    if (!myTurn()) return;
    const s = session.state;
    const me = s.active;
    if (targeting?.cardUid === inst.uid) {
      targeting = null;
      draw();
      return;
    }
    if (effectiveCost(s, me, inst) > s.players[me].mana) {
      toast('Not enough mana.');
      return;
    }
    const candidates = legalTargetsForCard(s, me, inst.uid);
    if (candidates.length > 0) {
      targeting = { source: { type: 'card' }, cardUid: inst.uid, candidates };
      draw();
    } else {
      dispatch({ type: 'playCard', cardUid: inst.uid, target: null });
    }
  }

  function clickPower() {
    if (!myTurn()) return;
    const s = session.state;
    const me = s.active;
    const power = getHeroPower(s.players[me].heroPower);
    if (s.players[me].heroPowerUsed) {
      toast('Hero power already used this turn.');
      return;
    }
    if (s.players[me].mana < power.cost) {
      toast('Not enough mana.');
      return;
    }
    const candidates = legalTargetsForHeroPower(s, me);
    if (candidates.length > 0) {
      targeting = { source: { type: 'power' }, candidates };
      draw();
    } else {
      dispatch({ type: 'heroPower', target: null });
    }
  }

  function resolveTargetClick(ref) {
    if (!targeting) return false;
    if (!isCandidate(ref)) return false;
    const t = targeting;
    if (t.source.type === 'card') dispatch({ type: 'playCard', cardUid: t.cardUid, target: ref });
    else if (t.source.type === 'power') dispatch({ type: 'heroPower', target: ref });
    else if (t.source.type === 'attack') dispatch({ type: 'attack', attacker: t.source.attacker, target: ref });
    return true;
  }

  function clickMinion(m) {
    const s = session.state;
    const ref = minionRef(m);
    if (resolveTargetClick(ref)) return;
    if (!myTurn()) return;
    if (m.controller !== s.active) return;
    if (targeting) {
      targeting = null;
      draw();
      return;
    }
    if (!canMinionAttack(s, m)) {
      if (m.frozen > 0) toast('Frozen solid.');
      else if (m.sick) toast('Summoning sickness — it needs a turn to settle.');
      else if (m.attacksUsed >= 1) toast('Already attacked this turn.');
      return;
    }
    const attacker = ref;
    const candidates = legalAttackTargets(s, s.active, attacker);
    if (candidates.length === 0) {
      toast('No targets it can reach this turn.');
      return;
    }
    targeting = { source: { type: 'attack', attacker }, candidates };
    draw();
  }

  function clickHero(playerId) {
    const s = session.state;
    if (resolveTargetClick(heroRef(playerId))) return;
    if (!myTurn()) return;
    if (playerId === s.active && canHeroAttack(s, s.active)) {
      const attacker = heroRef(s.active);
      const candidates = legalAttackTargets(s, s.active, attacker);
      if (candidates.length === 0) return;
      targeting = { source: { type: 'attack', attacker }, candidates };
      draw();
    }
  }

  function cancelTargeting() {
    if (targeting) {
      targeting = null;
      draw();
    }
  }

  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancelTargeting();
  });
  const escHandler = (e) => {
    if (e.key === 'Escape') cancelTargeting();
  };
  if (window.__fbEscHandler) window.removeEventListener('keydown', window.__fbEscHandler);
  window.__fbEscHandler = escHandler;
  window.addEventListener('keydown', escHandler);

  /* ---------------- rendering ---------------- */

  function manaPips(p) {
    const pips = [];
    for (let i = 0; i < p.maxMana; i++) pips.push(el('span', { class: i < p.mana ? 'pip-on' : 'pip-off' }, i < p.mana ? '◆' : '◇'));
    return el('div', { class: 'mana-row' }, pips, ` ${p.mana}/${p.maxMana}`);
  }

  function heroPlate(playerId, { withPower }) {
    const s = session.state;
    const p = s.players[playerId];
    const power = getHeroPower(p.heroPower);
    const targetable = isCandidate(heroRef(playerId));
    const canSwing = myTurn() && playerId === s.active && canHeroAttack(s, playerId);
    const plate = el(
      'div',
      {
        class: 'hero-plate' + (targetable ? ' targetable' : '') + (canSwing ? ' attackable-weapon' : ''),
        onclick: () => clickHero(playerId),
      },
      el(
        'div',
        {},
        el('div', { class: 'hname', text: p.name }),
        el('div', { class: 'hpow', text: power.name })
      ),
      el(
        'div',
        { class: 'hhp' },
        `${p.hero.hp}`,
        p.hero.armor > 0 ? el('span', { class: 'armor' }, ` +${p.hero.armor}`) : null
      ),
      p.weapon ? el('span', { class: 'weapon', text: `${p.weapon.name} ${p.weapon.atk}/${p.weapon.durability}` }) : null
    );
    if (!withPower) return plate;

    const powerBtn = el(
      'button',
      {
        class: 'power-btn' + (p.heroPowerUsed ? ' used' : ''),
        onclick: (e) => {
          e.stopPropagation();
          clickPower();
        },
      },
      el('span', { class: 'pname', text: `${power.name} (${power.cost})` }),
      el('span', { class: 'ptext', text: power.text })
    );
    return el('div', { class: 'hero-power-wrap', style: 'display:flex; gap:10px; align-items:center;' }, plate, powerBtn);
  }

  function lane(playerId) {
    const s = session.state;
    const mine = playerId === session.view;
    return el(
      'div',
      { class: 'lane', onclick: (e) => e.target.classList?.contains('lane') && cancelTargeting() },
      s.players[playerId].board.map((m) => {
        const ready = myTurn() && m.controller === s.active && canMinionAttack(s, m);
        const selected = targeting?.source.type === 'attack' && sameRef(targeting.source.attacker, minionRef(m));
        return minionView(m, {
          mine,
          ready,
          selected,
          exhausted: mine && !ready && !selected,
          targetable: isCandidate(minionRef(m)),
          onclick: () => clickMinion(m),
        });
      })
    );
  }

  function handStrip() {
    const s = session.state;
    const viewer = s.players[session.view];
    const active = myTurn();
    return el(
      'div',
      { class: 'hand-strip' },
      el(
        'div',
        { class: 'hand-cards' },
        viewer.hand.map((inst) => {
          const cost = effectiveCost(s, session.view, inst);
          const affordable = cost <= viewer.mana;
          return cardView(inst.cardId, {
            cost,
            classes: [
              active && affordable ? 'playable' : 'unaffordable',
              targeting?.cardUid === inst.uid ? 'selected' : '',
            ].filter(Boolean),
            onclick: () => clickHandCard(inst),
          });
        })
      ),
      el(
        'div',
        { class: 'end-col' },
        manaPips(viewer),
        el('div', { style: 'font-size:12px; color: var(--ink-soft);' }, `deck ${viewer.deck.length} · graveyard ${viewer.graveyard.length}`),
        el(
          'button',
          {
            class: 'primary',
            disabled: !active,
            onclick: () => dispatch({ type: 'endTurn' }),
          },
          'End turn'
        ),
        el('button', { class: 'quiet', onclick: () => confirmConcede() }, 'concede')
      )
    );
  }

  function confirmConcede() {
    if (!session.state.winner && window.confirm('Concede the duel?')) {
      dispatch({ type: 'concede' });
    }
  }

  function gameLog() {
    const entries = session.state.log.slice(-40);
    const box = el(
      'div',
      { class: 'game-log' },
      entries.map((e) =>
        el('div', { class: e.text.startsWith('—') ? 'turn-mark' : '' }, e.text)
      )
    );
    queueMicrotask(() => (box.scrollTop = box.scrollHeight));
    return box;
  }

  function overlays() {
    const s = session.state;
    const out = [];

    if (session.passPending && !s.winner) {
      out.push(
        el(
          'div',
          { class: 'overlay', style: 'background: var(--paper);' },
          el(
            'div',
            { class: 'panel' },
            el('h2', {}, `${poss(s.players[s.active].name)} turn`),
            el('p', {}, 'Pass the device. The previous hand is hidden.'),
            el(
              'button',
              {
                class: 'primary',
                onclick: () => {
                  session.passPending = false;
                  session.view = s.active;
                  draw();
                },
              },
              'I am ready'
            )
          )
        )
      );
      return out;
    }

    if (s.pendingChoice && (session.mode === 'hotseat' || s.pendingChoice.player === 'p1')) {
      const pc = s.pendingChoice;
      out.push(
        el(
          'div',
          { class: 'overlay' },
          el(
            'div',
            { class: 'panel' },
            el('h2', {}, pc.prompt ?? 'Choose'),
            el(
              'div',
              { class: 'choice-row' },
              pc.options.map((cardId, i) =>
                cardView(cardId, { classes: ['playable'], onclick: () => dispatch({ type: 'choose', index: i }) })
              )
            )
          )
        )
      );
    }

    if (s.winner) {
      const w = s.winner;
      const title = w === 'draw' ? 'A draw — both heroes fall' : `${verb(s.players[w].name, 'wins')}`;
      out.push(
        el(
          'div',
          { class: 'overlay' },
          el(
            'div',
            { class: 'panel' },
            el('h2', {}, title),
            el('p', {}, `${session.earned ?? 0} coins added to the purse.`),
            el(
              'div',
              { style: 'display:flex; gap:12px; justify-content:center;' },
              el('button', { class: 'primary', onclick: () => ctx.navigate('setup', { mode: session.mode }) }, 'Play again'),
              el('button', { onclick: () => ctx.navigate('menu') }, 'Back to the reading room')
            )
          )
        )
      );
    }
    return out;
  }

  function draw() {
    const s = session.state;
    const oppId = otherPlayer(session.view);
    const opp = s.players[oppId];

    const midline = el(
      'div',
      { class: 'midline' },
      el('span', { class: 'turn-name' }, s.winner ? 'duel over' : `${poss(s.players[s.active].name)} turn`),
      el('span', {}, `turn ${s.turnNumber}`),
      el('span', { class: 'spacer' }),
      targeting ? el('button', { class: 'quiet', onclick: () => cancelTargeting() }, 'cancel') : null,
      el('button', { class: 'quiet log-toggle', onclick: () => { showLog = !showLog; draw(); } }, showLog ? 'hide log' : 'log'),
      targeting
        ? el('span', { class: 'midline-hint' }, 'tap a target — or tap empty space to cancel')
        : session.mode === 'ai' && s.active === 'p2' && !s.winner
          ? el('span', { class: 'midline-hint' }, 'the Archivist is thinking…')
          : el('span', { class: 'midline-hint' }, 'tap a card to play it; tap a ready minion, then a target, to attack')
    );

    root.replaceChildren(
      el(
        'div',
        { class: 'game' },
        el(
          'div',
          { class: 'opp-strip' },
          heroPlate(oppId, { withPower: false }),
          el('div', { class: 'card-back' }, `hand ${opp.hand.length}`),
          el('div', { style: 'font-size:12px;color:var(--ink-soft);' }, `deck ${opp.deck.length}`),
          el('span', { class: 'spacer', style: 'flex:1;' }),
          manaPips(opp)
        ),
        el(
          'div',
          { class: 'battlefield', onclick: (e) => e.target.classList?.contains('battlefield') && cancelTargeting() },
          lane(oppId),
          midline,
          el(
            'div',
            { class: 'my-side' },
            el(
              'div',
              { class: 'my-hero-row', style: 'display:flex; align-items:center; gap:14px; padding: 6px 18px 0;' },
              heroPlate(session.view, { withPower: true })
            ),
            lane(session.view)
          ),
          showLog ? gameLog() : null
        ),
        handStrip()
      ),
      ...overlays()
    );

    scheduleAi();
  }

  draw();
}
