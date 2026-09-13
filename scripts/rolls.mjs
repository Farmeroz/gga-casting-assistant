import { ID, clone, uid, own, signed, integer } from './core.mjs';
import { collectTaggedModifiers, bucketSnapshot, consumeSnapshot } from './roll-modifiers.mjs';

const contexts = new Map(),
  facades = new WeakMap(),
  modifierContexts = new WeakMap();
const identity = Symbol('Casting Assistant invocation');
let installed = false,
  nativeRoll;
let queue = Promise.resolve();
export function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}
export function assertCompatible() {
  if (game.system?.id !== 'gurps' || !/^0\.18\.\d+$/.test(game.system.version))
    throw new Error('Casting Assistant requires GURPS Game Aid 0.18.x.');
  if (!globalThis.libWrapper?.register)
    throw new Error('Enable libWrapper before using Casting Assistant.');
}
export function initialiseRolls() {
  if (installed) return;
  assertCompatible();
  const registered = [];
  const wrap = (name, fn) => {
    libWrapper.register(ID, name, fn, 'MIXED');
    registered.push(name);
  };
  try {
    wrap('GURPS.ModifierBucket.applyMods', function (wrapped, mods = []) {
      const context = contexts.get(mods[0]?.gcaInvocation);
      if (!context) return wrapped(mods);
      const result = clone(context.modifiers);
      if (
        result.some(
          (m) => !Number.isFinite(m.modint) || /\*\s*(?:costs?|per)\b/i.test(m.desc || ''),
        )
      )
        throw new Error(
          'Remove cost directives from modifiers; allocate the cost in Casting Assistant.',
        );
      context.bucketUsed = true;
      modifierContexts.set(result, context);
      return result;
    });
    wrap('ChatMessage.getSpeaker', function (wrapped, options = {}) {
      const context = facades.get(options.actor);
      return context ? { ...context.speaker, [identity]: context } : wrapped(options);
    });
    wrap('GURPS.applyModifierDesc', function (wrapped, actor, description) {
      const context = facades.get(actor);
      return wrapped(context?.actor || actor, description);
    });
    wrap('GURPS.setLastTargetedRoll', function (wrapped, data, actorId, tokenId, broadcast) {
      const context = modifierContexts.get(data?.targetmods);
      if (!context) return wrapped(data, actorId, tokenId, broadcast);
      context.result = data;
      // The chat message handles audience and dice visibility.  Never expose
      // an assistant roll on GGA's independent broadcast channel.
      return wrapped(data, context.speaker.actor, context.speaker.token, false);
    });
    wrap('ChatMessage.create', function (wrapped, data, options = {}) {
      const context = data && !Array.isArray(data) && data.speaker?.[identity];
      if (!context) return wrapped(data, options);
      if (context.closed) throw new Error('A completed cast tried to publish another roll.');
      context.messages.push({ data, options });
      return Promise.resolve(null);
    });
    installed = true;
  } catch (error) {
    for (const target of registered.reverse()) libWrapper.unregister(ID, target);
    throw error;
  }
}
export function rollOtf(entry) {
  const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const prefix =
    entry.kind === 'spell'
      ? 'Sp'
      : entry.kind === 'skill'
        ? 'Sk'
        : entry.kind === 'melee'
          ? 'M'
          : 'R';
  return `${prefix}:"${quote(entry.name + (entry.object?.mode ? ` (${entry.object.mode})` : ''))}"`;
}
export function visibility(message) {
  return {
    whisper: Array.from(message?.whisper || []).map((u) => (typeof u === 'string' ? u : u.id)),
    blind: !!message?.blind,
  };
}
export async function targetedRoll(
  actor,
  entry,
  { modifier = 0, includeBucket = true, token = null, access = null } = {},
) {
  initialiseRolls();
  own(actor);
  const otf = rollOtf(entry),
    action = GURPS.parselink(otf)?.action;
  if (!action || !['skill-spell', 'attack'].includes(action.type))
    throw new Error('GGA could not recognise the selected spell, skill, or attack.');
  const target = Number(entry.level);
  if (!Number.isFinite(target) || target <= 0)
    throw new Error('The selected ability has no usable skill level.');
  action.obj = clone(entry.object);
  action.itemPath = entry.key;
  // Sheet callback OtFs can independently spend resources or roll effects.
  // The assistant owns those operations; its native roll uses the component's
  // statistics and tags, without executing extra sheet commands.
  const obj = clone(entry.object);
  for (const k of ['checkotf', 'duringotf', 'passotf', 'failotf']) delete obj[k];
  const check = await actor.canRoll?.(action, token, `[${otf}]`, obj);
  if (check?.canRoll === false)
    throw new Error(
      Object.entries(check)
        .filter(([k, v]) => /message/i.test(k) && v)
        .map(([, v]) => v)
        .join(' ') || 'GGA does not permit this roll.',
    );
  nativeRoll ||= (await import('../../../systems/gurps/module/dierolls/dieroll.js')).doRoll;
  const snapshot = bucketSnapshot(GURPS.ModifierBucket);
  const optionalArgs = {
    action,
    obj,
    itemPath: entry.key,
    event: { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
    text: '',
  };
  const modifiers = includeBucket ? snapshot.map((s) => s.copy) : [];
  if (modifier)
    modifiers.push({
      mod: signed(modifier),
      modint: integer(modifier, 'Casting modifier', -1000, 1000),
      desc: 'Casting adjustment',
    });
  modifiers.push(
    ...(await collectTaggedModifiers(actor, `[${otf}]`, optionalArgs, {
      tokenUuid: token?.document?.uuid,
    })),
  );
  const context = {
    id: uid(),
    actor,
    modifiers,
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document || token || actor.token }),
    messages: [],
    bucketUsed: false,
  };
  context.facade = Object.freeze({
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    isSelf: true,
  });
  contexts.set(context.id, context);
  facades.set(context.facade, context);
  try {
    await nativeRoll({
      actor: context.facade,
      formula: '3d6',
      origtarget: target,
      thing: entry.name,
      chatthing: `[${otf}]`,
      prefix: entry.kind === 'spell' ? 'Spell:' : '',
      targetmods: [{ gcaInvocation: context.id }],
      optionalArgs,
      action,
    });
    if (
      !context.bucketUsed ||
      !context.result ||
      !Number.isFinite(context.result.rtotal) ||
      !Number.isFinite(context.result.finaltarget)
    )
      throw new Error('GGA did not return a new roll.  No casting resources were spent.');
    if (context.messages.filter((m) => m.data.rolls?.length).length !== 1)
      throw new Error('GGA returned unexpected roll output.  No casting resources were spent.');
    let message;
    for (const item of context.messages) {
      const data = {
        ...item.data,
        speaker: { ...context.speaker },
        flags: { ...item.data.flags, [ID]: { kind: 'native-roll', invocation: context.id } },
      };
      if (access) {
        Object.assign(data, access);
        const options = { ...item.options };
        delete options.rollMode;
        delete options.messageMode;
        message = await ChatMessage.create(data, options);
      } else message = await ChatMessage.create(data, item.options);
    }
    if (!message) throw new Error('The casting roll could not be posted.');
    if (includeBucket && GURPS.ModifierBucket.modifierStack.AUTO_EMPTY)
      consumeSnapshot(GURPS.ModifierBucket, snapshot);
    return { data: clone(context.result), message, visibility: visibility(message) };
  } finally {
    context.closed = true;
    contexts.delete(context.id);
  }
}
export function validateDamage(formula) {
  if (!formula || formula.length > 200 || /[\[\]\n\r]|\*\s*(?:costs?|per)\b/i.test(formula))
    throw new Error('Enter one damage formula without commands or resource costs.');
  const action = GURPS.parselink(formula)?.action;
  if (!action || !['damage', 'deriveddamage'].includes(action.type) || action.next || action.costs)
    throw new Error('GGA did not recognise a single damage formula.');
  return action;
}
export async function rollDamage(actor, formula, access) {
  const action = validateDamage(formula);
  own(actor);
  // Native damage chat remains governed by GGA's current roll visibility.
  // Refuse an automated follow-on if that audience changed since the cast.
  const mode = game.settings.get('core', 'rollMode');
  const current = {};
  ChatMessage.applyRollMode(current, mode);
  const expected = visibility(current);
  if (
    expected.blind !== access.blind ||
    expected.whisper.slice().sort().join(',') !== access.whisper.slice().sort().join(',')
  )
    throw new Error(
      'Restore the casting roll’s chat visibility before rolling damage from this card.',
    );
  return GURPS.performAction(action, actor, {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });
}
