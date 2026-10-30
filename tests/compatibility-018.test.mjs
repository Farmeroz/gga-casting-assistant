import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { pdfReference, pageLinks, openPage } from '../scripts/references.mjs';
import { reference, resolveReference } from '../scripts/core.mjs';

test('PDF references preserve labels, multiword codes, and embedded colons', () => {
  for (const ref of ['B248', 'DF1:29', 'DFC:A-10', 'DFRPG Spells:20', 'DFRPG:X:12'])
    assert.equal(pdfReference(ref), ref);
  assert.equal(pdfReference('[PDF:DFC:A-10]'), 'DFC:A-10');
  assert.equal(pdfReference('M74–76'), 'M74');
  assert.equal(pdfReference('DF1:29-31'), 'DF1:29');
  for (const ref of ['', 'B', 'B:', ':20', '[PDF:B248] [/r 3d]', 'B248|/r 3d'])
    assert.throws(() => pdfReference(ref), /book\/page reference/);
});

test('Grimoire links keep complete PDF references and escape surrounding HTML', () => {
  const { document } = parseHTML('<html><body></body></html>');
  document.body.innerHTML = pageLinks(
    'DFC:A-10, DFRPG Spells:20; [PDF:DFRPG:X:12], M74-76, https://example.com/book',
  );
  assert.deepEqual(
    [...document.querySelectorAll('a')].map((a) => a.dataset.pageRef),
    ['DFC:A-10', 'DFRPG Spells:20', 'DFRPG:X:12', 'M74', 'https://example.com/book'],
  );
  document.body.innerHTML = pageLinks('<img src=x onerror=alert(1)> B248');
  assert.equal(document.querySelector('img'), null);
  assert.equal(document.querySelector('a').dataset.pageRef, 'B248');
});

test('registered PDF codes preserve case and work within prose', () => {
  globalThis.game = {
    journal: [{ pages: [{ type: 'pdf', system: { code: 'My Book (2)' } }] }],
  };
  try {
    assert.equal(pdfReference('My Book (2)20'), 'My Book (2)20');
    const { document } = parseHTML('<html><body></body></html>');
    document.body.innerHTML = pageLinks('See My Book (2):20 for details.');
    assert.equal(document.querySelector('a').dataset.pageRef, 'My Book (2):20');
  } finally {
    delete globalThis.game;
  }
});

test('PDF dispatch sends intact labels to modern and legacy GGA entry points', async () => {
  const calls = [];
  try {
    globalThis.GURPS = { modules: { Pdf: { handlePdf: (ref) => calls.push(ref) } } };
    await openPage('DFC:A-10');
    globalThis.GURPS = { handlePdf: (ref) => calls.push(ref) };
    await openPage('DFRPG Spells:20');
    globalThis.GURPS = { executeOTF: (ref) => calls.push(ref) };
    await openPage('[PDF:DFRPG:X:12]');
    assert.deepEqual(calls, ['DFC:A-10', 'DFRPG Spells:20', '[PDF:DFRPG:X:12]']);
    await assert.rejects(openPage('[PDF:B248] [/r 3d]'), /book\/page reference/);
    assert.equal(calls.length, 3);
  } finally {
    delete globalThis.GURPS;
  }
});

const melee = (mode, key = 'system.melee.0000') => ({
  key,
  kind: 'melee',
  name: 'Staff',
  object: { mode },
});

test('a legacy melee link recovers after usage notes are appended, even after reordering', () => {
  const saved = reference(melee('Swing'));
  const imported = melee('Swing [two-handed]', 'system.melee.0004');
  const before = structuredClone(saved);
  assert.equal(resolveReference(saved, [imported]), imported);
  assert.deepEqual(saved, before);
  const empty = melee(' [touch]');
  assert.equal(resolveReference(reference(melee('')), [empty]), empty);
});

test('legacy melee recovery never chooses between newly distinguished attacks', () => {
  const saved = reference(melee('Swing'));
  const candidates = [melee('Swing [one-handed]'), melee('Swing [two-handed]', 'other')];
  assert.equal(resolveReference(saved, candidates), null);
  const selected = reference(candidates[1]);
  assert.equal(resolveReference(selected, candidates), candidates[1]);
  assert.equal(resolveReference(selected, [melee('Swing [different]')]), null);
});

test('exact modes retain priority and recovery does not cross kinds, names, or usages', () => {
  const original = melee('Swing');
  const annotated = melee('Swing [two-handed]');
  assert.equal(resolveReference(reference(original), [original, annotated]), original);
  for (const candidate of [
    melee('Thrust [two-handed]'),
    { ...annotated, name: 'Sword' },
    { ...annotated, kind: 'ranged' },
  ])
    assert.equal(resolveReference(reference(original), [candidate]), null);
  const ranged = { ...original, kind: 'ranged' };
  assert.equal(resolveReference(reference(ranged), [{ ...annotated, kind: 'ranged' }]), null);
});
