# NOTES — decisions log

Working notes for the Forgebound: Bestiary build.

## What was in the repo

- A `Testing` placeholder file (removed) and `forgebound.html`, a single-file prototype.
- The prototype had exactly the failure modes the spec calls out: hero objects mutated
  with `__isHero`/`name` flags to act as targets, and module-global `pendingTarget` /
  `selectedAttackerUid` selection state that could linger across actions. It also used
  the AI-default art direction (Cinzel + Inter, copper/teal on dark, radial vignette,
  glowing borders, circular cost badges). It is kept for reference at
  `prototype/forgebound.html` and superseded by this app.
- **No LICENSE file exists in the repo; none was added (owner's call).**

## Stack

- Vanilla ES-module JavaScript, no framework, no build step, **zero npm dependencies**.
  The repo's existing prototype was plain HTML/JS, so this builds on that choice.
- Runs as a locally-served web app (`npm start` → tiny Node static server), because
  `fetch`ing `cards.json` and ES modules don't work over `file://`.
- Persistence: `localStorage` (real on-disk storage in every browser profile),
  versioned, behind an injectable storage adapter so the meta layer is testable.
- Tests: Node's built-in `node --test` runner against the pure engine (the engine has
  no DOM dependencies). 65 tests; also verified end-to-end in Chromium via Playwright
  (AI game, hot-seat pass screens, targeting cancel, shop, deckbuilder, persistence
  across reload).

## Engine decisions

- Game state is a single JSON-serializable object. All mutations go through
  `applyAction(state, action)` which deep-clones, validates the action, applies it,
  processes deaths/expiries, checks win, then runs `validateState` invariants
  (hand/board caps, mana bounds, unique uids, no dead minions on board, heroes carry
  no foreign keys, etc.). Targets are plain descriptors `{kind:'hero'|'minion',
  player, uid}` — hero objects are never mutated with flags.
- Targeting/attacker selection is UI-only state, wiped after every dispatch; the
  engine only ever receives complete actions. Cancelling a selection is a UI no-op,
  so it can't corrupt a game.
- Seeded RNG (mulberry32) lives in the state, so games and tests are reproducible.
- `charge` and `haste` are treated as the same ability (attack anything immediately);
  the balance model prices both at 2. They stay distinct keywords for display.
- Freeze: a frozen minion can't attack; it thaws at the end of its controller's turn.
  Hold Monster applies freeze 2 (misses two of its turns).
- Ward = absorbs the next damage instance entirely, then breaks (divine shield).
- Silence removes keywords, deathrattles/triggers, buffs/debuffs (stats return to
  printed values, current damage kept, floor 1 hp), freeze, and untargetability.
- Lifesteal/freeze-on-damage ride the damage pipeline, so they also apply to
  battlecry damage dealt by the minion and to defensive retaliation damage.
- The first player draws 3 cards, the second draws 4 (no coin card — kept simple).
- Both heroes dying simultaneously (e.g. Bodak) is a draw.
- Temporary control (Ultroloth/Mind Flayer) hands the minion back at end of turn; if
  the owner's board is full by then, the minion dies.
- Weapons exist minimally for Death Knight's blade: hero attacks once per turn,
  takes minion retaliation, durability ticks down.

## Card-set readings (ambiguities resolved, flagged for review)

- **Outliers:** the spec says six intentional outliers are "labeled in the data", but
  `cards.json` carries no such label. Under the stated model
  (atk+hp+keyword_costs vs cost*2+1), exactly **five** cards sit outside ±2:
  `tarrasque` (+7), `nosferatu` (−4), `lich` (−3), `mummy_lord` (−3),
  `wailing_banshee` (−3). Those five are allowlisted in the audit
  (`src/engine/balance.js`). `leprechaun` (−2, the deliberate "20 coins" gag card) is
  the likely sixth — at −2 it already passes the ±2 tolerance, so it is *not* in the
  allowlist. **Please confirm the intended sixth outlier.**
- Pit Fiend's text says "three 2/2 Lemures" but the `t_lemure` token is 1/2; token
  data wins (card data is authoritative).
- Clockwork Defender's text says "a 1/1 Sprocket" but `t_sprocket` is 2/1; token data
  wins.
- Call the Bones (hero power) says "a 1/1 Skeleton"; the only skeleton token is 2/2,
  so the power summons the skeleton token statted 1/1 (power text wins for the power —
  a 2/2 every turn for 2 mana would be far above the other powers' rate).
- Harpy "force an enemy minion to attack a random enemy": the chosen enemy minion
  fights a random *other* minion on its own side (its allies are "enemies" from the
  caster's perspective); fizzles if it has no allies.
- Marilith's forced attacks respect taunt and don't consume her normal attack.
- Leprechaun's deathrattle grants 20 real profile coins (the progression currency),
  credited when the game ends, plus a Wish added to hand in-game.
- Dire Wolf buffs a random adjacent minion (minions are always summoned to the right
  end of the board, so usually its left neighbour). Positional play (choosing an
  insertion point) was cut for scope — see below.
- Intellect Devourer / Nothic "look at" effects reveal through the game log; in
  hot-seat both players can read the log, which mirrors tabletop reality.
- Scavenger's Eye (and Succubus/Night Hag) discard at random — no hand-targeting UI
  for discards.
- Turn Undead is modal on the chosen target: destroys enemy Undead, otherwise deals 4.
- Rust Monster needs no target while the enemy controls a Construct (it eats a random
  one); otherwise it targets any minion for −2 Attack.
- Tarrasque's "can't be targeted by spells or hero powers" applies to both sides'
  spells and powers (classic elusive downside); battlecries and attacks still work.
- Invisible Stalker/Cloaker untargetability blocks *enemy* spells, battlecries and
  hero powers only.
- Raise Dead can resurrect the same minion repeatedly (the graveyard is a record of
  deaths, not a zone cards leave). Animate Dead picks the highest-cost dead minion
  and brings it back at 1 current health (printed max).
- "For each X you control" counts (Elder Brain, Clockwork Titan, Pyrohydra's heads)
  include the minion itself where it matches the tribe, snapshotted when the
  battlecry resolves.

## Meta / progression decisions

- One local profile. 30-card decks, max 2 copies per card, max 1 copy of a legendary.
- New profiles get a fixed starter collection, a prebuilt legal starter deck
  ("First March") and 150 coins.
- Coins: 60 for a win vs AI, 20 for a loss; hot-seat games pay a flat 30 to the
  shared profile and don't touch the personal W/L record.
- Packs cost 100 and contain 5 random collectible cards (8% legendary chance per
  slot; tokens excluded). Pack randomness is true `Math.random` — the seeded RNG is
  for games only.
- The AI plays one of three prebuilt themed decks from the full pool (it doesn't own
  a collection): Emberwing Flight (Dragons), Gravebloom (Undead), Stoneworks
  (Constructs/Giants).

## Not implemented / cut (and why)

- **Positional summoning**: you can't choose where a minion enters the board; they
  append to the right. Only Dire Wolf's adjacency reads position, so the cost of a
  placement UI wasn't worth it. Deathrattle tokens do appear where the minion died.
- **Mulligan**: no opening-hand redraw. The 3/4 card split compensates going second;
  a coin card / mulligan is the obvious next balance lever.
- **Card animations**: damage/death happen instantly with a log entry. The state
  diffing needed for choreographed animation was out of scope.
- **Reveal UI**: Intellect Devourer/Nothic reveals go to the log rather than a modal.
- Nothing in the card set was dropped — all 299 entries load and every battlecry,
  deathrattle, spell, trigger and aura is implemented (`assertEffectCoverage()`
  enforces this at boot and in tests).

## What I'd do next

- A mulligan step and a coin card for the second player.
- Deck import/export (the profile is plain JSON — trivial to expose).
- An "auto-squelch" replay log viewer: the engine is deterministic from (seed,
  action list), so full replays are nearly free.
- Smarter AI lethal search (spells + hero power in the lethal count, two-step
  trades), and AI awareness of its own AoE when the enemy board is wide.
- Sound and a couple of frames of attack/death animation.
- Balance telemetry: log per-card win-rate deltas from AI-vs-AI batch runs
  (`tests/simulation.test.mjs` already plays whole-pool games headlessly).
