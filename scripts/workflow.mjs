import { thresholdChecks, resolveThresholds } from './threshold.mjs';
import {
  ID,
  clone,
  uid,
  own,
  actorData,
  resources,
  resolveReference,
  costFor,
  outcome,
  outcomeCost,
  spendPlan,
  trimPlan,
  damageFormula,
  cleanProfile,
  normalise,
  esc,
  integer,
} from './core.mjs';
import { parseRecoveryExpression } from './parser.mjs';
import { targetedRoll, serial, validateDamage, rollDamage } from './rolls.mjs';
import { requestMutation } from './mutations.mjs';
import { pageLinks } from './references.mjs';
import { activeProfile } from './effects.mjs';
import {
  healingPreview,
  ordinaryMagic,
  spellsOn,
  worldTime,
  trackingState,
  effectState,
} from './tracking-model.mjs';
import { ongoingSnapshot } from './tracking.mjs';

export function selectedRecipients() {
  const tokens = Array.from(game.user.targets || []);
  return [...new Set(tokens.filter((t) => t.actor).map((t) => t.actor.uuid))];
}
export function recoveryPlan(p) {
  if (p.effectType === 'none') return null;
  const auto = /^auto:([12])$/.exec(p.effectAmount);
  const parsed = auto
    ? {
        valid: true,
        kind: 'fixed',
        effectType: p.effectType,
        amount: p.baseCost * Number(auto[1]),
        display: 'From base energy',
      }
    : parseRecoveryExpression(p.effectAmount, p.effectType);
  if (!parsed.valid) throw new Error(parsed.error);
  if (!['heal-hp', 'restore-fp'].includes(parsed.effectType))
    throw new Error('Choose a recovery effect type.');
  if (parsed.kind === 'fixed') integer(parsed.amount, 'Recovery amount');
  return parsed;
}
export function prepareCast(actor, input) {
  own(actor);
  const p = activeProfile(cleanProfile(input)),
    data = actorData(actor),
    entry = resolveReference(p.ability, data.abilities);
  if (!entry)
    throw new Error(
      'Choose the casting spell or skill; the saved reference is missing or ambiguous.',
    );
  if (p.rules === 'standard' && normalise(entry.name) === 'recover energy')
    throw new Error(
      'Recover Energy improves resting recovery and does not use a casting roll.  Use the character’s FP recovery controls.',
    );
  if (p.rules === 'threshold' && !p.rows.some((r) => r.mode === 'tally'))
    throw new Error('Choose a threshold tracker with Build tally before using Threshold casting.');
  const cost = costFor(p, entry),
    plan = spendPlan(p, resources(actor), cost.final);
  const attack = resolveReference(p.attack, data.attacks);
  if (p.rollAttack && !attack) throw new Error('Choose a linked attack before enabling its roll.');
  const damage = p.rollDamage || p.damageFormula ? damageFormula(attack, p, cost.base) : '';
  if (damage) validateDamage(damage);
  const recovery = recoveryPlan(p);
  let modifier = p.modifier - (p.rpmDesign ? p.rpmPathPenalty : 0);
  if (p.rules === 'standard')
    modifier -= plan.filter((r) => r.path === 'system.HP.value').reduce((s, r) => s + r.amount, 0);
  const recipients = selectedRecipients();
  const healing = healingPreview(actor, p, entry, recipients);
  const onPenalty = ordinaryMagic(p, entry) && p.useSpellsOn ? spellsOn(actor) : 0;
  if (
    ordinaryMagic(p, entry) &&
    p.useSpellsOn &&
    trackingState(actor).effects.some((e) => ['due', 'review'].includes(effectState(e)))
  )
    throw new Error('Resolve due maintenance or calamity review in Active effects before casting.');
  modifier -= onPenalty + (healing?.penalty || 0);
  if (p.autoApply && recovery && !recipients.length)
    throw new Error(
      'Target the recovery recipient before casting, or turn off automatic application.',
    );
  if (
    ordinaryMagic(p, entry) &&
    recovery?.effectType === 'heal-hp' &&
    recipients.includes(actor.uuid)
  )
    modifier -= Math.max(0, Number(actor.system.HP.max) - Number(actor.system.HP.value));
  return {
    p,
    entry,
    attack,
    cost,
    plan,
    damage,
    recovery,
    modifier,
    recipients,
    healing,
    onPenalty,
  };
}
export async function resolveRecovery(parsed, actor, access) {
  if (!parsed) return null;
  let amount = parsed.amount,
    roll = null;
  if (parsed.kind === 'roll') {
    roll = await new Roll(parsed.formula).evaluate();
    amount = Math.max(parsed.minimumOne ? 1 : 0, Math.floor(roll.total));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${parsed.effectType === 'heal-hp' ? 'Healing' : 'FP recovery'}: ${esc(parsed.display)}`,
      rolls: [roll],
      content: await roll.render(),
      ...access,
    });
  }
  return { type: parsed.effectType, amount, expression: parsed.display };
}
export const resultLabel = (result) =>
  ({
    success: 'Success',
    failure: 'Failure',
    criticalSuccess: 'Critical success',
    criticalFailure: 'Critical failure',
  })[result] || result;
export function cardHTML(cast) {
  const cost = cast.cost,
    paid = cast.payment?.rows || [];
  const buttons = [];
  if (
    cast.paid &&
    !cast.effectsBlocked &&
    cast.ongoing &&
    (!cast.attackResult || ['success', 'criticalSuccess'].includes(cast.attackResult)) &&
    ['success', 'criticalSuccess'].includes(cast.result)
  )
    buttons.push(
      cast.activeEffectId
        ? '<button type="button" data-gca-chat="resolve-targets">Resolve targets / active effects</button>'
        : '<button type="button" data-gca-chat="resolve-targets">Resolve targets / start effect</button>',
    );
  if (cast.paid && cast.effect?.amount > 0)
    buttons.push('<button type="button" data-gca-chat="apply">Apply recovery to targets</button>');
  if (
    cast.paid &&
    !cast.effectsBlocked &&
    cast.damage &&
    ['success', 'criticalSuccess'].includes(cast.result)
  )
    buttons.push(
      `<button type="button" data-gca-chat="damage">${cast.damageRolled ? 'Roll damage again' : 'Roll damage'}</button>`,
    );
  const type =
    cast.result === 'criticalSuccess'
      ? 'success'
      : cast.result === 'criticalFailure'
        ? 'failure'
        : '';
  if (type && cast.tables[type])
    buttons.push(
      `<button type="button" data-gca-chat="table" data-table-kind="${type}">Roll spell ${resultLabel(cast.result).toLowerCase()} table</button>`,
    );
  const atk =
    cast.attackResult === 'criticalSuccess'
      ? 'attackSuccess'
      : cast.attackResult === 'criticalFailure'
        ? 'attackFailure'
        : '';
  if (atk && cast.tables[atk])
    buttons.push(
      `<button type="button" data-gca-chat="table" data-table-kind="${atk}">Roll attack critical table</button>`,
    );
  return `<article class="gca-chat"><header><span>CASTING ASSISTANT</span><h3>${esc(cast.name)}</h3></header><p><strong>${esc(cast.actorName)}</strong> · ${esc(resultLabel(cast.result))}</p>
    <p>${cast.roll.total} vs ${cast.roll.target} · Margin ${cast.roll.margin}</p>
    ${cast.onPenalty ? `<p>Tracked spells on: −${cast.onPenalty}.</p>` : ''}
    ${cast.healing ? `<p>Repeated ${cast.healing.kind === 'minor' ? 'Minor' : 'Major'} Healing: ${cast.healing.count} earlier attempt(s), −${cast.healing.penalty}. Patient: ${esc(cast.recipientNames?.[0] || cast.healing.target)}.</p>` : ''}
    ${cast.physicianMitigated ? '<p>Physician 15+ changes this first-attempt critical failure to an ordinary failure (B248). The original dice are unchanged.</p>' : ''}
    <p>${pageLinks(cast.pageRef)}</p>
    <p><strong>Cost:</strong> ${cost.base} base − ${cost.reduction} reduction = ${cost.final}. <strong>Paid:</strong> ${paid.reduce((s, r) => s + r.amount, 0)}.</p>
    ${paid.length ? `<ul>${paid.map((r) => `<li>${esc(r.name)}: ${r.value} → ${r.after}${r.mode === 'tally' ? ' (tally)' : ''}</li>`).join('')}</ul>` : ''}
    ${cast.calamities?.length ? `<ul>${cast.calamities.map((c) => `<li>Threshold ${esc(c.name)}: ${c.after}/${c.cap}, +${c.modifier} → ${c.total}: ${esc(c.label)}${c.willError ? ` · ${esc(c.willError)}` : ''}${c.spellAllowed === false ? ' · Spell effects withheld' : ''}</li>`).join('')}</ul>` : ''}
    ${cast.paymentError ? `<p class="gca-error">${esc(cast.paymentError)}</p>` : ''}
    ${cast.attackResult ? `<p><strong>Attack:</strong> ${esc(resultLabel(cast.attackResult))}</p>` : ''}
    ${cast.effect ? `<p><strong>${cast.effect.type === 'heal-hp' ? 'Healing' : 'FP recovery'}:</strong> ${cast.effect.amount} · ${esc(cast.effect.expression)}</p>` : ''}
    ${cast.followupError ? `<p class="gca-error">${esc(cast.followupError)}</p>` : ''}
    ${cast.applications?.length ? `<ul>${cast.applications.map((r) => `<li>${esc(r.name)}: ${r.status === 'applied' ? `${r.key} ${r.before} → ${r.after}` : esc(r.status)}${r.status === 'applied' ? ` <button type="button" data-gca-chat="undo" data-recipient="${esc(r.actorUuid)}">GM undo</button>` : ''}</li>`).join('')}</ul>` : ''}
    <div class="gca-chat-actions">${buttons.join('')}</div></article>`;
}
export async function refreshCard(message, patch = {}) {
  const cast = { ...clone(message.getFlag(ID, 'cast')), ...patch };
  await message.update({ content: cardHTML(cast), [`flags.${ID}.cast`]: cast });
  return cast;
}
export async function cast(actor, input, token) {
  return serial(async () => {
    const ready = prepareCast(actor, input),
      { p, entry, attack, cost, plan, damage, recovery, modifier, recipients, healing, onPenalty } =
        ready;
    const operation = uid();
    if (healing)
      await requestMutation({
        kind: 'healing-reserve',
        actorUuid: actor.uuid,
        operation,
        profile: p,
        targets: recipients,
        expectedCount: healing.count,
      });
    let rolled;
    try {
      rolled = await targetedRoll(actor, entry, {
        modifier,
        includeBucket: p.includeBucket,
        token,
      });
    } catch (error) {
      if (healing)
        throw new Error(
          `${error.message} Review the pending attempt in Active effects → Healing history before retrying.`,
        );
      throw error;
    }
    let historyError = '';
    if (healing) {
      try {
        await requestMutation({ kind: 'healing-complete', actorUuid: actor.uuid, operation });
      } catch (error) {
        historyError = `Healing history needs review: ${error.message}`;
      }
    }
    const rawResult = outcome(rolled.data);
    const physicianMitigated =
      rawResult === 'criticalFailure' &&
      healing?.count === 0 &&
      p.physicianMitigation &&
      actorData(actor).abilities.some(
        (e) =>
          e.kind === 'skill' &&
          /^physician(?:\s*\/\s*tl\s*\d+)?$/i.test(e.name.trim()) &&
          e.level >= 15,
      );
    const result = physicianMitigated ? 'failure' : rawResult,
      spent = outcomeCost(p, cost, result);
    let payment = { status: 'spent', rows: [] },
      paymentError = '';
    try {
      if (spent)
        payment = await requestMutation({
          kind: 'spend',
          actorUuid: actor.uuid,
          plan: trimPlan(plan, spent),
          operation,
        });
    } catch (error) {
      paymentError = `Resources were not confirmed: ${error.message}  No follow-on effects were applied.`;
    }
    const record = {
      version: 1,
      operation,
      at: worldTime(),
      healing,
      onPenalty,
      physicianMitigated,
      recipients,
      recipientNames: recipients.map(
        (id) =>
          Array.from(game.user.targets || []).find((t) => t.actor?.uuid === id)?.actor?.name || id,
      ),
      ongoing: ongoingSnapshot(p, entry),
      actorUuid: actor.uuid,
      actorName: actor.name,
      name: p.name || entry.name,
      pageRef: entry.object?.pageref || entry.object?.reference || '',
      sourceRollId: rolled.message.id,
      result,
      cost,
      payment,
      paymentError,
      paid: !paymentError,
      roll: {
        total: rolled.data.rtotal,
        target: rolled.data.finaltarget,
        margin: rolled.data.margin,
      },
      tables: p.tables,
      thresholdStep: p.thresholdStep,
      effect: null,
      allowSelf: p.allowSelf,
      selfHealingApproved:
        !ordinaryMagic(p, entry) ||
        recovery?.effectType !== 'heal-hp' ||
        recipients.includes(actor.uuid),
      damage,
      applications: [],
      profileId: p.id || null,
    };
    if (historyError) record.followupError = historyError;
    if (!paymentError) {
      try {
        record.calamities = await resolveThresholds(
          actor,
          thresholdChecks(p, resources(actor), payment.rows),
          rolled.visibility,
        );
        record.effectsBlocked =
          !!historyError || record.calamities.some((c) => c.spellAllowed === false);
      } catch (error) {
        record.effectsBlocked = true;
        record.followupError = `Calamity check needs manual resolution: ${error.message}`;
      }
    }
    if (
      !paymentError &&
      !record.effectsBlocked &&
      (!record.attackResult || ['success', 'criticalSuccess'].includes(record.attackResult)) &&
      ['success', 'criticalSuccess'].includes(result)
    ) {
      try {
        let attackSucceeded = true;
        if (p.rollAttack) {
          const same =
            entry.kind === 'skill' && attack.kind === 'skill' && entry.key === attack.key;
          const attacked = same
            ? rolled
            : await targetedRoll(actor, attack, {
                includeBucket: p.includeBucket,
                token,
                access: rolled.visibility,
              });
          record.attackResult = outcome(attacked.data);
          attackSucceeded = ['success', 'criticalSuccess'].includes(record.attackResult);
        }
        if (p.rollDamage && attackSucceeded) {
          await rollDamage(actor, damage, rolled.visibility);
          record.damageRolled = true;
        }
        if (!attackSucceeded) record.damage = '';
        record.effect = await resolveRecovery(recovery, actor, rolled.visibility);
      } catch (error) {
        record.followupError = error.message;
      }
    }
    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor, token: token?.document || token }),
      ...rolled.visibility,
      content: cardHTML(record),
      flags: { [ID]: { cast: record } },
    });
    if (
      record.ongoing?.config.autoStart &&
      record.paid &&
      !record.effectsBlocked &&
      (!record.attackResult || ['success', 'criticalSuccess'].includes(record.attackResult)) &&
      ['success', 'criticalSuccess'].includes(result) &&
      !rolled.visibility.blind
    ) {
      try {
        const started = await requestMutation({ kind: 'effect-start', cardId: message.id });
        record.activeEffectId = started.effectId;
        await refreshCard(message, { activeEffectId: started.effectId });
      } catch (error) {
        await refreshCard(message, {
          followupError: `Ongoing effect needs review: ${error.message}`,
        });
      }
    }
    if (p.autoApply && record.paid && record.effect?.amount > 0) {
      try {
        const applied = await requestMutation({
          kind: 'heal',
          cardId: message.id,
          targets: recipients,
        });
        if (applied.results) await refreshCard(message, { applications: applied.results });
        else if (applied.status === 'pending')
          ui.notifications.info('Recovery is awaiting GM approval.');
      } catch (error) {
        await refreshCard(message, { followupError: error.message });
      }
    }
    return { message, record };
  });
}
