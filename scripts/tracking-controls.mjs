import { esc } from './core.mjs';
import {
  cleanOngoing,
  maintenanceCost,
  healingPreview,
  spellsOn,
  ordinaryMagic,
} from './tracking-model.mjs';
const select = (key, label, choices, current) =>
  `<label>${label}<select data-field="${key}">${choices.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
const check = (key, label, value) =>
  `<label class="gca-check"><input type="checkbox" data-field="${key}"${value ? ' checked' : ''}>${label}</label>`;
const input = (key, label, value, min = 0) =>
  `<label>${label}<input type="number" data-field="${key}" min="${min}" step="1" value="${esc(value)}"></label>`;
export function ongoingControls(p, entry) {
  const o = p.ongoing || cleanOngoing();
  let cost = '';
  try {
    cost = `${maintenanceCost(p, entry || { level: 0 })} energy after the selected reduction`;
  } catch {
    cost = 'Review the maintenance cost.';
  }
  return `${select(
    'ongoing.mode',
    'Duration tracking',
    [
      ['off', 'Off'],
      ['timed', 'Timed effect'],
      ['indefinite', 'No automatic expiry'],
    ],
    o.mode,
  )}${
    o.mode !== 'off'
      ? `${
          o.mode === 'timed'
            ? `<div class="gca-fields">${input('ongoing.amount', 'Duration', o.amount, 1)}${select(
                'ongoing.unit',
                'Unit',
                [
                  ['seconds', 'Seconds'],
                  ['minutes', 'Minutes'],
                  ['hours', 'Hours'],
                  ['days', 'Days'],
                ],
                o.unit,
              )}</div>${check('ongoing.maintainable', 'Can be maintained at the end of this interval', o.maintainable)}${o.maintainable ? `${input('ongoing.maintenanceCost', 'Base maintenance cost', o.maintenanceCost)}${check('ongoing.reduceMaintenance', 'Reduce maintenance cost for high skill', o.reduceMaintenance)}<p class="gca-hint" data-maintenance-preview>${esc(cost)}. The rate is saved when this effect starts.</p>` : ''}`
            : ''
        }${select(
          'ongoing.penalty',
          'Contribution to spells on',
          [
            ['none', 'None'],
            ['on', 'Spell on (−1)'],
            ['concentrating', 'Concentrating (−3)'],
          ],
          o.penalty,
        )}${select(
          'ongoing.resolution',
          'Target outcomes',
          [
            ['pending', 'GM confirms resistance / delivery'],
            ['none', 'No resistance; successful delivery affects targets'],
          ],
          o.resolution || 'pending',
        )}<label>Effect reminder<textarea data-field="ongoing.summary" rows="2" placeholder="Who or what is affected, and what changes?">${esc(o.summary)}</textarea></label>${check('ongoing.autoStart', 'Start automatically after a successful cast', o.autoStart)}<p class="gca-hint">Use Resolve targets on the casting card to track the spell and confirm each target separately. Automatic start still leaves resisted spells pending until the GM records outcomes. Blind casts require a GM to start the effect. Tracking records the reminder and casting penalty; apply other bonuses and conditions in play.</p><button type="button" data-gca="track-existing">Track existing effect from this setup</button>`
      : '<p class="gca-hint">Enable for a continuing spell or power. Check imported duration and maintenance values against its description.</p>'
  }`;
}
export function trackingPreview(actor, p, entry, recipients) {
  const parts = [];
  if (ordinaryMagic(p, entry) && p.useSpellsOn)
    parts.push(`Tracked spells on: −${spellsOn(actor)}`);
  try {
    const h = healingPreview(actor, p, entry, recipients);
    if (h)
      parts.push(
        `${h.kind === 'minor' ? 'Minor' : 'Major'} Healing: ${h.count} earlier attempt(s) today, −${h.penalty}`,
      );
  } catch (e) {
    parts.push(e.message);
  }
  return parts.join(' · ');
}
export function healingControls(p) {
  return `${select(
    'healingTracking',
    'Repeated-healing rule',
    [
      ['auto', 'Automatic: named Minor / Major Healing'],
      ['minor', 'Minor Healing'],
      ['major', 'Major Healing'],
      ['none', 'Off'],
    ],
    p.healingTracking || 'auto',
  )}${check('physicianMitigation', 'Apply Physician 15+ protection on the first attempt', p.physicianMitigation !== false)}<p class="gca-hint">Standard spells only, including standard spells paid from a threshold tally. Explicit Minor / Major choices support renamed or translated spells. Targets are fixed before the roll; failures count. B248.</p>`;
}
