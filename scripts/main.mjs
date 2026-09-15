import { RPMDesigner } from './rpm-ui.mjs';
import { MagicResourceWindow } from './resource-ui.mjs';
import * as log from './log.mjs';
import { ID, own, actorData, resolveReference } from './core.mjs';
import { CastingAssistant } from './ui.mjs';
import { wireChat } from './chat.mjs';
import { processRequest } from './mutations.mjs';
import { initialiseRolls } from './rolls.mjs';
import { Grimoire } from './grimoire.mjs';
import { profiles } from './profiles.mjs';
import { ActiveEffectsWindow } from './active-ui.mjs';
import { trackingState, effectState } from './tracking-model.mjs';
import { requestMutation, primaryGM } from './mutations.mjs';
import { accessibleCasters, activeEffectSummaries } from './tracking-summary.mjs';
let app, grimoire, designer, resourceWindow, activeWindow;
export async function openActiveEffects(actorUuid = null, effectId = null) {
  const actor = await resolveActor(actorUuid);
  if (activeWindow?.rendered && activeWindow.actor.uuid !== actor.uuid) {
    await activeWindow.close();
    if (activeWindow.rendered) return activeWindow;
  }
  if (!activeWindow?.rendered) activeWindow = new ActiveEffectsWindow(actor);
  activeWindow.focusEffect = effectId;
  await activeWindow.render({ force: true });
  activeWindow.raiseWindow();
  return activeWindow;
}
async function resolveActor(actorUuid) {
  const selected = canvas.tokens?.controlled || [];
  let actor = actorUuid
    ? await fromUuid(actorUuid)
    : selected.length === 1
      ? selected[0].actor
      : game.user.character;
  if (actor?.documentName === 'Token') actor = actor.actor;
  if (!actor && !actorUuid && game.user.isGM) actor = Array.from(game.actors || [])[0];
  if (!actor) throw new Error('Select one character token or assign your player character first.');
  own(actor);
  return actor;
}
export async function open(actorUuid = null, profileId = null, setup = null) {
  try {
    const actor = await resolveActor(actorUuid);
    if (profileId && !profiles(actor).some((p) => p.id === profileId))
      throw new Error('This saved build is no longer available.');
    if (setup?.ability && !resolveReference(setup.ability, actorData(actor).abilities))
      throw new Error('This spell or skill is no longer on the character sheet.');
    if (app?.rendered && app.actor.uuid === actor.uuid && !profileId && !setup) {
      await app.maximize();
      app.raiseWindow();
      return app;
    }
    if (app?.rendered) {
      if (app.busy) throw new Error('Wait for the current cast to finish.');
      if (!(await app.canReplace())) return app;
      await app.close();
    }
    initialiseRolls();
    app = new CastingAssistant(actor, profileId);
    if (setup) app.loadSetup(setup);
    await app.render({ force: true });
    app.raiseWindow();
    if (setup?.newBuild) app.element?.querySelector('[data-field="parserText"]')?.focus();
    return app;
  } catch (error) {
    ui.notifications.error(error.message);
    log.error(error);
  }
}
export const openAbility = (actorUuid, ability) => open(actorUuid, null, { ability });
export async function openDesigner(actorUuid = null, profile = null) {
  const actor = await resolveActor(actorUuid);
  if (typeof profile === 'string') profile = profiles(actor).find((p) => p.id === profile);
  if (designer?.rendered) {
    await designer.close();
    if (designer.rendered) {
      designer.raiseWindow();
      return designer;
    }
  }
  designer = new RPMDesigner(actor, profile);
  await designer.render({ force: true });
  designer.raiseWindow();
  return designer;
}
export const newBuild = (actorUuid) => openDesigner(actorUuid);
export async function openResources(actorUuid = null, onCreated = null) {
  const actor = await resolveActor(actorUuid);
  if (resourceWindow?.rendered) await resourceWindow.close();
  resourceWindow = new MagicResourceWindow(actor, onCreated);
  await resourceWindow.render({ force: true });
  resourceWindow.raiseWindow();
  return resourceWindow;
}
export async function openGrimoire(actorUuid = null) {
  try {
    const actor = await resolveActor(actorUuid);
    if (grimoire?.rendered) {
      if (grimoire.actor.uuid !== actor.uuid) await grimoire.selectActor(actor);
      await grimoire.maximize();
      grimoire.raiseWindow();
      return grimoire;
    }
    grimoire = new Grimoire(actor, { open, openAbility, newBuild });
    await grimoire.render({ force: true });
    grimoire.raiseWindow();
    return grimoire;
  } catch (error) {
    ui.notifications.error(error.message);
    log.error(error);
  }
}
class Launcher extends foundry.applications.api.ApplicationV2 {
  render() {
    open();
    return this;
  }
}
class GrimoireLauncher extends foundry.applications.api.ApplicationV2 {
  render() {
    openGrimoire();
    return this;
  }
}
class ActiveLauncher extends foundry.applications.api.ApplicationV2 {
  render() {
    openActiveEffects().catch((e) => ui.notifications.error(e.message));
    return this;
  }
}
Hooks.once('init', () => {
  game.settings.register(ID, 'healingDayOffset', {
    name: 'Healing day boundary (game-time seconds)',
    hint: 'Offset from world-time zero for each 24-hour healing day. Default 0. Set this to align the reset with your campaign calendar. Changing it affects which attempts count; it does not erase history.',
    scope: 'world',
    config: true,
    type: Number,
    default: 0,
  });
  game.settings.registerMenu(ID, 'activeEffects', {
    name: 'Active spells & effects',
    label: 'Open active effects',
    hint: 'Durations, maintenance, and repeated-healing history.',
    icon: 'fa-solid fa-hourglass-half',
    type: ActiveLauncher,
    restricted: false,
  });
  game.settings.registerMenu(ID, 'open', {
    name: 'Casting Assistant',
    label: 'Open casting assistant',
    hint: 'Spells, powers, saved profiles, and resource allocation.',
    icon: 'fa-solid fa-book-open',
    type: Launcher,
    restricted: false,
  });
  game.keybindings.register(ID, 'open', {
    name: 'Open Casting Assistant',
    editable: [{ key: 'KeyS', modifiers: ['Alt'] }],
    onDown: () => {
      open();
      return true;
    },
  });
  game.settings.registerMenu(ID, 'grimoire', {
    name: 'Grimoire',
    label: 'Open Grimoire',
    hint: 'Browse spells, skills, and saved RPM or power builds.',
    icon: 'fa-solid fa-book-open',
    type: GrimoireLauncher,
    restricted: false,
  });
  game.keybindings.register(ID, 'grimoire', {
    name: 'Open Grimoire',
    editable: [{ key: 'KeyB', modifiers: ['Alt'] }],
    onDown: () => {
      openGrimoire();
      return true;
    },
  });
});
Hooks.on('getSceneControlButtons', (controls) => {
  const tokens = Array.isArray(controls)
    ? controls.find((c) => c.name === 'tokens')
    : controls.tokens;
  if (!tokens) return;
  const tool = {
    name: ID,
    title: 'Casting Assistant',
    icon: 'fa-solid fa-book-open',
    button: true,
    visible: true,
    order: 98,
    onClick: () => open(),
    onChange: () => open(),
  };
  if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
  else tokens.tools[ID] = tool;
});
Hooks.once('ready', () => {
  game.modules.get(ID).api = {
    open,
    openAbility,
    newBuild,
    designer: openDesigner,
    resources: openResources,
    grimoire: openGrimoire,
    activeEffects: openActiveEffects,
    getActiveEffects: async (actorUuid) => activeEffectSummaries(await resolveActor(actorUuid)),
  };
  refreshTracking().catch((error) => log.error(error));
});
Hooks.on('renderChatMessageHTML', wireChat);
Hooks.on('createChatMessage', (message) => {
  processRequest(message).catch((error) => log.error(error));
});
Hooks.on('updateActor', (actor) => {
  app?.refreshActor(actor);
  grimoire?.refreshActor(actor);
  activeWindow?.refreshActor(actor);
});
Hooks.on('updateToken', (token) => {
  if (token.actor) {
    app?.refreshActor(token.actor);
    grimoire?.refreshActor(token.actor);
    activeWindow?.refreshActor(token.actor);
  }
});
Hooks.on('targetToken', () => {
  if (app?.rendered && !app.busy) app.renderQuiet();
});
Hooks.on('deleteActor', (actor) => {
  if (app?.actor.uuid === actor.uuid) {
    app.status = 'This character was deleted.';
    app.render({ force: true });
  }
  if (grimoire?.actor.uuid === actor.uuid) grimoire.close();
  if (activeWindow?.actor.uuid === actor.uuid) activeWindow.close();
});
const announced = new Set();
export async function refreshTracking() {
  const actors = accessibleCasters();
  for (const actor of actors) {
    const effects = trackingState(actor).effects;
    if (
      (!primaryGM() || primaryGM().id === game.user.id) &&
      effects.some(
        (e) => e.markerCleanup || (e.status === 'active' && effectState(e) === 'expired'),
      )
    )
      await requestMutation({ kind: 'tracking-tick', actorUuid: actor.uuid });
    const due = effects.filter((e) => ['due', 'review'].includes(effectState(e)));
    for (const e of due) {
      const key = `${actor.uuid}:${e.id}:${e.revision}:${e.endsAt}`;
      if (!announced.has(key)) {
        announced.add(key);
        ui.notifications.info(
          `${actor.name}: ${e.name} needs ${e.review ? 'GM review' : 'maintenance'}. Open Active effects.`,
          { permanent: false },
        );
      }
    }
  }
  if (app?.rendered && !app.busy) app.renderQuiet();
  if (activeWindow?.rendered && !activeWindow.busy) activeWindow.renderQuiet();
}
Hooks.on('updateWorldTime', () => {
  refreshTracking().catch((error) => log.error(error));
});
