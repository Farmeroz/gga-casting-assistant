import { CastingWindow } from './application.mjs';
import { esc } from './core.mjs';
import { requestMutation } from './mutations.mjs';
import { trackerDefinition } from './trackers.mjs';
import * as log from './log.mjs';
export class MagicResourceWindow extends CastingWindow {
  static DEFAULT_OPTIONS = {
    id: 'gca-resources',
    classes: ['gca-window', 'gca-resource-dialog'],
    window: { title: 'Create magic resource', resizable: true },
    position: { width: 490, height: 'auto' },
  };
  constructor(actor, onCreated) {
    super();
    this.actor = actor;
    this.preset = 'Magic FP';
    this.onCreated = onCreated;
    this.data = { kind: 'pool', name: 'Magic FP', maximum: 10, current: 10, step: 5, table: '' };
  }
  async _renderHTML() {
    const root = document.createElement('div'),
      p = this.data;
    root.className = 'gca-root gca-resource-form';
    const input = (key, label, type = 'number') =>
      `<label>${label}<input data-resource-field="${key}" type="${type}" value="${esc(p[key])}" ${type === 'number' ? 'min="0" step="1"' : ''}></label>`;
    root.innerHTML = `<p>Create a GGA Resource Tracker for <strong>${esc(this.actor.name)}</strong>.</p><label>Preset<select data-preset>${['Magic FP', 'Energy Pool', 'Threshold', 'Custom'].map((name) => `<option value="${name}" ${this.preset === name ? 'selected' : ''}>${name === 'Custom' ? 'Custom pool' : name}</option>`).join('')}</select></label>${input('name', 'Tracker name', 'text')}<div class="gca-fields">${input('maximum', p.kind === 'threshold' ? 'Threshold cap' : 'Maximum')}${input('current', 'Current value')}</div>${
      p.kind === 'threshold'
        ? `${input('step', 'Full points over cap per +1 calamity modifier')}<label>Calamity table<select data-resource-field="table"><option value="">Built-in roll with Thaumatology reference</option>${Array.from(
            game.tables || [],
          )
            .map(
              (t) =>
                `<option value="${esc(t.uuid)}" ${t.uuid === p.table ? 'selected' : ''}>${esc(t.name)}</option>`,
            )
            .join(
              '',
            )}</select></label><p class="gca-hint">Starts at zero and counts up. The cap is a safe threshold, not a spending limit. Calamity checks use 3d6 plus the excess modifier (GURPS 4e Thaumatology, p. 77).</p>`
        : '<p class="gca-hint">Spends down from its current value. You can select it in any casting profile.</p>'
    }<p data-resource-status role="status">${esc(this.status || '')}</p><button data-resource-create class="gca-primary" ${this.busy ? 'disabled' : ''}>Create and select</button>`;
    return root;
  }
  _replaceHTML(root, content) {
    content.replaceChildren(root);
    root.addEventListener('change', (e) => {
      if (e.target.hasAttribute('data-preset')) {
        const name = e.target.value;
        this.preset = name;
        this.data = {
          ...this.data,
          kind: name === 'Threshold' ? 'threshold' : 'pool',
          name: name === 'Custom' ? '' : name,
          maximum: name === 'Threshold' ? 30 : 10,
          current: name === 'Threshold' ? 0 : 10,
        };
        this.renderQuiet();
      }
      if (e.target.dataset.resourceField)
        this.data[e.target.dataset.resourceField] = e.target.value;
    });
    root.querySelector('[data-resource-create]').addEventListener('click', async () => {
      if (this.busy) return;
      try {
        trackerDefinition(this.data);
        this.busy = true;
        await this.renderQuiet();
        const created = await requestMutation({
          kind: 'create-tracker',
          actorUuid: this.actor.uuid,
          definition: this.data,
        });
        await this.onCreated?.(created);
        await this.close();
      } catch (error) {
        this.status = error.message;
        log.error(error);
      } finally {
        this.busy = false;
        if (this.rendered) this.renderQuiet();
      }
    });
  }
}
