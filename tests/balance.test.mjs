import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js'; // initialises the card DB
import { auditSet, TOLERANCE, INTENTIONAL_OUTLIERS } from '../src/engine/balance.js';

test('every minion is on curve or an allowlisted intentional outlier', () => {
  const { violations } = auditSet();
  assert.deepEqual(
    violations.map((v) => `${v.id} (${v.deviation})`),
    [],
    `cards outside ±${TOLERANCE} that are not allowlisted`
  );
});

test('the allowlist stays honest: every entry really is an outlier', () => {
  const { staleAllowlist, rows } = auditSet();
  assert.deepEqual(staleAllowlist.map((r) => r.id), []);
  for (const id of INTENTIONAL_OUTLIERS) {
    assert.ok(rows.some((r) => r.id === id), `allowlisted ${id} is not in the set`);
  }
});

test('spot-check the model against known cards', () => {
  const { rows } = auditSet();
  const by = (id) => rows.find((r) => r.id === id);
  assert.equal(by('red_wyrmling').deviation, 0); // 3+2 vs 2*2+1
  assert.equal(by('tarrasque').deviation, 7); // the big intentional one
  assert.equal(by('nosferatu').deviation, -4);
});
