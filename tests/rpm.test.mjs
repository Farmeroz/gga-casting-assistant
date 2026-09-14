import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDesign,
  newModifier,
  calculateDesign,
  modifierCost,
  sizeCost,
  weightCost,
  durationCost,
  longRangeCost,
  cleanDesign,
} from '../scripts/rpm-model.mjs';
import { designProfile, pathChoice } from '../scripts/rpm-profile.mjs';
import { standardDefaults, cleanProfile, ID } from '../scripts/core.mjs';
import { exportProfiles, parseImport } from '../scripts/profiles.mjs';
import { parseProfileText } from '../scripts/parser.mjs';
const effect = (path, kind, greater = false, quantity = 1) => ({
  path,
  effect: kind,
  greater,
  quantity,
  notes: '',
});
const modifier = (kind, fields = {}) => ({ ...newModifier(kind), ...fields });
const build = (effects, modifiers, other = {}) => ({
  ...newDesign(),
  effects,
  modifiers,
  ...other,
});
const actor = {
  system: {
    skills: {
      '0000': { name: 'Path of Body', level: 15 },
      '0001': { name: 'Path of Magic', level: 13 },
      '0002': { name: 'Path of Mind', level: 14 },
    },
  },
};

test('RPM p. 39 Alertness calculation: narrow scope is not substituted for broad Sense rolls', () => {
  const r = calculateDesign(
    build(
      [effect('Mind', 'Strengthen')],
      [
        modifier('bonus', { value: 2, scope: 'broad', notes: 'Sense rolls' }),
        modifier('duration', { value: 10 }),
      ],
    ),
  );
  assert.equal(r.total, 14);
  assert.equal(r.greater, 0);
});
test('RPM p. 39 Bag of Bones: conditional wrapper is inside the Greater multiplier', () => {
  const r = calculateDesign(
    build(
      [effect('Undead', 'Control', true), effect('Undead', 'Create')],
      [modifier('duration', { value: 1, unit: 'days' }), modifier('weight', { value: 100 })],
      { delivery: 'charm' },
    ),
  );
  assert.equal(r.base, 25);
  assert.equal(r.total, 75);
  assert.deepEqual(r.paths, ['Undead', 'Magic']);
});
test('RPM p. 39 Body of Shadow: two Greater effects multiply every component', () => {
  const r = calculateDesign(
    build(
      [effect('Body', 'Transform', true), effect('Energy', 'Transform', true)],
      [
        modifier('traits', { value: 50, notes: 'Shadow Form' }),
        modifier('duration', { value: 10 }),
        modifier('weight', { value: 300 }),
      ],
    ),
  );
  assert.equal(r.base, 70);
  assert.equal(r.total, 350);
});
test('repeated Greater effects count individually and round-trip without duplicate header counting', () => {
  const r = calculateDesign(build([effect('Body', 'Destroy', true, 2)], []), 'Test ritual');
  assert.equal(r.greater, 2);
  assert.equal(r.total, 50);
  const parsed = parseProfileText(r.block);
  assert.equal(parsed.greaterCount, 2);
  assert.equal(parsed.multiplier, 5);
  assert.equal(parsed.energy, 50);
});
test('range, area and speed round up SSRT boundaries', () => {
  assert.deepEqual(
    [0, 2, 2.1, 3, 3.1, 5, 7, 10, 15, 20, 21, 30, 100, 12000].map(sizeCost),
    [0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 7, 10, 23],
  );
  assert.equal(modifierCost(modifier('area', { value: 2, excluded: 3 })).cost, 4);
});
test('weight and duration round up while momentary is free', () => {
  assert.deepEqual(
    [10, 11, 30, 31, 100, 300, 301, 10000].map(weightCost),
    [0, 1, 1, 2, 2, 3, 4, 6],
  );
  assert.deepEqual(
    [0, 1, 600, 601, 1800, 3600, 86400, 2592000, 31536000, 31536001].map(durationCost),
    [0, 1, 1, 2, 2, 3, 7, 11, 22, 23],
  );
});
test('information ranges use B241, with 200 yards rather than 200 miles free', () => {
  assert.deepEqual(
    [0, 200 / 1760, 0.12, 0.5, 1, 1.1, 3, 10, 30, 100, 300, 1000, 1001, 3000, 3001, 10000].map(
      longRangeCost,
    ),
    [0, 0, 1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 9, 10, 10],
  );
});
test('damage uses delivered dice, external scaling, damage type and enhancement breakpoints', () => {
  assert.equal(modifierCost(modifier('damage', { dice: 3, adds: 3, delivery: 'missile' })).cost, 1);
  assert.equal(
    modifierCost(modifier('damage', { dice: 2, adds: 2, delivery: 'explosive' })).cost,
    1,
  );
  assert.equal(modifierCost(modifier('damage', { dice: 3, adds: 1, damageType: 'cut' })).cost, 14);
  assert.equal(
    modifierCost(modifier('damage', { dice: 3, adds: 1, damageType: 'cut', enhancements: 10 }))
      .cost,
    16,
  );
  assert.equal(modifierCost(modifier('damage', { dice: 10, enhancements: 10 })).cost, 40);
  assert.equal(modifierCost(modifier('damage', { dice: 1, hasEnhancements: true })).cost, 1);
});
test('traits, afflictions, healing and trappings use their separate costs', () => {
  assert.equal(modifierCost(modifier('traits', { value: 11, removes: true })).cost, 3);
  assert.equal(
    modifierCost(modifier('traits', { value: 10, removes: true, noSelfControl: true })).cost,
    5,
  );
  assert.equal(modifierCost(modifier('affliction', { value: 31 })).cost, 7);
  assert.equal(modifierCost(modifier('healing', { dice: 2 })).cost, 4);
  const r = calculateDesign(
    build([effect('Body', 'Restore')], [modifier('weight', { value: 300 })], { trappings: 25 }),
  );
  assert.equal(r.total, 6);
});
test('inherent Healing appears in the exported write-up; Duration and Weight remain casting details', () => {
  const r = calculateDesign(
    build([effect('Body', 'Restore')], [modifier('healing'), modifier('weight', { value: 300 })]),
    'Minor Healing',
  );
  assert.equal(r.total, 7);
  assert.match(r.block, /Inherent Modifiers: Healing, 1d HP\./);
  assert.doesNotMatch(r.block.split('\n')[2], /Weight/);
});
test('saved construction and resource allocation survive export/import and can be edited again', () => {
  const original = {
    ...standardDefaults(null),
    rules: 'threshold',
    rows: [
      {
        name: 'Threshold',
        path: 'system.additionalresources.tracker.0002.value',
        mode: 'tally',
        amount: 'auto',
      },
    ],
  };
  const d = build(
    [effect('Body', 'Restore')],
    [modifier('healing'), modifier('weight', { value: 300 })],
  );
  const { profile } = designProfile(actor, { name: 'Mend', design: d }, original);
  assert.equal(profile.ability.name, 'Path of Body');
  assert.equal(profile.rules, 'threshold');
  assert.equal(profile.baseCost, 7);
  assert.equal(profile.effectAmount, '1d');
  const [loaded] = parseImport(exportProfiles(actor, [profile]));
  assert.deepEqual(loaded.rpmDesign, profile.rpmDesign);
  assert.deepEqual(loaded.rows, original.rows);
  loaded.rpmDesign.modifiers[0].dice = 2;
  assert.equal(
    designProfile(actor, { name: loaded.name, design: loaded.rpmDesign }, loaded).profile.baseCost,
    11,
  );
});
test('lowest required Path and multi-Path penalty are saved, missing Paths are explicit', () => {
  const d = build([effect('Body', 'Sense'), effect('Mind', 'Sense'), effect('Magic', 'Sense')], []);
  const { profile } = designProfile(actor, { name: 'Scan', design: d });
  assert.equal(profile.ability.name, 'Path of Magic');
  assert.equal(profile.rpmPathPenalty, 1);
  assert.equal(profile.modifier, 0);
  assert.deepEqual(pathChoice(actor, ['Body', 'Energy']).missing, ['Energy']);
});
test('invalid design data cannot silently become a cheap valid ritual', () => {
  const d = newDesign();
  d.effects[0].quantity = -1;
  assert.throws(() => cleanDesign(d), /Effect count/);
  assert.throws(
    () => calculateDesign(build([effect('Body', 'Restore')], [modifier('extra', { value: -1 })])),
    /Modifier value/,
  );
  assert.throws(
    () => cleanProfile({ ...standardDefaults(null), rpmDesign: { version: 9 } }),
    /Unsupported RPM/,
  );
});
test('v2 profiles migrate placeholder threshold step without changing explicit custom progression', () => {
  assert.equal(
    cleanProfile({ ...standardDefaults(null), schemaVersion: 2, thresholdStep: 1 }).thresholdStep,
    5,
  );
  assert.equal(
    cleanProfile({ ...standardDefaults(null), schemaVersion: 2, thresholdStep: 3 }).thresholdStep,
    3,
  );
});

test('the actual casting preparation uses generated healing and the selected threshold allocation', async () => {
  const { prepareCast } = await import('../scripts/workflow.mjs');
  globalThis.game = { user: { id: 'gm', isGM: true, targets: [] } };
  const a = {
    ...actor,
    testUserPermission: () => true,
    system: {
      ...actor.system,
      additionalresources: {
        tracker: { '0000': { name: 'Threshold', min: 0, max: 30, value: 28 } },
      },
    },
  };
  const { profile } = designProfile(a, {
    name: 'Mend',
    design: build(
      [effect('Body', 'Restore')],
      [modifier('healing'), modifier('weight', { value: 300 })],
    ),
  });
  profile.rows = [
    {
      name: 'Threshold',
      path: 'system.additionalresources.tracker.0000.value',
      mode: 'tally',
      amount: 'auto',
    },
  ];
  const prepared = prepareCast(a, profile);
  assert.equal(prepared.plan[0].amount, 7);
  assert.equal(prepared.plan[0].mode, 'tally');
  assert.equal(prepared.recovery.formula, '1d6');
});
test('charm preparation suppresses stored healing rather than healing immediately', async () => {
  const { prepareCast } = await import('../scripts/workflow.mjs');
  globalThis.game = { user: { id: 'gm', isGM: true, targets: [] } };
  const a = {
    ...actor,
    testUserPermission: () => true,
    system: { ...actor.system, FP: { value: 30, max: 30 } },
  };
  const { profile } = designProfile(a, {
    name: 'Charm',
    design: build([effect('Body', 'Restore')], [modifier('healing')], { delivery: 'charm' }),
  });
  const prepared = prepareCast(a, profile);
  assert.equal(prepared.cost.final, 9);
  assert.equal(prepared.recovery, null);
  assert.equal(profile.effectAmount, '1d');
});
