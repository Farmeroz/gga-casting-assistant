import { actorData, reference, standardDefaults, clone, cleanProfile, uid } from './core.mjs';
import { calculateDesign, diceText } from './rpm-model.mjs';
import { parseProfileText } from './parser.mjs';
export function pathChoice(actor, paths) {
  const skills = actorData(actor).abilities.filter((e) => e.kind === 'skill');
  const entries = [],
    missing = [];
  for (const path of paths) {
    const matches = skills.filter(
      (e) =>
        e.name.toLowerCase().replace(/[^a-z]/g, '') === `pathof${path.toLowerCase()}` &&
        e.level > 0,
    );
    if (matches.length === 1) entries.push(matches[0]);
    else missing.push(path);
  }
  return { entry: missing.length ? null : entries.sort((a, b) => a.level - b.level)[0], missing };
}
export function designProfile(actor, input, original = null) {
  const result = calculateDesign(input.design, input.name);
  const p = original ? clone(original) : { ...standardDefaults(null), id: uid() };
  const selected = pathChoice(actor, result.paths);
  p.name = String(input.name || '').trim();
  if (!p.name) throw new Error('Give the ritual a name.');
  p.rpmDesign = result.design;
  p.rpmPathPenalty = result.pathPenalty;
  p.rules = original?.rules === 'threshold' ? 'threshold' : 'rpm';
  p.baseCost = result.total;
  p.applyReduction = false;
  p.critFree = false;
  p.failurePolicy = 'full';
  p.criticalFailurePolicy = 'full';
  p.ability = reference(selected.entry);
  p.parserText = result.block;
  p.parsed = parseProfileText(result.block);
  const damage = result.design.modifiers.find((m) => m.kind === 'damage');
  const healing = result.design.modifiers.find((m) => m.kind === 'healing');
  p.damageFormula = damage
    ? `${diceText(damage)} ${damage.damageType}${damage.delivery === 'explosive' ? ' ex' : ''}`
    : '';
  p.effectType = healing ? (healing.resource === 'hp' ? 'heal-hp' : 'restore-fp') : 'none';
  p.effectAmount = healing ? diceText(healing) : '';
  p.effectCategory = 'auto';
  p.combineEffects = !!(damage && healing);
  p.scaleDamage = false;
  p.rollDamage = false;
  p.rollAttack = false;
  if (result.design.delivery !== 'immediate') {
    p.effectCategory = 'other';
    p.combineEffects = false;
  }
  return { profile: cleanProfile(p), result, missing: selected.missing };
}
