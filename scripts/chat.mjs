import * as log from './log.mjs';
import { ID, clone, own } from './core.mjs';
import { requestMutation, approveRecovery } from './mutations.mjs';
import { selectedRecipients, refreshCard } from './workflow.mjs';
import { rollDamage, visibility } from './rolls.mjs';
import { openPage } from './references.mjs';

export function wireChat(message, html) {
  const root = html?.[0] || html;
  if (!root?.querySelectorAll) return;
  const author = message.author?.id || message.user?.id || message.user;
  const allowed = game.user.isGM || author === game.user.id;
  for (const button of root.querySelectorAll(
    '[data-gca-chat],[data-page-ref],[data-gca-approve]',
  )) {
    if (button.dataset.gcaBound) continue;
    button.dataset.gcaBound = 'true';
    if (
      (button.dataset.gcaChat && !allowed) ||
      ((button.dataset.gcaChat === 'undo' || button.dataset.gcaApprove) && !game.user.isGM)
    ) {
      button.hidden = true;
      continue;
    }
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (button.dataset.pageRef) {
          await openPage(button.dataset.pageRef);
          return;
        }
        if (button.dataset.gcaApprove) {
          const result = await approveRecovery(message),
            card = game.messages.get(message.getFlag(ID, 'request').cardId);
          if (card) await mergeApplications(card, result.results);
          return;
        }
        const cast = clone(message.getFlag(ID, 'cast'));
        if (!cast) throw new Error('The casting record is missing.');
        const actor = await fromUuid(cast.actorUuid);
        own(actor);
        switch (button.dataset.gcaChat) {
          case 'start-effect': {
            const result = await requestMutation({ kind: 'effect-start', cardId: message.id });
            await refreshCard(message, { activeEffectId: result.effectId });
            await game.modules.get(ID).api.activeEffects(actor.uuid);
            break;
          }
          case 'active-effects':
            await game.modules.get(ID).api.activeEffects(actor.uuid);
            break;
          case 'apply': {
            const targets = selectedRecipients();
            if (!targets.length)
              throw new Error('Target the recovery recipient token or tokens first.');
            const result = await requestMutation({ kind: 'heal', cardId: message.id, targets });
            if (result.results) await mergeApplications(message, result.results);
            else if (result.status === 'pending')
              ui.notifications.info('Recovery is awaiting GM approval.');
            break;
          }
          case 'undo': {
            await requestMutation({
              kind: 'undo',
              cardId: message.id,
              target: button.dataset.recipient,
            });
            await refreshCard(message, {
              applications: (cast.applications || []).map((r) =>
                r.actorUuid === button.dataset.recipient ? { ...r, status: 'undone' } : r,
              ),
            });
            break;
          }
          case 'damage':
            if (cast.effectsBlocked)
              throw new Error('Resolve the calamity before applying spell effects.');
            if (!cast.paid || !cast.damage)
              throw new Error('This cast has no available damage follow-on.');
            await rollDamage(actor, cast.damage, visibility(message));
            await refreshCard(message, { damageRolled: true });
            break;
          case 'table': {
            const key = button.dataset.tableKind,
              uuid = cast.tables?.[key];
            const table = uuid ? await fromUuid(uuid) : null;
            if (table?.documentName !== 'RollTable')
              throw new Error('The selected table is unavailable.');
            if (!table.testUserPermission(game.user, 'OBSERVER'))
              throw new Error('You do not have access to this table.');
            const over = Math.max(
              0,
              ...(cast.payment?.rows || [])
                .filter((r) => r.mode === 'tally' && Number.isFinite(r.max))
                .map((r) => r.after - r.max),
            );
            const modifier = key === 'threshold' ? Math.floor(over / (cast.thresholdStep || 5)) : 0;
            const roll = await new Roll(`(${table.formula}) + ${modifier}`).evaluate();
            const drawn = await table.draw({ roll, displayChat: false });
            // Preserve the original card's exact audience instead of using
            // the current global chat mode when resolving an old card.
            await table.toMessage(drawn.results, {
              messageData: { speaker: ChatMessage.getSpeaker({ actor }), ...visibility(message) },
              roll: drawn.roll,
            });
            break;
          }
        }
      } catch (error) {
        ui.notifications.error(error.message);
        log.error(error);
      } finally {
        button.disabled = false;
      }
    });
  }
}
async function mergeApplications(card, results) {
  const all = new Map((card.getFlag(ID, 'cast').applications || []).map((r) => [r.actorUuid, r]));
  for (const r of results) if (r.status !== 'already-applied') all.set(r.actorUuid, r);
  await refreshCard(card, { applications: [...all.values()] });
}
