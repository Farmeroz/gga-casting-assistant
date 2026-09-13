import {
  ID,
  clone,
  esc,
  uid,
  own,
  actorData,
  resources,
  reference,
  resolveReference,
  standardDefaults,
  costFor,
  spendPlan,
  cleanProfile,
  cleanTags,
} from './core.mjs';
import {
  profiles,
  saveProfile,
  deleteProfile,
  exportProfiles,
  importProfiles,
  shortcut,
  missingReferences,
} from './profiles.mjs';
import { parseProfileText, recoveryCommandFromSpell } from './parser.mjs';
import { pageLinks, openPage } from './references.mjs';
import { prepareCast, cast } from './workflow.mjs';
import { CastingWindow, openCharacterSheet } from './application.mjs';
import { EFFECT_LABELS, effectLayout, effectSummary, suggestAttack } from './effects.mjs';

const App = CastingWindow;
const option = (value, label, current) =>
  `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`;
const button = (action, label, extra = '') =>
  `<button type="button" data-gca="${action}" ${extra}>${label}</button>`;
const input = (key, label, value, type = 'text', extra = '') =>
  `<label>${label}<input data-field="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const check = (key, label, value) =>
  `<label class="gca-check"><input data-field="${key}" type="checkbox"${value ? ' checked' : ''}>${label}</label>`;
const select = (key, label, options, current) =>
  `<label>${label}<select data-field="${key}">${options.map(([v, l]) => option(v, l, current)).join('')}</select></label>`;
const policies = [
  ['none', 'No cost'],
  ['one', 'One point'],
  ['full', 'Full calculated cost'],
];
export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function confirm(title, content) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content,
    rejectClose: false,
  });
}
export class CastingAssistant extends App {
  static DEFAULT_OPTIONS = {
    id: 'gga-casting-assistant',
    tag: 'section',
    classes: ['gca-window'],
    window: { title: 'Casting Assistant', icon: 'fa-solid fa-book-open', resizable: true },
    position: { width: 1100, height: 780 },
  };
  constructor(actor, profileId = null) {
    const prefs = clone(game.user.getFlag(ID, 'preferences') || {});
    const size = prefs.position || {};
    super({
      position: {
        width: Math.max(560, Math.min(size.width || 1100, window.innerWidth - 30)),
        height: Math.max(400, Math.min(size.height || 780, window.innerHeight - 50)),
      },
    });
    this.prefs = {
      search: '',
      sort: 'name',
      view: 'abilities',
      kind: 'all',
      browserOpen: false,
      open: { cost: true },
      ...prefs,
    };
    this.actor = actor;
    this.busy = false;
    this.status = 'Choose a spell or saved profile.';
    this.dirty = false;
    this._saveQueue = Promise.resolve();
    this.loadInitial(profileId);
  }
  loadInitial(profileId) {
    const data = actorData(this.actor),
      saved = profiles(this.actor);
    const chosen = saved.find((p) => p.id === profileId);
    this.draft = chosen
      ? clone(chosen)
      : standardDefaults(
          data.abilities.find((e) => e.key === this.prefs.lastAbility) || data.abilities[0],
        );
    if (!this.draft.id) this.draft.id = uid();
    if (!chosen) this.sheetRecovery();
    this.editBuild = false;
    this.revealEffect();
    this.dirty = false;
  }
  revealEffect() {
    const data = actorData(this.actor),
      layout = effectLayout(this.draft, resolveReference(this.draft.ability, data.abilities), data);
    this.prefs.open.cost = true;
    if (layout.damage) this.prefs.open.delivery = true;
    if (layout.healing) this.prefs.open.recovery = true;
  }
  sheetRecovery() {
    const entry = resolveReference(this.draft.ability, actorData(this.actor).abilities),
      command = recoveryCommandFromSpell(entry);
    if (command) {
      this.draft.effectAmount = command;
      this.draft.effectType = /^\/fp/i.test(command) ? 'restore-fp' : 'heal-hp';
    }
    suggestAttack(this.draft, entry, actorData(this.actor));
  }
  loadSetup(setup) {
    if (setup.newBuild) {
      this.draft = {
        ...standardDefaults(null),
        id: uid(),
        name: 'New RPM build',
        rules: 'rpm',
        baseCost: 0,
      };
      this.prefs.open = { ...this.prefs.open, parser: true, cost: true };
      this.status = 'Paste and parse your build, then choose its casting skill and save.';
    } else if (setup.ability) {
      const entry = resolveReference(setup.ability, actorData(this.actor).abilities);
      if (!entry) throw new Error('This spell or skill is no longer on the character sheet.');
      this.draft = { ...standardDefaults(entry), id: uid() };
      this.sheetRecovery();
      this.prefs.lastAbility = entry.key;
      this.status = 'Loaded from your Grimoire.  Review the setup before casting.';
    }
    this.editBuild = !!setup.newBuild;
    this.revealEffect();
    this.dirty = false;
  }
  async savePrefs() {
    const value = clone(this.prefs);
    this._saveQueue = this._saveQueue
      .catch(() => {})
      .then(() => game.user.setFlag(ID, 'preferences', value));
    await this._saveQueue;
  }
  async close(options) {
    if (this.busy) {
      ui.notifications.warn('Wait for this cast to finish.');
      return this;
    }
    this.prefs.position = { width: this.position.width, height: this.position.height };
    await this.savePrefs();
    this._resizeObserver?.disconnect();
    clearTimeout(this._refreshTimer);
    clearTimeout(this._sizeSave);
    return super.close(options);
  }
  get token() {
    return (
      this.actor.token?.object ||
      canvas.tokens?.controlled?.find((t) => t.actor?.uuid === this.actor.uuid) ||
      this.actor.getActiveTokens?.()[0] ||
      null
    );
  }
  panel(key, title, body, summary = '', openDefault = false) {
    return `<details class="gca-panel" data-panel="${key}"${(this.prefs.open[key] ?? openDefault) ? ' open' : ''}><summary><strong>${title}</strong><span>${esc(summary)}</span></summary><div class="gca-panel-body" data-resize="${key}"${this.prefs.heights?.[key] ? ` style="height:${this.prefs.heights[key]}px"` : ''}>${body}</div></details>`;
  }
  async _renderHTML() {
    const root = document.createElement('div');
    root.className = 'gca-root gca-casting-root';
    const p = this.draft,
      data = actorData(this.actor),
      entry = resolveReference(p.ability, data.abilities),
      available = resources(this.actor);
    const layout = effectLayout(p, entry, data);
    const q = this.prefs.search.toLowerCase(),
      saved = profiles(this.actor),
      showSaved = this.prefs.view === 'profiles';
    let items = showSaved
      ? saved
      : data.abilities.filter((e) => this.prefs.kind === 'all' || e.kind === this.prefs.kind);
    items = items.filter((e) =>
      `${e.name} ${e.object?.college || ''} ${e.object?.class || ''} ${e.notes || ''}`
        .toLowerCase()
        .includes(q),
    );
    items.sort((a, b) =>
      this.prefs.sort === 'level'
        ? Number(b.level || 0) - Number(a.level || 0) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
    const actors = [
      ...new Map(
        [
          this.actor,
          ...Array.from(game.actors || []).filter((a) => a.testUserPermission(game.user, 'OWNER')),
        ].map((a) => [a.uuid, a]),
      ).values(),
    ];
    let preview = '';
    try {
      const cost = costFor(p, entry || { level: 0 });
      preview = `${cost.base} base − ${cost.reduction} reduction = ${cost.final} energy`;
      spendPlan(p, available, cost.final);
    } catch (e) {
      preview = e.message;
    }
    const rows = p.rows
      .map(
        (r, i) =>
          `<div class="gca-resource-row"><label class="gca-sr" for="gca-source-${i}">Resource ${i + 1}</label><select id="gca-source-${i}" data-source="${i}">${option('', 'Choose resource', r.path)}${available.map((s) => option(s.path, `${s.name} · ${s.value}${Number.isFinite(s.max) ? ` / ${s.max}` : ''}`, r.path)).join('')}</select><label><span class="gca-sr">Amount</span><input aria-label="Resource ${i + 1} amount" data-field="rows.${i}.amount" value="${esc(r.amount)}" placeholder="auto"></label><select aria-label="Resource ${i + 1} direction" data-field="rows.${i}.mode">${option('pool', 'Spend down', r.mode)}${option('tally', 'Build tally', r.mode)}</select>${button('remove-row', '<i class="fa-solid fa-xmark"></i>', `data-index="${i}" title="Remove resource row" aria-label="Remove resource row ${i + 1}"`)}</div>`,
      )
      .join('');
    const costBody = `<div class="gca-fields">${input('baseCost', 'Base cost / energy', p.baseCost, 'number', 'min="0" step="1"')}${input('modifier', 'Casting adjustment', p.modifier, 'number', 'step="1"')}</div>${check('includeBucket', 'Include my Modifier Bucket', p.includeBucket)}
      <div class="gca-section-heading"><strong>Pay with</strong>${button('add-row', '+ Resource')}</div>${rows}<p class="gca-hint"><strong>auto</strong> pays the remaining cost from that resource.</p>`;
    const rulesBody = `<div class="gca-fields">${select(
      'rules',
      'Casting rules',
      [
        ['standard', 'Standard spells'],
        ['power', 'Power'],
        ['rpm', 'RPM profile'],
        ['threshold', 'Threshold profile'],
      ],
      p.rules,
    )}</div><div class="gca-checks">${check('applyReduction', 'High-skill cost reduction', p.applyReduction)}${check('critFree', 'Critical success costs no energy', p.critFree)}</div><div class="gca-fields">${select('failurePolicy', 'Failure cost', policies, p.failurePolicy)}${select('criticalFailurePolicy', 'Critical failure cost', policies, p.criticalFailurePolicy)}</div>`;
    const attackOptions = [
      ['', 'No linked attack'],
      ...data.attacks.map((e) => [
        e.key,
        `${e.name}${e.object.mode ? ` (${e.object.mode})` : ''} · ${e.kind}`,
      ]),
    ];
    const delivery = `${select('attackKey', 'Linked attack', attackOptions, resolveReference(p.attack, data.attacks)?.key || '')}${input('damageFormula', 'Damage formula', p.damageFormula, 'text', 'placeholder="Use linked attack, or enter e.g. 3d+2 burn"')}<div class="gca-checks">${check('rollAttack', 'Roll linked attack after casting', p.rollAttack)}${check('rollDamage', 'Roll damage after success', p.rollDamage)}</div><details class="gca-effect-options"><summary>Damage options</summary>${check('scaleDamage', 'Multiply damage by base energy', p.scaleDamage)}<p class="gca-hint">Enable only for a formula expressed per energy point.</p></details>`;
    const targets = [
      ...new Set(
        Array.from(game.user.targets || [])
          .map((t) => t.name || t.actor?.name)
          .filter(Boolean),
      ),
    ];
    const recovery = `<div class="gca-fields">${select(
      'effectType',
      'Restore',
      [
        ['none', 'Choose recovery'],
        ['heal-hp', 'Hit Points (HP)'],
        ['restore-fp', 'Fatigue Points (FP)'],
      ],
      p.effectType,
    )}${input('effectAmount', 'Amount or dice formula', p.effectAmount, 'text', 'placeholder="e.g. 4 or 1d-3!"')}</div><div class="gca-targets"><strong>Targets</strong><span>${esc(targets.join(', ') || 'No tokens targeted')}</span></div><div class="gca-checks">${check('autoApply', 'Apply to current targets after success', p.autoApply)}</div><p class="gca-hint">Otherwise, use the recovery button on the casting card.</p><details class="gca-effect-options"><summary>Recovery options</summary>${check('allowSelf', 'Allow the caster as a recipient', p.allowSelf)}<p class="gca-hint"><strong>auto:1</strong> restores base energy; <strong>auto:2</strong> restores twice base energy.  /hp and /fp formulas are also accepted.</p></details>`;
    const tables = Array.from(game.tables || []).sort((a, b) => a.name.localeCompare(b.name));
    const tableBody = `<div class="gca-fields">${[
      ['success', 'Spell critical success'],
      ['failure', 'Spell critical failure'],
      ['attackSuccess', 'Attack critical success'],
      ['attackFailure', 'Attack critical failure'],
      ['threshold', 'Threshold / calamity'],
    ]
      .filter(([k]) => !k.startsWith('attack') || layout.damage || p.tables[k])
      .filter(
        ([k]) =>
          k !== 'threshold' ||
          p.rules === 'threshold' ||
          p.rows.some((r) => r.mode === 'tally') ||
          p.tables[k],
      )
      .map(([k, l]) =>
        select(
          `tables.${k}`,
          l,
          [['', 'None'], ...tables.map((t) => [t.uuid, t.name])],
          p.tables[k],
        ),
      )
      .join(
        '',
      )}${p.rules === 'threshold' || p.rows.some((r) => r.mode === 'tally') || p.tables.threshold ? input('thresholdStep', 'Tally overage per +1 table modifier', p.thresholdStep, 'number', 'min="1"') : ''}</div><p class="gca-hint">Choose your world’s tables and its threshold progression.  Table buttons appear when relevant.</p>`;
    const parsed = p.parsed;
    const parser = `<label>RPM or power build<textarea data-field="parserText" rows="6" placeholder="Paste the build to parse its name, cost, damage, and recovery…">${esc(p.parserText)}</textarea></label><div class="gca-inline">${button('parse', 'Parse build')}${button('clear-parser', 'Clear text')}</div>${parsed ? `<div class="gca-parser-summary"><strong>${esc(parsed.title)}</strong><p>${parsed.energy ?? 'No'} energy detected · ${esc(parsed.damageFormula || 'No damage detected')} · ${parsed.greaterEffects?.length || 0} Greater effects</p><p>Check the values above, choose the casting skill, then save the profile.</p></div>` : ''}`;
    const notes = `${input('notes', 'Your notes', p.notes)}${input('tagsText', 'Tags (comma separated)', (p.tags || []).join(', '), 'text', 'placeholder="Healing, combat, utility"')}`;
    const combined =
      layout.kind === 'mixed'
        ? '<p class="gca-hint">This setup uses both effects.  Choose Damage or Healing above to use only one.</p>'
        : layout.kind !== 'other'
          ? `<div class="gca-combined">${check('combineEffects', 'Use both damage and recovery controls', p.combineEffects || (layout.inferred.kind === 'mixed' && (!p.effectCategory || p.effectCategory === 'auto')))}<p class="gca-hint">For a setup that needs both effects.</p></div>`
          : '';
    const advanced =
      combined +
      this.panel('rules', 'Casting rules', rulesBody, p.rules, true) +
      this.panel('tables', 'Critical & threshold tables', tableBody, 'Optional');
    root.innerHTML = `<header class="gca-top"><div><div class="gca-kicker">GURPS 4e · SPELLS & POWERS</div><h2>Casting Assistant</h2></div><div class="gca-top-tools">${button('grimoire', 'Grimoire', 'title="Browse your Grimoire in a separate window"')}<label class="gca-sr" for="gca-actor">Caster</label><select id="gca-actor" data-actor>${actors.map((a) => option(a.uuid, a.name, this.actor.uuid)).join('')}</select>${button('sheet', '<i class="fa-solid fa-user"></i>', 'title="Open character sheet"')}${button('reset-layout', '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>', 'title="Reset panel sizes"')}</div></header>
      <div class="gca-workspace ${this.prefs.browserOpen ? '' : 'is-focused'}"><aside class="gca-sidebar"><nav class="gca-tabs" aria-label="Browse">${button('abilities', 'Spells & skills', `aria-pressed="${!showSaved}"`)}${button('profiles', `Saved <span>${saved.length}</span>`, `aria-pressed="${showSaved}"`)}</nav><label class="gca-search"><span class="gca-sr">Search</span><input data-search value="${esc(this.prefs.search)}" placeholder="Search name, college, class…" type="search"></label><div class="gca-browser-tools"><select aria-label="Sort" data-sort>${option('name', 'Name A–Z', this.prefs.sort)}${option('level', 'Highest skill', this.prefs.sort)}</select>${!showSaved ? `<select aria-label="Ability type" data-kind>${option('all', 'Spells & skills', this.prefs.kind)}${option('spell', 'Spells', this.prefs.kind)}${option('skill', 'Skills / powers', this.prefs.kind)}</select>` : ''}</div>
      <div class="gca-list" role="list" aria-label="${showSaved ? 'Saved profiles' : 'Spells and skills'}">${items.map((e) => `<button type="button" role="listitem" data-gca="${showSaved ? 'load-profile' : 'choose-ability'}" data-key="${esc(showSaved ? e.id : e.key)}" class="gca-list-item${(showSaved ? e.id === p.id : e.key === entry?.key) ? ' selected' : ''}"><span><strong>${esc(e.name)}</strong><small>${esc(showSaved ? `${e.rules.toUpperCase()} · ${e.ability?.name || 'Choose casting skill'}` : [e.object?.college || e.kind, e.object?.class].filter(Boolean).join(' · '))}</small></span>${!showSaved ? `<b>${e.level || '–'}</b>` : ''}</button>`).join('') || '<div class="gca-empty">No matches.  Try another search or save your first profile.</div>'}</div><div class="gca-sidebar-footer"><span>${items.length} shown</span>${button('import', 'Import')}${button('export-all', 'Export all')}</div></aside>
      <main class="gca-main"><div class="gca-profile-bar">${button('toggle-browser', '<i class="fa-solid fa-list"></i>', `class="gca-quick-list" title="${this.prefs.browserOpen ? 'Hide' : 'Show'} quick spell list" aria-pressed="${!!this.prefs.browserOpen}"`)}${input('name', 'Profile name', p.name)}<div class="gca-profile-tools">${button('save', 'Save', 'class="gca-primary"')}${button('copy', 'Save copy')}${button('shortcut', '<i class="fa-solid fa-bolt"></i>', 'title="Create hotbar shortcut"')}${button('export', '<i class="fa-solid fa-file-export"></i>', 'title="Export this profile"')}${button('delete', '<i class="fa-solid fa-trash"></i>', 'title="Delete saved profile"')}</div></div>
      <div class="gca-entry">${select('abilityKey', 'Casting spell / skill', [['', 'Choose ability'], ...data.abilities.map((e) => [e.key, `${e.name} · ${e.kind} ${e.level}`])], entry?.key || '')}<div>${pageLinks(entry?.object?.pageref || entry?.object?.reference || '')}</div>${
        entry
          ? `<p>${[
              ['Class', entry.object.class],
              ['Cost', entry.object.cost],
              ['Maintain', entry.object.maintain],
              ['Cast', entry.object.casttime],
              ['Duration', entry.object.duration],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => `<span>${k}: <strong>${esc(v)}</strong></span>`)
              .join('')}</p>`
          : ''
      }</div>
      <div class="gca-panels"><div class="gca-effect-choice">${select(
        'effectCategory',
        'Effect',
        [
          ['auto', `Automatic · ${EFFECT_LABELS[layout.inferred.kind]}`],
          ['damage', 'Damage'],
          ['healing', 'Healing / recovery'],
          ['other', 'Other'],
        ],
        p.effectCategory || 'auto',
      )}<p>${esc(layout.reason)}</p>${button('edit-build', p.parserText ? 'Edit build text' : 'Paste a build', 'class="gca-build-button"')}</div>
      <div class="gca-primary-panels">${this.panel('cost', 'Casting & resources', costBody, `${p.baseCost} base energy`, true)}<div class="gca-effect-panels">${layout.damage ? this.panel('delivery', 'Attack & damage', delivery, p.rollDamage ? 'Damage enabled' : 'Set up the effect', true) : ''}${layout.healing ? this.panel('recovery', 'Healing & recovery', recovery, p.effectType === 'restore-fp' ? 'Restore FP' : 'Heal HP', true) : ''}${!layout.damage && !layout.healing ? '<section class="gca-other-effect"><h3>Resolve the spell’s effect in play</h3><p>The assistant handles the casting roll and resource cost.  Use the PDF reference for the spell’s duration, resistance, and other effects.</p></section>' : ''}</div></div>
      <div class="gca-resolution"><span>Resolution</span><strong data-effect-preview>${esc(effectSummary(p))}</strong></div>
      ${p.parserText || p.rules === 'rpm' || this.editBuild ? this.panel('parser', 'RPM / power build', parser, p.parserText ? 'Build text saved with profile' : 'Paste and parse', true) : ''}
      ${this.panel('notes', 'Notes & tags', notes, (p.tags || []).join(', '))}${this.panel('advanced', 'Advanced', advanced, 'Rules, combined effects, and tables')}</div></main></div>
      <footer class="gca-footer"><div><strong data-preview>${esc(preview)}</strong><span data-status role="status">${esc(this.status)}${this.dirty ? ' · Unsaved changes' : ''}</span></div>${button('cast', '<i class="fa-solid fa-wand-magic-sparkles"></i> Cast / Resolve', `class="gca-primary gca-cast"${this.busy ? ' disabled' : ''}`)}</footer><input type="file" data-import-file accept="application/json,.json" hidden>`;
    if (this.busy) {
      root.classList.add('gca-busy');
      root.querySelectorAll('button,input,select,textarea,summary').forEach((el) => {
        if ('disabled' in el) el.disabled = true;
      });
    }
    return root;
  }
  _replaceHTML(root, content) {
    const doc = content.ownerDocument,
      focus = content.contains(doc.activeElement) ? doc.activeElement : null;
    const identity = focus?.dataset.field
      ? `[data-field="${focus.dataset.field}"]`
      : focus?.hasAttribute('data-search')
        ? '[data-search]'
        : null;
    const start = focus?.selectionStart,
      end = focus?.selectionEnd;
    const scroll = content.querySelector('.gca-panels')?.scrollTop || 0,
      listScroll = content.querySelector('.gca-list')?.scrollTop || 0;
    this._resizeObserver?.disconnect();
    content.replaceChildren(root);
    root.querySelector('.gca-panels').scrollTop = scroll;
    root.querySelector('.gca-list').scrollTop = listScroll;
    if (identity) {
      const el = root.querySelector(identity);
      el?.focus({ preventScroll: true });
      if (el && start !== null && ['text', 'search'].includes(el.type))
        el.setSelectionRange(start, end);
    }
    root.addEventListener('click', (event) => this.click(event).catch((e) => this.error(e)));
    root.addEventListener('input', (event) => this.change(event).catch((e) => this.error(e)));
    root.addEventListener('change', (event) => {
      if (event.target.matches('select,[data-import-file]'))
        this.change(event).catch((e) => this.error(e));
    });
    root.querySelectorAll('[data-panel]').forEach((el) =>
      el.addEventListener('toggle', () => {
        this.prefs.open[el.dataset.panel] = el.open;
        this.savePrefs().catch((e) => this.error(e));
      }),
    );
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const e of entries)
        if (e.target.style.height && e.contentRect.height > 40) {
          this.prefs.heights ||= {};
          this.prefs.heights[e.target.dataset.resize] = Math.round(
            e.target.getBoundingClientRect().height,
          );
        }
      clearTimeout(this._sizeSave);
      this._sizeSave = setTimeout(() => this.savePrefs().catch((e) => this.error(e)), 400);
    });
    root.querySelectorAll('[data-resize]').forEach((el) => this._resizeObserver.observe(el));
  }
  error(error) {
    this.status = error.message;
    ui.notifications.error(error.message);
    console.error(ID, error);
    if (this.rendered) this.renderQuiet();
  }
  async change(event) {
    const el = event.target;
    if (this.busy) return;
    if (el.tagName === 'SELECT' && event.type === 'input') return;
    if (el.dataset.field && !(el.tagName === 'SELECT' && event.type === 'input')) {
      const path = el.dataset.field,
        keys = path.split('.'),
        last = keys.pop();
      let value = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') value = el.value === '' ? '' : Number(el.value);
      if (path === 'tagsText') this.draft.tags = cleanTags(value);
      else if (path === 'effectCategory') {
        this.draft.effectCategory = value;
        if (value === 'healing' && this.draft.effectType === 'none') {
          this.draft.effectType = 'heal-hp';
          this.draft.effectAmount = '';
        }
        this.prefs.open.delivery = true;
        this.prefs.open.recovery = true;
      } else if (path === 'attackKey')
        this.draft.attack = reference(actorData(this.actor).attacks.find((e) => e.key === value));
      else if (path === 'abilityKey')
        this.draft.ability = reference(
          actorData(this.actor).abilities.find((e) => e.key === value),
        );
      else if (path === 'rules') {
        const standard = standardDefaults(
          resolveReference(this.draft.ability, actorData(this.actor).abilities),
        );
        Object.assign(this.draft, {
          rules: value,
          applyReduction: value === 'standard' ? standard.applyReduction : false,
          critFree: value === 'standard',
          failurePolicy: value === 'standard' ? standard.failurePolicy : 'full',
          criticalFailurePolicy: 'full',
        });
      } else {
        let parent = this.draft;
        for (const key of keys) parent = parent[key];
        parent[last] = value;
      }
      this.dirty = true;
      if (
        ['rules', 'effectType', 'attackKey', 'abilityKey', 'effectCategory'].includes(path) ||
        el.type === 'checkbox'
      ) {
        this.renderQuiet();
        return;
      }
      this.updatePreview();
      return;
    }
    if (el.hasAttribute('data-search')) {
      this.prefs.search = el.value;
      this.renderQuiet();
      return;
    }
    if (el.hasAttribute('data-sort')) {
      this.prefs.sort = el.value;
      this.renderQuiet();
      return;
    }
    if (el.hasAttribute('data-kind')) {
      this.prefs.kind = el.value;
      this.renderQuiet();
      return;
    }
    if (el.hasAttribute('data-source')) {
      const s = resources(this.actor).find((s) => s.path === el.value),
        r = this.draft.rows[Number(el.dataset.source)];
      Object.assign(r, { path: s?.path || '', name: s?.name || '', mode: s?.mode || 'pool' });
      this.dirty = true;
      this.renderQuiet();
      return;
    }
    if (el.hasAttribute('data-actor')) {
      if (!(await this.canReplace())) return this.renderQuiet();
      const actor = await fromUuid(el.value);
      own(actor);
      this.actor = actor;
      this.loadInitial();
      this.renderQuiet();
      return;
    }
    if (el.hasAttribute('data-import-file') && el.files[0]) {
      const imported = await importProfiles(this.actor, await el.files[0].text());
      const missing = imported.filter((p) => missingReferences(this.actor, p).length).length;
      this.status = `Imported ${imported.length} profiles.${missing ? `  ${missing} need their casting or attack references selected.` : ''}`;
      this.prefs.view = 'profiles';
      this.renderQuiet();
    }
  }
  updatePreview() {
    const root = this.element;
    let text = '';
    try {
      const e = resolveReference(this.draft.ability, actorData(this.actor).abilities),
        cost = costFor(this.draft, e || { level: 0 });
      spendPlan(this.draft, resources(this.actor), cost.final);
      text = `${cost.base} base − ${cost.reduction} reduction = ${cost.final} energy`;
    } catch (e) {
      text = e.message;
    }
    const preview = root?.querySelector('[data-preview]');
    if (preview) preview.textContent = text;
    const effect = root?.querySelector('[data-effect-preview]');
    if (effect) effect.textContent = effectSummary(this.draft);
    const status = root?.querySelector('[data-status]');
    if (status) status.textContent = `${this.status}${this.dirty ? ' · Unsaved changes' : ''}`;
  }
  async canReplace() {
    return (
      !this.dirty ||
      (await confirm('Unsaved profile', '<p>Discard the unsaved profile changes?</p>'))
    );
  }
  async click(event) {
    const el = event.target.closest('[data-gca],[data-page-ref]');
    if (!el || this.busy) return;
    event.preventDefault();
    if (el.dataset.pageRef) {
      event.stopPropagation();
      await openPage(el.dataset.pageRef);
      return;
    }
    const action = el.dataset.gca;
    switch (action) {
      case 'grimoire':
        event.stopPropagation();
        await game.modules.get(ID).api.grimoire(this.actor.uuid);
        return;
      case 'toggle-browser':
        this.prefs.browserOpen = !this.prefs.browserOpen;
        break;
      case 'edit-build':
        this.editBuild = true;
        this.prefs.open.parser = true;
        break;
      case 'abilities':
      case 'profiles':
        this.prefs.view = action;
        break;
      case 'choose-ability': {
        const entry = actorData(this.actor).abilities.find((e) => e.key === el.dataset.key);
        if (!entry) return;
        if (this.draft.parserText || this.prefs.view === 'profiles') {
          this.draft.ability = reference(entry);
          this.dirty = true;
        } else {
          if (!(await this.canReplace())) return;
          this.draft = { ...standardDefaults(entry), id: uid() };
          this.sheetRecovery();
          this.editBuild = false;
          this.dirty = false;
        }
        this.revealEffect();
        this.prefs.lastAbility = entry.key;
        this.status = 'Ready to configure or cast.';
        break;
      }
      case 'load-profile':
        if (!(await this.canReplace())) return;
        this.draft = clone(profiles(this.actor).find((p) => p.id === el.dataset.key));
        this.revealEffect();
        this.dirty = false;
        this.status = 'Profile loaded.  Review resources and targets.';
        break;
      case 'save':
      case 'copy':
        this.draft = await saveProfile(this.actor, this.draft, { copy: action === 'copy' });
        this.dirty = false;
        this.status = 'Profile saved.';
        break;
      case 'delete':
        if (!profiles(this.actor).some((p) => p.id === this.draft.id))
          throw new Error('This profile has not been saved.');
        if (
          !(await confirm(
            'Delete profile',
            `<p>Delete <strong>${esc(this.draft.name)}</strong> from this actor?</p>`,
          ))
        )
          return;
        await deleteProfile(this.actor, this.draft.id);
        this.draft.id = uid();
        this.dirty = false;
        this.status = 'Saved profile deleted.';
        break;
      case 'shortcut':
        await shortcut(this.actor, this.draft);
        break;
      case 'export':
        download(exportProfiles(this.actor, [cleanProfile(this.draft)]), 'casting-profile.json');
        break;
      case 'export-all':
        download(exportProfiles(this.actor), 'casting-profiles.json');
        break;
      case 'import':
        this.element.querySelector('[data-import-file]').click();
        return;
      case 'sheet':
        event.stopPropagation();
        await openCharacterSheet(this.actor);
        return;
      case 'reset-layout':
        this.prefs.heights = {};
        this.prefs.open = { cost: true };
        break;
      case 'add-row':
        if (this.draft.rows.length >= 16)
          throw new Error('A profile may contain up to 16 resource rows.');
        this.draft.rows.push({ name: '', path: '', mode: 'pool', amount: 0 });
        this.dirty = true;
        break;
      case 'remove-row':
        this.draft.rows.splice(Number(el.dataset.index), 1);
        this.dirty = true;
        break;
      case 'clear-parser':
        this.draft.parserText = '';
        this.draft.parsed = null;
        this.dirty = true;
        break;
      case 'parse': {
        if (!this.draft.parserText.trim()) throw new Error('Paste a build first.');
        const parsed = parseProfileText(this.draft.parserText);
        Object.assign(this.draft, {
          parsed,
          name: parsed.title,
          effectCategory: 'auto',
          combineEffects: false,
          attack: null,
          rollAttack: false,
          rollDamage: false,
          rules: 'rpm',
          applyReduction: false,
          critFree: false,
          failurePolicy: 'full',
          criticalFailurePolicy: 'full',
          damageFormula: parsed.damageFormula || '',
          effectType: parsed.effectType,
          effectAmount: parsed.effectAmount === 'auto' ? '' : String(parsed.effectAmount),
          scaleDamage: false,
        });
        this.draft.baseCost = parsed.energy ?? '';
        this.prefs.open.cost = true;
        this.prefs.open.delivery = true;
        if (parsed.effectType !== 'none') this.prefs.open.recovery = true;
        this.dirty = true;
        this.status = 'Parsed.  Check the cost and effects, select the casting skill, then save.';
        break;
      }
      case 'cast': {
        prepareCast(this.actor, this.draft);
        this.busy = true;
        this.status = 'Resolving cast…';
        await this.renderQuiet();
        try {
          const result = await cast(this.actor, clone(this.draft), this.token);
          this.status = result.record.paymentError
            ? 'Cast needs review in chat.'
            : 'Cast complete.  See chat for the result.';
        } finally {
          this.busy = false;
          await this.renderQuiet();
        }
        return;
      }
    }
    await this.savePrefs();
    this.renderQuiet();
  }
  refreshActor(actor) {
    if (actor?.uuid !== this.actor.uuid || this.busy) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      if (this.rendered && !this.busy) {
        if (!this.dirty) {
          const saved = profiles(this.actor).find((p) => p.id === this.draft.id);
          if (saved) this.draft = clone(saved);
        }
        this.renderQuiet();
      }
    }, 100);
  }
}
