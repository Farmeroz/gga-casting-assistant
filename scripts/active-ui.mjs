import { CastingWindow } from './application.mjs';
import { ID, clone, esc, own, resources } from './core.mjs';
import {
  trackingState,
  effectState,
  worldTime,
  timeText,
  spellsOn,
  healingDayStart,
} from './tracking-model.mjs';
import { requestMutation } from './mutations.mjs';
import { openPage } from './references.mjs';
import * as log from './log.mjs';

const button = (action, text, extra = '') =>
  `<button type="button" data-active="${action}" ${extra}>${text}</button>`;
const option = (value, label, current) =>
  `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
const confirm = (title, content) =>
  foundry.applications.api.DialogV2.confirm({ window: { title }, content, rejectClose: false });
export class ActiveEffectsWindow extends CastingWindow {
  static DEFAULT_OPTIONS = {
    id: 'gga-active-effects',
    tag: 'section',
    classes: ['gca-window', 'gca-active-window'],
    window: {
      title: 'Active spells & effects',
      icon: 'fa-solid fa-hourglass-half',
      resizable: true,
    },
    position: { width: 840, height: 700 },
  };
  constructor(actor) {
    super({
      position: {
        width: Math.min(840, window.innerWidth - 30),
        height: Math.min(700, window.innerHeight - 50),
      },
    });
    this.actor = actor;
    this.busy = false;
    this.payments = new Map();
    this.status = '';
    this.advanceSeconds = '60';
  }
  paymentRows(e) {
    if (!this.payments.has(e.id)) this.payments.set(e.id, clone(e.profile?.rows || []));
    return this.payments.get(e.id);
  }
  paymentHTML(e) {
    const sources = resources(this.actor);
    return `<details class="gca-effect-options"><summary>Payment resources</summary><p>Review the allocation for this action. Use <strong>auto</strong> on one row for the remainder.</p>${this.paymentRows(
      e,
    )
      .map(
        (r, i) =>
          `<div class="gca-active-payment"><label>Resource<select data-payment="${i}" data-part="source">${option('', 'Choose resource', r.path)}${sources.map((s) => option(s.path, `${s.name} · ${s.value}`, r.path)).join('')}</select></label><label>Amount<input data-payment="${i}" data-part="amount" value="${esc(r.amount)}" placeholder="auto"></label><label>Direction<select data-payment="${i}" data-part="mode">${option('pool', 'Spend down', r.mode)}${option('tally', 'Build tally', r.mode)}</select></label>${button('remove-payment', 'Remove', `data-index="${i}"`)}</div>`,
      )
      .join('')}${button('add-payment', '+ Resource')}</details>`;
  }
  effectHTML(e) {
    const state = effectState(e),
      remaining =
        e.endsAt === null
          ? 'No automatic expiry'
          : state === 'due'
            ? 'Maintenance due'
            : `${timeText(e.endsAt - worldTime())} remaining`;
    const overdue = state === 'due' ? Math.floor((worldTime() - e.endsAt) / e.period) + 1 : 0;
    return `<article class="gca-active-card ${state === 'due' || state === 'review' ? 'is-due' : ''}" data-effect-id="${esc(e.id)}"><header><h3>${esc(e.name)}</h3><strong>${esc(state === 'review' ? 'Needs GM review' : remaining)}</strong></header><p>${esc(e.recipientNames?.join(', ') || 'No recipient recorded')} · ${e.penalty === 'concentrating' ? 'Concentrating: −3' : e.penalty === 'on' ? 'Spell on: −1' : 'No spells-on penalty'}</p>${e.summary ? `<p class="gca-active-summary">${esc(e.summary)}</p>` : ''}${e.maintainable ? `<p>Maintenance: <strong>${e.maintenanceCost} energy</strong> per ${timeText(e.period)}.</p>` : ''}${overdue > 1 ? `<p class="gca-error">${overdue} unpaid intervals. Resolve each interval in order, or let the spell expire at its first unpaid boundary.</p>` : ''}${e.review ? `<p class="gca-error">${esc(e.review)}. Payment and the interval are already recorded; do not pay again.</p>` : ''}<div class="gca-active-actions">${state === 'due' ? button('maintain', `Maintain · ${e.maintenanceCost} energy`, 'class="gca-primary"') + button('expire', 'Let expire') : ''}${e.penalty !== 'none' ? button('concentration', e.penalty === 'concentrating' ? 'Stop concentrating' : 'Concentrate') : ''}${button('cancel', e.ordinary ? 'Cancel early · 1 energy' : 'End effect')}${button('external', 'Ended externally')}${e.review && game.user.isGM ? button('reviewed', 'GM: review resolved') : ''}</div>${this.paymentHTML(e)}</article>`;
  }
  async _renderHTML() {
    const state = trackingState(this.actor),
      at = worldTime();
    const active = state.effects.filter((e) =>
      ['active', 'due', 'review'].includes(effectState(e, at)),
    );
    active.sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
    const actors = [
      ...new Map(
        [
          this.actor,
          ...Array.from(game.actors || []).filter((a) => a.testUserPermission(game.user, 'OWNER')),
        ].map((a) => [a.uuid, a]),
      ).values(),
    ];
    const history = state.healing.filter(
      (h) =>
        h.status === 'pending' ||
        (h.at >= Math.max(healingDayStart(at), state.resetAt ?? -Infinity) &&
          h.at <= at &&
          h.status !== 'discarded'),
    );
    const root = document.createElement('div');
    root.className = 'gca-root gca-active-root';
    root.innerHTML = `<header class="gca-active-header"><div><h2>Active spells & effects</h2><p>${active.length} tracked · ${active.filter((e) => effectState(e) === 'due').length} due · Spells on: −${spellsOn(this.actor)}</p></div><label>Character<select data-active-actor>${actors.map((a) => option(a.uuid, a.name, this.actor.uuid)).join('')}</select></label></header><div class="gca-active-toolbar">${button('casting', 'Casting Assistant')}${button('refresh', 'Refresh')}${
      game.user.isGM
        ? `<label>Advance game time<select data-advance-seconds>${[
            ['1', '1 second'],
            ['60', '1 minute'],
            ['600', '10 minutes'],
            ['3600', '1 hour'],
          ]
            .map(([v, l]) => option(v, l, this.advanceSeconds))
            .join('')}</select></label>${button('advance', 'Advance time')}`
        : ''
    }</div><p class="gca-hint">Uses game time, including time advanced by combat or your calendar. Resolve resistance and apply the described effect in play. ${button('rules', 'Rules · B237–238')}</p><p role="status">${esc(this.status)}</p><main class="gca-active-list">${active.map((e) => this.effectHTML(e)).join('') || '<div class="gca-empty">No active effects. Enable duration tracking in a casting profile, then cast it or choose Track existing effect.</div>'}</main><details class="gca-active-history"><summary>Healing history · ${history.length} current / unresolved attempt(s)</summary><p>Minor and Major Healing count separately for this caster and each patient. Failures count; undoing HP recovery does not erase the attempt. ${button('healing-rules', 'Rules · B248')}</p>${history.map((h) => `<div class="gca-healing-entry"><span>${esc(h.targetName || h.target)} · ${h.kind === 'minor' ? 'Minor' : 'Major'} Healing · −${h.penalty} on this attempt · ${h.status === 'pending' ? 'Needs review' : 'Counted'}</span>${h.status === 'pending' ? button('count-attempt', 'Confirm roll happened', `data-operation="${esc(h.id)}"`) + (game.user.isGM ? button('discard-attempt', 'GM: no roll happened', `data-operation="${esc(h.id)}"`) : '') : ''}</div>`).join('') || '<p>No tracked healing attempts this day.</p>'}${game.user.isGM ? button('reset-healing', 'GM: reset healing day') + button('clear-history', 'Clear older history') : ''}</details>`;
    if (this.busy)
      root.querySelectorAll('button,input,select').forEach((e) => {
        e.disabled = true;
      });
    return root;
  }
  _replaceHTML(root, content) {
    const focus = content.contains(content.ownerDocument.activeElement)
      ? content.ownerDocument.activeElement
      : null;
    const focusedEffect = focus?.closest('[data-effect-id]')?.dataset.effectId;
    const focusedIndex = focus?.dataset.payment,
      focusedPart = focus?.dataset.part;
    const scroll = content.scrollTop,
      historyOpen = content.querySelector('.gca-active-history')?.open;
    const paymentOpen = [...content.querySelectorAll('[data-effect-id] details[open]')].map(
      (d) => d.closest('[data-effect-id]').dataset.effectId,
    );
    content.replaceChildren(root);
    content.scrollTop = scroll;
    if (historyOpen) root.querySelector('.gca-active-history').open = true;
    for (const card of root.querySelectorAll('[data-effect-id]'))
      if (paymentOpen.includes(card.dataset.effectId)) card.querySelector('details').open = true;
    if (focusedEffect && focusedIndex !== undefined) {
      const card = [...root.querySelectorAll('[data-effect-id]')].find(
        (c) => c.dataset.effectId === focusedEffect,
      );
      card
        ?.querySelector(`[data-payment="${focusedIndex}"][data-part="${focusedPart}"]`)
        ?.focus({ preventScroll: true });
    }
    root.addEventListener('click', (e) => this.click(e).catch((error) => this.error(error)));
    root.addEventListener('change', (e) => this.change(e).catch((error) => this.error(error)));
    root.addEventListener('input', (e) => {
      if (e.target.matches('input[data-payment]'))
        this.change(e).catch((error) => this.error(error));
    });
  }
  error(error) {
    this.status = error.message;
    ui.notifications.error(error.message);
    log.error(error);
    this.renderQuiet();
  }
  async change(event) {
    if (this.busy) return;
    const el = event.target;
    if (el.hasAttribute('data-advance-seconds')) {
      this.advanceSeconds = el.value;
      return;
    }
    if (el.hasAttribute('data-active-actor')) {
      const actor = await fromUuid(el.value);
      own(actor);
      this.actor = actor;
      this.payments.clear();
      await this.renderQuiet();
    } else if (el.hasAttribute('data-payment')) {
      const id = el.closest('[data-effect-id]').dataset.effectId;
      const row = this.payments.get(id)[Number(el.dataset.payment)];
      if (el.dataset.part === 'source') {
        const s = resources(this.actor).find((r) => r.path === el.value);
        Object.assign(row, { path: s?.path || '', name: s?.name || '', mode: s?.mode || 'pool' });
        await this.renderQuiet();
      } else row[el.dataset.part] = el.value;
    }
  }
  async click(event) {
    const el = event.target.closest('[data-active]');
    if (!el || this.busy) return;
    event.preventDefault();
    event.stopPropagation();
    const action = el.dataset.active,
      id = el.closest('[data-effect-id]')?.dataset.effectId;
    const effect = trackingState(this.actor).effects.find((e) => e.id === id);
    if (action === 'rules' || action === 'healing-rules')
      return openPage(action === 'rules' ? 'B237' : 'B248');
    if (action === 'casting') return game.modules.get(ID).api.open(this.actor.uuid);
    if (action === 'add-payment' || action === 'remove-payment') {
      const rows = this.paymentRows(effect);
      if (action === 'add-payment') {
        if (rows.length >= 16) throw new Error('Use up to 16 payment rows.');
        rows.push({ name: '', path: '', mode: 'pool', amount: 0 });
      } else rows.splice(Number(el.dataset.index), 1);
      return this.renderQuiet();
    }
    this.busy = true;
    try {
      if (action === 'refresh') return;
      if (action === 'advance') {
        if (!game.user.isGM) throw new Error('Only a GM can advance game time.');
        const seconds = Number(this.element.querySelector('[data-advance-seconds]').value);
        if (
          await confirm(
            'Advance game time',
            `<p>Advance the whole world by ${timeText(seconds)}? Other modules using game time will also advance.</p>`,
          )
        )
          await game.time.advance(seconds);
        return;
      }
      let request = { actorUuid: this.actor.uuid };
      if (['reset-healing', 'clear-history', 'count-attempt', 'discard-attempt'].includes(action)) {
        const text =
          action === 'clear-history'
            ? 'Clear older healing history and compact ended effects? Current attempts and active effects remain.'
            : action === 'reset-healing'
              ? 'Reset repeated-healing counts for this caster? This does not restore HP or FP.'
              : action === 'count-attempt'
                ? 'Confirm that this healing roll happened? It will count whether it succeeded or failed.'
                : 'Discard this attempt only if no healing roll happened. If a roll happened, confirm it instead.';
        if (!(await confirm('Review healing history', `<p>${text}</p>`))) return;
        request = {
          ...request,
          kind: {
            'clear-history': 'tracking-clear',
            'reset-healing': 'healing-reset',
            'count-attempt': 'healing-complete',
            'discard-attempt': 'healing-discard',
          }[action],
          operation: el.dataset.operation,
        };
      } else {
        if (!effect) throw new Error('This effect is no longer available.');
        request = {
          ...request,
          effectId: id,
          revision: effect.revision,
          rows: clone(this.paymentRows(effect)),
        };
        if (action === 'maintain') {
          if (
            !(await confirm(
              'Maintain spell',
              `<p>Pay <strong>${effect.maintenanceCost} energy</strong> for the next ${timeText(effect.period)} of <strong>${esc(effect.name)}</strong>?</p><p>Confirm that the caster is awake and able to maintain it. The interval starts at its previous expiry, including when resolving a time jump.</p>`,
            ))
          )
            return;
          request = { ...request, kind: 'effect-maintain', awake: true };
        } else if (['expire', 'cancel', 'external'].includes(action)) {
          const cost = action === 'cancel' && effect.ordinary ? 1 : 0;
          const text =
            action === 'expire'
              ? 'Let this spell end at its unpaid maintenance boundary?'
              : action === 'external'
                ? 'Record that the effect already ended in play (for example, dispelled)? This applies no cancellation cost.'
                : `End this effect now${cost ? ' and pay 1 energy (B237)' : ''}?`;
          if (
            !(await confirm('End effect', `<p><strong>${esc(effect.name)}</strong>: ${text}</p>`))
          )
            return;
          request = { ...request, kind: 'effect-end', reason: action };
        } else if (action === 'concentration') request.kind = 'effect-concentration';
        else if (action === 'reviewed') {
          if (
            !(await confirm(
              'Resolve maintenance review',
              '<p>Confirm the GM has resolved the calamity and this effect continues. If the effect ended, use Ended externally.</p>',
            ))
          )
            return;
          request.kind = 'effect-reviewed';
        } else return;
      }
      const result = await requestMutation(request);
      this.status = result.error || 'Tracking updated.';
    } finally {
      this.busy = false;
      await this.renderQuiet();
    }
  }
  refreshActor(actor) {
    if (this.rendered && !this.busy && actor?.uuid === this.actor.uuid) this.renderQuiet();
  }
  async close(options) {
    if (this.busy) {
      ui.notifications.warn('Wait for this update to finish.');
      return this;
    }
    return super.close(options);
  }
}
