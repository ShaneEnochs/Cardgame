# NOTES — running decisions log

Working notes for the Forgebound: Bestiary build. Newest entries at the bottom of each section.

## What was in the repo

- A `Testing` placeholder file (removed) and `forgebound.html`, a single-file prototype.
- The prototype had exactly the failure modes the spec calls out: hero objects mutated
  with `__isHero`/`name` flags to act as targets, and module-global `pendingTarget` /
  `selectedAttackerUid` selection state that could linger across actions. It also used
  the AI-default art direction (Cinzel + Inter, copper/teal on dark, radial vignette,
  glowing borders, circular cost badges). It is kept for reference at
  `prototype/forgebound.html` and superseded by this app.
- No LICENSE file exists in the repo; none was added (owner's call).

## Stack

- Vanilla ES-module JavaScript, no framework, no build step, zero npm dependencies.
  The repo's existing prototype was plain HTML/JS, so this builds on that choice.
- Runs as a locally-served web app (`npm start` → tiny Node static server), because
  `fetch`ing `cards.json` and ES modules don't work over `file://`.
- Persistence: `localStorage` (real on-disk storage in every browser profile).
- Tests: Node's built-in `node --test` runner against the pure engine (the engine has
  no DOM dependencies).

## Engine decisions

- Game state is a single JSON-serializable object. All mutations go through
  `applyAction(state, action)` which deep-clones, validates the action, applies it,
  processes deaths/expiries, checks win, then runs `validateState` invariants
  (hand/board caps, mana bounds, unique uids, no dead minions on board, heroes carry
  no foreign keys, etc.). Targets are plain descriptors `{kind:'hero'|'minion',
  player, uid}` — hero objects are never mutated with flags.
- Targeting/attacker selection is UI-only state; the engine only ever receives
  complete actions. Cancelling a selection is a UI no-op, so it can't corrupt a game.
- Seeded RNG (mulberry32) lives in the state, so games and tests are reproducible.
- `charge` and `haste` are treated as the same ability (attack anything immediately);
  the balance model prices both at 2. They stay distinct keywords for display.
- Freeze: a frozen minion can't attack; it thaws at the end of its controller's turn.
  Hold Monster applies freeze 2 (misses two of its turns).
- Ward = absorbs the next damage instance entirely, then breaks (divine shield).
- Silence removes keywords, deathrattles/triggers, buffs/debuffs (stats return to
  printed values, current damage kept), freeze, and untargetability.

## Card-set readings (ambiguities resolved, flagged for review)

- **Outliers:** the spec says six intentional outliers are "labeled in the data", but
  `cards.json` carries no such label. Under the stated model
  (atk+hp+keyword_costs vs cost*2+1), exactly **five** cards sit outside ±2:
  `tarrasque` (+7), `nosferatu` (−4), `lich` (−3), `mummy_lord` (−3),
  `wailing_banshee` (−3). Those five are allowlisted in the audit. `leprechaun` (−2,
  the deliberate "20 coins" gag card) is the likely sixth — flagged for confirmation
  rather than guessed into the allowlist.
- Pit Fiend's text says "three 2/2 Lemures" but the `t_lemure` token is 1/2; token
  data wins (card data is authoritative).
- Clockwork Defender's text says "a 1/1 Sprocket" but `t_sprocket` is 2/1; token data
  wins.
- Call the Bones (hero power) says "a 1/1 Skeleton"; the only skeleton token is 2/2,
  so the power summons a 1/1 with the skeleton token's identity (power text wins for
  the power, since 2/2-per-turn would be far above the other powers' rate).
- Harpy "force an enemy minion to attack a random enemy": the chosen enemy minion
  fights a random *other* minion on its own side (its allies are "enemies" from the
  caster's perspective); fizzles if it has no allies.
- Marilith's forced attacks respect taunt and don't consume her normal attack.
- Leprechaun's deathrattle grants 20 real profile coins (the progression currency) to
  the controlling player's profile at game end, plus a Wish added to hand in-game.
- Dire Wolf buffs a random adjacent minion (minions are always summoned to the right
  end of the board, so usually its left neighbour).
- Intellect Devourer / Nothic "look at" effects reveal through the game log; in
  hot-seat both players can read the log, which mirrors tabletop reality.
- Scavenger's Eye discards a random card (no hand-targeting UI for discards).

## Meta / progression decisions

- One local profile. 30-card decks, max 2 copies per card, max 1 copy of a legendary.
- New profiles get a fixed starter collection and a prebuilt legal starter deck.
- Coins: 60 for a win vs AI, 20 for a loss; hot-seat games pay 30 to the shared
  profile. Packs cost 100 and contain 5 cards (tokens excluded; small legendary
  chance per slot).

## Not implemented / cut

- (tracking as work proceeds)

## What I'd do next

- (tracking as work proceeds)
