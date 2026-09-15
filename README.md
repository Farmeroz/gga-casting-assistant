# GGA Casting Assistant

Version 0.5.0. Cast spells and powers, browse your Grimoire, save reusable RPM builds, allocate resources, and apply healing in GURPS 4e Game Aid.

## Install or update

Requires Foundry VTT 14, GURPS Game Aid 0.18.x, and libWrapper.

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Paste `https://github.com/Farmeroz/gga-casting-assistant/releases/latest/download/module.json` into **Manifest URL** and select **Install**.
3. Open your world and enable **GGA Casting Assistant** and **libWrapper** in **Manage Modules**.
4. Select your character’s token and press **Alt+S** for casting or **Alt+B** for the Grimoire.

For a manual installation, download the versioned ZIP from [GitHub Releases](https://github.com/Farmeroz/gga-casting-assistant/releases) and extract its `gga-casting-assistant` folder into `Data/modules/`.

Existing profiles remain available. Profiles are saved on your actors, separately from the module folder.

The casting window shows cost, payment, and controls for the selected effect: **Damage**, **Healing / recovery**, or **Other**. **Automatic** uses the configured effects and available sheet information. Choose a category yourself when needed; use **Advanced** for combined effects, rule options, and tables. The list button beside the profile name opens a compact browser.

The **Grimoire** button in the casting assistant opens a separate browser with cards or a list, search, filters, favourites, and clickable PDF references on cards and in the detail pane, using the character sheet’s book mappings. Its **Saved builds** view organises RPM rituals and other casting profiles with names and tags, duplication, import, and filtered export. **+ Create RPM spell** opens the RPM Designer. Add Path effects and modifiers, review the live energy breakdown, and save an editable ritual directly to the Grimoire. **Save & open casting** prepares its casting profile, including damage or healing and the lowest available required Path skill. Existing pasted builds remain supported.

In the casting window, **Create tracker** adds a Magic FP, Energy Pool, Threshold, or custom GGA Resource Tracker. Pools spend down. Threshold trackers start at zero, count up, and permit spending beyond their cap. Any Casting Assistant cast using a tally checks for calamity while over the cap, including zero-cost casts. The default is 3d6 +1 per full 5 points over the cap (GURPS 4e Thaumatology, p. 77). Choose a world calamity table, or use the built-in roll with an outcome label and book reference. Calamity effects are applied in play; a result of 29+ also rolls Will with the excess modifier as a penalty before releasing the spell's effects.

**Active effects** opens a separate view of the caster's ongoing spells and effects, recipients, time remaining, maintenance, and healing history. In **Duration & maintenance**, enable a timer or choose no automatic expiry, review the maintenance cost, and choose how the effect counts towards spells on. By default, a successful cast offers **Start ongoing effect** after resistance or delivery is resolved; automatic start is optional. Timers follow Foundry game time. Due maintenance requires a choice and reviewed payment. Cancelling a standard spell early costs one energy; letting it expire does not. Threshold maintenance checks for calamity when it adds to an over-cap tally, including crossing the cap; zero-cost maintenance does not.

Standard Minor and Major Healing now track attempts separately for each caster and patient during the game day. Target exactly one patient before rolling. The preview applies −3 per earlier attempt; failed rolls count. Physician 15+ protection applies to the first attempt when recognised. The GM can review interrupted attempts or reset the healing day. Renamed spells can select their rule explicitly under Recovery options. Rules: **GURPS 4e Basic Set**, pp. 237–238, 248; **Thaumatology**, pp. 76–77.

GM Control Sheet 0.3.0 or later can show these effects beside both their caster and their recipients. Clicking a badge opens the original caster's management window. The modules remain independently usable.

Both windows can also be opened from **Configure Settings → Module Settings**. The book button in the token controls opens casting. Players can use their assigned character when no token is selected.

Open **User-Guide.html** for the complete user guide.

## Support and licence

Report problems through [GitHub Issues](https://github.com/Farmeroz/gga-casting-assistant/issues). Released under the [MIT licence](LICENSE.txt).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.

## Help tooltips

Hover over a control or focus it with the keyboard for a short explanation. Press Escape to dismiss the help. Under **Configure Settings → Module Settings → GGA Casting Assistant**, turn off **Show help tooltips** to hide optional help on your client. Labels, settings descriptions, and important notices remain visible. Other users keep their own preference.
