import test from 'node:test';
import assert from 'node:assert/strict';
import { ID, actorData, standardDefaults, cleanProfile } from '../scripts/core.mjs';
import { profiles, parseImport } from '../scripts/profiles.mjs';
import {
  effectState,
  trackingState,
  spellsOn,
  healingPreview,
  maintenanceCost,
} from '../scripts/tracking-model.mjs';
import { trackingRequest, startFromCard, ongoingSnapshot } from '../scripts/tracking.mjs';
import { recoveryDirect } from '../scripts/mutations.mjs';
import { prepareCast } from '../scripts/workflow.mjs';

const gm = { id: 'gm', isGM: true },
  player = { id: 'player', isGM: false };
const actors = new Map();
let offset = 0,
  messages = [],
  rolls = [];
globalThis.game = {
  user: gm,
  users: [gm, player],
  time: { worldTime: 0 },
  settings: { get: () => offset },
};
globalThis.fromUuid = async (id) => actors.get(id);
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => {
    messages.push(data);
    return data;
  },
};
globalThis.Roll = class {
  constructor(formula) {
    rolls.push(formula);
  }
  async evaluate() {
    this.total = 10;
    return this;
  }
  async render() {
    return 'dice';
  }
};
function actor(id) {
  game.time.worldTime = 0;
  game.user.targets = [];
  offset = 0;
  messages = [];
  rolls = [];
  const a = {
    uuid: `Actor.${id}`,
    name: id,
    documentName: 'Actor',
    flags: {},
    updates: 0,
    system: {
      FP: { value: 20, max: 20 },
      HP: { value: 5, max: 10 },
      spells: {
        light: { name: 'Light', level: 15, cost: '1', maintain: '1', duration: '1 minute' },
        minor: { name: 'Minor Healing', level: 16, cost: '1' },
        major: { name: 'Major Healing', level: 16, cost: '1' },
      },
    },
    testUserPermission: (u) => u.isGM || u.id === player.id,
    getFlag: (_scope, key) => a.flags[key],
    async update(changes) {
      for (const [path, v] of Object.entries(changes)) {
        if (path.startsWith(`flags.${ID}.`)) {
          a.flags[path.slice(`flags.${ID}.`.length)] = structuredClone(v);
          continue;
        }
        const parts = path.split('.'),
          key = parts.pop();
        let dest = a;
        for (const p of parts) dest = dest[p] ??= {};
        dest[key] = structuredClone(v);
      }
      a.updates++;
    },
  };
  actors.set(a.uuid, a);
  return a;
}
const entry = (a, name) => actorData(a).abilities.find((e) => e.name === name);
function profile(a, name = 'Light') {
  const p = standardDefaults(entry(a, name));
  p.ongoing.mode = 'timed';
  return p;
}
async function add(a, p = profile(a), id = 'light') {
  await trackingRequest({ kind: 'effect-add', actorUuid: a.uuid, profile: p, operation: id }, gm);
  return trackingState(a).effects.find((e) => e.id === id);
}
const change = (a, e, kind, extra = {}) =>
  trackingRequest(
    {
      kind,
      actorUuid: a.uuid,
      effectId: e.id,
      revision: e.revision,
      rows: e.profile.rows,
      ...extra,
    },
    gm,
  );

test('v3 saved data and exports migrate without enabling duration tracking or losing profiles', () => {
  const a = actor('migration'),
    p = profile(a);
  delete p.ongoing;
  p.schemaVersion = 3;
  a.flags.profiles = { version: 3, entries: [p] };
  const saved = profiles(a)[0];
  assert.equal(saved.ongoing.mode, 'off');
  assert.equal(saved.ongoing.penalty, 'on');
  assert.equal(
    parseImport(JSON.stringify({ format: ID, version: 3, profiles: [p] }))[0].name,
    'Light',
  );
  assert.throws(() => cleanProfile({ ...p, ongoing: { mode: 'timed', amount: 0 } }), /Duration/);
});
test('timed expiry, permanent-style exclusion and concentration apply correct spells-on penalties', async () => {
  const a = actor('penalties'),
    p = profile(a);
  p.ongoing.maintainable = false;
  const e = await add(a, p);
  assert.equal(spellsOn(a), 1);
  await change(a, e, 'effect-concentration');
  assert.equal(spellsOn(a), 3);
  game.time.worldTime = 60;
  assert.equal(spellsOn(a), 0);
  await trackingRequest({ kind: 'tracking-tick', actorUuid: a.uuid }, gm);
  game.time.worldTime = 0;
  assert.equal(spellsOn(a), 0, 'clock rewind does not resurrect recorded expiry');
  p.ongoing.mode = 'indefinite';
  p.ongoing.penalty = 'none';
  await add(a, p, 'permanent');
  assert.equal(spellsOn(a), 0);
});
test('zero-cost maintenance extends from the old boundary, retains spells on and never rolls dice', async () => {
  const a = actor('free');
  let e = await add(a);
  assert.equal(e.maintenanceCost, 0);
  game.time.worldTime = 120;
  assert.equal(effectState(e), 'due');
  assert.equal(spellsOn(a), 1);
  await change(a, e, 'effect-maintain', { awake: true });
  e = trackingState(a).effects[0];
  assert.equal(e.endsAt, 120);
  assert.equal(effectState(e), 'due');
  await change(a, e, 'effect-maintain', { awake: true });
  assert.equal(trackingState(a).effects[0].endsAt, 180);
  assert.equal(a.system.FP.value, 20);
  assert.deepEqual(rolls, []);
});
test('duplicate maintenance requests cannot double-spend or extend twice', async () => {
  const a = actor('concurrent'),
    p = profile(a);
  p.ongoing.maintenanceCost = 4;
  const e = await add(a, p);
  game.time.worldTime = 60;
  const results = await Promise.allSettled([
    change(a, e, 'effect-maintain', { awake: true }),
    change(a, e, 'effect-maintain', { awake: true }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(a.system.FP.value, 17);
  assert.equal(trackingState(a).effects[0].endsAt, 120);
});
test('insufficient funds and unauthorised users leave resources and timer unchanged', async () => {
  const a = actor('funds'),
    p = profile(a);
  p.ongoing.maintenanceCost = 100;
  const e = await add(a, p);
  game.time.worldTime = 60;
  await assert.rejects(change(a, e, 'effect-maintain', { awake: true }), /available/);
  assert.equal(trackingState(a).effects[0].endsAt, 60);
  assert.equal(a.system.FP.value, 20);
  await assert.rejects(
    trackingRequest({ kind: 'effect-end', actorUuid: a.uuid }, { id: 'stranger' }),
    /ownership/,
  );
});
test('maintenance supports a reviewed split between FP and another resource', async () => {
  const a = actor('split'),
    p = profile(a);
  p.ongoing.maintenanceCost = 5;
  a.system.additionalresources = { tracker: { '0000': { name: 'ER', value: 10, max: 10 } } };
  const e = await add(a, p);
  game.time.worldTime = 60;
  await change(a, e, 'effect-maintain', {
    awake: true,
    rows: [
      { ...p.rows[0], amount: 1 },
      {
        name: 'ER',
        path: 'system.additionalresources.tracker.0000.value',
        mode: 'pool',
        amount: 'auto',
      },
    ],
  });
  assert.equal(a.system.FP.value, 19);
  assert.equal(a.system.additionalresources.tracker['0000'].value, 7);
});
test('early standard cancellation costs exactly one; lapse and external ending cost nothing', async () => {
  const a = actor('cancel');
  let e = await add(a);
  await change(a, e, 'effect-end', { reason: 'cancel' });
  assert.equal(a.system.FP.value, 19);
  e = await add(a, profile(a), 'second');
  game.time.worldTime = 60;
  await change(a, e, 'effect-end', { reason: 'expire' });
  assert.equal(a.system.FP.value, 19);
  e = await add(a, profile(a), 'third');
  await change(a, e, 'effect-end', { reason: 'external' });
  assert.equal(spellsOn(a), 0);
});
test('paid threshold maintenance checks the new tally; free maintenance over cap does not', async () => {
  const a = actor('threshold'),
    p = profile(a);
  p.rules = 'threshold';
  a.system.additionalresources = {
    tracker: {
      '0000': {
        name: 'Threshold',
        value: 31,
        max: 30,
        gcaResource: { kind: 'threshold', step: 5 },
      },
    },
  };
  p.rows = [
    {
      name: 'Threshold',
      path: 'system.additionalresources.tracker.0000.value',
      mode: 'tally',
      amount: 'auto',
    },
  ];
  let e = await add(a, p);
  game.time.worldTime = 60;
  await change(a, e, 'effect-maintain', { awake: true });
  assert.deepEqual(rolls, []);
  p.ongoing.maintenanceCost = 5;
  e = await add(a, p, 'paid');
  game.time.worldTime = 120;
  await change(a, e, 'effect-maintain', { awake: true });
  assert.equal(a.system.additionalresources.tracker['0000'].value, 35);
  assert.deepEqual(rolls, ['3d6 + 1']);
  assert.ok(messages.every((m) => m.whisper?.includes('gm')));
});
test('starting an old card is idempotent even after ending its effect; failed and blind starts are guarded', async () => {
  const a = actor('cards'),
    p = profile(a);
  let c = {
    paid: true,
    result: 'success',
    actorUuid: a.uuid,
    name: p.name,
    ongoing: ongoingSnapshot(p, entry(a, 'Light')),
    recipients: [],
  };
  const card = { id: 'old', author: player, whisper: ['gm'], getFlag: () => c };
  await startFromCard(card, player);
  let e = trackingState(a).effects[0];
  await change(a, e, 'effect-end', { reason: 'external' });
  await startFromCard(card, player);
  assert.equal(trackingState(a).effects.length, 1);
  assert.equal(spellsOn(a), 0);
  await assert.rejects(startFromCard({ ...card, blind: true }, player), /GM/);
  c = { ...c, attackResult: 'failure' };
  await assert.rejects(startFromCard(card, gm), /successful/);
  c = { ...c, attackResult: undefined, result: 'failure' };
  await assert.rejects(startFromCard(card, gm), /successful/);
});
test('healing reserves before rolling, rejects concurrent pending attempts, counts failures and separates spells/casters/patients', async () => {
  const a = actor('healer'),
    b = actor('other'),
    patient = actor('patient');
  const p = profile(a, 'Minor Healing'),
    targets = [patient.uuid];
  const req = {
    kind: 'healing-reserve',
    actorUuid: a.uuid,
    profile: p,
    targets,
    operation: 'h1',
    expectedCount: 0,
  };
  await trackingRequest(req, player);
  await assert.rejects(trackingRequest({ ...req, operation: 'h2' }, player), /previous healing/);
  await trackingRequest({ kind: 'healing-complete', actorUuid: a.uuid, operation: 'h1' }, player);
  assert.equal(healingPreview(a, p, entry(a, 'Minor Healing'), targets).penalty, 3);
  assert.equal(
    healingPreview(a, profile(a, 'Major Healing'), entry(a, 'Major Healing'), targets).penalty,
    0,
  );
  assert.equal(
    healingPreview(b, profile(b, 'Minor Healing'), entry(b, 'Minor Healing'), targets).penalty,
    0,
  );
  assert.equal(healingPreview(a, p, entry(a, 'Minor Healing'), [b.uuid]).penalty, 0);
  await assert.rejects(trackingRequest({ ...req, operation: 'h2' }, player), /history changed/);
});
test('healing day uses world time and configured boundary, not elapsed real time', async () => {
  const a = actor('days'),
    patient = actor('day-patient'),
    p = profile(a, 'Minor Healing');
  game.time.worldTime = 86399;
  await trackingRequest(
    {
      kind: 'healing-reserve',
      actorUuid: a.uuid,
      profile: p,
      targets: [patient.uuid],
      operation: 'day',
      expectedCount: 0,
    },
    gm,
  );
  await trackingRequest({ kind: 'healing-complete', actorUuid: a.uuid, operation: 'day' }, gm);
  game.time.worldTime = 86400;
  assert.equal(healingPreview(a, p, entry(a, 'Minor Healing'), [patient.uuid]).count, 0);
  offset = 21600;
  assert.equal(healingPreview(a, p, entry(a, 'Minor Healing'), [patient.uuid]).count, 1);
});
test('discard requires a GM and unresolved status; player can confirm a real roll', async () => {
  const a = actor('review'),
    patient = actor('review-patient'),
    p = profile(a, 'Minor Healing');
  await trackingRequest(
    {
      kind: 'healing-reserve',
      actorUuid: a.uuid,
      profile: p,
      targets: [patient.uuid],
      operation: 'pending',
      expectedCount: 0,
    },
    player,
  );
  await assert.rejects(
    trackingRequest({ kind: 'healing-discard', actorUuid: a.uuid, operation: 'pending' }, player),
    /Only a GM/,
  );
  await trackingRequest({ kind: 'healing-discard', actorUuid: a.uuid, operation: 'pending' }, gm);
  assert.equal(healingPreview(a, p, entry(a, 'Minor Healing'), [patient.uuid]).count, 0);
});
test('tracked healing cannot be applied to another patient after the roll', async () => {
  const a = actor('bound'),
    patient = actor('bound-patient'),
    other = actor('wrong-patient');
  const c = {
    actorUuid: a.uuid,
    paid: true,
    allowSelf: true,
    effect: { type: 'heal-hp', amount: 2 },
    healing: { target: patient.uuid },
  };
  const card = { id: 'bound-card', author: player, getFlag: () => c };
  await assert.rejects(recoveryDirect(card, [other.uuid], player), /original patient/);
  await recoveryDirect(card, [patient.uuid], player);
  assert.equal(patient.system.HP.value, 7);
});
test('casting preparation combines spells-on and repeated-healing penalties; RPM is excluded', async () => {
  const a = actor('prepare'),
    patient = actor('prepare-patient'),
    p = profile(a, 'Minor Healing');
  await add(a);
  await trackingRequest(
    {
      kind: 'healing-reserve',
      actorUuid: a.uuid,
      profile: p,
      targets: [patient.uuid],
      operation: 'prior',
      expectedCount: 0,
    },
    gm,
  );
  await trackingRequest({ kind: 'healing-complete', actorUuid: a.uuid, operation: 'prior' }, gm);
  game.user.targets = [{ actor: patient }];
  const prepared = prepareCast(a, p);
  assert.equal(prepared.modifier, -4);
  p.rules = 'rpm';
  assert.equal(prepareCast(a, p).modifier, 0);
  assert.equal(maintenanceCost(profile(a), entry(a, 'Light')), 0);
});
