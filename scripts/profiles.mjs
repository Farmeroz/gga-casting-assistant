import {
  ID,
  VERSION,
  clone,
  cleanProfile,
  own,
  uid,
  actorData,
  resolveReference,
} from './core.mjs';
export function profiles(actor) {
  const data = actor.getFlag(ID, 'profiles');
  if (!data) return [];
  if (![1, 2, VERSION].includes(data.version) || !Array.isArray(data.entries))
    throw new Error('Unsupported saved profile data.  Use a compatible Casting Assistant version.');
  return data.entries.map((p) => cleanProfile(p));
}
export async function saveProfile(actor, input, { copy = false } = {}) {
  own(actor);
  const p = cleanProfile(input);
  if (copy) p.id = uid();
  const all = profiles(actor),
    i = all.findIndex((e) => e.id === p.id);
  p.createdAt = copy ? Date.now() : (i >= 0 ? all[i].createdAt : p.createdAt) || Date.now();
  p.updatedAt = Date.now();
  if (i < 0) all.push(p);
  else all[i] = p;
  if (all.length > 100) throw new Error('An actor may have up to 100 saved casting profiles.');
  await actor.setFlag(ID, 'profiles', { version: VERSION, entries: all });
  return p;
}
export async function deleteProfile(actor, id) {
  own(actor);
  await actor.setFlag(ID, 'profiles', {
    version: VERSION,
    entries: profiles(actor).filter((p) => p.id !== id),
  });
}
export function exportProfiles(actor, entries = profiles(actor)) {
  return JSON.stringify(
    { format: ID, version: VERSION, actorName: actor.name, profiles: entries },
    null,
    2,
  );
}
export function parseImport(text) {
  if (text.length > 3000000) throw new Error('The import file is too large.');
  const data = JSON.parse(text);
  if (
    data.format !== ID ||
    ![1, 2, VERSION].includes(data.version) ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 100
  )
    throw new Error('Choose a Casting Assistant profile export.');
  return data.profiles.map((p) => ({ ...cleanProfile(p), id: uid() }));
}
export async function importProfiles(actor, text) {
  own(actor);
  const incoming = parseImport(text),
    all = profiles(actor);
  if (all.length + incoming.length > 100)
    throw new Error('This import would exceed 100 saved profiles.');
  await actor.setFlag(ID, 'profiles', { version: VERSION, entries: [...all, ...incoming] });
  return incoming;
}
export function missingReferences(actor, p) {
  const data = actorData(actor),
    out = [];
  if (!resolveReference(p.ability, data.abilities)) out.push('casting spell or skill');
  if (p.attack && !resolveReference(p.attack, data.attacks)) out.push('linked attack');
  return out;
}
export async function shortcut(actor, profile) {
  own(actor);
  if (!profile.id || !profiles(actor).some((p) => p.id === profile.id))
    throw new Error('Save this profile before creating a shortcut.');
  const command = `game.modules.get('${ID}').api.open(${JSON.stringify(actor.uuid)}, ${JSON.stringify(profile.id)});`;
  const macro = await Macro.create({
    name: profile.name,
    type: 'script',
    img: 'icons/svg/book.svg',
    command,
  });
  ui.notifications.info('Shortcut created in the Macro Directory.  Drag it to your hotbar.');
  return macro;
}
