import { CastingWindow } from './application.mjs';
import { ID, clone, esc, uid, standardDefaults } from './core.mjs';
import {
  newDesign,
  newModifier,
  calculateDesign,
  modifierCost,
  PATHS,
  EFFECTS,
  MODIFIERS,
  DAMAGE_TYPES,
} from './rpm-model.mjs';
import { designProfile, pathChoice } from './rpm-profile.mjs';
import { saveProfile } from './profiles.mjs';
import { pageLinks, openPage } from './references.mjs';
import * as log from './log.mjs';
const opts = (items, value) =>
  items
    .map((x) => {
      const [v, l] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    })
    .join('');
const field = (key, label, value, type = 'text', help = '') =>
  `<label>${esc(label)}<input data-rpm-field="${key}" type="${type}" value="${esc(value)}" aria-label="${esc(label)}" ${help ? `data-help="${esc(help)}"` : ''}></label>`;
const select = (key, label, values, value, help = '') =>
  `<label>${esc(label)}<select data-rpm-field="${key}" aria-label="${esc(label)}" ${help ? `data-help="${esc(help)}"` : ''}>${opts(values, value)}</select></label>`;
const check = (key, label, value) =>
  `<label class="rpm-check"><input data-rpm-field="${key}" type="checkbox" ${value ? 'checked' : ''}>${esc(label)}</label>`;
const action = (id, label, extra = '') =>
  `<button type="button" data-rpm="${id}" ${extra}>${label}</button>`;
const notes = (key, value) =>
  field(
    key,
    'What this does / notes',
    value,
    'text',
    'Record what the component changes. This is part of the ritual’s definition and can help the GM review it.',
  );
export function modifierControls(m, i) {
  const p = `modifiers.${i}.`,
    n = (key, label, help = '') => field(p + key, label, m[key], 'number', help);
  const s = (key, label, items, help = '') => select(p + key, label, items, m[key], help);
  let body = '';
  if (['damage', 'healing'].includes(m.kind)) {
    body = n('dice', 'Dice') + n('adds', 'Adds (−3 to +3)');
    body +=
      m.kind === 'healing'
        ? s('resource', 'Restore', [
            ['hp', 'HP'],
            ['fp', 'FP'],
          ])
        : s('damageType', 'Damage type', Object.keys(DAMAGE_TYPES)) +
          s(
            'delivery',
            'Delivery',
            [
              ['internal', 'Internal / resisted'],
              ['missile', 'Hand-held missile'],
              ['explosive', 'Explosive missile'],
              ['distant', 'External at target'],
            ],
            'Enter the actual damage delivered. The calculator applies the external damage multiplier when pricing it (RPM, p. 17).',
          ) +
          n(
            'enhancements',
            'Net enhancements %',
            'Enter the combined enhancement percentage after limitations. Positive enhancements have a minimum cost of 1 energy. RPM, p. 17.',
          ) +
          check(
            p + 'hasEnhancements',
            'Includes enhancements (even if net +0%)',
            m.hasEnhancements,
          );
  } else {
    const labels = {
      duration: 'Duration',
      range: 'Range in yards',
      area: 'Radius in yards',
      weight: 'Largest subject, lbs.',
      bonus: 'Bonus',
      penalty: 'Penalty magnitude',
      traits: 'Character points',
      affliction: 'Affliction enhancement %',
      speed: 'Yards per second',
      information: 'Distance in miles',
      time: 'Distance in days',
      dimensions: 'Dimensions crossed',
      meta: 'Original spell energy',
      extra: 'Additional energy',
      custom: 'Agreed energy cost',
    };
    body = n('value', labels[m.kind]);
    if (m.kind === 'duration')
      body += s('unit', 'Unit', ['minutes', 'hours', 'days', 'weeks', 'months', 'years']);
    if (m.kind === 'area') body += n('excluded', 'Excluded subjects');
    if (['bonus', 'penalty'].includes(m.kind))
      body += s('scope', 'Scope', ['narrow', 'moderate', 'broad']);
    if (m.kind === 'traits')
      body +=
        check(p + 'removes', 'Removes character points', m.removes) +
        check(p + 'noSelfControl', 'Disadvantage allows no self-control roll', m.noSelfControl);
  }
  return `<div class="rpm-fields">${body}</div>${notes(p + 'notes', m.notes)}`;
}
export function designerHTML(state, result, error = '', skill = '') {
  const d = state.design;
  const effectRows = d.effects
    .map(
      (e, i) =>
        `<article class="rpm-component"><div class="rpm-fields">${select(
          `effects.${i}.greater`,
          'Level',
          [
            ['false', 'Lesser'],
            ['true', 'Greater'],
          ],
          String(e.greater),
          'Choose Lesser or Greater according to the effect and campaign. Each Greater effect increases the multiplier for the whole ritual. RPM, pp. 6–12, 18–19.',
        )}${select(`effects.${i}.effect`, 'Effect', Object.keys(EFFECTS), e.effect)}${select(`effects.${i}.path`, 'Path', PATHS, e.path)}${field(`effects.${i}.quantity`, 'Count', e.quantity, 'number')}<strong class="rpm-cost" data-effect-cost="${i}">${EFFECTS[e.effect] * Number(e.quantity)} en</strong>${action('remove-effect', '×', `data-index="${i}" aria-label="Remove effect ${i + 1}"`)}</div>${notes(`effects.${i}.notes`, e.notes)}</article>`,
    )
    .join('');
  const modifierRows = d.modifiers
    .map((m, i) => {
      let cost = '–';
      try {
        cost = modifierCost(m).cost;
      } catch {}
      return `<article class="rpm-component rpm-modifier"><div class="rpm-section-heading"><h3>${MODIFIERS[m.kind]}</h3><span class="rpm-cost" data-modifier-cost="${i}">${cost} en</span>${action('remove-modifier', '×', `data-index="${i}" aria-label="Remove ${MODIFIERS[m.kind]} ${i + 1}"`)}</div>${modifierControls(m, i)}</article>`;
    })
    .join('');
  return `<header class="rpm-header"><div><div class="gca-kicker">GURPS 4e · ${esc(state.actorName)}</div><h2>RPM Designer</h2></div>${action('grimoire', 'Grimoire')}</header><div class="rpm-layout"><main class="rpm-editor"><section class="rpm-card">${field('name', 'Ritual name', state.name)}<label>Description<textarea data-rpm-field="description" rows="3">${esc(d.description)}</textarea></label><div class="rpm-fields">${select(
    'delivery',
    'Prepare as',
    [
      ['immediate', 'Immediate ritual'],
      ['conditional', 'Conditional ritual'],
      ['charm', 'Charm'],
    ],
    d.delivery,
    'Conditional rituals and charms add a Lesser Control Magic wrapper before the Greater multiplier. Preparation does not release the stored effects. RPM, pp. 25–28, 38.',
  )}${field('trappings', 'Trappings discount %', d.trappings, 'number', 'Apply the agreed 0–25% discount after the Greater multiplier. RPM, p. 19.')}</div><details><summary>Trappings and GM rulings</summary>${field('trappingsNotes', 'Agreed trappings', d.trappingsNotes)}<label>Rulings and assumptions<textarea data-rpm-field="ruling" rows="2">${esc(d.ruling)}</textarea></label></details></section><section class="rpm-card"><div class="rpm-section-heading"><h3>Spell effects</h3>${action('add-effect', '+ Add effect')}</div>${effectRows}</section><section class="rpm-card"><h3>Spell modifiers</h3>${modifierRows || '<p class="rpm-muted">Add the modifiers this ritual needs.</p>'}<div class="rpm-add-modifiers" aria-label="Add a spell modifier">${Object.entries(
    MODIFIERS,
  )
    .map(([k, l]) =>
      action(
        'add-modifier',
        '+ ' + l,
        `data-kind="${k}" data-help="Add ${esc(l)} and configure its contribution to this ritual."`,
      ),
    )
    .join(
      '',
    )}</div></section></main><aside class="rpm-summary"><section class="rpm-card rpm-total-card"><span data-rpm-level>${result?.greater ? 'GREATER RITUAL' : 'LESSER RITUAL'}</span><strong data-rpm-total>${result?.total ?? '–'}</strong><span>ENERGY</span></section><section class="rpm-card"><div data-rpm-breakdown>${breakdown(result)}</div><p data-rpm-skill>${esc(skill)}</p><p class="rpm-muted">${pageLinks('RPM15')} · ${pageLinks('RPM18')} · ${pageLinks('RPM19')}</p><div class="rpm-actions">${action('save', 'Save to Grimoire', 'class="gca-primary"')}${action('prepare', 'Save & open casting')}${action('copy', 'Save as new spell')}${action('copy-text', 'Copy write-up')}</div><p data-rpm-status role="status">${esc(error || state.status || '')}</p><ul class="rpm-warnings" data-rpm-warnings>${(result?.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section></aside><section class="rpm-card rpm-writeup"><h3>Spell write-up</h3><pre data-rpm-writeup>${esc(result?.block || 'Complete the highlighted values to calculate the ritual.')}</pre></section></div>`;
}
function breakdown(r) {
  return r
    ? `<dl><dt>Effects & modifiers</dt><dd>${r.base}</dd><dt>Greater effects</dt><dd>${r.greater}</dd><dt>Multiplier</dt><dd>×${r.multiplier}</dd><dt>Before trappings</dt><dd>${r.base * r.multiplier}</dd><dt>Trappings</dt><dd>${r.design.trappings}%</dd><dt>Final energy</dt><dd>${r.total}</dd></dl>`
    : '<p>Check the entered values.</p>';
}
export class RPMDesigner extends CastingWindow {
  static DEFAULT_OPTIONS = {
    id: 'gca-rpm-designer',
    classes: ['gca-window', 'gca-rpm-dialog'],
    window: { title: 'RPM Designer', resizable: true },
    position: { width: 1080, height: 790 },
  };
  constructor(actor, profile = null) {
    super();
    this.actor = actor;
    this.original = profile ? clone(profile) : { ...standardDefaults(null), id: uid() };
    this.name = profile?.name || '';
    this.design = profile?.rpmDesign ? clone(profile.rpmDesign) : newDesign();
    this.dirty = false;
    this.status = 'Build the ritual, then save it or open casting.';
  }
  calculation() {
    return calculateDesign(this.design, this.name || 'Unnamed ritual');
  }
  skillText(r) {
    const s = pathChoice(this.actor, r.paths);
    return s.missing.length
      ? `Choose a casting skill in the assistant: Path of ${s.missing.join(', ')} not found or ambiguous.`
      : `${s.entry.name} ${s.entry.level}${r.pathPenalty ? ` − ${r.pathPenalty} for ${r.paths.length} Paths` : ''}. Review situational modifiers when casting.`;
  }
  async _renderHTML() {
    let result,
      error = '';
    try {
      result = this.calculation();
    } catch (e) {
      error = e.message;
    }
    const root = document.createElement('div');
    root.className = 'gca-root rpm-root';
    root.innerHTML = designerHTML(
      { name: this.name, design: this.design, actorName: this.actor.name, status: this.status },
      result,
      error,
      result ? this.skillText(result) : '',
    );
    if (this.busy)
      root.querySelectorAll('button,input,select,textarea').forEach((e) => (e.disabled = true));
    return root;
  }
  _replaceHTML(root, content) {
    const scroll = content.scrollTop;
    content.replaceChildren(root);
    content.scrollTop = scroll;
    root.addEventListener('input', (e) => this.change(e));
    root.addEventListener('change', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') this.change(e);
    });
    root.addEventListener('click', (e) =>
      this.click(e).catch((error) => {
        this.status = error.message;
        log.error(error);
        this.preview();
      }),
    );
  }
  change(event) {
    const el = event.target,
      key = el.dataset.rpmField;
    if (!key || this.busy) return;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (key.endsWith('.greater')) value = value === 'true';
    if (key === 'name') this.name = value;
    else {
      const path = key.split('.'),
        last = path.pop();
      let target = this.design;
      for (const k of path) target = target[k];
      target[last] = value;
    }
    this.dirty = true;
    this.status = 'Unsaved changes';
    this.preview();
  }
  preview() {
    const root = this.element;
    if (!root) return;
    try {
      const r = this.calculation();
      root.querySelector('[data-rpm-total]').textContent = r.total;
      root.querySelector('[data-rpm-level]').textContent = r.greater
        ? 'GREATER RITUAL'
        : 'LESSER RITUAL';
      root.querySelector('[data-rpm-breakdown]').innerHTML = breakdown(r);
      root.querySelector('[data-rpm-writeup]').textContent = r.block;
      root.querySelector('[data-rpm-warnings]').innerHTML = r.warnings
        .map((w) => `<li>${esc(w)}</li>`)
        .join('');
      root.querySelector('[data-rpm-skill]').textContent = this.skillText(r);
      this.design.effects.forEach((e, i) => {
        root.querySelector(`[data-effect-cost="${i}"]`).textContent =
          `${EFFECTS[e.effect] * e.quantity} en`;
      });
      this.design.modifiers.forEach((m, i) => {
        root.querySelector(`[data-modifier-cost="${i}"]`).textContent =
          `${modifierCost(m).cost} en`;
      });
      root.querySelector('[data-rpm-status]').textContent = this.status;
    } catch (error) {
      root.querySelector('[data-rpm-total]').textContent = '–';
      root.querySelector('[data-rpm-status]').textContent = error.message;
    }
  }
  async click(event) {
    const el = event.target.closest('[data-rpm],[data-page-ref]');
    if (!el || this.busy) return;
    event.preventDefault();
    if (el.dataset.pageRef) {
      await openPage(el.dataset.pageRef);
      return;
    }
    const a = el.dataset.rpm;
    if (a === 'grimoire') {
      await game.modules.get(ID).api.grimoire(this.actor.uuid);
      return;
    }
    if (a === 'add-effect') {
      if (this.design.effects.length >= 30) throw new Error('Use up to 30 effect rows.');
      this.design.effects.push({
        path: 'Body',
        effect: 'Sense',
        greater: false,
        quantity: 1,
        notes: '',
      });
    }
    if (a === 'remove-effect') {
      if (this.design.effects.length <= 1) throw new Error('A ritual needs at least one effect.');
      this.design.effects.splice(Number(el.dataset.index), 1);
    }
    if (a === 'add-modifier') {
      if (this.design.modifiers.length >= 40) throw new Error('Use up to 40 modifiers.');
      const m = newModifier(el.dataset.kind);
      if (m.kind === 'area') m.value = 2;
      this.design.modifiers.push(m);
    }
    if (a === 'remove-modifier') this.design.modifiers.splice(Number(el.dataset.index), 1);
    if (a === 'copy-text') {
      await navigator.clipboard.writeText(this.calculation().block);
      this.status = 'Write-up copied.';
      this.preview();
      return;
    }
    if (['save', 'copy', 'prepare'].includes(a)) {
      const { profile, missing } = designProfile(
        this.actor,
        { name: this.name, design: this.design },
        this.original,
      );
      this.busy = true;
      try {
        this.original = await saveProfile(this.actor, profile, { copy: a === 'copy' });
        this.dirty = false;
        this.status = `Saved to Grimoire.${missing.length ? ' Choose the casting skill in the assistant.' : ''}`;
        if (a === 'prepare') await game.modules.get(ID).api.open(this.actor.uuid, this.original.id);
      } finally {
        this.busy = false;
      }
    } else {
      this.dirty = true;
      this.status = 'Unsaved changes';
    }
    await this.renderQuiet();
  }
  async close(options) {
    if (this.busy) return this;
    if (
      this.dirty &&
      !(await foundry.applications.api.DialogV2.confirm({
        window: { title: 'Unsaved RPM design' },
        content: '<p>Discard the unsaved changes?</p>',
        rejectClose: false,
      }))
    )
      return this;
    return super.close(options);
  }
}
