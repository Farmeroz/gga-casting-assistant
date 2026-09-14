import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorData,
  reference,
  resolveReference,
  standardDefaults,
  costFor,
  outcomeCost,
  outcome,
  spendPlan,
  trimPlan,
  cleanProfile,
  damageFormula,
} from '../scripts/core.mjs';
import { activeProfile, effectLayout } from '../scripts/effects.mjs';
import { exportProfiles, parseImport, importProfiles } from '../scripts/profiles.mjs';
import { catalogue, filterItems, sortItems } from '../scripts/grimoire-model.mjs';

const spell = (name = 'Fireball', level = 15, cls = 'Missile') => ({
  key: 'system.spells.0000',
  name,
  level,
  kind: 'spell',
  object: { name, level, class: cls, cost: '3', college: 'Fire', pageref: 'M74' },
});
const fp = { path: 'system.FP.value', name: 'FP', value: 10, min: 0, max: 10 };
const er = {
  path: 'system.additionalresources.tracker.0000.value',
  name: 'ER',
  value: 6,
  min: 0,
  max: 6,
};
test('ordinary spells use skill-based discounts and the configured failure cost', () => {
  const entry = spell(),
    profile = standardDefaults(entry),
    cost = costFor(profile, entry);
  assert.deepEqual(cost, { base: 3, reduction: 1, final: 2 });
  assert.equal(outcomeCost(profile, cost, 'success'), 2);
  assert.equal(outcomeCost(profile, cost, 'failure'), 1);
  assert.equal(outcomeCost(profile, cost, 'criticalSuccess'), 0);
  assert.equal(outcomeCost(profile, cost, 'criticalFailure'), 2);
});
test('blocking and lending defaults keep their costs and information failure pays in full', () => {
  for (const entry of [
    spell('Deflect', 20, 'Blocking'),
    spell('Lend Energy', 20),
    spell('Lend Vitality', 20),
  ])
    assert.equal(standardDefaults(entry).applyReduction, false);
  const entry = spell('Seek Water', 10, 'Information'),
    profile = standardDefaults(entry);
  assert.equal(outcomeCost(profile, costFor(profile, entry), 'failure'), 3);
});
test('cost never becomes negative at high skill and outcome needs a valid native result', () => {
  const entry = spell('Light', 40);
  assert.equal(costFor(standardDefaults(entry), entry).final, 0);
  assert.equal(outcome({ rtotal: 7, finaltarget: 12, failure: false }), 'success');
  assert.throws(() => outcome({ rtotal: NaN, finaltarget: 12 }), /valid new GGA roll/);
});
test('split resources allocate the remainder and merge repeated rows', () => {
  const profile = {
    rows: [
      { ...er, amount: 2 },
      { ...fp, amount: 1 },
      { ...fp, amount: 'auto' },
    ],
  };
  const plan = spendPlan(profile, [fp, er], 5);
  assert.deepEqual(
    plan.map((row) => [row.name, row.amount]),
    [
      ['ER', 2],
      ['FP', 3],
    ],
  );
  assert.deepEqual(
    trimPlan(plan, 1).map((row) => [row.name, row.amount]),
    [['ER', 1]],
  );
});
test('invalid allocations cannot overspend, invent resources, or use two auto rows', () => {
  assert.throws(() => spendPlan({ rows: [{ ...fp, amount: 'auto' }] }, [fp], 11), /available/);
  assert.throws(
    () =>
      spendPlan(
        {
          rows: [
            { ...fp, amount: 'auto' },
            { ...er, amount: 'auto' },
          ],
        },
        [fp, er],
        3,
      ),
    /Only one/,
  );
  assert.throws(
    () => spendPlan({ rows: [{ name: 'Missing', amount: 1 }] }, [fp], 1),
    /Choose a resource/,
  );
  assert.throws(() => spendPlan({ rows: [{ ...fp, amount: 1 }] }, [fp], 2), /must match/);
});
test('a tally builds upward while ordinary pools retain their minimum', () => {
  const tally = {
    name: 'Threshold',
    max: 30,
    path: 'system.additionalresources.tracker.1.value',
    value: 20,
    min: 0,
  };
  const plan = spendPlan({ rows: [{ ...tally, mode: 'tally', amount: 'auto' }] }, [tally], 30);
  assert.equal(plan[0].amount, 30);
  assert.equal(plan[0].mode, 'tally');
});
test('saved references recover after reordering but do not guess between duplicates', () => {
  const old = spell(),
    moved = { ...old, key: 'system.spells.0003' };
  assert.equal(resolveReference(reference(old), [moved]), moved);
  assert.equal(
    resolveReference(reference(old), [moved, { ...moved, key: 'system.spells.0004' }]),
    null,
  );
  assert.equal(resolveReference(reference(old), [old, moved]), old);
});
test('nested actor spells remain separate from skills and attacks', () => {
  const data = actorData({
    system: {
      spells: { folder: { contains: { one: spell().object } } },
      skills: { one: { name: 'Meditation', level: 12 } },
      ranged: { one: { name: 'Fireball', mode: 'Missile', damage: '1d burn' } },
    },
  });
  assert.equal(data.abilities.length, 2);
  assert.equal(data.attacks.length, 2);
  assert.equal(
    data.abilities.find((item) => item.kind === 'spell').key,
    'system.spells.folder.contains.one',
  );
});
test('switching effect category suppresses hidden actions without losing the saved profile', () => {
  const original = {
    ...standardDefaults(spell()),
    effectCategory: 'healing',
    rollAttack: true,
    rollDamage: true,
    damageFormula: '1d burn',
    effectType: 'heal-hp',
    effectAmount: '2',
  };
  const active = activeProfile(original);
  assert.equal(active.rollAttack, false);
  assert.equal(active.rollDamage, false);
  assert.equal(active.effectType, 'heal-hp');
  assert.equal(original.rollDamage, true);
  assert.equal(original.damageFormula, '1d burn');
  const other = activeProfile({ ...original, effectCategory: 'other' });
  assert.equal(other.effectType, 'none');
  assert.equal(effectLayout(original, spell(), { attacks: [] }).healing, true);
});
test('simple per-energy damage scaling retains damage type and adds', () => {
  assert.equal(
    damageFormula(null, { damageFormula: '1d+1 burn', scaleDamage: true }, 3),
    '3d+3 burn',
  );
  assert.throws(
    () => damageFormula(null, { damageFormula: 'swing cut', scaleDamage: true }, 3),
    /simple dice formula/,
  );
});
test('profile exports import as new entries and reject invalid versions atomically', async () => {
  globalThis.game = { user: { id: 'owner' } };
  const p = { ...standardDefaults(spell()), id: 'original', tags: ['Fire', 'fire', 'Combat'] };
  const actor = {
    name: 'Caster',
    getFlag: () => ({ version: 2, entries: [p] }),
    testUserPermission: () => true,
    setFlag: async () => {
      throw new Error('Unexpected mutation');
    },
  };
  const incoming = parseImport(exportProfiles(actor));
  assert.notEqual(incoming[0].id, p.id);
  assert.deepEqual(incoming[0].tags, ['Fire', 'Combat']);
  assert.throws(() => cleanProfile({ ...p, schemaVersion: 99 }), /unsupported version/);
  await assert.rejects(
    importProfiles(actor, JSON.stringify({ format: 'wrong', version: 2, profiles: [] })),
    /profile export/,
  );
});
test('grimoire search, bookmarks, and sorting preserve actor data', () => {
  const entry = spell('Flamé Jet'),
    actor = {
      name: 'Mage',
      system: { spells: { '0000': entry.object }, FP: { value: 10, max: 10 } },
      getFlag: () => null,
    };
  const before = structuredClone(actor.system),
    items = catalogue(actor, [{ type: 'ability', ref: reference(entry) }]);
  assert.equal(filterItems(items, { query: 'flame fire', favourites: true }).length, 1);
  assert.equal(filterItems(items, { query: 'healing' }).length, 0);
  assert.equal(
    sortItems([...items, { ...items[0], id: 'b', name: 'Alpha', level: null }], 'skill')[0].name,
    'Flamé Jet',
  );
  assert.deepEqual(actor.system, before);
});
