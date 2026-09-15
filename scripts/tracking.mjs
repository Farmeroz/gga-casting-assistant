import {
  ID,
  own,
  clone,
  cleanProfile,
  resources,
  spendPlan,
  actorData,
  resolveReference,
  esc,
} from './core.mjs';
import { actorQueue } from './mutations.mjs';
import {
  effectTargets,
  newTargets,
  TARGET_OUTCOMES,
  conditionChoices,
  syncTargetMarker,
  cleanEffectMarkers,
} from './effect-targets.mjs';
import { thresholdChecks, resolveThresholds } from './threshold.mjs';
import {
  trackingState,
  worldTime,
  cleanOngoing,
  periodSeconds,
  effectState,
  maintenanceCost,
  healingPreview,
  healingDayStart,
  ordinaryMagic,
} from './tracking-model.mjs';

async function actorFrom(uuid) {
  let a = await fromUuid(uuid);
  if (a?.documentName === 'Token') a = a.actor;
  if (a?.documentName !== 'Actor') throw new Error('The character is no longer available.');
  return a;
}
const authorId = (m) => m.author?.id || m.user?.id || m.user;
async function save(actor, state, updates = {}) {
  if (
    state.effects.filter((e) => e.status === 'active').length > 1000 ||
    state.healing.length > 5000
  )
    throw new Error(
      'Tracking history is full. Ask the GM to clear completed history in Active effects.',
    );
  await actor.update({ ...updates, [`flags.${ID}.tracking`]: state });
}
export function ongoingSnapshot(p, entry) {
  if (p.ongoing.mode === 'off' || (p.rpmDesign && p.rpmDesign.delivery !== 'immediate'))
    return null;
  return {
    config: cleanOngoing(p.ongoing),
    maintenanceCost: maintenanceCost(p, entry),
    ordinary: ordinaryMagic(p, entry),
    profile: { rows: clone(p.rows), tables: clone(p.tables), thresholdStep: p.thresholdStep },
  };
}
async function beginEffect(actor, snapshot, details, user) {
  own(actor, user);
  return actorQueue(actor.uuid, async () => {
    const state = trackingState(actor),
      existing = state.effects.find((e) => e.id === details.id);
    if (existing) return { status: 'already-tracked', effectId: existing.id };
    const config = cleanOngoing(snapshot.config);
    if (config.mode === 'off')
      throw new Error('Enable duration tracking in the casting profile first.');
    const at = worldTime(),
      period = periodSeconds(config);
    const effect = {
      id: details.id,
      revision: 0,
      status: 'active',
      startedAt: at,
      endsAt: config.mode === 'timed' ? at + period : null,
      period,
      maintainable: config.mode === 'timed' && config.maintainable,
      maintenanceCost: snapshot.maintenanceCost,
      penalty: config.penalty,
      ordinary: snapshot.ordinary,
      summary: config.summary,
      profile: snapshot.profile,
      ...details,
    };
    effect.targets = newTargets(
      effect.recipients || [],
      effect.recipientNames || [],
      config.resolution,
    );
    state.effects.push(effect);
    await save(actor, state);
    return { status: 'tracked', effectId: effect.id };
  });
}
export async function startFromCard(card, user = game.user) {
  const c = card?.getFlag(ID, 'cast');
  if (
    !c?.paid ||
    c.effectsBlocked ||
    (c.attackResult && !['success', 'criticalSuccess'].includes(c.attackResult)) ||
    !['success', 'criticalSuccess'].includes(c.result) ||
    !c.ongoing
  )
    throw new Error('This card has no successful, paid ongoing effect to start.');
  if (card.blind && !user.isGM)
    throw new Error('A GM must resolve and start a blind spell effect.');
  if (!user.isGM && authorId(card) !== user.id)
    throw new Error('Only the caster or a GM may start this effect.');
  const actor = await actorFrom(c.actorUuid);
  return beginEffect(
    actor,
    c.ongoing,
    {
      id: `cast-${card.id}`,
      name: c.name,
      cardId: card.id,
      recipients: c.recipients || [],
      recipientNames: c.recipientNames || [],
      access: {
        whisper: Array.from(card.whisper || []).map((u) => (typeof u === 'string' ? u : u.id)),
        blind: !!card.blind,
      },
    },
    user,
  );
}
export async function trackingRequest(request, user) {
  if (request.kind === 'effect-start')
    return startFromCard(game.messages.get(request.cardId), user);
  const actor = await actorFrom(request.actorUuid);
  own(actor, user);
  if (request.kind === 'effect-add') {
    const p = cleanProfile(request.profile),
      entry = resolveReference(p.ability, actorData(actor).abilities);
    if (!entry) throw new Error('Choose the spell or skill for the existing effect.');
    const snapshot = ongoingSnapshot(p, entry);
    if (!snapshot)
      throw new Error(
        'Enable a duration in the profile; stored charms must be activated separately.',
      );
    const recipients = await Promise.all((request.targets || []).slice(0, 50).map(actorFrom));
    return beginEffect(
      actor,
      snapshot,
      {
        id: request.operation,
        name: p.name,
        recipients: recipients.map((a) => a.uuid),
        recipientNames: recipients.map((a) => a.name),
        access: {
          whisper: [
            user.id,
            ...Array.from(game.users || [])
              .filter((u) => u.isGM)
              .map((u) => u.id),
          ],
          blind: false,
        },
      },
      user,
    );
  }
  return actorQueue(actor.uuid, async () => {
    const state = trackingState(actor);
    if (request.kind === 'tracking-tick') {
      let changed = false;
      for (const e of state.effects) {
        if (e.status === 'active' && effectState(e) === 'expired') {
          e.status = 'expired';
          e.revision++;
          changed = true;
        }
        if (
          e.markerCleanup ||
          (e.status === 'expired' && effectTargets(e).some((t) => t.conditionId))
        ) {
          await cleanEffectMarkers(actor, e);
          changed = true;
        }
      }
      if (changed) await save(actor, state);
      return { status: 'updated' };
    }
    if (request.kind === 'healing-reserve') {
      const old = state.healing.find((h) => h.id === request.operation);
      if (old) return { status: old.status, healing: old };
      const p = cleanProfile(request.profile),
        entry = resolveReference(p.ability, actorData(actor).abilities);
      if (!entry) throw new Error('The healing spell is unavailable.');
      const h = healingPreview(actor, p, entry, request.targets || []);
      if (!h) throw new Error('This profile does not use repeated-healing tracking.');
      if (h.count !== request.expectedCount)
        throw new Error('The healing history changed. Review the new penalty before casting.');
      const target = await actorFrom(h.target);
      const value = { ...h, id: request.operation, targetName: target.name, status: 'pending' };
      state.healing.push(value);
      await save(actor, state);
      return { status: 'reserved', healing: value };
    }
    if (request.kind === 'healing-complete') {
      const h = state.healing.find((h) => h.id === request.operation);
      if (!h || h.status === 'discarded')
        throw new Error('The reserved healing attempt is unavailable.');
      h.status = 'counted';
      await save(actor, state);
      return { status: 'counted' };
    }
    if (request.kind === 'healing-discard') {
      if (!user.isGM) throw new Error('Only a GM can discard an unrolled healing attempt.');
      const h = state.healing.find((h) => h.id === request.operation);
      if (!h || h.status !== 'pending')
        throw new Error('Only an unresolved attempt can be discarded.');
      h.status = 'discarded';
      await save(actor, state);
      return { status: 'discarded' };
    }
    if (request.kind === 'healing-reset' || request.kind === 'tracking-clear') {
      if (!user.isGM) throw new Error('Only a GM can reset or clear tracking history.');
      if (state.healing.some((h) => h.status === 'pending'))
        throw new Error('Resolve pending healing attempts before resetting history.');
      if (request.kind === 'healing-reset') {
        state.healing = [];
        state.resetAt = worldTime();
      } else {
        // Keep effect tombstones: old chat cards must never restart a finished effect.
        const day = healingDayStart();
        state.healing = state.healing.filter((h) => h.at >= day);
        state.effects = state.effects.map((e) =>
          !e.markerCleanup && ['ended', 'expired'].includes(effectState(e))
            ? { id: e.id, status: 'ended', revision: e.revision }
            : e,
        );
      }
      await save(actor, state);
      return { status: 'updated' };
    }
    const effect = state.effects.find((e) => e.id === request.effectId);
    if (!effect || effect.revision !== request.revision)
      throw new Error('This effect changed. Refresh Active effects before trying again.');
    if (effect.access?.blind && !user.isGM)
      throw new Error('A GM must manage effects started from a blind cast.');
    if (request.kind === 'effect-target') {
      if (!user.isGM)
        throw new Error('Only a GM can confirm target outcomes or condition markers.');
      if (!['active', 'due', 'review'].includes(effectState(effect)))
        throw new Error('This effect has already ended.');
      if (!TARGET_OUTCOMES.includes(request.outcome))
        throw new Error('Choose a valid target outcome.');
      effect.targets = effectTargets(effect);
      const target = effect.targets.find((t) => t.actorUuid === request.targetUuid);
      if (!target) throw new Error('This character was not a target of the original cast.');
      const conditionId = request.outcome === 'affected' ? String(request.conditionId || '') : '';
      if (conditionId && !conditionChoices().some((s) => s.id === conditionId))
        throw new Error('Choose a supported condition marker.');
      // Keep the prior marker identity until cleanup succeeds, including when ending a target.
      const priorCondition = target.conditionId;
      target.status = request.outcome;
      target.conditionId = conditionId;
      target.markerPending = !!(priorCondition || conditionId || target.markerPending);
      target.updatedAt = worldTime();
      effect.revision++;
      if (
        effect.targets.length &&
        effect.targets.every((t) => ['resisted', 'ended'].includes(t.status))
      ) {
        effect.status = 'ended';
        effect.endedAt = worldTime();
        effect.endReason = 'targets-ended';
      }
      effect.markerCleanup = effect.targets.some((t) => t.markerPending)
        ? 'Condition marker update pending'
        : '';
      await save(actor, state);
      let error = '';
      try {
        await syncTargetMarker(actor, effect, target);
        target.markerPending = false;
        effect.markerCleanup = '';
        if (effect.targets.some((t) => t.markerPending))
          effect.markerCleanup = 'Other target markers need review';
      } catch (e) {
        error = `Outcome recorded; condition marker needs GM review: ${e.message}`;
        effect.markerCleanup = error;
      }
      await save(actor, state);
      return { status: error ? 'review' : 'updated', error };
    }
    const status = effectState(effect),
      at = worldTime();
    if (!['active', 'due', 'review'].includes(status))
      throw new Error('This effect has already ended.');
    let cost = 0,
      rows = [],
      updates = {};
    if (request.kind === 'effect-maintain') {
      if (status !== 'due') throw new Error('Maintenance is not currently due.');
      if (request.awake !== true)
        throw new Error('Confirm that the caster can maintain the spell.');
      cost = effect.maintenanceCost;
    } else if (request.kind === 'effect-end') {
      if (request.reason === 'expire' && status !== 'due')
        throw new Error('Let expire is available when maintenance is due.');
      if (!['expire', 'cancel', 'external'].includes(request.reason))
        throw new Error('Choose how the effect ends.');
      if (request.reason === 'cancel' && effect.ordinary) cost = 1;
    } else if (request.kind === 'effect-concentration') {
      if (effect.penalty === 'none')
        throw new Error('This effect is excluded from spells-on penalties.');
      effect.penalty = effect.penalty === 'concentrating' ? 'on' : 'concentrating';
    } else if (request.kind === 'effect-reviewed') {
      if (!user.isGM || !effect.review)
        throw new Error('Only a GM can resolve this maintenance review.');
      effect.review = '';
    } else throw new Error('Unknown tracking operation.');
    if (cost > 0) {
      if (!Array.isArray(request.rows) || request.rows.length > 16)
        throw new Error('Review the maintenance payment rows.');
      rows = spendPlan({ rows: request.rows }, resources(actor), cost);
      for (const row of rows) {
        row.after = row.value + (row.mode === 'tally' ? row.amount : -row.amount);
        updates[row.path] = row.after;
      }
    }
    if (request.kind === 'effect-maintain') {
      effect.endsAt += effect.period;
      effect.lastMaintainedAt = at;
    } else if (request.kind === 'effect-end') {
      effect.status = 'ended';
      effect.endedAt = at;
      effect.endReason = request.reason;
      if (effectTargets(effect).some((t) => t.conditionId))
        effect.markerCleanup = 'Condition cleanup pending';
    }
    effect.revision++;
    const checks = rows.some((r) => r.mode === 'tally' && r.amount > 0)
      ? thresholdChecks(
          { ...effect.profile, rows: rows.filter((r) => r.mode === 'tally') },
          resources(actor),
          rows,
        )
      : [];
    // Store resources, interval and a review marker together. A retry cannot charge twice.
    if (checks.length && effect.status === 'active') effect.review = 'Calamity resolution pending';
    await save(actor, state, updates);
    let calamities = [],
      error = '';
    if (checks.length) {
      try {
        calamities = await resolveThresholds(actor, checks, effect.access);
        effect.review = '';
        if (calamities.some((c) => c.spellAllowed === false) && effect.status === 'active') {
          effect.status = 'ended';
          effect.endedAt = at;
          effect.endReason = 'calamity';
        }
        await save(actor, state);
      } catch (e) {
        error = `Payment recorded. Resolve the calamity manually: ${e.message}`;
      }
    }
    if (
      effect.status !== 'active' &&
      (effect.markerCleanup || effectTargets(effect).some((t) => t.conditionId))
    ) {
      error ||= await cleanEffectMarkers(actor, effect);
      await save(actor, state);
    }
    const label =
      request.kind === 'effect-maintain'
        ? 'Maintenance'
        : request.kind === 'effect-end'
          ? 'Effect ended'
          : 'Effect updated';
    // A failed report never rolls back a confirmed resource change.
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        ...effect.access,
        content: `<p><strong>${esc(effect.name)}</strong> · ${label}${cost ? ` · ${cost} energy` : ''}.</p>${rows.length ? `<p>${rows.map((r) => `${esc(r.name)}: ${r.value} → ${r.after}`).join('; ')}</p>` : ''}${error ? `<p>${esc(error)}</p>` : ''}`,
      });
    } catch {
      error ||= 'The effect was updated, but its chat report could not be posted.';
    }
    return { status: error ? 'review' : 'updated', rows, calamities, error };
  });
}
