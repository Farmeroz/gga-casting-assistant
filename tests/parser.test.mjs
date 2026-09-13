import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRecoveryExpression,
  stringsFromRecoveryField,
  recoveryCommandFromSpell,
  normaliseDamageFormula,
  parseProfileText,
} from '../scripts/parser.mjs';
test('recovery supports fixed amounts, dice, FP commands, and minimum one', () => {
  assert.equal(parseRecoveryExpression('0!').amount, 1);
  const recovery = parseRecoveryExpression('/fp 1d-3!');
  assert.equal(recovery.effectType, 'restore-fp');
  assert.equal(recovery.formula, '1d6-3');
  assert.equal(recovery.minimumOne, true);
  assert.equal(parseRecoveryExpression('/hp +4').amount, 4);
});
test('recovery rejects executable text and invalid dice', () => {
  for (const text of [
    '',
    '/hp -2',
    '1d0',
    '0d6',
    '1001d6',
    '1d6; actor.update({})',
    '@UUID[Actor.a]',
  ])
    assert.equal(parseRecoveryExpression(text).valid, false, text);
});
test('nested and cyclic sheet notes are bounded and recovery commands are found', () => {
  const notes = { text: '/hp 1d+2!' };
  notes.self = notes;
  assert.deepEqual(stringsFromRecoveryField(notes), ['/hp 1d+2!']);
  assert.equal(recoveryCommandFromSpell({ object: { notes } }), '/hp 1d+2!');
});
test('damage text retains divisors, types, and recognised extras', () => {
  assert.equal(normaliseDamageFormula('2d6+1 (2) burn surge'), '2d+1 (2) burn surge');
  assert.equal(normaliseDamageFormula('3d6 damage', 'explosive crushing'), '3d cr ex');
  assert.equal(normaliseDamageFormula('no dice here'), '');
});
test('parsed builds retain the entered energy and recovery command', () => {
  const text = 'Name: Renew\nEnergy: 12\nEffect: /hp 2d-1!';
  const parsed = parseProfileText(text);
  assert.equal(parsed.title, 'Renew');
  assert.equal(parsed.energy, 12);
  assert.equal(parsed.effectType, 'heal-hp');
  assert.equal(parsed.effectAmount, '/hp 2d-1!');
  assert.equal(parsed.raw, text);
});
