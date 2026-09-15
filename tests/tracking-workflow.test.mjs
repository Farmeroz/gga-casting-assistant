import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Execute the actual workflow and mutation code, replacing only the native GGA
// roll boundary. No Foundry installation is needed for this integration fixture.
const temp = mkdtempSync(join(tmpdir(), 'casting-flow-'));
cpSync(new URL('../scripts/', import.meta.url), temp, { recursive: true });
writeFileSync(
  join(temp, 'rolls.mjs'),
  `
export const serial = async f => f();
export const targetedRoll = (...args) => globalThis.testRoll(...args);
export const validateDamage = () => {};
export const rollDamage = async () => {};
`,
);
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const { cast } = await import(pathToFileURL(join(temp, 'workflow.mjs')));
const { ID, standardDefaults, actorData } = await import(pathToFileURL(join(temp, 'core.mjs')));
const gm = { id: 'gm', isGM: true };
let lastModifier,
  total = 10,
  critical = false,
  fail = false,
  blind = false,
  nativeError = false;
const actors = new Map(),
  cards = new Map();
globalThis.game = {
  user: gm,
  users: [gm],
  time: { worldTime: 0 },
  settings: { get: () => 0 },
  messages: cards,
};
globalThis.fromUuid = async (id) => actors.get(id);
globalThis.testRoll = async (_a, e, options) => {
  if (nativeError) throw new Error('No native roll');
  lastModifier = options.modifier;
  return {
    data: {
      rtotal: total,
      finaltarget: e.level + options.modifier,
      margin: e.level + options.modifier - total,
      isCritFailure: critical,
      failure: fail || critical,
    },
    message: { id: 'native' },
    visibility: { whisper: ['gm'], blind },
  };
};
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => {
    const c = {
      ...data,
      id: `card-${cards.size}`,
      author: gm,
      getFlag: (id, key) => c.flags?.[id]?.[key],
      async update(changes) {
        for (const [path, value] of Object.entries(changes)) {
          if (path.startsWith(`flags.${ID}.`))
            c.flags[ID][path.slice(`flags.${ID}.`.length)] = value;
          else c[path] = value;
        }
      },
    };
    cards.set(c.id, c);
    return c;
  },
};
function makeActor(id) {
  const a = {
    uuid: `Actor.${id}`,
    name: id,
    documentName: 'Actor',
    flags: {},
    system: {
      FP: { value: 20, max: 20 },
      HP: { value: 4, max: 10 },
      skills: { physician: { name: 'Physician/TL8', level: 15 } },
      spells: {
        healing: { name: 'Minor Healing', level: 15, cost: '1' },
        light: { name: 'Light', level: 15, cost: '1', maintain: '1', duration: '1 minute' },
      },
    },
    testUserPermission: () => true,
    getFlag: (_id, k) => a.flags[k],
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path.startsWith(`flags.${ID}.`))
          a.flags[path.slice(`flags.${ID}.`.length)] = structuredClone(value);
        else {
          const parts = path.split('.'),
            key = parts.pop();
          let obj = a;
          for (const p of parts) obj = obj[p] ??= {};
          obj[key] = value;
        }
      }
    },
  };
  actors.set(a.uuid, a);
  return a;
}
function setup(name = 'Minor Healing') {
  critical = fail = blind = nativeError = false;
  total = 10;
  cards.clear();
  const actor = makeActor(`caster-${actors.size}`),
    patient = makeActor(`patient-${actors.size}`);
  game.user.targets = [{ actor: patient }];
  const p = standardDefaults(actorData(actor).abilities.find((e) => e.name === name));
  return { actor, patient, p };
}
test('actual casting flow counts failed attempts and applies the next penalty before the native roll', async () => {
  const { actor, p } = setup();
  fail = true;
  const first = await cast(actor, p);
  assert.equal(first.record.result, 'failure');
  assert.equal(actor.flags.tracking.healing[0].status, 'counted');
  fail = false;
  const second = await cast(actor, p);
  assert.equal(lastModifier, -3);
  assert.equal(second.record.healing.count, 1);
});
test('Physician mitigation applies only to the first attempt and retains the native dice', async () => {
  const { actor, p } = setup();
  critical = true;
  total = 18;
  const first = await cast(actor, p);
  assert.equal(first.record.result, 'failure');
  assert.equal(first.record.physicianMitigated, true);
  assert.equal(first.record.roll.total, 18);
  const second = await cast(actor, p);
  assert.equal(second.record.result, 'criticalFailure');
  assert.equal(second.record.physicianMitigated, false);
});
test('successful automatic tracking starts once, failed and blind casts do not reveal an active effect', async () => {
  for (const mode of ['success', 'failure', 'blind']) {
    const { actor, p } = setup('Light');
    p.ongoing.mode = 'timed';
    p.ongoing.autoStart = true;
    fail = mode === 'failure';
    blind = mode === 'blind';
    const result = await cast(actor, p);
    assert.equal(actor.flags.tracking?.effects.length || 0, mode === 'success' ? 1 : 0);
    if (mode === 'success') assert.ok(result.message.getFlag(ID, 'cast').activeEffectId);
  }
});
test('an interrupted native roll leaves a reviewable reservation and cannot silently reroll', async () => {
  const { actor, p } = setup();
  nativeError = true;
  await assert.rejects(cast(actor, p), /pending attempt/);
  nativeError = false;
  await assert.rejects(cast(actor, p), /previous healing/);
  assert.equal(actor.system.FP.value, 20);
});
