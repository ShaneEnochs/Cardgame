// Balance audit report: npm run balance
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initCards } from '../src/engine/cards.js';
import { auditSet, TOLERANCE } from '../src/engine/balance.js';

initCards(JSON.parse(readFileSync(fileURLToPath(new URL('../data/cards.json', import.meta.url)), 'utf8')));

const { rows, violations, staleAllowlist } = auditSet();

const hist = new Map();
for (const r of rows) hist.set(r.deviation, (hist.get(r.deviation) ?? 0) + 1);

console.log(`Balance audit — model: atk + hp + keyword costs ≈ cost*2 + 1 (tolerance ±${TOLERANCE})`);
console.log(`Minions audited: ${rows.length}\n`);
console.log('Deviation histogram:');
for (const d of [...hist.keys()].sort((a, b) => a - b)) {
  const n = hist.get(d);
  console.log(`  ${String(d).padStart(3)}: ${'█'.repeat(Math.ceil(n / 2))} ${n}`);
}

const outliers = rows.filter((r) => Math.abs(r.deviation) > TOLERANCE);
console.log('\nOutliers (beyond tolerance):');
for (const r of outliers.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))) {
  const tag = r.intentional ? 'intentional' : 'VIOLATION';
  console.log(
    `  ${r.deviation > 0 ? '+' : ''}${r.deviation}  ${r.name} (${r.cost} mana ${r.statline}${
      r.keywords.length ? ', ' + r.keywords.join('/') : ''
    }) — ${tag}`
  );
}

if (staleAllowlist.length > 0) {
  console.log('\nStale allowlist entries (no longer outliers):');
  for (const r of staleAllowlist) console.log(`  ${r.name} (${r.deviation})`);
}

if (violations.length > 0 || staleAllowlist.length > 0) {
  console.error(`\nFAIL: ${violations.length} violation(s), ${staleAllowlist.length} stale allowlist entr(ies).`);
  process.exit(1);
}
console.log('\nOK: set is balanced; every outlier is an allowlisted intentional one.');
