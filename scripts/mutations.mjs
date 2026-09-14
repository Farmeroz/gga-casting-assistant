import { ID, clone, own, resources, validateFunds, integer, uid, esc } from './core.mjs';
const queues = new Map();
export const primaryGM = () =>
  Array.from(game.users || [])
    .filter((u) => u.active && u.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
export function actorQueue(key, task) {
  const previous = queues.get(key) || Promise.resolve(),
    run = previous.catch(() => {}).then(task);
  queues.set(key, run);
  run
    .finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    })
    .catch(() => {});
  return run;
}
async function actorFrom(uuid) {
  const doc = await fromUuid(uuid);
  const actor = doc?.documentName === 'Token' ? doc.actor : doc;
  if (actor?.documentName !== 'Actor') throw new Error('The character is no longer available.');
  return actor;
}
function readLedger(actor) {
  return clone(actor.getFlag(ID, 'operations') || {});
}
async function commit(actor, updates, ledger) {
  const keys = Object.keys(ledger);
  // Unbounded idempotency is preferable to silently reviving old Apply cards.
  if (keys.length > 5000)
    throw new Error(
      'This actor has reached the casting history limit.  Ask the GM to archive the actor before continuing.',
    );
  await actor.update({ ...updates, [`flags.${ID}.operations`]: ledger });
}
export async function spendDirect(actor, plan, operation, user = game.user) {
  own(actor, user);
  return actorQueue(actor.uuid, async () => {
    const ledger = readLedger(actor);
    if (ledger[operation]) return ledger[operation];
    const live = resources(actor),
      updates = {},
      rows = [];
    if (!Array.isArray(plan) || plan.length > 16) throw new Error('Invalid resource allocation.');
    const paths = new Set();
    for (const row of plan) {
      const source = live.find((r) => r.path === row.path && r.name === row.name);
      if (!source || paths.has(row.path))
        throw new Error('The resource setup changed.  Review the cast before continuing.');
      paths.add(row.path);
      const amount = integer(row.amount, 'Resource spend'),
        mode = row.mode === 'tally' ? 'tally' : 'pool';
      rows.push({
        ...source,
        mode,
        amount,
        after: source.value + (mode === 'tally' ? amount : -amount),
      });
    }
    validateFunds(rows);
    for (const row of rows) updates[row.path] = row.after;
    const result = { status: 'spent', rows, at: Date.now() };
    ledger[operation] = result;
    await commit(actor, updates, ledger);
    return result;
  });
}
function authorId(message) {
  return message.author?.id || message.user?.id || message.user;
}
export async function recoveryDirect(card, targets, user = game.user) {
  const cast = clone(card?.getFlag(ID, 'cast') || null);
  if (!cast?.paid || !cast.effect || cast.effect.amount <= 0)
    throw new Error('This casting card has no paid recovery effect.');
  if (!user.isGM && authorId(card) !== user.id)
    throw new Error('Only the caster or a GM may apply this effect.');
  const caster = await actorFrom(cast.actorUuid);
  own(caster, user);
  const key =
    cast.effect.type === 'heal-hp' ? 'HP' : cast.effect.type === 'restore-fp' ? 'FP' : null;
  if (!key) throw new Error('Invalid recovery effect.');
  const amount = integer(cast.effect.amount, 'Recovery amount');
  if (!Array.isArray(targets) || !targets.length || targets.length > 50)
    throw new Error('Choose between 1 and 50 recipients.');
  const resolved = await Promise.all(targets.map(actorFrom)),
    unique = [...new Map(resolved.map((a) => [a.uuid, a])).values()];
  const results = [];
  for (const actor of unique) {
    if (!cast.allowSelf && actor.uuid === caster.uuid) {
      results.push({ actorUuid: actor.uuid, name: actor.name, status: 'self-excluded' });
      continue;
    }
    if (actor.uuid === caster.uuid && cast.selfHealingApproved === false)
      throw new Error(
        'Target the caster before casting standard self-healing so its injury penalty is included.',
      );
    if (!game.user.isGM) own(actor);
    results.push(
      await actorQueue(actor.uuid, async () => {
        const ledger = readLedger(actor),
          operation = `heal-${card.id}`;
        if (ledger[operation]) return { ...ledger[operation], status: 'already-applied' };
        const resource = actor.system?.[key],
          before = Number(resource?.value),
          max = Number(resource?.max);
        if (!Number.isFinite(before) || !Number.isFinite(max))
          throw new Error(`${actor.name} has no valid ${key} pool.`);
        const after = Math.max(before, Math.min(before + amount, max));
        const result = {
          actorUuid: actor.uuid,
          name: actor.name,
          key,
          before,
          after,
          amount: after - before,
          status: 'applied',
          at: Date.now(),
        };
        ledger[operation] = result;
        await commit(actor, { [`system.${key}.value`]: after }, ledger);
        return result;
      }),
    );
  }
  return { status: 'applied', results };
}
export async function undoRecoveryDirect(card, targetUuid, user = game.user) {
  if (!user.isGM) throw new Error('Only a GM can undo a recovery application.');
  const actor = await actorFrom(targetUuid);
  return actorQueue(actor.uuid, async () => {
    const ledger = readLedger(actor),
      key = `heal-${card.id}`,
      entry = ledger[key];
    if (!entry || entry.status === 'undone')
      throw new Error('There is no active application to undo.');
    if (Number(actor.system?.[entry.key]?.value) !== entry.after)
      throw new Error(
        `${actor.name}'s ${entry.key} changed after healing.  Adjust it manually to preserve intervening changes.`,
      );
    ledger[key] = { ...entry, status: 'undone', undoneAt: Date.now() };
    await commit(actor, { [`system.${entry.key}.value`]: entry.before }, ledger);
    return { status: 'undone', name: actor.name };
  });
}
export async function executeRequest(request, user) {
  if (request.kind === 'create-tracker') {
    const { createMagicTracker } = await import('./trackers.mjs');
    return createMagicTracker(await actorFrom(request.actorUuid), request.definition, user);
  }
  if (request.kind === 'spend')
    return spendDirect(await actorFrom(request.actorUuid), request.plan, request.operation, user);
  const card = game.messages.get(request.cardId);
  if (!card) throw new Error('The original casting card is no longer available.');
  if (request.expectedCast && JSON.stringify(card.getFlag(ID, 'cast')) !== request.expectedCast)
    throw new Error(
      'The casting card changed after approval.  Review it again before applying recovery.',
    );
  if (request.kind === 'heal') return recoveryDirect(card, request.targets, user);
  if (request.kind === 'undo') return undoRecoveryDirect(card, request.target, user);
  throw new Error('Unknown casting operation.');
}
export async function processRequest(message) {
  if (primaryGM()?.id !== game.user.id) return;
  const req = message.getFlag(ID, 'request');
  if (!req || message.getFlag(ID, 'response')) return;
  const user = game.users.get(authorId(message));
  if (!user) return;
  await actorQueue(`request-${message.id}`, async () => {
    if (message.getFlag(ID, 'response')) return;
    let response;
    try {
      if (req.kind === 'heal' && !user.isGM) {
        const targets = await Promise.all(req.targets.map(actorFrom));
        if (targets.some((a) => !a.testUserPermission(user, 'OWNER'))) {
          const card = game.messages.get(req.cardId),
            cast = card?.getFlag(ID, 'cast');
          if (!cast?.paid || authorId(card) !== user.id)
            throw new Error('Invalid recovery request.');
          response = { ok: true, value: { status: 'pending', requestId: message.id } };
          await message.update({
            [`flags.${ID}.response`]: response,
            content: `<p><strong>${esc(user.name)}</strong> requests ${cast.effect?.amount || 0} ${cast.effect?.type === 'heal-hp' ? 'HP healing' : 'FP recovery'} from <strong>${esc(cast.name)}</strong> for ${targets.map((a) => esc(a.name)).join(', ')}.</p><button type="button" data-gca-approve="true">GM: approve recovery</button>`,
          });
          return;
        }
      }
      response = { ok: true, value: await executeRequest(req, user) };
    } catch (e) {
      response = { ok: false, error: e.message };
    }
    await message.update({
      [`flags.${ID}.response`]: response,
      content: `<p>Casting Assistant: ${response.ok ? esc(response.value.status) : esc(response.error)}.</p>`,
    });
  });
}
export async function approveRecovery(message) {
  if (!game.user.isGM) throw new Error('Only a GM can approve recovery.');
  const request = message.getFlag(ID, 'request');
  if (request?.kind !== 'heal') throw new Error('Invalid recovery request.');
  const card = game.messages.get(request.cardId),
    cast = clone(card?.getFlag(ID, 'cast') || null);
  if (!cast?.paid || !cast.effect) throw new Error('The original recovery effect is unavailable.');
  const targets = await Promise.all(request.targets.map(actorFrom));
  const approved = await foundry.applications.api.DialogV2.confirm({
    window: { title: 'Apply requested recovery' },
    content: `<p>Apply <strong>${cast.effect.amount} ${cast.effect.type === 'heal-hp' ? 'HP' : 'FP'}</strong> from <strong>${esc(cast.name)}</strong> to ${targets.map((a) => esc(a.name)).join(', ')}?</p>`,
    rejectClose: false,
  });
  if (!approved) throw new Error('Recovery approval cancelled.');
  const result = await requestMutation({
    ...request,
    kind: 'heal',
    expectedCast: JSON.stringify(cast),
  });
  await message.update({
    content: `<p>Recovery approved. ${result.results.map((r) => `${esc(r.name)}: ${esc(r.status)}`).join('; ')}.</p>`,
    [`flags.${ID}.response`]: { ok: true, value: result },
  });
  return result;
}
export async function requestMutation(request) {
  const gm = primaryGM();
  if (!gm || gm.id === game.user.id) return executeRequest(request, game.user);
  // Message authorship is supplied by Foundry.  No client-supplied user ID
  // authorises spending or recovery on another actor.
  const message = await ChatMessage.create({
    user: game.user.id,
    whisper: [game.user.id, gm.id],
    content: '<p>Casting Assistant: processing resource or recovery update.</p>',
    flags: { [ID]: { request: { ...request, id: uid() } } },
  });
  const response = await new Promise((resolve, reject) => {
    let timer;
    const check = (m) => {
      if (m.id !== message.id) return;
      const result = m.getFlag(ID, 'response');
      if (!result) return;
      clearTimeout(timer);
      Hooks.off('updateChatMessage', hook);
      resolve(result);
    };
    const hook = Hooks.on('updateChatMessage', check);
    timer = setTimeout(() => {
      Hooks.off('updateChatMessage', hook);
      reject(
        new Error(
          'The GM has not confirmed this update.  Check the private processing message before trying again.',
        ),
      );
    }, 20000);
    check(game.messages.get(message.id) || message);
  });
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
