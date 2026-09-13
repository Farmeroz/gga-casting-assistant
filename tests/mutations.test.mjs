import test from 'node:test';
import assert from 'node:assert/strict';
import { ID } from '../scripts/core.mjs';
import { spendDirect, recoveryDirect, undoRecoveryDirect } from '../scripts/mutations.mjs';
const gm = { id: 'gm', isGM: true },
  player = { id: 'player', isGM: false };
const actors = new Map();
globalThis.game = { user: gm, users: [gm, player] };
globalThis.fromUuid = async (uuid) => actors.get(uuid);
function actor(id, fp = 10, hp = 4) {
  const a = {
    uuid: 'Actor.' + id,
    documentName: 'Actor',
    name: id,
    system: { FP: { value: fp, max: 10 }, HP: { value: hp, max: 10 } },
    flags: { [ID]: {} },
    updates: 0,
    testUserPermission: (user) => user.isGM || user.id === 'player',
    getFlag: (_id, key) => a.flags[ID][key],
    update: async (changes) => {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split('.'),
          last = parts.pop();
        let dest = a;
        for (const key of parts) dest = dest[key] ??= {};
        dest[last] = value;
      }
      a.updates++;
    },
  };
  actors.set(a.uuid, a);
  return a;
}
const plan = (amount) => [{ path: 'system.FP.value', name: 'FP', mode: 'pool', amount }];
function card(caster, id = 'cast') {
  return {
    id,
    author: player,
    getFlag: () => ({
      actorUuid: caster.uuid,
      paid: true,
      allowSelf: true,
      effect: { type: 'heal-hp', amount: 4 },
    }),
  };
}
test('resource operation IDs prevent duplicate spending', async () => {
  const a = actor('spend');
  await spendDirect(a, plan(3), 'op', player);
  await spendDirect(a, plan(3), 'op', player);
  assert.equal(a.system.FP.value, 7);
  assert.equal(a.updates, 1);
});
test('concurrent resource spends serialise and cannot exceed the remaining pool', async () => {
  const a = actor('race', 5);
  const results = await Promise.allSettled([
    spendDirect(a, plan(4), 'a'),
    spendDirect(a, plan(4), 'b'),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(a.system.FP.value, 1);
  assert.equal(a.updates, 1);
});
test('permission failures and unknown resource paths leave the actor unchanged', async () => {
  const a = actor('denied');
  await assert.rejects(spendDirect(a, plan(2), 'a', { id: 'stranger' }), /ownership/);
  await assert.rejects(
    spendDirect(a, [{ ...plan(2)[0], path: 'system.attributes.ST.value' }], 'b'),
    /setup changed/,
  );
  assert.equal(a.updates, 0);
  assert.equal(a.system.FP.value, 10);
});
test('healing deduplicates recipients, caps recovery, and cannot be applied twice', async () => {
  const caster = actor('caster'),
    target = actor('target', 10, 8),
    message = card(caster);
  const first = await recoveryDirect(message, [target.uuid, target.uuid], player);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].amount, 2);
  assert.equal(target.system.HP.value, 10);
  const again = await recoveryDirect(message, [target.uuid], player);
  assert.equal(again.results[0].status, 'already-applied');
  assert.equal(target.updates, 1);
});
test('unpaid or unauthorised recovery cannot change targets', async () => {
  const caster = actor('caster2'),
    target = actor('target2');
  await assert.rejects(
    recoveryDirect({ ...card(caster), getFlag: () => ({ paid: false }) }, [target.uuid]),
    /no paid recovery/,
  );
  await assert.rejects(
    recoveryDirect(card(caster), [target.uuid], { id: 'stranger', isGM: false }),
    /Only the caster/,
  );
  assert.equal(target.updates, 0);
});
test('GM undo restores health once and keeps an operation marked as used', async () => {
  const caster = actor('caster3'),
    target = actor('target3'),
    message = card(caster, 'undo');
  await recoveryDirect(message, [target.uuid], player);
  await undoRecoveryDirect(message, target.uuid, gm);
  assert.equal(target.system.HP.value, 4);
  await recoveryDirect(message, [target.uuid], player);
  assert.equal(target.system.HP.value, 4);
  await assert.rejects(undoRecoveryDirect(message, target.uuid, gm), /no active application/);
});
test('undo refuses to overwrite intervening health changes or accept player authority', async () => {
  const caster = actor('caster4'),
    target = actor('target4'),
    message = card(caster, 'changed');
  await recoveryDirect(message, [target.uuid], player);
  target.system.HP.value = 7;
  await assert.rejects(undoRecoveryDirect(message, target.uuid, gm), /changed after healing/);
  await assert.rejects(undoRecoveryDirect(message, target.uuid, player), /Only a GM/);
  assert.equal(target.system.HP.value, 7);
});
