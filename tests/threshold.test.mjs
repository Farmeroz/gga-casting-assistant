import test from 'node:test';
import assert from 'node:assert/strict';
import { thresholdChecks, resolveThresholds } from '../scripts/threshold.mjs';
import { trackerDefinition, createMagicTracker } from '../scripts/trackers.mjs';
import { resources, spendPlan, ID, standardDefaults } from '../scripts/core.mjs';
import { spendDirect } from '../scripts/mutations.mjs';
const gm = { id: 'gm', isGM: true };
globalThis.game = { user: gm };
const source = {
  name: 'Threshold',
  path: 'system.additionalresources.tracker.0000.value',
  value: 0,
  max: 30,
  min: 0,
  mode: 'tally',
};
const profile = { ...standardDefaults(null), rows: [{ ...source, amount: 'auto' }] };
function actor(value = 0) {
  const a = {
    uuid: 'Actor.' + Math.random(),
    name: 'Mage',
    system: {
      attributes: { WILL: { value: 14 } },
      additionalresources: {
        tracker: {
          '0000': trackerDefinition({
            kind: 'threshold',
            name: 'Threshold',
            maximum: 30,
            current: value,
          }),
        },
      },
    },
    flags: {},
    testUserPermission: (u) => u.isGM,
    getFlag: (_id, key) => a.flags[key],
    update: async (changes) => {
      for (const [path, value] of Object.entries(changes)) {
        if (path === `flags.${ID}.operations`) {
          a.flags.operations = value;
          continue;
        }
        const parts = path.split('.'),
          key = parts.pop();
        let dest = a;
        for (const k of parts) dest = dest[k] ??= {};
        dest[key] = value;
      }
    },
  };
  return a;
}
test('cap is safe, 1–4 excess triggers +0, full five-point increments add modifiers', () => {
  assert.equal(thresholdChecks(profile, [{ ...source, value: 30 }]).length, 0);
  for (const [value, mod] of [
    [31, 0],
    [34, 0],
    [35, 1],
    [39, 1],
    [40, 2],
  ])
    assert.equal(thresholdChecks(profile, [{ ...source, value }])[0].modifier, mod);
});
test('zero-cost and failed casts over the cap still check using actual post-payment tally', () => {
  assert.equal(thresholdChecks(profile, [{ ...source, value: 35 }], [])[0].modifier, 1);
  const paid = [{ ...source, value: 29, after: 31, amount: 2 }];
  assert.equal(thresholdChecks(profile, [{ ...source, value: 50 }], paid)[0].after, 31);
});
test('rules label does not suppress checks and duplicate allocation rows do not double-roll', () => {
  for (const rules of ['rpm', 'standard', 'power', 'threshold']) {
    const p = { ...profile, rules, rows: [...profile.rows, ...profile.rows] };
    assert.equal(thresholdChecks(p, [{ ...source, value: 40 }]).length, 1);
  }
});
test('separate tallies keep their own cap, modifier and table', () => {
  const second = {
    ...source,
    name: 'Other',
    path: 'system.additionalresources.tracker.0001.value',
    max: 10,
    value: 17,
    thresholdStep: 3,
    thresholdTable: 'RollTable.other',
  };
  const checks = thresholdChecks(
    { ...profile, rows: [...profile.rows, { ...second, amount: 0 }] },
    [{ ...source, value: 34 }, second],
  );
  assert.deepEqual(
    checks.map((c) => c.modifier),
    [0, 2],
  );
  assert.equal(checks[1].table, 'RollTable.other');
});
test('created threshold trackers count up past the cap and ordinary pools remain bounded', async () => {
  const a = actor(29);
  const available = resources(a);
  const plan = spendPlan(profile, available, 10);
  const paid = await spendDirect(a, plan, 'threshold-spend');
  assert.equal(a.system.additionalresources.tracker['0000'].value, 39);
  assert.equal(a.system.additionalresources.tracker['0000'].isMaximumEnforced, false);
  assert.equal(thresholdChecks(profile, resources(a), paid.rows)[0].modifier, 1);
  assert.throws(() => trackerDefinition({ name: 'Magic FP', current: 11, maximum: 10 }), /exceed/);
  assert.throws(
    () => spendPlan({ ...profile, rows: [{ ...profile.rows[0], mode: 'pool' }] }, resources(a), 3),
    /Build tally/,
  );
});
test('tracker creation preserves existing fields, uses unused padded keys and rejects duplicate names', async () => {
  const a = actor();
  a.system.additionalresources.tracker['0012'] = { name: 'Ammo', value: 8, max: 10, color: 'red' };
  const created = await createMagicTracker(a, { name: 'Energy Pool', maximum: 20, current: 20 });
  assert.equal(created.path, 'system.additionalresources.tracker.0013.value');
  assert.equal(a.system.additionalresources.tracker['0012'].color, 'red');
  await assert.rejects(
    createMagicTracker(a, { name: 'energy pool', maximum: 20, current: 0 }),
    /already exists/,
  );
  await assert.rejects(
    createMagicTracker(a, { name: 'Forbidden', maximum: 20, current: 0 }, { isGM: false }),
    /ownership/,
  );
});
test('automatic calamity preserves private/blind audience and looks up exact modified total without drawing', async () => {
  const messages = [],
    formulas = [],
    looked = [];
  globalThis.Roll = class {
    constructor(f) {
      this.formula = f;
      formulas.push(f);
    }
    async evaluate() {
      this.total = 14;
      return this;
    }
    async render() {
      return 'roll';
    }
  };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (m) => messages.push(m) };
  globalThis.fromUuid = async () => ({
    documentName: 'RollTable',
    name: 'World Calamities',
    testUserPermission: () => true,
    getResultsForRoll: (n) => {
      looked.push(n);
      return [{ description: 'Campaign result' }];
    },
  });
  const access = { whisper: ['gm'], blind: true };
  const checks = thresholdChecks({ ...profile, tables: { threshold: 'RollTable.a' } }, [
    { ...source, value: 39 },
  ]);
  const results = await resolveThresholds(actor(), checks, access);
  assert.deepEqual(formulas, ['3d6 + 1']);
  assert.deepEqual(looked, [14]);
  assert.deepEqual(messages[0].whisper, ['gm']);
  assert.equal(messages[0].blind, true);
  assert.equal(results[0].total, 14);
});
test('29+ checks resolve Will before spell effects; failure blocks effects but does not refund costs', async () => {
  let count = 0;
  globalThis.Roll = class {
    async evaluate() {
      this.total = count++ ? 12 : 29;
      return this;
    }
    async render() {
      return 'roll';
    }
  };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
  const a = actor(90),
    checks = thresholdChecks(profile, resources(a));
  const [r] = await resolveThresholds(a, checks, {});
  assert.equal(r.willTarget, 2);
  assert.equal(r.spellAllowed, false);
  assert.equal(a.system.additionalresources.tracker['0000'].value, 90);
});
