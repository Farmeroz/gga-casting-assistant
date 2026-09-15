import { createHelpController, helpResolver } from './tooltip-engine.mjs';
export const helpConfig = {
  id: 'gga-casting-assistant',
  scope:
    '.gca-help-dialog, .gca-window, .gca-book-dialog, .gca-chat-actions, [data-gca-approve], [name^="gga-casting-assistant."], [data-key^="gga-casting-assistant."], [data-tool="gga-casting-assistant"], [data-control="gga-casting-assistant"]',
  actions: {
    'active-effects':
      'Open this caster’s active spells, maintenance reminders, and repeated-healing history.',
    'track-existing':
      'Record an effect that is already active, starting its timer now. This does not cast it, spend its initial cost, or apply bonuses.',
    abilities: 'Browse spells and skills from the actor’s sheet.',
    profiles: 'Browse casting profiles saved on this actor.',
    cast: 'Resolve this casting setup, including the configured roll, resource payment, and enabled effects. Review the preview first.',
    casting: 'Open the casting assistant for this actor.',
    grimoire: 'Browse spells and saved builds in a separate Grimoire window.',
    sheet: 'Open this actor’s character sheet.',
    'reset-layout': 'Restore the casting panels to their default sizes.',
    save: 'Save this casting profile on the actor. Saving does not cast it.',
    copy: 'Save the current configuration as a separate profile on the actor.',
    shortcut: 'Create a hotbar macro for this casting setup.',
    export: 'Download this casting profile as JSON.',
    'export-all': 'Download all saved profiles for this actor.',
    'export-view': 'Download the saved builds matching the current Grimoire filters.',
    import: 'Choose a JSON file containing casting profiles to import for this actor.',
    delete: 'Delete this saved casting profile.',
    duplicate: 'Create a separate copy of this saved build.',
    metadata: 'Edit the saved build’s name and tags.',
    'new-build': 'Create a ritual with the RPM Designer, then save it to the Grimoire.',
    'design-ritual':
      'Open the guided RPM Designer. Edit effects and modifiers with a live energy breakdown.',
    'create-resource':
      'Create and select a Magic FP, Energy Pool, Threshold, or custom GGA Resource Tracker.',
    prepare: 'Copy this entry into the casting assistant for review. This does not cast it.',
    'open-profile': 'Open this saved casting setup for review.',
    favourite: 'Add or remove this entry from your favourites.',
    favourites: 'Show only favourites, or return to all matching entries.',
    layout: 'Switch between Grimoire cards and the compact list.',
    tag: 'Filter saved builds by this tag.',
    clear: 'Clear the Grimoire filters.',
    'toggle-browser': 'Show or hide the compact spell and profile browser.',
    'load-profile': 'Load this saved profile into the casting window.',
    'choose-ability': 'Use this spell or skill in the casting setup.',
    'add-row': 'Add another resource to the payment plan.',
    'remove-row': 'Remove this resource from the payment plan; the actor’s tracker is retained.',
    parse: 'Extract suggested values from the build text. Review them before saving or casting.',
    'clear-parser': 'Clear the build text from this setup.',
    'edit-build': 'Show the build-text editor for pasting or revising a ritual.',
  },
  fields: {
    useSpellsOn:
      'Include −1 per tracked spell on, or −3 while concentrating on it, for standard spellcasting. Turn off if you already include these penalties elsewhere. B238.',
    healingTracking:
      'Track Minor and Major Healing separately per caster, patient, and game day. Automatic recognises the English spell names; explicit choices support renamed spells. B248.',
    physicianMitigation:
      'For a first Minor or Major Healing attempt today, Physician 15+ changes a critical failure to an ordinary failure. The skill must be named Physician or Physician/TL. B248.',
    'ongoing.resolution':
      'Choose GM confirmation for resistance or unresolved delivery. No resistance marks recorded targets affected when the successful effect starts.',
    'ongoing.mode':
      'Off, a timed duration, or no automatic expiry. Instant and permanent spells need their own interpretation; review the spell description.',
    'ongoing.amount':
      'Length of each duration interval. Timers advance with Foundry world time, not real time.',
    'ongoing.unit': 'Time unit for the duration; game days here are 24 hours.',
    'ongoing.maintainable':
      'Offer maintenance at the end of each interval. The caster must be able to maintain the effect; payment is never automatic.',
    'ongoing.maintenanceCost':
      'Base energy to maintain for one interval, before the optional high-skill reduction. This is independent of casting cost.',
    'ongoing.reduceMaintenance':
      'Apply the selected ability’s high-skill energy reduction to maintenance. A critical casting success does not make later maintenance free. B238.',
    'ongoing.penalty':
      'How this effect contributes to tracked spells-on penalties: none, −1, or −3 while concentrating. Permanent spells do not contribute. B238.',
    'ongoing.autoStart':
      'Start the timer after a successful paid cast. Enable only when resistance, attack delivery, or other conditions do not still need resolution. Blind casts require GM activation.',
    'ongoing.summary':
      'A reminder of the effect and its recipients. This does not apply GGA bonuses, conditions, or changes to recipient statistics.',
    abilityKey: 'Choose the spell or skill used for the casting roll.',
    baseCost: 'Energy cost before any enabled reduction or outcome policy.',
    modifier: 'Adjustment applied to this casting roll.',
    includeBucket: 'Include the current user’s Modifier Bucket in the casting roll.',
    rules: 'Select the casting rules mode for cost and outcome handling.',
    applyReduction: 'Apply the selected rules mode’s high-skill energy reduction where supported.',
    critFree: 'Treat a critical casting success as costing no energy when this option is enabled.',
    failurePolicy: 'Choose how much energy to pay on a failed casting roll.',
    criticalFailurePolicy: 'Choose how much energy to pay on a critical casting failure.',
    attackKey:
      'Choose the attack used after a successful cast when linked-attack rolling is enabled.',
    damageFormula: 'Damage expression to roll, or leave blank to use the linked attack’s damage.',
    rollAttack: 'Roll the linked attack after a successful casting roll.',
    rollDamage: 'Roll the configured damage when the casting workflow reaches that step.',
    scaleDamage:
      'Multiply the damage formula by base energy. Enable only when the formula is expressed per energy point.',
    effectType: 'Choose whether recovery restores HP or FP.',
    effectAmount: 'Recovery amount, as a number or supported dice expression.',
    autoApply: 'Apply recovery to the current targets after success, subject to permissions.',
    allowSelf: 'Allow the caster as a recovery recipient.',
    effectCategory:
      'Choose which effect controls are shown. Automatic uses the setup and available sheet data.',
    combineEffects: 'Show and use both damage and recovery controls for this setup.',
    parserText: 'Paste the ritual or power build. Parse build suggests values for you to review.',
    notes: 'Notes saved with this casting profile.',
    tagsText: 'Comma-separated labels used to organise saved builds.',
    name: 'Name saved with this casting profile or build.',
    tags: 'Comma-separated labels saved with this build.',
    thresholdStep:
      'Full points over the cap per +1 to 3d6. Default 5, rounded down. A check is still required at +0 when over the cap (Thaumatology, p. 77).',
  },
  rules: [
    [
      '[data-active="target"]',
      'GM only: record this target’s outcome and optional condition marker. Ending one target leaves the others intact.',
    ],
    [
      '[data-target-part="status"]',
      'Pending awaits resistance or delivery. Affected receives the spell; Resisted and Ended do not.',
    ],
    [
      '[data-target-part="conditionId"]',
      'Optional visible marker for an affected target. Existing unrelated conditions are preserved.',
    ],
    [
      '[data-gca-chat="resolve-targets"]',
      'Start this successful effect once, then open its per-target outcome controls. GM confirmation is required for resisted targets.',
    ],
    [
      '[data-active="maintain"]',
      'Pay the reviewed maintenance cost once and extend from the previous expiry. Resolve missed intervals separately after a time jump.',
    ],
    [
      '[data-active="expire"]',
      'End the spell at its unpaid maintenance boundary, without a cancellation cost.',
    ],
    [
      '[data-active="cancel"]',
      'End a spell early. Standard magic costs one energy, without a high-skill discount. B237.',
    ],
    [
      '[data-active="external"]',
      'Record a spell that already ended in play, such as a dispelled effect; no cancellation charge.',
    ],
    [
      '[data-active="concentration"]',
      'Toggle the tracked concentration penalty between −3 and the ordinary −1 spell-on penalty. This does not select a GGA manoeuvre.',
    ],
    [
      '[data-active="advance"]',
      'GM only: advance the whole world’s game time. This also advances other modules that use world time.',
    ],
    [
      '[data-active="count-attempt"]',
      'Count a reserved healing attempt after confirming that its roll happened, whether it succeeded or failed.',
    ],
    [
      '[data-active="discard-attempt"]',
      'GM only: remove a reserved attempt only when no healing roll happened.',
    ],
    [
      '[data-active="reset-healing"]',
      'GM only: start a fresh healing day for this caster. Does not change HP, FP, or active spells.',
    ],
    [
      '[data-active="clear-history"]',
      'GM only: remove older healing history and compact ended effect records. Old casting cards remain used.',
    ],
    [
      '[data-active="reviewed"]',
      'GM only: confirm the calamity has been resolved and the maintained spell continues. Use Ended externally if it failed.',
    ],
    [
      '[data-payment][data-part="source"]',
      'Resource to use for this maintenance or cancellation payment.',
    ],
    [
      '[data-payment][data-part="amount"]',
      'Set an explicit amount, or auto on one row for the rest of this action’s cost.',
    ],
    ['[data-payment][data-part="mode"]', 'Spend down from a pool, or add to a threshold tally.'],
    [
      '[data-gca-chat="start-effect"]',
      'After resolving resistance and delivery, start this spell’s duration now. Each casting card can create one tracked effect.',
    ],
    [
      '[data-gca-chat="active-effects"]',
      'Open the caster’s tracked spells and maintenance controls.',
    ],
    [
      '[data-rpm="add-effect"]',
      'Add a separate Path/effect component. Every occurrence contributes energy.',
    ],
    [
      '[data-rpm="remove-effect"], [data-rpm="remove-modifier"]',
      'Remove this component and recalculate the ritual.',
    ],
    [
      '[data-rpm="save"]',
      'Save the editable construction and a castable profile in the actor’s Grimoire.',
    ],
    [
      '[data-rpm="prepare"]',
      'Save the ritual and open the casting setup to choose resources and review the skill.',
    ],
    ['[data-rpm="copy"]', 'Save this construction as a separate ritual.'],
    ['[data-rpm="copy-text"]', 'Copy the compatible RPM spell write-up.'],
    [
      '[data-resource-create]',
      'Create a GGA tracker and select it for this profile. Threshold trackers start at zero and may exceed their cap.',
    ],
    ['[data-preset]', 'Choose starting settings for a pool or a threshold tally.'],
    ['[data-resource-field="step"]', 'Full excess points per +1 on 3d6. RAW is 5.'],
    [
      '[data-resource-field="table"]',
      'Optional world table looked up using the modified 3d6 total. Blank uses the built-in roll and book reference.',
    ],

    ['[data-source]', 'Choose the resource used by this payment row.'],
    ['[data-field$=".amount"]', 'Amount to pay from this row. Use auto to pay the remaining cost.'],
    [
      '[data-field$=".mode"]',
      'Spend down reduces a pool; Build tally increases an accumulated tally.',
    ],
    [
      '[data-field^="tables."]',
      'Choose the world roll table offered for this outcome. None disables that table option.',
    ],
    [
      '[data-actor], [data-book-actor]',
      'Choose the actor whose spells and saved profiles are shown.',
    ],
    ['[data-search], [data-browse="query"]', 'Filter the entries by the search text.'],
    ['[data-sort], [data-browse="sort"]', 'Choose how matching entries are ordered.'],
    ['[data-kind], [data-browse]', 'Filter the Grimoire entries without changing saved builds.'],
    ['[data-grimoire="select"]', 'Show this entry’s details without casting it.'],
    [
      '[data-gca-chat="apply"]',
      'Apply the recovery from this casting result, subject to recipient permissions.',
    ],
    [
      '[data-gca-chat="undo"]',
      'Undo the recorded changes from this casting result if their current state permits it.',
    ],
    ['[data-gca-chat="damage"]', 'Roll the damage associated with this casting result.'],
    ['[data-gca-chat="table"]', 'Roll the configured table for this casting outcome.'],
    ['[data-gca-approve]', 'Approve the requested recovery application as GM.'],
    ['a.pdflink, .pdflink', 'Open the book and page through GGA’s configured PDF links.'],
  ],
  actionAttributes: ['data-gca', 'data-grimoire', 'data-action', 'data-rpm'],
};
let resolve = helpResolver(helpConfig);

export const helpController = createHelpController({ ...helpConfig, resolve });
if (globalThis.Hooks) {
  Hooks.once('init', () => helpController.register());
  Hooks.once('ready', () => helpController.start());
}
