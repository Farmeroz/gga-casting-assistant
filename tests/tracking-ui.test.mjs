import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
const { document, window } = parseHTML('<html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
class App {
  constructor() {
    this.position = { width: 1000, height: 750 };
  }
  async render() {
    this.element ||= document.createElement('section');
    this._replaceHTML(await this._renderHTML(), this.element);
    this.rendered = true;
    return this;
  }
  bringToFront() {}
  async close() {
    this.rendered = false;
  }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: App, DialogV2: { confirm: async () => true } } },
};
globalThis.game = {
  user: { id: 'gm', isGM: true, targets: [], getFlag: () => undefined, setFlag: async () => {} },
  users: [],
  actors: [],
  tables: [],
  modules: new Map(),
  time: { worldTime: 0 },
  settings: { get: () => 0 },
};
globalThis.ui = {
  notifications: {
    error: (x) => {
      throw new Error(x);
    },
    warn() {},
  },
};
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
const { CastingAssistant } = await import('../scripts/ui.mjs');
const { ActiveEffectsWindow } = await import('../scripts/active-ui.mjs');
const { trackingRequest } = await import('../scripts/tracking.mjs');
const { activeEffectSummaries } = await import('../scripts/tracking-summary.mjs');
const { ID } = await import('../scripts/core.mjs');
function actor(id) {
  const a = {
    uuid: `Actor.${id}`,
    name: id,
    documentName: 'Actor',
    flags: {},
    system: {
      FP: { value: 10, max: 10 },
      spells: { light: { name: 'Light', level: 15, maintain: '2', duration: '1 minute' } },
    },
    testUserPermission: () => true,
    getFlag: (_id, k) => a.flags[k],
    async update(changes) {
      for (const [k, v] of Object.entries(changes)) {
        if (k.startsWith(`flags.${ID}.`))
          a.flags[k.slice(`flags.${ID}.`.length)] = structuredClone(v);
        else if (k === 'system.FP.value') a.system.FP.value = v;
      }
    },
  };
  return a;
}
test('casting window presents opt-in duration settings and a separate active-effects action', async () => {
  const a = actor('Mage');
  game.actors = [a];
  const app = new CastingAssistant(a);
  await app.render();
  assert.ok(app.element.querySelector('[data-gca="active-effects"]'));
  assert.equal(app.element.querySelector('[data-field="ongoing.mode"]').value, 'off');
  app.draft.ongoing.mode = 'timed';
  await app.render();
  assert.ok(app.element.querySelector('[data-field="ongoing.maintenanceCost"]'));
  assert.match(app.element.querySelector('[data-maintenance-preview]').textContent, /1 energy/);
  await app.close();
});
test('active window maintains through its actual button and updates the visible timer and pool', async () => {
  const a = actor('Maintainer');
  game.actors = [a];
  game.time.worldTime = 0;
  globalThis.fromUuid = async () => a;
  const caster = new CastingAssistant(a);
  caster.draft.ongoing.mode = 'timed';
  await trackingRequest(
    { kind: 'effect-add', actorUuid: a.uuid, profile: caster.draft, operation: 'ui' },
    game.user,
  );
  game.time.worldTime = 60;
  const app = new ActiveEffectsWindow(a);
  await app.render();
  assert.match(app.element.textContent, /Maintenance due/);
  const button = app.element.querySelector('[data-active="maintain"]');
  await app.click({ target: button, preventDefault() {}, stopPropagation() {} });
  assert.equal(a.system.FP.value, 9);
  assert.match(app.element.textContent, /1 minute remaining/);
  assert.equal(app.element.querySelector('[data-active="maintain"]'), null);
});
test('summary API maps received effects to their original caster and separates synthetic actors', async () => {
  const a = actor('Caster'),
    b = actor('Recipient'),
    twin = actor('TokenCopy');
  twin.uuid = 'Scene.s.Token.t.Actor.base';
  game.time.worldTime = 0;
  game.actors = [a, b];
  game.scenes = [{ tokens: [{ actor: twin }] }];
  const docs = new Map([a, b, twin].map((x) => [x.uuid, x]));
  globalThis.fromUuid = async (id) => docs.get(id);
  const caster = new CastingAssistant(a);
  caster.draft.ongoing.mode = 'timed';
  await trackingRequest(
    {
      kind: 'effect-add',
      actorUuid: a.uuid,
      profile: caster.draft,
      targets: [b.uuid],
      operation: 'received',
    },
    game.user,
  );
  const pending = activeEffectSummaries(b)[0];
  assert.equal(pending.pending, true);
  await trackingRequest(
    {
      kind: 'effect-target',
      actorUuid: a.uuid,
      effectId: 'received',
      revision: 0,
      targetUuid: b.uuid,
      outcome: 'affected',
    },
    game.user,
  );
  const [effect] = activeEffectSummaries(b);
  assert.equal(effect.casterUuid, a.uuid);
  assert.equal(effect.received, true);
  assert.equal(effect.cast, false);
  assert.deepEqual(activeEffectSummaries(twin), []);
  assert.equal(activeEffectSummaries(a)[0].cast, true);
});
