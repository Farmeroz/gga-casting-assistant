import { ID, clone, integer, normalise, reduction } from './core.mjs';

export const TIME_UNITS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
export const worldTime = () => Number(globalThis.game?.time?.worldTime) || 0;
export function ongoingDefaults(entry = null) {
  const raw = normalise(entry?.object?.duration);
  const match = /^(\d+)\s*(s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hours?|days?)\.?$/.exec(raw);
  const unit = match?.[2]?.[0];
  const maintain = String(entry?.object?.maintain ?? '').trim();
  return {
    mode: 'off',
    amount: match ? Number(match[1]) : 1,
    unit: unit === 's' ? 'seconds' : unit === 'h' ? 'hours' : unit === 'd' ? 'days' : 'minutes',
    maintainable: /^\d+$/.test(maintain),
    maintenanceCost: /^\d+$/.test(maintain) ? Number(maintain) : 0,
    reduceMaintenance: entry?.kind === 'spell',
    penalty: entry?.kind === 'spell' && raw !== 'permanent' ? 'on' : 'none',
    autoStart: false,
    summary: '',
  };
}
export function cleanOngoing(value) {
  const p = { ...ongoingDefaults(), ...(value || {}) };
  if (!['off', 'timed', 'indefinite'].includes(p.mode) || !Object.hasOwn(TIME_UNITS, p.unit))
    throw new Error('Choose a valid effect duration.');
  p.amount = integer(p.amount, 'Duration', 1, 1000000);
  p.maintenanceCost = integer(p.maintenanceCost, 'Maintenance cost');
  if (!['none', 'on', 'concentrating'].includes(p.penalty))
    throw new Error('Choose how this effect counts towards spells on.');
  for (const k of ['maintainable', 'reduceMaintenance', 'autoStart']) p[k] = p[k] === true;
  p.summary = String(p.summary || '').slice(0, 2000);
  return p;
}
export const periodSeconds = (o) => o.amount * TIME_UNITS[o.unit];
export const trackingState = (actor) =>
  clone(actor.getFlag?.(ID, 'tracking') || { version: 1, effects: [], healing: [], resetAt: null });
export function effectState(e, at = worldTime()) {
  if (e.status !== 'active') return e.status;
  if (e.review) return 'review';
  if (e.endsAt !== null && at >= e.endsAt) return e.maintainable ? 'due' : 'expired';
  return 'active';
}
export function spellsOn(actor, at = worldTime()) {
  return trackingState(actor)
    .effects.filter((e) => ['active', 'due', 'review'].includes(effectState(e, at)))
    .reduce((n, e) => n + (e.penalty === 'concentrating' ? 3 : e.penalty === 'on' ? 1 : 0), 0);
}
export function ordinaryMagic(p, entry) {
  return (
    p.rules === 'standard' ||
    (p.rules === 'threshold' && !p.rpmDesign && !p.parserText && entry?.kind === 'spell')
  );
}
export function maintenanceCost(p, entry) {
  const o = cleanOngoing(p.ongoing);
  return Math.max(0, o.maintenanceCost - (o.reduceMaintenance ? reduction(entry.level) : 0));
}
export function healingKind(p, entry) {
  if (p.healingTracking === 'none' || !ordinaryMagic(p, entry)) return '';
  if (['minor', 'major'].includes(p.healingTracking)) return p.healingTracking;
  return { 'minor healing': 'minor', 'major healing': 'major' }[normalise(entry?.name)] || '';
}
export function healingDayStart(at = worldTime()) {
  let offset = 0;
  try {
    offset = Number(game.settings.get(ID, 'healingDayOffset')) || 0;
  } catch {
    /* default before init */
  }
  return Math.floor((at - offset) / 86400) * 86400 + offset;
}
export function healingAttempts(actor, target, kind, at = worldTime()) {
  const s = trackingState(actor),
    day = Math.max(healingDayStart(at), s.resetAt ?? -Infinity);
  return s.healing.filter(
    (h) =>
      h.target === target &&
      h.kind === kind &&
      h.at >= day &&
      h.at <= at &&
      h.status !== 'discarded',
  );
}
export function healingPreview(actor, p, entry, recipients, at = worldTime()) {
  const kind = healingKind(p, entry);
  if (!kind) return null;
  if (recipients.length !== 1)
    throw new Error('Target exactly one patient before casting tracked Minor or Major Healing.');
  const attempts = healingAttempts(actor, recipients[0], kind, at);
  if (attempts.some((h) => h.status === 'pending'))
    throw new Error(
      'A previous healing attempt needs review in Active effects → Healing history before another roll.',
    );
  return { kind, target: recipients[0], count: attempts.length, penalty: attempts.length * 3, at };
}
export function timeText(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  for (const [unit, size] of [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ])
    if (n >= size && n % size === 0) return `${n / size} ${unit}${n / size === 1 ? '' : 's'}`;
  return `${n} seconds`;
}
