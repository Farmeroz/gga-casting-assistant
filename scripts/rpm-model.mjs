// GURPS 4e Thaumatology: Ritual Path Magic, pp. 15-19, 25-28, 38.
// This model stores design decisions, not a transcript to be reparsed.
export const PATHS = [
  'Body',
  'Chance',
  'Crossroads',
  'Energy',
  'Magic',
  'Matter',
  'Mind',
  'Spirit',
  'Undead',
];
export const EFFECTS = {
  Sense: 2,
  Strengthen: 3,
  Restore: 4,
  Control: 5,
  Destroy: 5,
  Create: 6,
  Transform: 8,
};
export const MODIFIERS = {
  duration: 'Duration',
  range: 'Range',
  area: 'Area of Effect',
  weight: 'Subject Weight',
  damage: 'Damage',
  healing: 'Healing',
  bonus: 'Bestows a Bonus',
  penalty: 'Bestows a Penalty',
  traits: 'Altered Traits',
  affliction: 'Afflictions',
  speed: 'Speed',
  information: 'Information range',
  time: 'Cross-time range',
  dimensions: 'Dimensional range',
  meta: 'Meta-Magic',
  extra: 'Extra Energy',
  custom: 'Custom modifier',
};
export const DAMAGE_TYPES = {
  burn: 1,
  cr: 1,
  tox: 1,
  pi: 1,
  'pi-': 0.5,
  cut: 1.5,
  'pi+': 1.5,
  imp: 2,
  cor: 2,
  fat: 2,
  'pi++': 2,
};
export const DURATION_UNITS = {
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2592000,
  years: 31536000,
};
const fail = (message) => {
  throw new Error(message);
};
const num = (value, label, min = 0, max = 1000000, whole = false) => {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value)) ||
    Number(value) < min ||
    Number(value) > max ||
    (whole && !Number.isSafeInteger(Number(value)))
  )
    fail(`${label} must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  return Number(value);
};
const txt = (value, max = 4000) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const choice = (value, values, label) =>
  values.includes(value) ? value : fail(`Choose a valid ${label}.`);
export function newDesign() {
  return {
    version: 1,
    description: '',
    effects: [{ path: 'Body', effect: 'Sense', greater: false, quantity: 1, notes: '' }],
    modifiers: [],
    delivery: 'immediate',
    trappings: 0,
    trappingsNotes: '',
    ruling: '',
  };
}
export function newModifier(kind = 'duration') {
  return {
    kind,
    value: 0,
    unit: 'minutes',
    notes: '',
    scope: 'narrow',
    dice: 1,
    adds: 0,
    damageType: 'burn',
    delivery: 'internal',
    enhancements: 0,
    hasEnhancements: false,
    excluded: 0,
    resource: 'hp',
    noSelfControl: false,
  };
}
export function cleanDesign(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.effects) ||
    !Array.isArray(input.modifiers)
  )
    fail('Unsupported RPM design.');
  if (!input.effects.length || input.effects.length > 30 || input.modifiers.length > 40)
    fail('Use 1–30 effects and up to 40 modifiers.');
  return {
    version: 1,
    description: txt(input.description),
    ruling: txt(input.ruling),
    delivery: choice(input.delivery, ['immediate', 'conditional', 'charm'], 'ritual delivery'),
    trappings: num(input.trappings, 'Trappings discount', 0, 25, true),
    trappingsNotes: txt(input.trappingsNotes),
    effects: input.effects.map((e) => ({
      path: choice(e.path, PATHS, 'Path'),
      effect: choice(e.effect, Object.keys(EFFECTS), 'effect'),
      greater: e.greater === true,
      quantity: num(e.quantity, 'Effect count', 1, 20, true),
      notes: txt(e.notes, 500),
    })),
    modifiers: input.modifiers.map((m) => ({
      ...newModifier(choice(m.kind, Object.keys(MODIFIERS), 'modifier')),
      value: num(m.value, 'Modifier value'),
      unit: choice(m.unit || 'minutes', Object.keys(DURATION_UNITS), 'duration unit'),
      notes: txt(m.notes, 500),
      scope: choice(m.scope || 'narrow', ['narrow', 'moderate', 'broad'], 'bonus scope'),
      dice: num(m.dice ?? 1, 'Dice', 1, 1000, true),
      adds: num(m.adds ?? 0, 'Dice adds', -3, 3, true),
      damageType: choice(m.damageType || 'burn', Object.keys(DAMAGE_TYPES), 'damage type'),
      delivery: choice(
        m.delivery || 'internal',
        ['internal', 'missile', 'explosive', 'distant'],
        'damage delivery',
      ),
      enhancements: num(m.enhancements ?? 0, 'Net enhancements', 0, 10000),
      hasEnhancements: m.hasEnhancements === true,
      excluded: num(m.excluded ?? 0, 'Excluded subjects', 0, 1000, true),
      resource: choice(m.resource || 'hp', ['hp', 'fp'], 'healing resource'),
      noSelfControl: m.noSelfControl === true,
      removes: m.removes === true,
    })),
  };
}
export function sizeCost(distance) {
  if (distance <= 2) return 0;
  for (let n = 1; n < 100; n++) {
    const limit = [3, 5, 7, 10, 15, 20][(n - 1) % 6] * 10 ** Math.floor((n - 1) / 6);
    if (distance <= limit) return n;
  }
  fail('Distance is too large.');
}
export function durationCost(seconds) {
  const bounds = [0, 600, 1800, 3600, 10800, 21600, 43200, 86400, 259200, 604800, 1209600, 2592000];
  const index = bounds.findIndex((n) => seconds <= n);
  if (index >= 0) return index;
  if (seconds <= 31536000) return Math.min(22, 10 + Math.ceil(seconds / 2592000));
  return 21 + Math.ceil(seconds / 31536000);
}
export function weightCost(pounds) {
  const bounds = [10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 900000, 2700000];
  const i = bounds.findIndex((n) => pounds <= n);
  return i >= 0 ? i : 11 + Math.ceil(Math.log(pounds / 2700000) / Math.log(3));
}
export function longRangeCost(miles) {
  const bounds = [200 / 1760, 0.5, 1, 3, 10, 30, 100, 300, 1000];
  const i = bounds.findIndex((n) => miles <= n);
  if (i >= 0) return i;
  for (let n = 9; n < 100; n++) {
    const limit = (n % 2 ? 3 : 10) * 1000 * 10 ** Math.floor((n - 9) / 2);
    if (miles <= limit) return n;
  }
  fail('Distance is too large.');
}
export const diceText = (m) => `${m.dice}d${m.adds > 0 ? '+' + m.adds : m.adds < 0 ? m.adds : ''}`;
export function modifierCost(m) {
  m = {
    ...m,
    value: Number(m.value),
    dice: Number(m.dice),
    adds: Number(m.adds),
    enhancements: Number(m.enhancements),
    excluded: Number(m.excluded),
  };
  let cost = 0,
    label = MODIFIERS[m.kind],
    detail = '';
  switch (m.kind) {
    case 'duration':
      cost = durationCost(m.value * DURATION_UNITS[m.unit]);
      detail = m.value ? `${m.value} ${m.unit}` : 'Momentary';
      break;
    case 'range':
    case 'speed':
      cost = sizeCost(m.value);
      detail = `${m.value} ${m.kind === 'speed' ? 'yards/second' : 'yards'}`;
      break;
    case 'area':
      if (m.value <= 0) fail('Area radius must be greater than zero.');
      cost = Math.max(2, 2 * sizeCost(m.value)) + Math.ceil(m.excluded / 2);
      detail = `${m.value} yards radius${m.excluded ? `, excludes ${m.excluded}` : ''}`;
      break;
    case 'weight':
      cost = weightCost(m.value);
      detail = `${m.value} lbs.`;
      break;
    case 'bonus':
    case 'penalty':
      num(m.value, 'Bonus or penalty', 0, 20, true);
      cost = m.value ? 2 ** (m.value - 1) * { narrow: 1, moderate: 2, broad: 5 }[m.scope] : 0;
      detail = `${m.kind === 'penalty' ? '−' : '+'}${m.value}, ${m.scope}`;
      break;
    case 'traits':
      cost = Math.ceil((m.value * (m.noSelfControl && m.removes ? 2.5 : 1)) / (m.removes ? 5 : 1));
      detail = `${m.removes ? 'Removes' : 'Adds'} ${m.value} character points`;
      break;
    case 'affliction':
      cost = Math.ceil(m.value / 5);
      detail = `${m.value}% Affliction enhancement`;
      break;
    case 'damage':
    case 'healing': {
      const external = m.kind === 'damage' && m.delivery !== 'internal';
      const factor = external ? (m.delivery === 'explosive' ? 2 : 3) : 1;
      cost = Math.ceil(
        Math.max(0, Math.ceil((m.dice * 4 + m.adds) / factor) - 4) *
          (m.kind === 'healing' ? 1 : DAMAGE_TYPES[m.damageType]),
      );
      if (m.kind === 'damage' && (m.hasEnhancements || m.enhancements > 0))
        cost += Math.max(
          1,
          cost <= 20 ? Math.ceil(m.enhancements / 5) : Math.ceil((cost * m.enhancements) / 100),
        );
      detail =
        m.kind === 'healing'
          ? `${diceText(m)} ${m.resource.toUpperCase()}`
          : `${m.delivery === 'internal' ? 'Internal' : 'External'} ${diceText(m)} ${m.damageType}${m.delivery === 'explosive' ? ' ex' : ''}${m.delivery === 'distant' ? ', created at target' : ''}${m.hasEnhancements || m.enhancements ? `, net enhancements +${m.enhancements}%` : ''}`;
      break;
    }
    case 'information':
    case 'time':
      cost = longRangeCost(m.value);
      detail = `${m.value} ${m.kind === 'time' ? 'days' : 'miles'}`;
      break;
    case 'dimensions':
      cost = num(m.value, 'Dimensions', 0, 1000, true) * 10;
      detail = `${m.value} dimensions`;
      break;
    default:
      cost = num(m.value, 'Energy', 0, 1000000, true);
      detail = m.kind === 'custom' ? 'GM-defined' : '';
  }
  return {
    kind: m.kind,
    cost,
    label: `${label}${detail ? ', ' + detail : ''}${m.notes ? ` (${m.notes})` : ''}`,
    inherent: ![
      'duration',
      'range',
      'information',
      'time',
      'dimensions',
      'weight',
      'extra',
    ].includes(m.kind),
  };
}
export function calculateDesign(input, name = 'Unnamed ritual') {
  const design = cleanDesign(input);
  const effects = design.effects.map((e) => ({
    cost: EFFECTS[e.effect] * e.quantity,
    label: `${e.greater ? 'Greater' : 'Lesser'} ${e.effect} ${e.path}${e.quantity > 1 ? ` ×${e.quantity}` : ''}`,
  }));
  const mods = design.modifiers.map(modifierCost);
  const greater = design.effects.reduce((sum, e) => sum + (e.greater ? e.quantity : 0), 0);
  const multiplier = 1 + 2 * greater;
  const wrapper =
    design.delivery !== 'immediate'
      ? [{ label: 'Lesser Control Magic (conditional wrapper)', cost: 5 }]
      : [];
  const components = [...effects, ...wrapper, ...mods];
  const base = components.reduce((sum, c) => sum + c.cost, 0);
  const total = Math.ceil((base * multiplier * (100 - design.trappings)) / 100);
  num(total, 'Total ritual energy', 0, 1000000, true);
  const paths = [
    ...new Set([...design.effects.map((e) => e.path), ...(wrapper.length ? ['Magic'] : [])]),
  ];
  const warnings = [];
  const has = (k) =>
    design.modifiers.some(
      (m) => m.kind === k && (m.value > 0 || ['damage', 'healing'].includes(k)),
    );
  if (has('duration') && (has('damage') || has('healing')))
    warnings.push(
      'Damage and Healing do not normally combine with Duration. Check the ritual; enduring damage uses enhancements (RPM, pp. 17–18).',
    );
  if (
    design.modifiers.some(
      (m) => m.kind === 'damage' && ['missile', 'explosive'].includes(m.delivery),
    ) &&
    (has('range') || has('weight'))
  )
    warnings.push(
      'A hand-held missile normally needs neither Range nor Subject Weight. Keep these only for another component (RPM, p. 17).',
    );
  if (
    design.modifiers.some((m) => m.kind === 'damage' && m.delivery === 'distant') &&
    !has('range')
  )
    warnings.push('Damage created at a distant target needs Range (RPM, p. 17).');
  if (
    design.modifiers.filter((m) => m.kind === 'damage').length > 1 ||
    design.modifiers.filter((m) => m.kind === 'healing').length > 1
  )
    warnings.push(
      'Multiple damage or healing components: the casting profile can hold one formula of each kind. Resolve additional components in play.',
    );
  if (
    design.modifiers.some((m) => m.kind === 'damage' && (m.hasEnhancements || m.enhancements > 0))
  )
    warnings.push(
      'Damage enhancements are included in the energy cost. Record them in the notes and apply their effects in play; the generated damage roll contains dice, type, and explosion only.',
    );
  if (design.delivery !== 'immediate')
    warnings.push(
      'Casting creates the charm or conditional ritual. Damage and healing are resolved when it is triggered, not when prepared.',
    );
  if (design.trappings && !design.trappingsNotes)
    warnings.push('Record the agreed trappings for this discount (RPM, p. 19).');
  const block = `${txt(name, 120)}\nSpell Effects: ${effects.map((e) => e.label).join(' + ')}.\nInherent Modifiers: ${
    mods
      .filter((m) => m.inherent)
      .map((m) => m.label)
      .join(' + ') || 'None'
  }.\nGreater Effects: ${greater} (×${multiplier}).\n\n${design.description}\n\nTypical Casting: ${components.map((c) => `${c.label} (${c.cost})`).join(' + ')}. ${total} energy (${base}×${multiplier}${design.trappings ? `, less ${design.trappings}% trappings` : ''}).`;
  return {
    design,
    components,
    greater,
    multiplier,
    base,
    total,
    paths,
    pathPenalty: Math.max(0, paths.length - 2),
    warnings,
    block,
  };
}
