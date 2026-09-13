import {
  ID,
  actorData,
  reference,
  resolveReference,
  resources,
  normalise,
  cleanTags,
} from './core.mjs';
import { profiles } from './profiles.mjs';
import { activeProfile } from './effects.mjs';

export const RULE_LABELS = {
  standard: 'Standard spell',
  power: 'Power',
  rpm: 'RPM',
  threshold: 'Threshold',
};
export const searchKey = (value) =>
  normalise(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
export function plainText(value) {
  if (value == null || typeof value === 'object') return '';
  return String(value)
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>|<\/\s*(?:p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[x],
    )
    .replace(/&#(\d+);/g, (raw, n) =>
      Number(n) > 0 && Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : raw,
    )
    .trim();
}
export function colleges(value) {
  return [
    ...new Set(
      plainText(value)
        .split(/[,;/]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function listedCost(value) {
  const text = normalise(value);
  if (['none', 'no cost', '0', 'free'].includes(text)) return 0;
  if (/^\d+(?:\s*(?:to|-|–|or)\s*\d+)?$/.test(text)) return Number(text.match(/^\d+/)[0]);
  return null;
}
export function bookmarkMatches(mark, item, all) {
  if (mark.type !== item.type) return false;
  if (item.type === 'profile') return mark.id === item.profile.id;
  return (
    resolveReference(
      mark.ref,
      all.filter((i) => i.type === 'ability').map((i) => i.entry),
    )?.key === item.entry.key
  );
}
export function bookmarkFor(item) {
  return item.type === 'profile'
    ? { type: 'profile', id: item.profile.id }
    : { type: 'ability', ref: reference(item.entry) };
}
export function profileIssues(actor, p, data = actorData(actor), available = resources(actor)) {
  p = activeProfile(p);
  const result = [];
  if (!resolveReference(p.ability, data.abilities))
    result.push('Choose the casting spell or skill.');
  if (p.attack && !resolveReference(p.attack, data.attacks))
    result.push('Choose the linked attack again.');
  for (const row of p.rows || []) {
    if (row.amount === 0 || row.amount === '0') continue;
    const found =
      available.find((r) => r.path === row.path && r.name === row.name) ||
      available.filter((r) => r.name === row.name).length === 1;
    if (!found) result.push(`Choose a resource for ${row.name || 'the empty resource row'}.`);
  }
  return result;
}
export function catalogue(actor, marks = []) {
  const data = actorData(actor),
    saved = profiles(actor),
    available = resources(actor);
  const result = data.abilities.map((entry) => {
    const o = entry.object,
      notes = [o.notes, o.description, o.vtt_notes, o.vttNotes].map(plainText).filter(Boolean);
    return {
      id: `ability:${entry.key}`,
      type: 'ability',
      entry,
      name: entry.name,
      level: entry.level,
      kind: entry.kind,
      colleges: colleges(o.college),
      class: plainText(o.class).split(';')[0].trim(),
      fullClass: plainText(o.class),
      cost: plainText(o.cost) || '—',
      costNumber: listedCost(o.cost),
      castTime: plainText(o.casttime) || '—',
      duration: plainText(o.duration) || '—',
      maintain: plainText(o.maintain) || '—',
      pageRef: String(o.pageref || o.reference || ''),
      notes: [...new Set(notes)].join('\n\n'),
      tags: [],
      setups: saved.filter((p) => resolveReference(p.ability, data.abilities)?.key === entry.key),
      updatedAt: 0,
      issues: [],
    };
  });
  for (const p of saved) {
    const ability = resolveReference(p.ability, data.abilities);
    result.push({
      id: `profile:${p.id}`,
      type: 'profile',
      profile: p,
      name: p.name,
      level: ability?.level ?? null,
      kind: p.rules,
      colleges: colleges(ability?.object?.college),
      class: RULE_LABELS[p.rules] || p.rules,
      fullClass: RULE_LABELS[p.rules] || p.rules,
      cost: String(p.baseCost),
      costNumber: Number.isFinite(Number(p.baseCost)) ? Number(p.baseCost) : null,
      castTime: plainText(ability?.object?.casttime) || '—',
      duration: plainText(ability?.object?.duration) || '—',
      maintain: plainText(ability?.object?.maintain) || '—',
      pageRef: String(ability?.object?.pageref || ability?.object?.reference || ''),
      notes: plainText(p.notes),
      tags: cleanTags(p.tags || []),
      updatedAt: p.updatedAt || 0,
      issues: profileIssues(actor, p, data, available),
      ability,
    });
  }
  for (const item of result) {
    item.favourite = marks.some((m) => bookmarkMatches(m, item, result));
    item.search = searchKey(
      [
        item.name,
        item.colleges.join(' '),
        item.fullClass,
        item.notes,
        item.pageRef,
        item.tags.join(' '),
        item.profile?.parserText,
        item.profile?.ability?.name,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  return result;
}
export function filterItems(items, filters = {}) {
  const tab = filters.tab || 'spells';
  const tokens = [...searchKey(filters.query || '').matchAll(/"([^"]+)"|(\S+)/g)].map(
    (m) => m[1] || m[2],
  );
  return items.filter(
    (i) =>
      (tab === 'builds'
        ? i.type === 'profile'
        : i.type === 'ability' && i.kind === (tab === 'skills' ? 'skill' : 'spell')) &&
      (!filters.favourites || i.favourite) &&
      (!filters.college || i.colleges.some((c) => searchKey(c) === searchKey(filters.college))) &&
      (!filters.class || searchKey(i.class) === searchKey(filters.class)) &&
      (!filters.tag || i.tags.some((t) => searchKey(t) === searchKey(filters.tag))) &&
      (!filters.rules || i.kind === filters.rules) &&
      tokens.every((t) => i.search.includes(t)),
  );
}
export function sortItems(items, sort = 'name') {
  const name = (a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.id.localeCompare(b.id);
  const number = (a, b, desc = false) =>
    a == null ? (b == null ? 0 : 1) : b == null ? -1 : desc ? b - a : a - b;
  return [...items].sort((a, b) => {
    if (sort === 'name-desc') return name(b, a);
    if (sort === 'skill') return number(a.level, b.level, true) || name(a, b);
    if (sort === 'cost') return number(a.costNumber, b.costNumber) || name(a, b);
    if (sort === 'college')
      return (a.colleges[0] || '\uffff').localeCompare(b.colleges[0] || '\uffff') || name(a, b);
    if (sort === 'recent')
      return number(a.updatedAt || null, b.updatedAt || null, true) || name(a, b);
    return name(a, b);
  });
}
export function facets(items, tab) {
  const base = filterItems(items, { tab });
  const unique = (values) =>
    [...new Map(values.filter(Boolean).map((v) => [searchKey(v), v])).values()].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    colleges: unique(base.flatMap((i) => i.colleges)),
    classes: unique(base.map((i) => i.class)),
    tags: unique(base.flatMap((i) => i.tags)),
  };
}
export function bookmarksFor(actor, user = game.user) {
  return (user.getFlag(ID, 'grimoireFavourites') || []).filter((m) => m.actorUuid === actor.uuid);
}
