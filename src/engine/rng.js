// Seeded RNG (mulberry32). The generator state lives inside the game state so
// every game is reproducible from its seed — tests and replays rely on this.

export function seedRng(seed) {
  return (seed >>> 0) || 1;
}

export function nextFloat(state) {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state, n) {
  return Math.floor(nextFloat(state) * n);
}

export function pick(state, arr) {
  if (arr.length === 0) return undefined;
  return arr[randInt(state, arr.length)];
}

export function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
