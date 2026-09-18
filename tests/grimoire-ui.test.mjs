import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
const { document, window } = parseHTML('<html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.innerWidth = 1440;
window.innerHeight = 1000;
class App {
  constructor(options = {}) {
    this.position = options.position || { width: 1100, height: 800 };
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
  async maximize() {}
  bringToFront() {}
}
globalThis.foundry = { applications: { api: { ApplicationV2: App } } };
const hooks = new Map();
globalThis.Hooks = { on: (key, fn) => hooks.set(key, fn), once() {} };
let flags = {};
globalThis.game = {
  user: {
    id: 'gm',
    isGM: true,
    getFlag: (_id, key) => flags[key],
    setFlag: async (_id, key, value) => (flags[key] = value),
  },
  modules: new Map(),
  actors: [],
  tables: [],
};
globalThis.ui = {
  notifications: {
    info() {},
    error(message) {
      throw Error(message);
    },
  },
};
globalThis.canvas = { tokens: { controlled: [] } };
const { Grimoire, grimoirePosition } = await import('../scripts/grimoire.mjs');
const { sortItems, listedSeconds } = await import('../scripts/grimoire-model.mjs');
const { ID, standardDefaults } = await import('../scripts/core.mjs');
const { saveProfile } = await import('../scripts/profiles.mjs');
const { openGrimoire } = await import('../scripts/main.mjs');
function actor() {
  flags = {};
  const saved = {};
  return {
    uuid: 'Actor.mage',
    name: 'Mage',
    documentName: 'Actor',
    system: {
      spells: {
        a: {
          name: 'Alpha',
          level: 12,
          cost: '10',
          casttime: '1 minute',
          duration: '2 hours',
          college: 'Fire',
        },
        b: {
          name: 'Beta',
          level: 16,
          cost: '2',
          casttime: '10 sec',
          duration: '30 minutes',
          college: 'Air',
        },
        c: {
          name: '<img src=x>',
          level: 14,
          cost: 'Varies',
          casttime: 'Special',
          duration: 'Permanent',
        },
      },
    },
    getFlag: (_id, key) => saved[key],
    setFlag: async (_id, key, value) => (saved[key] = value),
    testUserPermission: () => true,
  };
}
const click = async (book, selector) => {
  const target = book.element.querySelector(selector);
  assert.ok(target, selector);
  await book.click({ target, preventDefault() {}, stopPropagation() {} });
};
const names = (book) =>
  [...book.element.querySelectorAll('.gca-book-entry .gca-book-row-name')].map(
    (x) => x.textContent,
  );
test('compact and table actions preserve identity, details toggle, favourites, and numeric ordering', async () => {
  const a = actor(),
    prepared = [];
  const book = new Grimoire(a, { openAbility: async (uuid, ref) => prepared.push({ uuid, ref }) });
  await book.render();
  await click(book, '[data-layout="list"]');
  assert.equal(book.element.querySelectorAll('.gca-book-row').length, 3);
  assert.equal(book.element.querySelector('img'), null);
  const beta = book.items().find((x) => x.name === 'Beta').id;
  await click(book, '.gca-book-row [data-grimoire="prepare"][data-id="' + beta + '"]');
  assert.equal(prepared[0].ref.name, 'Beta');
  assert.equal(book.rendered, true);
  await click(book, '[data-grimoire="toggle-details"]');
  assert.equal(book.element.querySelector('.gca-book-detail').hidden, true);
  await click(book, '.gca-book-row [data-grimoire="select"][data-id="' + beta + '"]');
  assert.equal(book.prefs.details, true);
  assert.equal(prepared.length, 1);
  await click(book, '[data-layout="table"]');
  await click(book, '[data-sort="cost"]');
  assert.deepEqual(names(book), ['Beta', 'Alpha', '<img src=x>']);
  assert.equal(book.element.querySelector('[aria-sort="ascending"] button').dataset.sort, 'cost');
  await click(book, '[data-sort="cost"]');
  assert.deepEqual(names(book), ['Alpha', 'Beta', '<img src=x>']);
  await click(book, '[data-sort="castTime"]');
  assert.deepEqual(names(book), ['Beta', 'Alpha', '<img src=x>']);
  await click(book, '[data-sort="duration"]');
  assert.deepEqual(names(book), ['Beta', 'Alpha', '<img src=x>']);
  await click(book, '[data-sort="skill"]');
  assert.deepEqual(names(book), ['Beta', '<img src=x>', 'Alpha']);
  await click(book, '[data-sort="skill"]');
  assert.deepEqual(names(book), ['Alpha', '<img src=x>', 'Beta']);
  await click(book, '.gca-book-entry [data-grimoire="favourite"][data-id="' + beta + '"]');
  await click(book, '[data-grimoire="favourites"]');
  assert.deepEqual(names(book), ['Beta']);
  await click(book, '[data-grimoire="clear"]');
  assert.equal(names(book).length, 3);
  await book.close();
});
test('saved-build preparation, preferences, scroll, window placement, and standalone shortcut survive refresh', async () => {
  const a = actor(),
    prepared = [];
  await saveProfile(a, { ...standardDefaults(null), id: 'a', name: 'A build' });
  await saveProfile(a, { ...standardDefaults(null), id: 'b', name: 'B build' });
  const book = new Grimoire(a, { open: async (uuid, id) => prepared.push(id) });
  book.prefs.tab = 'builds';
  book.prefs.layout = 'table';
  await book.render();
  await click(book, '.gca-book-entry [data-grimoire="prepare"][data-id="profile:b"]');
  assert.deepEqual(prepared, ['b']);
  const results = book.element.querySelector('.gca-book-results');
  results.scrollTop = 300;
  results.scrollLeft = 210;
  await click(book, '[data-grimoire="toggle-details"]');
  assert.equal(book.element.querySelector('.gca-book-results').scrollTop, 300);
  assert.equal(book.element.querySelector('.gca-book-results').scrollLeft, 210);
  let macro;
  globalThis.Macro = { create: async (value) => (macro = value) };
  await click(book, '[data-grimoire="grimoire-shortcut"]');
  let opened;
  game.modules.set(ID, { api: { grimoire: (uuid) => (opened = uuid) } });
  Function(macro.command)();
  assert.equal(opened, a.uuid);
  assert.deepEqual(prepared, ['b']);
  book.position = { width: 900, height: 700, left: 75, top: 60 };
  book.prefs.views.builds.query = 'build';
  await book.close();
  const restored = new Grimoire(a, {});
  assert.equal(restored.prefs.layout, 'table');
  assert.equal(restored.prefs.details, false);
  assert.equal(restored.filters.query, 'build');
  assert.deepEqual(restored.position, book.position);
  assert.deepEqual(
    grimoirePosition(
      { width: 900, height: 700, left: 5000, top: -50 },
      { innerWidth: 1200, innerHeight: 900 },
    ),
    { width: 900, height: 700, left: 300, top: 0 },
  );
});
test('toolbar opens only Grimoire, reuses its window, and supports object and legacy control collections', async () => {
  const a = actor();
  game.user.character = a;
  game.actors = [a];
  const build = hooks.get('getSceneControlButtons');
  for (const controls of [{ tokens: { tools: {} } }, [{ name: 'tokens', tools: [] }]]) {
    build(controls);
    const tokenTools = Array.isArray(controls)
      ? controls[0].tools
      : Object.values(controls.tokens.tools);
    const launcher = tokenTools.find((t) => t.name === `${ID}-grimoire`);
    assert.ok(launcher);
    const book = await launcher.onClick();
    assert.ok(book instanceof Grimoire);
    assert.equal(book.rendered, true);
    assert.equal(await openGrimoire(), book);
    await book.close();
  }
});
test('time sorting compares units and leaves special or missing values last in both directions', () => {
  assert.equal(listedSeconds('1 minute'), 60);
  assert.equal(listedSeconds('2 hours'), 7200);
  assert.equal(listedSeconds('2'), 2);
  assert.equal(listedSeconds('Special'), null);
  assert.equal(listedSeconds('1 minute per energy'), null);
  const items = ['1 minute', '10 seconds', 'Special'].map((castTime, i) => ({
    id: String(i),
    name: String(i),
    castTime,
  }));
  assert.deepEqual(
    sortItems(items, 'castTime').map((x) => x.id),
    ['1', '0', '2'],
  );
  assert.deepEqual(
    sortItems(items, 'castTime-desc').map((x) => x.id),
    ['0', '1', '2'],
  );
});
