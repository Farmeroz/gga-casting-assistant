import { cleanDesign } from './rpm-model.mjs';
export const ID = 'gga-casting-assistant';
export const VERSION = 3;
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const normalise = (x) =>
  String(x ?? '')
    .trim()
    .toLowerCase();
export const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;
export const esc = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const integer = (n, label = 'Amount', min = 0, max = 1000000) => {
  if (
    n === '' ||
    n === null ||
    !Number.isSafeInteger(Number(n)) ||
    Number(n) < min ||
    Number(n) > max
  )
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(n);
};
export const uid = () => crypto.randomUUID();
export const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
export function own(actor, user = game.user) {
  if (!actor?.testUserPermission(user, 'OWNER'))
    throw new Error('You need ownership of this character.');
}
export function named(root, path, kind) {
  const out = [];
  function visit(o, p, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 12) return;
    if (typeof o.name === 'string' && o.name.trim())
      out.push({ key: p, name: o.name, kind, object: o, level: Number(o.level ?? o.import ?? 0) });
    for (const [k, v] of Object.entries(o))
      if (v && typeof v === 'object') visit(v, `${p}.${k}`, depth + 1);
  }
  visit(root, path);
  return out;
}
export function actorData(actor) {
  const spells = named(actor.system?.spells, 'system.spells', 'spell');
  const skills = named(actor.system?.skills, 'system.skills', 'skill');
  const attacks = [
    ...named(actor.system?.ranged, 'system.ranged', 'ranged'),
    ...named(actor.system?.melee, 'system.melee', 'melee'),
    ...skills,
  ];
  return {
    abilities: [...spells, ...skills].sort((a, b) => a.name.localeCompare(b.name)),
    attacks,
  };
}
export function reference(entry) {
  return entry
    ? { key: entry.key, name: entry.name, kind: entry.kind, mode: entry.object?.mode || '' }
    : null;
}
export function resolveReference(ref, entries) {
  if (!ref) return null;
  const matches = entries.filter(
    (e) =>
      e.kind === ref.kind && e.name === ref.name && (e.object?.mode || '') === (ref.mode || ''),
  );
  return matches.find((e) => e.key === ref.key) || (matches.length === 1 ? matches[0] : null);
}
export function resources(actor) {
  const out = [];
  for (const name of ['FP', 'HP']) {
    const o = actor.system?.[name];
    if (Number.isFinite(Number(o?.value)))
      out.push({
        path: `system.${name}.value`,
        name,
        value: Number(o.value),
        min: 0,
        max: Number(o.max),
        mode: 'pool',
      });
  }
  for (const e of named(
    actor.system?.additionalresources?.tracker,
    'system.additionalresources.tracker',
    'tracker',
  )) {
    const o = e.object;
    if (!Number.isFinite(Number(o.value))) continue;
    out.push({
      path: `${e.key}.value`,
      name: e.name,
      value: Number(o.value),
      min: Number(o.min) || 0,
      max: Number(o.max),
      mode: o.gcaResource?.kind
        ? o.gcaResource.kind === 'threshold'
          ? 'tally'
          : 'pool'
        : /threshold|tally|calamity/i.test(e.name)
          ? 'tally'
          : 'pool',
      thresholdStep:
        o.gcaResource?.kind === 'threshold' ? Number(o.gcaResource.step) || 5 : undefined,
      thresholdTable: o.gcaResource?.table || '',
      resourceKind: o.gcaResource?.kind || '',
    });
  }
  return out;
}
export function reduction(level) {
  return Math.max(0, Math.floor((Number(level) - 10) / 5));
}
export function standardDefaults(entry) {
  const name = normalise(entry?.name),
    cls = normalise(entry?.object?.class);
  const standard = entry?.kind === 'spell';
  const reduce =
    standard && !cls.includes('blocking') && !['lend energy', 'lend vitality'].includes(name);
  const cost = Number(String(entry?.object?.cost || '').match(/\d+/)?.[0] || 0);
  return {
    schemaVersion: VERSION,
    name: entry?.name || 'New profile',
    ability: reference(entry),
    rules: standard ? 'standard' : 'power',
    baseCost: cost,
    applyReduction: reduce,
    critFree: standard,
    failurePolicy: standard ? (cls.includes('information') ? 'full' : 'one') : 'full',
    criticalFailurePolicy: 'full',
    modifier: 0,
    includeBucket: true,
    effectCategory: 'auto',
    combineEffects: false,
    attack: null,
    rollAttack: false,
    rollDamage: false,
    scaleDamage: false,
    damageFormula: '',
    effectType: ['minor healing', 'major healing'].includes(name)
      ? 'heal-hp'
      : name === 'lend energy'
        ? 'restore-fp'
        : 'none',
    effectAmount:
      name === 'major healing'
        ? 'auto:2'
        : ['minor healing', 'lend energy'].includes(name)
          ? 'auto:1'
          : '',
    autoApply: false,
    allowSelf: true,
    rows: [{ name: 'FP', path: 'system.FP.value', mode: 'pool', amount: 'auto' }],
    tables: { success: '', failure: '', attackSuccess: '', attackFailure: '', threshold: '' },
    thresholdStep: 5,
    rpmDesign: null,
    rpmPathPenalty: 0,
    parserText: '',
    parsed: null,
    notes: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
export function cleanTags(value) {
  if (!Array.isArray(value)) value = String(value ?? '').split(',');
  const seen = new Set(),
    out = [];
  for (const item of value) {
    const tag = String(item).trim().slice(0, 40),
      key = normalise(tag);
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  if (out.length > 12) throw new Error('Use up to 12 tags per profile.');
  return out;
}
export function costFor(profile, entry) {
  const base = integer(profile.baseCost, 'Base cost');
  const discount = profile.applyReduction ? reduction(entry.level) : 0;
  return { base, reduction: discount, final: Math.max(0, base - discount) };
}
export function outcome(data) {
  if (!data || !Number.isFinite(data.rtotal) || !Number.isFinite(data.finaltarget))
    throw new Error('No valid new GGA roll was returned.');
  return data.isCritSuccess
    ? 'criticalSuccess'
    : data.isCritFailure
      ? 'criticalFailure'
      : data.failure
        ? 'failure'
        : 'success';
}
export function outcomeCost(profile, cost, result) {
  if (result === 'criticalSuccess' && profile.critFree) return 0;
  const policy =
    result === 'criticalFailure'
      ? profile.criticalFailurePolicy
      : result === 'failure'
        ? profile.failurePolicy
        : 'full';
  return policy === 'none' ? 0 : policy === 'one' ? Math.min(1, cost.final) : cost.final;
}
export function spendPlan(profile, available, cost) {
  const rows = profile.rows || [];
  let explicit = 0,
    auto = 0;
  for (const row of rows)
    if (row.amount === 'auto') auto++;
    else explicit += integer(row.amount, 'Resource allocation');
  if (auto > 1) throw new Error('Only one resource row may use the remaining cost automatically.');
  const out = [];
  for (const row of rows) {
    const amount = row.amount === 'auto' ? Math.max(0, cost - explicit) : integer(row.amount);
    const candidates = available.filter((r) => r.name === row.name);
    const source =
      available.find((r) => r.path === row.path && r.name === row.name) ||
      (candidates.length === 1 ? candidates[0] : null);
    if (!source) {
      if (!amount && row.mode !== 'tally') continue;
      throw new Error(`Choose a resource for ${row.name || 'the empty row'}.`);
    }
    const mode = row.mode === 'tally' ? 'tally' : 'pool';
    if (source.resourceKind === 'threshold' && mode !== 'tally')
      throw new Error(`${source.name} is a threshold tracker. Choose Build tally.`);
    if (mode === 'tally' && !Number.isFinite(source.max))
      throw new Error('Set a cap for the threshold tracker.');
    if (!amount) continue;
    const existing = out.find((r) => r.path === source.path);
    if (existing && existing.mode !== mode)
      throw new Error('One resource cannot both spend down and build up.');
    if (existing) existing.amount += amount;
    else out.push({ ...source, mode, amount });
  }
  if (out.reduce((s, r) => s + r.amount, 0) !== cost)
    throw new Error(
      'Resource allocation must match the final cost.  Set one row to Auto to use the remainder.',
    );
  validateFunds(out);
  return out;
}
export function validateFunds(plan) {
  for (const r of plan)
    if (r.mode === 'pool' && r.value - r.amount < r.min)
      throw new Error(
        `${r.name} has ${r.value - r.min} available; ${r.amount} is required.  Adjust the resource split.`,
      );
}
export function trimPlan(plan, cost) {
  let left = cost;
  return plan
    .map((r) => {
      const amount = Math.min(left, r.amount);
      left -= amount;
      return { ...r, amount };
    })
    .filter((r) => r.amount > 0);
}
export function damageFormula(entry, profile, cost) {
  const raw = (profile.damageFormula || entry?.object?.damage || '').trim();
  if (!raw) return '';
  if (profile.scaleDamage) {
    const m = /^\+?(\d*)d([+-]\d+)?\s+(.+?)(?:\s*\/\s*point|\s+per\s+point)?$/i.exec(raw);
    if (!m) throw new Error('Per-energy scaling needs a simple dice formula, such as 1d burn.');
    const adds = Number(m[2] || 0) * cost;
    return `${Number(m[1] || 1) * cost}d${adds ? signed(adds) : ''} ${m[3]}`;
  }
  return raw;
}
export function cleanProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid casting profile.');
  if (![1, 2, VERSION].includes(input.schemaVersion))
    throw new Error('This profile uses an unsupported version.');
  const p = standardDefaults(null);
  for (const k of Object.keys(p)) if (Object.hasOwn(input, k)) p[k] = clone(input[k]);
  p.schemaVersion = VERSION;
  // Old profiles used a +1-per-point, rounded-up placeholder. Migrate to RAW.
  if (input.schemaVersion < 3 && Number(p.thresholdStep) === 1) p.thresholdStep = 5;
  p.rpmDesign = p.rpmDesign ? cleanDesign(p.rpmDesign) : null;
  p.rpmPathPenalty = integer(p.rpmPathPenalty, 'RPM Path penalty', 0, 7);
  p.id = typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : uid();
  p.name = String(p.name).trim().slice(0, 120);
  if (!p.name) throw new Error('Give the profile a name.');
  for (const k of ['ability', 'attack'])
    if (
      p[k] &&
      (typeof p[k].name !== 'string' || !['spell', 'skill', 'melee', 'ranged'].includes(p[k].kind))
    )
      throw new Error('Invalid ability reference.');
  p.baseCost = integer(p.baseCost);
  p.modifier = integer(p.modifier, 'Modifier', -1000, 1000);
  p.thresholdStep = integer(p.thresholdStep, 'Threshold step', 1, 1000000);
  if (!['standard', 'power', 'rpm', 'threshold'].includes(p.rules))
    throw new Error('Invalid casting rules.');
  if (!['auto', 'damage', 'healing', 'other'].includes(p.effectCategory))
    throw new Error('Invalid effect category.');
  if (!['none', 'heal-hp', 'restore-fp'].includes(p.effectType))
    throw new Error('Invalid recovery effect.');
  for (const k of ['failurePolicy', 'criticalFailurePolicy'])
    if (!['none', 'one', 'full'].includes(p[k])) throw new Error('Invalid failure cost policy.');
  for (const k of [
    'applyReduction',
    'critFree',
    'includeBucket',
    'rollAttack',
    'rollDamage',
    'scaleDamage',
    'autoApply',
    'allowSelf',
    'combineEffects',
  ])
    p[k] = p[k] === true;
  for (const k of ['damageFormula', 'effectAmount', 'parserText', 'notes'])
    p[k] = String(p[k] ?? '').slice(0, k === 'parserText' ? 30000 : 4000);
  if (!Array.isArray(p.rows) || p.rows.length > 16)
    throw new Error('Profiles may contain up to 16 resource rows.');
  p.rows = p.rows.map((r) => ({
    name: String(r.name || '').slice(0, 120),
    path: String(r.path || ''),
    mode: r.mode === 'tally' ? 'tally' : 'pool',
    amount: r.amount === 'auto' ? 'auto' : integer(r.amount),
  }));
  const tables = {};
  for (const k of ['success', 'failure', 'attackSuccess', 'attackFailure', 'threshold'])
    tables[k] = typeof p.tables?.[k] === 'string' ? p.tables[k].slice(0, 200) : '';
  p.tables = tables;
  p.tags = cleanTags(p.tags);
  for (const k of ['createdAt', 'updatedAt'])
    p[k] = Number.isSafeInteger(p[k]) && p[k] >= 0 ? p[k] : 0;
  if (JSON.stringify(p).length > 100000) throw new Error('This profile is too large.');
  return p;
}
