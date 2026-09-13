import {clone, signed} from './core.mjs';

const list = value => value?.contents || Array.from(value || []);
const tags = value => String(value || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

// GGA 0.18's tag selection helpers are read-only.  Collect their matching
// modifiers into a local list instead of calling addTaggedRollModifiers, which
// writes the client's shared bucket.  This retains college and component tags.
export async function collectTaggedModifiers(actor, chatthing, optionalArgs, entry = {}) {
  const settings = game.settings.get('gurps', 'use-tagged-modifiers');
  if (!settings?.autoAdd) return [];
  const helper = optionalArgs.obj ? '_getTagsFromItemOrAttr' : '_getTagsFromCheck';
  if (typeof actor[helper] !== 'function') throw new Error('GGA does not expose the required tagged-modifier calculator.');
  const selected = new Set([...tags(settings.allRolls), ...tags(optionalArgs.obj?.modifierTags),
    ...(optionalArgs.obj ? actor[helper](chatthing, settings, optionalArgs) : actor[helper](chatthing, settings))]);
  const itemRef = optionalArgs.obj?.name || optionalArgs.obj?.originalName || actor._getItemRefFromCheck?.(chatthing);
  const localise = text => {
    const key = text.match(/(GURPS\.\w+)/)?.[1];
    return key ? game.i18n.localize(key) + text.replace(key, '') : text;
  };
  const mods = [...(actor.system?.conditions?.usermods || []), ...(actor.system?.conditions?.self?.modifiers || []).map(localise)];
  const targets = list(game.user.targets);
  if (targets.length) {
    const native = await import('../../../systems/gurps/module/actor/effect-modifier-popout.js');
    if (typeof native.getRangedModifier !== 'function' || typeof native.getSizeModifier !== 'function') throw new Error('GGA does not expose the required target-modifier calculators.');
    const active = list(canvas.tokens?.placeables);
    const source = entry.tokenUuid ? active.find(t=>t.document?.uuid === entry.tokenUuid) : actor.token?.object || actor.getActiveTokens?.()[0];
    for (const target of targets) {
      mods.push(...(target.actor?.system?.conditions?.target?.modifiers || []).map(localise));
      if (source) mods.push(native.getRangedModifier(source, target), native.getSizeModifier(source, target));
    }
  }
  const inCombat = !!game.combat?.isActive && list(game.combat.combatants).some(c=>
    entry.tokenUuid ? c.token?.uuid === entry.tokenUuid : c.actor?.uuid === actor.uuid);
  const result = [];
  for (const text of mods.filter(Boolean)) {
    for (const tag of (text.match(/#(\S+)/g) || []).map(s=>s.slice(1).toLowerCase())) {
      if (!selected.has(tag)) continue;
      if (text.includes('#maneuver') && !(itemRef && text.includes(itemRef)) && !text.includes('@man:')) continue;
      if (inCombat ? settings.nonCombatOnlyTag && selected.has(settings.nonCombatOnlyTag) : settings.combatOnlyTag && selected.has(settings.combatOnlyTag)) continue;
      const desc = text.match(/^[+-]\d+(.*?)(?=[#@])/)?.[1].trim() || '';
      const value = Number(text.match(/[-+]\d+/)?.[0] || 0);
      // Match GGA's merging of equal descriptions, including multiple tags.
      const existing = result.find(m=>m.desc === desc && !/\* *Cost/i.test(desc));
      if (existing) {existing.modint += value; existing.mod = signed(existing.modint);}
      else result.push({mod:signed(value), modint:value, desc, tagged:true});
    }
  }
  return result;
}

export function bucketSnapshot(bucket) {
  return bucket.modifierStack.modifierList.filter(m=>!m.tagged).map(value=>({value, copy:clone(value), fingerprint:JSON.stringify(value)}));
}
export function consumeSnapshot(bucket, snapshot) {
  const current = bucket.modifierStack.modifierList;
  const removable = new Set(snapshot.filter(s=>JSON.stringify(s.value) === s.fingerprint).map(s=>s.value));
  const changed = snapshot.some(s=>current.includes(s.value) && !removable.has(s.value));
  // New/replaced/edited entries are retained.  Only unchanged objects used by
  // this request are consumed, and failure never restores a stale snapshot.
  const remaining = current.filter(m=>!removable.has(m));
  if (remaining.length !== current.length) {
    bucket.modifierStack.modifierList = remaining;
    bucket.modifierStack.sum(); bucket.refresh();
  }
  if (changed) ui.notifications.warn('Your bucket changed during the check.  Changed modifiers were kept; review them before your next roll.');
}
