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
// Public read-only API, schema 1. Consumers never edit tracking flags directly.
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
        received = e.recipients?.includes(actor.uuid) || false;
      if (!cast && !received) continue;
      results.push({
        schema: 1,
        id: e.id,
        name: e.name,
        summary: e.summary || '',
        casterUuid: caster.uuid,
        casterName: caster.name,
        actorUuid: actor.uuid,
        cast,
        received,
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
