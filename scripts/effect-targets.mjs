import { ID, clone } from './core.mjs';
import { effectState } from './tracking-model.mjs';

export const TARGET_OUTCOMES = ['pending', 'affected', 'resisted', 'ended'];
export function effectTargets(effect) {
  if (Array.isArray(effect.targets)) return clone(effect.targets);
  // Earlier records captured selected recipients, not resistance outcomes.
  return [...new Set(effect.recipients || [])].map((actorUuid) => ({
    actorUuid,
    name: effect.recipientNames?.[effect.recipients.indexOf(actorUuid)] || actorUuid,
    status: 'pending',
    conditionId: '',
  }));
}
export function newTargets(recipients, names, resolution) {
  return [...new Set(recipients)].map((actorUuid) => ({
    actorUuid,
    name: names[recipients.indexOf(actorUuid)] || actorUuid,
    status: resolution === 'none' ? 'affected' : 'pending',
    conditionId: '',
  }));
}
const collection = (value) => value?.contents || Array.from(value || []);
export function conditionChoices() {
  return collection(globalThis.CONFIG?.statusEffects)
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id,
      name: globalThis.game?.i18n?.localize(s.name || s.label || s.id) || s.name || s.label || s.id,
      img: s.img || s.icon || 'icons/svg/aura.svg',
    }));
}
export async function syncTargetMarker(caster, effect, target) {
  let actor = await fromUuid(target.actorUuid);
  if (actor?.documentName === 'Token') actor = actor.actor;
  if (!actor) return; // A deleted token has no marker left to remove.
  const markers = collection(actor.effects).filter((m) => {
    const source = m.getFlag?.(ID, 'targetEffect');
    return (
      source?.casterUuid === caster.uuid &&
      source.effectId === effect.id &&
      source.targetUuid === target.actorUuid
    );
  });
  const active = ['active', 'due', 'review'].includes(effectState(effect));
  const conditionId = active && target.status === 'affected' ? target.conditionId || '' : '';
  const remove = markers.filter(
    (m) => !conditionId || !collection(m.statuses).includes(conditionId),
  );
  if (remove.length)
    await actor.deleteEmbeddedDocuments(
      'ActiveEffect',
      remove.map((m) => m.id),
    );
  if (!conditionId || markers.some((m) => !remove.includes(m))) return;
  const condition = conditionChoices().find((s) => s.id === conditionId);
  if (!condition) throw new Error('The selected condition is no longer available.');
  // A marker placed by the GM or another module remains theirs to manage.
  const allMarkers = collection(actor.effects);
  const relatedStatus = allMarkers.some(
    (m) => m.getFlag?.(ID, 'targetEffect') && collection(m.statuses).includes(conditionId),
  );
  const externalStatus = allMarkers.some(
    (m) =>
      !m.getFlag?.(ID, 'targetEffect') &&
      !m.disabled &&
      collection(m.statuses).includes(conditionId),
  );
  if (externalStatus || (collection(actor.statuses).includes(conditionId) && !relatedStatus))
    return;
  await actor.createEmbeddedDocuments('ActiveEffect', [
    {
      name: `${effect.name} · ${caster.name}`,
      img: condition.img,
      statuses: [condition.id],
      changes: [],
      disabled: false,
      flags: {
        [ID]: {
          targetEffect: {
            casterUuid: caster.uuid,
            effectId: effect.id,
            targetUuid: target.actorUuid,
          },
        },
      },
    },
  ]);
}
export async function cleanEffectMarkers(caster, effect) {
  const errors = [];
  effect.targets = effectTargets(effect);
  for (const target of effect.targets) {
    if (!target.conditionId && !target.markerPending) continue;
    try {
      await syncTargetMarker(caster, effect, target);
      target.markerPending = false;
    } catch (error) {
      errors.push(`${target.name}: ${error.message}`);
    }
  }
  effect.markerCleanup = errors.join('; ');
  return effect.markerCleanup;
}
