import { normalise } from './core.mjs';
export function recoveryTypeFromResource(resource) {
  const key = normalise(resource);
  if (key === 'hp') return 'heal-hp';
  if (key === 'fp') return 'restore-fp';
  return 'none';
}

export function normaliseRecoveryCommand(text) {
  const raw = String(text ?? '')
    .replace(/[–—−]/g, '-')
    .trim();
  if (!raw) return '';

  const match = raw.match(/\/(hp|fp)\s+([+]?\d+d\d*(?:[+-]\d+)?!?|[+]?\d+!?)/i);
  if (!match) return '';

  return `/${match[1].toLowerCase()} ${match[2].replace(/\s+/g, '')}`;
}

export function stringsFromRecoveryField(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'undefined') return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (typeof value !== 'object' || depth > 3) return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsFromRecoveryField(item, depth + 1, seen));
  }

  return Object.values(value).flatMap((item) => stringsFromRecoveryField(item, depth + 1, seen));
}

export function recoveryCommandFromSpell(spell) {
  const obj = spell?.object;
  if (!obj || typeof obj !== 'object') return '';

  const likelyFields = [
    'vtt_notes',
    'vttNotes',
    'notes',
    'note',
    'otf',
    'formula',
    'effect',
    'effects',
    'description',
    'text',
    'usage',
    'usage_notes',
  ];

  for (const key of likelyFields) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    for (const text of stringsFromRecoveryField(obj[key])) {
      const command = normaliseRecoveryCommand(text);
      if (command) return command;
    }
  }

  return '';
}

export function parseRecoveryExpression(rawValue, fallbackType = 'none') {
  const original = String(rawValue ?? '')
    .replace(/[–—−]/g, '-')
    .trim();
  if (!original) return { valid: false, error: 'No healing/recovery amount was entered.' };

  let text = original;
  let effectType = fallbackType;

  const commandMatch = text.match(/^\/(hp|fp)\b\s*(.*)$/i);
  if (commandMatch) {
    effectType = recoveryTypeFromResource(commandMatch[1]);
    text = commandMatch[2].trim();
  }

  const minimumOne = /!\s*$/.test(text);
  text = text.replace(/!\s*$/, '').replace(/\s+/g, '');

  if (/^[+]?\d+$/.test(text)) {
    const amount = Math.max(Number(text.replace(/^\+/, '')), minimumOne ? 1 : 0);
    return {
      valid: true,
      kind: 'fixed',
      effectType,
      amount,
      minimumOne,
      display: original,
    };
  }

  const diceMatch = text.match(/^\+?(\d+)d(\d*)([+-]\d+)?$/i);
  if (diceMatch) {
    const dice = Number(diceMatch[1]);
    const faces = diceMatch[2] ? Number(diceMatch[2]) : 6;
    const modifier = diceMatch[3] ? Number(diceMatch[3]) : 0;

    if (
      !Number.isFinite(dice) ||
      dice <= 0 ||
      dice > 1000 ||
      !Number.isFinite(faces) ||
      faces <= 0 ||
      faces > 1000000
    ) {
      return { valid: false, error: `Invalid healing/recovery dice expression: ${original}` };
    }

    const formula = `${dice}d${faces}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`;
    return {
      valid: true,
      kind: 'roll',
      effectType,
      formula,
      minimumOne,
      display: original,
    };
  }

  return {
    valid: false,
    error: `Unrecognised healing/recovery amount: ${original}. Use a number, dice formula such as 1d-3!, or /hp /fp command.`,
  };
}

export function sentenceCaseDamageType(text) {
  const raw = normalise(text);
  for (const [rx, type] of [
    [/huge piercing|pi\+\+/, 'pi++'],
    [/large piercing|pi\+/, 'pi+'],
    [/small piercing|pi-/, 'pi-'],
    [/piercing|\bpi\b/, 'pi'],
    [/burn|fire|flame|heat|electric|lightning/, 'burn'],
    [/crush|impact|force|concussion/, 'cr'],
    [/cut|slash/, 'cut'],
    [/impal|\bimp\b/, 'imp'],
    [/corrosion|acid|\bcor\b/, 'cor'],
    [/toxic|poison|\btox\b/, 'tox'],
    [/fatigue|\bfat\b/, 'fat'],
  ])
    if (rx.test(raw)) return type;
  return '';
}
export function normaliseDamageFormula(formula, context = '') {
  const text = String(formula || '')
    .replace(/[–—−]/g, '-')
    .trim();
  const match = /(\d+)d(?:6)?([+-]\d+)?(!?)/i.exec(text);
  if (!match) return '';
  const after = text.slice(match.index + match[0].length);
  const explicit = /(?:^|\s)(pi\+\+|pi\+|pi-|pi|burn|cr|cut|imp|cor|tox|fat)(?=\s|$)/i.exec(after);
  const type = explicit?.[1] || sentenceCaseDamageType(after + ' ' + context);
  if (!type) return '';
  const divisor = /\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(after)?.[0] || '';
  const extras = [
    /\bex\b|explosive/i.test(after + ' ' + context) ? 'ex' : '',
    /surge/i.test(after + ' ' + context) ? 'surge' : '',
  ];
  return [`${match[1]}d${match[2] || ''}${match[3]}`, divisor, type, ...extras]
    .filter(Boolean)
    .join(' ');
}

export function extractFirstNumber(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function parseProfileText(rawText) {
  const raw = String(rawText ?? '').trim();
  const text = raw.replace(/[–—−]/g, '-');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstPlainLine = lines.find(
    (line) =>
      !/^\s*(spell effects|inherent modifiers|typical casting|cost|energy|damage|effect|name|title)\s*:/i.test(
        line,
      ),
  );
  const nameMatch = text.match(/^\s*(?:name|title|spell|power)\s*:\s*(.+)$/im);
  const title = (nameMatch?.[1] ?? firstPlainLine ?? 'Parsed Power').replace(/[.;:]+$/, '').trim();

  const energy = extractFirstNumber(
    [
      /(?:^|\b)(\d+)\s*energy\b/i,
      /\benergy\s*[:=]\s*(\d+)\b/i,
      /\bcost\s*[:=]\s*(\d+)\b/i,
      /\bfp\s*cost\s*[:=]\s*(\d+)\b/i,
      /\bbase\s*(?:cost|energy)\s*[:=]\s*(\d+)\b/i,
    ],
    text,
  );

  const spellEffects = (text.match(/spell effects\s*:\s*([^\n]+)/i)?.[1] ?? '')
    .replace(/[.;]+$/, '')
    .trim();
  const inherentModifiers = (text.match(/inherent modifiers\s*:\s*([^\n]+)/i)?.[1] ?? '')
    .replace(/[.;]+$/, '')
    .trim();
  const typicalCasting = (text.match(/typical casting\s*:\s*([\s\S]+)/i)?.[1] ?? '').trim();

  let damageFormula = '';
  const existingDamage = text.match(
    /\b(\+?\d+d(?:6)?(?:[+-]\d+)?\s*(?:burn|cr|cut|imp|pi\+\+|pi\+|pi-|pi|cor|tox|fat)(?:\s+ex|\s+surge)?)\b/i,
  );
  if (existingDamage) {
    damageFormula = normaliseDamageFormula(existingDamage[1], text);
  }

  if (!damageFormula) {
    const damageLine = text.match(/damage[^\n.]*?([+]?\d+d(?:6)?(?:[+-]\d+)?)([^\n.]*)/i);
    if (damageLine) {
      damageFormula = normaliseDamageFormula(
        `${damageLine[1]} ${damageLine[2] ?? ''}`,
        `${spellEffects} ${inherentModifiers} ${typicalCasting}`,
      );
    }
  }

  let effectType = 'none';
  let effectAmount = 'auto';
  const lowered = normalise(text);

  const explicitRecoveryCommand = normaliseRecoveryCommand(text);
  if (explicitRecoveryCommand) {
    const commandResource = explicitRecoveryCommand.match(/^\/(hp|fp)\b/i)?.[1] ?? '';
    effectType = recoveryTypeFromResource(commandResource);
    effectAmount = explicitRecoveryCommand;
  } else {
    if (/\b(heal|healing|restore hp|cure|lend vitality)\b/.test(lowered)) {
      effectType = 'heal-hp';
    }
    if (
      /\b(restore fp|recover fp|recover fatigue|restore fatigue|lend energy|fatigue recovery)\b/.test(
        lowered,
      )
    ) {
      effectType = 'restore-fp';
    }

    const recoveryLine = lines.find((line) =>
      /\b(heal|healing|restore hp|restore fp|recover fp|recover fatigue|lend energy|lend vitality|fatigue recovery)\b/i.test(
        line,
      ),
    );
    const formulaMatch = recoveryLine?.match(/([+]?\d+d\d*(?:[+-]\d+)?!?)/i);

    if (formulaMatch) {
      effectAmount = formulaMatch[1];
    } else {
      const explicitEffectAmount = extractFirstNumber(
        [
          /(?:heal|healing|restore hp|restore fp|recover fp|lend energy)[^\d]{0,20}(\d+)\b/i,
          /\beffect\s*amount\s*[:=]\s*(\d+)\b/i,
        ],
        text,
      );
      if (explicitEffectAmount !== null) effectAmount = explicitEffectAmount;
    }
  }

  const greaterMatches = [
    ...(spellEffects || text).matchAll(/\bGreater\s+[A-Za-z]+\s+[A-Za-z]+/gi),
  ].map((m) => m[0]);
  const lesserMatches = [
    ...(spellEffects || text).matchAll(/\bLesser\s+[A-Za-z]+\s+[A-Za-z]+/gi),
  ].map((m) => m[0]);
  const multiplierMatch = (
    text.match(/Greater Effects\s*:[^\n]+/i)?.[0] ||
    typicalCasting ||
    text
  ).match(/[x×]\s*(\d+)\b|\bmultiplier\s*[:=]\s*(\d+)\b/i);
  const multiplier = multiplierMatch ? Number(multiplierMatch[1] ?? multiplierMatch[2]) : null;

  const greaterCount = Number(
    text.match(/Greater Effects\s*:\s*(\d+)/i)?.[1] ?? greaterMatches.length,
  );
  const notes = [];
  if (spellEffects) notes.push(`Spell Effects: ${spellEffects}`);
  if (inherentModifiers) notes.push(`Inherent Modifiers: ${inherentModifiers}`);
  if (greaterMatches.length) notes.push(`Greater effects detected: ${greaterMatches.length}`);
  if (lesserMatches.length) notes.push(`Lesser effects detected: ${lesserMatches.length}`);
  if (multiplier) notes.push(`Multiplier detected: ×${multiplier}`);

  return {
    title,
    energy,
    damageFormula,
    effectType,
    effectAmount,
    spellEffects,
    inherentModifiers,
    typicalCasting,
    greaterEffects: greaterMatches,
    greaterCount,
    lesserEffects: lesserMatches,
    multiplier,
    notes,
    raw,
  };
}
