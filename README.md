# Pokémon Showdown Skins

Custom reskins and input mods for [Pokémon Showdown](https://play.pokemonshowdown.com), built as userscripts. The main skin turns Showdown into a fullscreen, console-style experience: the battle fills the screen, chat is hidden, controls are large and centered, and the whole client is playable with a Bluetooth gamepad.

The [independent controller prototype](skins/controller-client/README.md) launches the newer frontend using your existing Showdown session. It owns its UI and socket instead of rearranging the live client's elements. It is an alternative to the original console skin; disable the old scripts before testing it. PR builds are available as the **controller-userscript** workflow artifact.

## Features

- Fullscreen battle: the 640×360 battle canvas scales to fill the window on desktop and iPad (portrait and landscape), with the chat pane and userlist hidden.
- Console-style controls: enlarged, centered move/switch buttons; moves + Terastallize on one row, all six Pokémon on another; single-row end-of-battle and replay controls.
- Full gamepad support (tested with 8BitDo SN30 Pro+ in X-input mode): navigate every screen — moves, switches, Terastallize, forfeit dialog, sound/timer menus, end-of-battle buttons, replay playback, and Pokémon info tooltips — without touching mouse or screen.
- iOS audio unlock: works around Safari's autoplay policy so battle music plays after a single screen tap per session.

## Repository structure

| Path | Purpose |
|---|---|
| `skins/console-skin/console-skin.user.js` | The main skin + gamepad layer. Install this one. |
| `skins/gamepad-debug/gamepad-debug.user.js` | Optional on-screen gamepad diagnostic overlay. Install only when debugging controller issues. |
| `skins/controller-client/` | Independent controller launcher source and prototype installation instructions. |
| `frontend/` | Shared controller app, tests, and static/userscript builds. |

## Requirements

- **Desktop:** Chrome (or any Chromium browser) with the [Tampermonkey](https://www.tampermonkey.net/) extension. Stylish will NOT work — these scripts contain JavaScript, not just CSS.
- **iPad / iOS:** Safari with the free **Userscripts** app by Justin Wasack ([App Store](https://apps.apple.com/us/app/userscripts/id1463298887)).
- **Gamepad (optional):** any controller the browser's Gamepad API can see. Button indices are calibrated for an 8BitDo SN30 Pro+ in X-input mode (power on with **Start+X**).

## Installation

### Desktop (Chrome + Tampermonkey)

1. Install Tampermonkey from the Chrome Web Store.
2. In `chrome://extensions` → Tampermonkey → **Details**, enable **Allow User Scripts** (older Chrome: enable **Developer mode**). Without this, userscripts are silently ignored.
3. Open the Tampermonkey **Dashboard** → **Utilities** tab → **Import from file**, and select `skins/console-skin/console-skin.user.js`.
   - Alternative: Dashboard → **＋ Create a new script**, delete the template, paste the entire file contents (the `// ==UserScript==` header MUST be the first line), then save (Cmd+S).
4. Reload play.pokemonshowdown.com. The Tampermonkey icon should show a **1** badge on that tab; the fullscreen layout confirms it's running.

### iPad / iOS (Safari + Userscripts)

1. Install the **Userscripts** app, then enable it: **Settings → Apps → Safari → Extensions → Userscripts** → Allow Extension, and allow it for `pokemonshowdown.com` (or all websites).
2. Get the script file onto the iPad (AirDrop, iCloud Drive, or download) — the filename **must end in exactly `.user.js`**.
3. In the **Files** app, move it into **On My iPad → Userscripts** (the folder the Userscripts app created). If replacing an older version, delete the old copy first — two versions will fight.
4. In Safari on play.pokemonshowdown.com, tap the **puzzle-piece / extensions icon** in the address bar → **Userscripts** → tap the **folder icon** to list all scripts → confirm the script is listed and active.
   - Tapping a script's name toggles it. There is no reliable on/off indicator — when unsure, reload the page and judge by the result.
5. Reload the page.

> **Do not** install as a plain `.css` UserStyle on iOS — the Userscripts app's CSS file type silently fails to inject. Everything here is packaged as JavaScript for that reason.

### Updating

The repo is the source of truth, but browsers run their own copies. After changing the script: re-import into Tampermonkey (desktop) and replace the file in the Userscripts folder (iPad), then reload Showdown.

## Gamepad controls

| Input | Action |
|---|---|
| D-pad | Move the cursor (left/right within a row, up/down between moves / Pokémon / battlefield rows) |
| A | Confirm / click the highlighted item |
| B | Cancel / close popup |
| X | Terastallize |
| Start | Forfeit menu |
| Select | Sound menu (cursor lands on Mute) |
| L3 (left stick click) | Timer menu |
| R3 (right stick click) | Show/hide info tooltip for the highlighted move or Pokémon |
| R1 | **Unbound — reserved by iPadOS as a system button.** Do not bind it. |

## Known limitations

- **Music on iOS needs one tap.** iOS only allows audio to start during a real touch; controller presses don't count. Tap the screen once per session and the script primes every battle theme so later battles start music automatically.
- **Bluetooth pairing is single-device.** The SN30 Pro+ bonds to one device at a time; pairing it with the iPad drops the Mac bond (and vice versa). Tip: use USB-C wired on the Mac, Bluetooth on the iPad.
- Selectors target the current play.pokemonshowdown.com client and may break when the client updates.
