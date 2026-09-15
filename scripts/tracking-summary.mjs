import { effectTargets } from './effect-targets.mjs';
import { own } from './core.mjs';
import { trackingState, effectState, worldTime } from './tracking-model.mjs';

export function accessibleCasters(user = game.user) {
  return [
    ...new Map(
      [
        ...Array.from(game.actors || []),
        ...Array.from(game.scenes || []).flatMap((s) =>
          Array.from(s.tokens || [])
            .map((t) => t.actor)
            .filter(Boolean),
        ),
      ]
        .filter((a) => a.testUserPermission(user, 'OWNER'))
        .map((a) => [a.uuid, a]),
    ).values(),
  ];
}
// Public read-only API, schema 2 adds confirmed/pending target outcomes. Consumers never edit tracking flags directly.
// Records are exposed only from casters this user can own/manage.
export function activeEffectSummaries(actor, user = game.user) {
  own(actor, user);
  const now = worldTime(),
    results = [];
  const casters = [
    ...new Map([actor, ...accessibleCasters(user)].map((a) => [a.uuid, a])).values(),
  ];
  for (const caster of casters) {
    for (const e of trackingState(caster).effects) {
      const state = effectState(e, now);
      if (!['active', 'due', 'review'].includes(state)) continue;
      const cast = caster.uuid === actor.uuid,
        target = effectTargets(e).find((t) => t.actorUuid === actor.uuid),
        received = target?.status === 'affected',
        pending = target?.status === 'pending';
      if (!cast && !received && !pending) continue;
      results.push({
        schema: 2,
        id: e.id,
        name: e.name,
        summary: e.summary || '',
        casterUuid: caster.uuid,
        casterName: caster.name,
        actorUuid: actor.uuid,
        cast,
        received,
        pending,
        targetStatus: target?.status || null,
        state,
        endsAt: e.endsAt,
        remaining: e.endsAt === null ? null : Math.max(0, e.endsAt - now),
        maintainable: e.maintainable,
        maintenanceCost: e.maintenanceCost,
        penalty: e.penalty,
        recipientNames: [...(e.recipientNames || [])],
      });
    }
  }
  return results.sort(
    (a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) || a.name.localeCompare(b.name),
  );
}
