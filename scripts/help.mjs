import { createHelpController, helpResolver } from './tooltip-engine.mjs';
export const helpConfig = {
  id: 'gga-casting-assistant',
  scope:
    '.gca-help-dialog, .gca-window, .gca-book-dialog, .gca-chat-actions, [data-gca-approve], [name^="gga-casting-assistant."], [data-key^="gga-casting-assistant."], [data-tool="gga-casting-assistant"], [data-control="gga-casting-assistant"]',
  actions: {
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
    'new-build': 'Start a fresh RPM build for parsing and saving.',
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
    thresholdStep: 'Tally overage that adds one to the configured calamity-table modifier.',
  },
  rules: [
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
  actionAttributes: ['data-gca', 'data-grimoire', 'data-action'],
};
let resolve = helpResolver(helpConfig);

export const helpController = createHelpController({ ...helpConfig, resolve });
if (globalThis.Hooks) {
  Hooks.once('init', () => helpController.register());
  Hooks.once('ready', () => helpController.start());
}
