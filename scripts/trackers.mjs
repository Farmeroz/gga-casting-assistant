import { own, integer, normalise } from './core.mjs';
import { actorQueue } from './mutations.mjs';
// Tracker shape and zero-padded allocation adapted from Farmeroz's MIT-licensed
// GGA Ammo Resource Assistant, scripts/gga-adapter.mjs.
export function trackerDefinition(input) {
  const name = String(input.name || '')
    .trim()
    .slice(0, 120);
  if (!name) throw new Error('Give the resource tracker a name.');
  const tally = input.kind === 'threshold';
  const max = integer(input.maximum, tally ? 'Threshold cap' : 'Maximum', 1);
  const value = integer(input.current, 'Current value');
  if (!tally && value > max) throw new Error('Current value cannot exceed the pool maximum.');
  return {
    name,
    alias: '',
    pdf: tally ? 'T77' : '',
    max,
    min: 0,
    value,
    points: 0,
    isDamageTracker: false,
    isDamageType: false,
    isMinimumEnforced: true,
    isMaximumEnforced: !tally,
    initialValue: '',
    thresholds: [],
    breakpoints: true,
    gcaResource: {
      version: 1,
      kind: tally ? 'threshold' : 'pool',
      step: integer(input.step ?? 5, 'Calamity step', 1),
      table: String(input.table || '').slice(0, 200),
    },
  };
}
export async function createMagicTracker(actor, input, user = game.user) {
  own(actor, user);
  return actorQueue(actor.uuid, async () => {
    const data = trackerDefinition(input),
      root = actor.system?.additionalresources?.tracker || {};
    if (Object.values(root).some((t) => normalise(t?.name) === normalise(data.name)))
      throw new Error(
        `A tracker named ${data.name} already exists. Choose it from the resource list.`,
      );
    let n =
      Math.max(
        -1,
        ...Object.keys(root)
          .filter((k) => /^\d+$/.test(k))
          .map(Number),
      ) + 1;
    while (Object.hasOwn(root, String(n).padStart(4, '0'))) n++;
    const path = `system.additionalresources.tracker.${String(n).padStart(4, '0')}`;
    await actor.update({ [path]: data });
    return {
      status: 'created',
      path: `${path}.value`,
      name: data.name,
      mode: data.gcaResource.kind === 'threshold' ? 'tally' : 'pool',
    };
  });
}
