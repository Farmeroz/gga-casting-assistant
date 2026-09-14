import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
const { document, window } = parseHTML('<html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
class App {
  constructor() {
    this.position = { width: 1080, height: 790 };
  }
  async render() {
    if (!this.element) {
      this.element = document.createElement('section');
      this.content = document.createElement('div');
      this.element.append(this.content);
      document.body.append(this.element);
    }
    this._replaceHTML(await this._renderHTML(), this.content);
    this.rendered = true;
    return this;
  }
  async close() {
    this.element?.remove();
    this.rendered = false;
    return this;
  }
  bringToFront() {}
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: App, DialogV2: { confirm: async () => true } } },
};
globalThis.game = { user: { id: 'gm', isGM: true }, tables: [], modules: new Map() };
const { RPMDesigner } = await import('../scripts/rpm-ui.mjs');
const { MagicResourceWindow } = await import('../scripts/resource-ui.mjs');
const { ID } = await import('../scripts/core.mjs');
const { Grimoire } = await import('../scripts/grimoire.mjs');
const { standardDefaults } = await import('../scripts/core.mjs');
const { saveProfile } = await import('../scripts/profiles.mjs');
const { newDesign } = await import('../scripts/rpm-model.mjs');
function makeActor() {
  const flags = {};
  const actor = {
    uuid: 'Actor.test',
    name: 'Mage',
    documentName: 'Actor',
    system: {
      skills: {
        '0000': { name: 'Path of Body', level: 15 },
        '0001': { name: 'Path of Magic', level: 14 },
      },
    },
    testUserPermission: () => true,
    getFlag: (_id, key) => flags[key],
    setFlag: async (_id, key, data) => (flags[key] = data),
    update: async (changes) => {
      for (const [path, data] of Object.entries(changes)) {
        let dest = actor;
        const parts = path.split('.'),
          key = parts.pop();
        for (const part of parts) dest = dest[part] ??= {};
        dest[key] = data;
      }
    },
  };
  globalThis.fromUuid = async () => actor;
  return actor;
}
const click = (app, selector) =>
  app.click({
    target: app.element.querySelector(selector),
    preventDefault() {},
    stopPropagation() {},
  });
function input(app, field, value) {
  const el = app.element.querySelector(`[data-rpm-field="${field}"]`);
  assert.ok(el, field);
  Object.defineProperty(el, 'value', { configurable: true, value });
  app.change({ target: el });
}
test('Designer DOM creates, reprices, saves, prepares and duplicates a ritual', async () => {
  const actor = makeActor();
  let prepared;
  game.modules.set(ID, {
    api: {
      open: async (_actor, id) => {
        prepared = id;
      },
    },
  });
  const app = new RPMDesigner(actor);
  await app.render();
  input(app, 'name', 'Minor Healing');
  input(app, 'effects.0.effect', 'Restore');
  await click(app, '[data-rpm="add-modifier"][data-kind="healing"]');
  await click(app, '[data-rpm="add-modifier"][data-kind="weight"]');
  input(app, 'modifiers.1.value', '300');
  assert.equal(app.element.querySelector('[data-rpm-total]').textContent, '7');
  await click(app, '[data-rpm="prepare"]');
  const saved = actor.getFlag(ID, 'profiles').entries;
  assert.equal(saved[0].id, prepared);
  assert.equal(saved[0].baseCost, 7);
  assert.equal(saved[0].ability.name, 'Path of Body');
  assert.equal(saved[0].effectAmount, '1d');
  input(app, 'effects.0.greater', 'true');
  assert.equal(app.element.querySelector('[data-rpm-total]').textContent, '21');
  input(app, 'delivery', 'charm');
  assert.equal(app.element.querySelector('[data-rpm-total]').textContent, '36');
  await click(app, '[data-rpm="copy"]');
  assert.equal(actor.getFlag(ID, 'profiles').entries.length, 2);
  await app.close();
});
test('editing dice adds keeps the component badge and total in agreement; text is escaped', async () => {
  const app = new RPMDesigner(makeActor());
  await app.render();
  input(app, 'name', '<img src=x onerror=alert(1)>');
  await click(app, '[data-rpm="add-modifier"][data-kind="healing"]');
  input(app, 'modifiers.0.adds', '2');
  assert.equal(app.element.querySelector('[data-modifier-cost="0"]').textContent, '2 en');
  assert.equal(app.element.querySelector('[data-rpm-total]').textContent, '4');
  assert.equal(app.element.querySelectorAll('img').length, 0);
  await click(app, '[data-rpm="remove-modifier"]');
  assert.equal(app.design.modifiers.length, 0);
  await app.close();
});
test('resource dialog preset survives rendering and creates a threshold with an unenforced cap', async () => {
  const actor = makeActor();
  let created;
  const app = new MagicResourceWindow(actor, (value) => (created = value));
  await app.render();
  let preset = app.element.querySelector('[data-preset]');
  Object.defineProperty(preset, 'value', { value: 'Threshold' });
  preset.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(setImmediate);
  assert.equal(app.data.current, 0);
  assert.equal(app.data.maximum, 30);
  assert.equal(app.data.kind, 'threshold');
  assert.equal(app.element.querySelector('[data-preset]').value, 'Threshold');
  app.element
    .querySelector('[data-resource-create]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let n = 0; n < 10 && !created; n++) await new Promise(setImmediate);
  assert.equal(created.mode, 'tally');
  assert.equal(actor.system.additionalresources.tracker['0000'].isMaximumEnforced, false);
});

test('Grimoire renders populated spell, skill and saved-build tabs in both layouts', async () => {
  const actor = makeActor();
  actor.system.spells = { '0000': { name: 'Light', level: 14, cost: '1' } };
  game.user.getFlag = () => undefined;
  game.user.setFlag = async () => {};
  for (const [id, name, rpmDesign] of [
    ['rpm-a', 'A ritual', newDesign()],
    ['rpm-b', 'B ritual', newDesign()],
    ['pasted', 'Pasted ritual', null],
  ])
    await saveProfile(actor, {
      ...standardDefaults(null),
      id,
      name,
      rules: 'rpm',
      rpmDesign,
    });
  const book = new Grimoire(actor, {});
  for (const tab of ['spells', 'skills', 'builds']) {
    book.prefs.tab = tab;
    for (const layout of ['cards', 'list']) {
      book.prefs.layout = layout;
      await book.render();
      assert.equal(
        book.element.querySelectorAll('.gca-book-card').length,
        { spells: 1, skills: 2, builds: 3 }[tab],
      );
      assert.equal(
        book.element.querySelectorAll('.gca-book-card [data-grimoire="design-ritual"]').length,
        tab === 'builds' ? 2 : 0,
      );
    }
  }
  let edited;
  game.modules.set(ID, {
    api: { designer: async (uuid, profile) => (edited = { uuid, profile }) },
  });
  // The second card must edit its own ritual, even while the first is selected.
  assert.equal(book.selected, 'profile:rpm-a');
  await click(book, '.gca-book-card [data-grimoire="design-ritual"][data-id="profile:rpm-b"]');
  assert.equal(edited.uuid, actor.uuid);
  assert.equal(edited.profile.id, 'rpm-b');
  await click(book, '.gca-book-detail [data-grimoire="design-ritual"]');
  assert.equal(edited.profile.id, 'rpm-a');
  await book.close();
});
