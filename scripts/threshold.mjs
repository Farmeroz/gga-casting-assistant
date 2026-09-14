import { esc, integer } from './core.mjs';
// GURPS 4e Thaumatology, pp. 77-78: full five-point increments, including
// a +0 check when 1-4 over; zero-cost casts while over also require a check.
export function thresholdChecks(profile, available, paidRows = []) {
  const selected = new Map();
  for (const row of profile.rows || []) {
    if (row.mode !== 'tally') continue;
    const candidates = available.filter((r) => r.name === row.name);
    const source =
      available.find((r) => r.path === row.path && r.name === row.name) ||
      (candidates.length === 1 ? candidates[0] : null);
    if (!source || !Number.isFinite(source.max))
      throw new Error('Choose a valid threshold tracker and cap.');
    const paid = paidRows.find((r) => r.path === source.path);
    const after = paid?.after ?? source.value;
    const excess = Math.max(0, after - source.max);
    if (excess) {
      const step = integer(source.thresholdStep ?? profile.thresholdStep ?? 5, 'Calamity step', 1);
      selected.set(source.path, {
        path: source.path,
        name: source.name,
        before: paid?.value ?? source.value,
        after,
        cap: source.max,
        excess,
        step,
        modifier: Math.floor(excess / step),
        table: source.thresholdTable || profile.tables?.threshold || '',
      });
    }
  }
  return [...selected.values()];
}
const BANDS = [
  [10, 'No calamity'],
  [12, 'Nightmares'],
  [13, 'Temporary threshold reduction'],
  [14, 'Threshold and spell-skill penalties'],
  [15, 'Unstable magic'],
  [16, 'Minor disadvantage'],
  [17, 'Disadvantage'],
  [18, 'Major disadvantage'],
  [19, 'One spell lost'],
  [20, 'Multiple disadvantages'],
  [21, 'Prolonged unstable magic'],
  [22, 'Calamity redirected or repeated'],
  [23, 'Permanent trait loss'],
  [24, 'Regional mana disturbance'],
  [25, 'Spell-skill loss'],
  [26, 'Slowly recovering spell-skill loss'],
  [27, 'Ageing'],
  [28, 'Regional plague or curse'],
  [29, 'Spellcasting ability lost'],
  [39, 'Spellcasting loss and lasting regional change'],
  [Infinity, 'Catastrophic calamity'],
];
export function calamityLabel(total) {
  return BANDS.find(([max]) => total <= max)[1];
}
export async function resolveThresholds(actor, checks, access) {
  const results = [];
  for (const check of checks) {
    const roll = await new Roll(`3d6 + ${check.modifier}`).evaluate();
    const result = {
      ...check,
      total: roll.total,
      label: calamityLabel(roll.total),
      spellAllowed: true,
    };
    let tableText = '';
    if (check.table) {
      try {
        const table = await fromUuid(check.table);
        if (table?.documentName !== 'RollTable' || !table.testUserPermission(game.user, 'OBSERVER'))
          throw new Error('The configured calamity table is unavailable or not visible to you.');
        // Query the exact total. draw() can reroll out-of-range totals and consume
        // non-replacement entries; neither is appropriate for a calamity check.
        const matches = await table.getResultsForRoll(roll.total);
        if (!matches?.length)
          throw new Error(`No table entry covers ${roll.total}. Use the reference below.`);
        tableText = matches
          .map((r) => `<p>${esc(r.description || r.text || r.name || '')}</p>`)
          .join('');
        result.tableName = table.name;
      } catch (e) {
        result.tableError = e.message;
      }
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      ...access,
      flavor: `Threshold calamity: ${esc(check.name)}`,
      content: `<h3>Threshold calamity · ${esc(check.name)}</h3><p>Tally ${check.after} / ${check.cap}: ${check.excess} over, +${check.modifier} (${check.step} per full increment).</p>${await roll.render()}<p><strong>${esc(result.label)}</strong> · GURPS 4e Thaumatology, pp. 77–78.</p>${tableText}${result.tableError ? `<p>${esc(result.tableError)}</p>` : ''}<p>Apply the calamity in play using the table reference.</p>`,
    });
    if (roll.total >= 29) {
      const will = Number(actor.system?.attributes?.WILL?.value);
      if (!Number.isFinite(will) || will <= 0) {
        result.spellAllowed = false;
        result.willError = `Will not found. Resolve Will−${check.modifier} manually before applying the spell's effects.`;
      } else {
        const save = await new Roll('3d6').evaluate(),
          target = will - check.modifier;
        result.willTotal = save.total;
        result.willTarget = target;
        result.spellAllowed = save.total <= 4 || (save.total < 17 && save.total <= target);
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          rolls: [save],
          ...access,
          flavor: 'Will to complete the spell',
          content: `${await save.render()}<p>Will ${will} − ${check.modifier} = ${target}. ${result.spellAllowed ? 'The spell can take effect.' : 'The spell fails; resources remain spent.'} The calamity still applies (Thaumatology, p. 77).</p>`,
        });
      }
    }
    results.push(result);
  }
  return results;
}
