import test from 'node:test';
import assert from 'node:assert/strict';
import { ID, standardDefaults, actorData } from '../scripts/core.mjs';
import { trackingRequest } from '../scripts/tracking.mjs';
import { trackingState, spellsOn } from '../scripts/tracking-model.mjs';
import { activeEffectSummaries } from '../scripts/tracking-summary.mjs';
import { effectTargets } from '../scripts/effect-targets.mjs';
const gm = { id: 'gm', isGM: true },
  player = { id: 'player', isGM: false };
const docs = new Map();
globalThis.game = {
  user: gm,
  users: [gm],
  actors: [],
  scenes: [],
  time: { worldTime: 0 },
  settings: { get: () => 0 },
};
globalThis.CONFIG = {
  statusEffects: [{ id: 'sleep', name: 'Sleeping', img: 'icons/svg/sleep.svg' }],
};
globalThis.fromUuid = async (uuid) => docs.get(uuid);
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
function actor(id) {
  const a = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    documentName: 'Actor',
    flags: {},
    effects: [],
    system: {
      FP: { value: 20, max: 20 },
      spells: {
        sleep: { name: 'Sleep', level: 15, cost: '4', maintain: '0', duration: '5 minutes' },
      },
    },
    testUserPermission: () => true,
    getFlag: (_, k) => a.flags[k],
    get statuses() {
      return new Set(a.effects.filter((e) => !e.disabled).flatMap((e) => [...e.statuses]));
    },
    async update(changes) {
      for (const [k, v] of Object.entries(changes))
        if (k.startsWith(`flags.${ID}.`))
          a.flags[k.slice(`flags.${ID}.`.length)] = structuredClone(v);
    },
    async createEmbeddedDocuments(_type, entries) {
      if (a.markerFailure) throw new Error('Marker write failed');
      for (const entry of entries) {
        const e = {
          ...entry,
          id: `m${a.effects.length}`,
          statuses: new Set(entry.statuses),
          getFlag: (_, k) => e.flags?.[ID]?.[k],
        };
        a.effects.push(e);
      }
      return a.effects;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      if (a.markerFailure) throw new Error('Marker delete failed');
      a.effects = a.effects.filter((e) => !ids.includes(e.id));
    },
  };
  docs.set(a.uuid, a);
  return a;
}
async function setup(resolution = 'pending') {
  game.time.worldTime = 0;
  docs.clear();
  const caster = actor('Roselyn'),
    one = actor('Angel'),
    two = actor('Guard');
  game.actors = [caster, one, two];
  const p = standardDefaults(actorData(caster).abilities[0]);
  p.ongoing.mode = 'timed';
  p.ongoing.resolution = resolution;
  p.ongoing.maintainable = false;
  await trackingRequest(
    {
      kind: 'effect-add',
      actorUuid: caster.uuid,
      profile: p,
      targets: [one.uuid, two.uuid],
      operation: 'sleep',
    },
    gm,
  );
  return { caster, one, two };
}
const effect = (a) => trackingState(a).effects[0];
const resolve = (a, t, outcome, conditionId = '', user = gm) =>
  trackingRequest(
    {
      kind: 'effect-target',
      actorUuid: a.uuid,
      effectId: 'sleep',
      revision: effect(a).revision,
      targetUuid: t.uuid,
      outcome,
      conditionId,
    },
    user,
  );
test('selected targets are pending until confirmed; resisted targets disappear and affected targets retain the caster', async () => {
  const { caster, one, two } = await setup();
  assert.equal(activeEffectSummaries(one)[0].pending, true);
  assert.equal(activeEffectSummaries(one)[0].received, false);
  await resolve(caster, one, 'affected');
  await resolve(caster, two, 'resisted');
  assert.equal(activeEffectSummaries(one)[0].received, true);
  assert.equal(activeEffectSummaries(one)[0].casterUuid, caster.uuid);
  assert.deepEqual(activeEffectSummaries(two), []);
  assert.equal(spellsOn(caster), 1);
  await resolve(caster, one, 'ended');
  assert.equal(spellsOn(caster), 0);
  assert.equal(effect(caster).status, 'ended');
  assert.deepEqual(activeEffectSummaries(one), []);
});
test('no-resistance effects apply to their recorded targets and old effects remain pending review', async () => {
  const { caster, one } = await setup('none');
  assert.equal(activeEffectSummaries(one)[0].received, true);
  const old = effect(caster);
  delete old.targets;
  assert.ok(effectTargets(old).every((t) => t.status === 'pending'));
});
test('only the GM may resolve original targets and stale clicks cannot change an outcome twice', async () => {
  const { caster, one } = await setup();
  const before = effect(caster);
  await assert.rejects(resolve(caster, one, 'affected', '', player), /Only a GM/);
  await assert.rejects(resolve(caster, { uuid: 'Actor.someoneElse' }, 'affected'), /not a target/);
  await assert.rejects(resolve(caster, one, 'affected', 'unknown'), /supported condition/);
  assert.deepEqual(effect(caster), before);
  await resolve(caster, one, 'affected');
  await assert.rejects(
    trackingRequest(
      {
        kind: 'effect-target',
        actorUuid: caster.uuid,
        effectId: 'sleep',
        revision: 0,
        targetUuid: one.uuid,
        outcome: 'resisted',
      },
      gm,
    ),
    /changed/,
  );
});
test('optional markers are removed for one target without changing the others, or pre-existing conditions', async () => {
  const { caster, one, two } = await setup();
  await one.createEmbeddedDocuments('ActiveEffect', [
    { name: 'GM condition', statuses: ['sleep'] },
  ]);
  await resolve(caster, one, 'affected', 'sleep');
  assert.equal(one.effects.length, 1);
  await resolve(caster, two, 'affected', 'sleep');
  assert.equal(two.effects.length, 1);
  await resolve(caster, two, 'ended');
  assert.equal(two.effects.length, 0);
  assert.equal(one.effects.length, 1);
  assert.equal(effect(caster).status, 'active');
});
test('marker failure retains the resolved outcome and refresh retries cleanup without resource changes', async () => {
  const { caster, one } = await setup();
  await resolve(caster, one, 'affected', 'sleep');
  one.markerFailure = true;
  const result = await resolve(caster, one, 'ended');
  assert.match(result.error, /Outcome recorded/);
  assert.equal(effect(caster).targets[0].status, 'ended');
  assert.equal(one.effects.length, 1);
  one.markerFailure = false;
  await trackingRequest({ kind: 'tracking-tick', actorUuid: caster.uuid }, gm);
  assert.equal(one.effects.length, 0);
  assert.equal(effect(caster).markerCleanup, '');
  assert.equal(caster.system.FP.value, 20);
});
test('timed expiry cleans module markers and permanently ends the recipient display', async () => {
  const { caster, one } = await setup();
  await resolve(caster, one, 'affected', 'sleep');
  game.time.worldTime = 301;
  await trackingRequest({ kind: 'tracking-tick', actorUuid: caster.uuid }, gm);
  assert.equal(one.effects.length, 0);
  assert.equal(effect(caster).status, 'expired');
  game.time.worldTime = 0;
  assert.deepEqual(activeEffectSummaries(one), []);
});
test('separate spells using the same marker remain independently owned', async () => {
  const { caster, one } = await setup();
  await resolve(caster, one, 'affected', 'sleep');
  const other = actor('Other caster');
  game.actors.push(other);
  const p = standardDefaults(actorData(other).abilities[0]);
  p.ongoing.mode = 'timed';
  await trackingRequest(
    {
      kind: 'effect-add',
      actorUuid: other.uuid,
      profile: p,
      targets: [one.uuid],
      operation: 'sleep',
    },
    gm,
  );
  await resolve(other, one, 'affected', 'sleep');
  assert.equal(one.effects.length, 2);
  await resolve(caster, one, 'ended');
  assert.equal(one.effects.length, 1);
  assert.equal(one.effects[0].getFlag(ID, 'targetEffect').casterUuid, other.uuid);
});
