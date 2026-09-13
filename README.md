# GGA Casting Assistant

Version 0.3.0. Cast spells and powers, browse your Grimoire, save reusable RPM builds, allocate resources, and apply healing in GURPS 4e Game Aid.

## Install or update

Requires Foundry VTT 14, GURPS Game Aid 0.18.x, and libWrapper.

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Paste `https://github.com/Farmeroz/gga-casting-assistant/releases/latest/download/module.json` into **Manifest URL** and select **Install**.
3. Open your world and enable **GGA Casting Assistant** and **libWrapper** in **Manage Modules**.
4. Select your character’s token and press **Alt+S** for casting or **Alt+B** for the Grimoire.

For a manual installation, download the versioned ZIP from [GitHub Releases](https://github.com/Farmeroz/gga-casting-assistant/releases) and extract its `gga-casting-assistant` folder into `Data/modules/`.

Existing profiles remain available. Profiles are saved on your actors, separately from the module folder.

The casting window shows cost, payment, and controls for the selected effect: **Damage**, **Healing / recovery**, or **Other**. **Automatic** uses the configured effects and available sheet information. Choose a category yourself when needed; use **Advanced** for combined effects, rule options, and tables. The list button beside the profile name opens a compact browser.

The **Grimoire** button in the casting assistant opens a separate browser with cards or a list, search, filters, favourites, and clickable PDF references on cards and in the detail pane, using the character sheet’s book mappings. Its **Saved builds** view organises RPM rituals and other casting profiles with names and tags, duplication, import, and filtered export. **+ New RPM build** opens a fresh setup for parsing and saving a ritual.

Both windows can also be opened from **Configure Settings → Module Settings**. The book button in the token controls opens casting. Players can use their assigned character when no token is selected.

Open **User-Guide.html** for the complete user guide.

## Support and licence

Report problems through [GitHub Issues](https://github.com/Farmeroz/gga-casting-assistant/issues). Released under the [MIT licence](LICENSE.txt).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.
