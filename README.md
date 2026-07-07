# Forgebound: Bestiary

A two-player dueling card game (Hearthstone-lite): 30-life heroes, mana climbing
1→10, minions with summoning sickness, spells, hero powers, and a 299-card bestiary
set with tribal synergy across 12 tribes.

Work in progress — see `NOTES.md` for the running decision log.

## Run it

```sh
git clone https://github.com/ShaneEnochs/Cardgame.git
cd Cardgame
npm start          # serves at http://localhost:5173 — no install step, zero dependencies
```

Requires Node 18+ and a browser. Progress (coins, collection, decks) persists in the
browser's localStorage.

## Test it

```sh
npm test           # engine + effects + AI simulation tests (node --test)
npm run balance    # card-set balance audit
```

## Stack

Vanilla ES-module JavaScript, no framework, no build step, zero npm dependencies —
the repo's prototype was plain HTML/JS and nothing in this game needs more. The
engine is pure data-in/data-out and runs headless under Node for tests; the UI is a
thin DOM layer over it.

## Art direction

Printed field-guide: ink on unbleached paper, flat vermilion and slate accents,
hard-edged square-cornered cards with a rectangular cost tab — chosen because a
light, print-like board keeps fourteen minions readable at a glance, and because it
deliberately avoids the stock "glowing dark-fantasy" look (teal-and-copper on dark,
Cinzel display type, glow borders, vignettes, circular cost badges).
