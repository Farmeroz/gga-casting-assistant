import { clone, normalise, reference } from './core.mjs';

export const EFFECT_LABELS = {
  damage: 'Damage',
  healing: 'Healing / recovery',
  other: 'Other',
  mixed: 'Damage + healing',
};
export function matchingDamageAttack(entry, data) {
  if (!entry) return null;
  const matches = data.attacks.filter(
    (a) =>
      ['ranged', 'melee'].includes(a.kind) &&
      normalise(a.name) === normalise(entry.name) &&
      String(a.object.damage || '').trim(),
  );
  return matches.length === 1 ? matches[0] : null;
}
export function inferEffect(p, entry, data) {
  const healing = p.effectType && p.effectType !== 'none';
  const damage = !!(p.damageFormula || p.rollDamage || p.rollAttack || p.attack);
  if (healing && damage)
    return { kind: 'mixed', reason: 'This setup includes attack or damage and recovery.' };
  if (healing) return { kind: 'healing', reason: 'Recovery is configured for this setup.' };
  if (damage) return { kind: 'damage', reason: 'An attack or damage formula is configured.' };
  if (matchingDamageAttack(entry, data))
    return { kind: 'damage', reason: 'A matching damage attack is on the character sheet.' };
  if (/\b(missile|melee)\b/i.test(entry?.object?.class || ''))
    return {
      kind: 'damage',
      reason: 'The sheet lists a missile or melee spell.  Check its attack and damage.',
    };
  return {
    kind: 'other',
    reason: 'No direct damage or recovery identified.  Choose an effect if needed.',
  };
}
export function effectLayout(p, entry, data) {
  const inferred = inferEffect(p, entry, data),
    selected = p.effectCategory || 'auto';
  const kind = selected === 'auto' ? inferred.kind : selected;
  const mixed = kind === 'mixed' || (kind !== 'other' && p.combineEffects === true);
  return {
    kind,
    mixed,
    damage: kind === 'damage' || mixed,
    healing: kind === 'healing' || mixed,
    inferred,
    label: EFFECT_LABELS[mixed ? 'mixed' : kind],
    reason: selected === 'auto' ? inferred.reason : 'Your chosen effect is saved with this setup.',
  };
}
export function suggestAttack(p, entry, data) {
  if (p.attack || p.effectType !== 'none') return;
  const attack = matchingDamageAttack(entry, data);
  if (attack) p.attack = reference(attack);
}
// Preserve stored settings for switching back, but never execute an effect hidden by a manual category.
export function activeProfile(input) {
  const p = clone(input),
    category = p.effectCategory || 'auto';
  if (category === 'auto') return p;
  const extra = category !== 'other' && p.combineEffects === true;
  if (category !== 'damage' && !extra) {
    p.attack = null;
    p.rollAttack = false;
    p.rollDamage = false;
    p.scaleDamage = false;
    p.damageFormula = '';
    p.tables = { ...p.tables, attackSuccess: '', attackFailure: '' };
  }
  if (category !== 'healing' && !extra) {
    p.effectType = 'none';
    p.effectAmount = '';
    p.autoApply = false;
  }
  return p;
}
export function effectSummary(p) {
  const active = activeProfile(p),
    parts = [];
  if (active.rollAttack) parts.push('Linked attack');
  if (active.rollDamage) parts.push(`Damage: ${active.damageFormula || 'linked attack formula'}`);
  else if (active.damageFormula) parts.push(`Damage from chat: ${active.damageFormula}`);
  if (active.effectType !== 'none') {
    const auto = /^auto:([12])$/.exec(active.effectAmount),
      amount = auto
        ? Number(active.baseCost) * Number(auto[1])
        : active.effectAmount || 'choose amount';
    parts.push(
      `${active.effectType === 'heal-hp' ? 'Heal HP' : 'Restore FP'}: ${amount}${active.autoApply ? ' · current targets' : ' · apply from chat'}`,
    );
  }
  return parts.length ? `After success: ${parts.join(' · ')}` : 'Casting roll and resource cost';
}
