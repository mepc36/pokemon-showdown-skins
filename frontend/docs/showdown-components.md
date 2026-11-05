# Showdown component map

Visual reference: [`skins/console-skin/console-skin.user.js`](../../skins/console-skin/console-skin.user.js) and the supplied iPad screenshot. The original userscript is unchanged.

On November 1, 2026, we inspected the generated HTML of the official homepage and a public Gen 9 Random Battle as a guest spectator. The live page loads `js/oldclient/client-battle.js`. Fetching the initial page alone does not provide the move buttons: JavaScript generates the battle room, and the player controls depend on a private server request. We used the official legacy client source to map those controls without logging in or starting a match.

| Visual component | Official selectors | Our frontend |
| --- | --- | --- |
| Entire battle room | `.ps-room[id^="room-battle-"]` | `#app` / `main` |
| Battlefield frame | `.battle` / `.innerbattle` | `#arena-wrap` contains `#arena.battle`; pinned official renderer |
| Background / weather | `.backdrop` / `.weather` | Rendered by the pinned engine inside `#arena` |
| Trainers and team icons | `.leftbar`, `.rightbar`, `.trainer`, `.picon` | Official renderer retains these inside the field |
| Active Pokémon name, HP and status | `.statbar`, `.hpbar`, `.hp`, `.hptext`, `.status` | Official renderer retains these inside the field |
| Turn label and animation messages | `.turn`, `.messagebar` | Official renderer retains these inside the field |
| Chat log, input, spectators | `.battle-log`, `.battle-log-add`, `.battle-userlist`, `.battle-chat-toggle` | No visible chat UI; renderer log is in hidden `#hidden-log` |
| Choice controls | `.battle-controls`, `.controls` | `.command-panel` / `#choices` |
| “What will … do?” | `.whatdo` | `#prompt` and `#turn-label` |
| Four moves | `.movemenu .movebutton`, `button[name="chooseMove"]` | `.moves`, `#move-1` through `#move-4` |
| Move color, type and PP | `.type-*`, `small.type`, `small.pp` | `data-type`, own type palette, PP from current request |
| Six switch slots and HP strips | `.switchmenu button`, `.allyparty`, `.picon` | `.team`, `#switch-1` through `#switch-6`, `.team-hp` |
| Terastallize checkbox | `.megaevo-box`, `.megaevo input` | `#tera` with `aria-pressed` |
| Timer menu | `button[name="openTimer"]` | `#timer-on`, `#timer-off` |
| Sound menu | `button[name="openSounds"]` | `#music` |
| Forfeit prompt | Current battle tab close button opens a popup | `#forfeit` opens our confirmation dialog |
| Information hotspots | `.has-tooltip`, `data-tooltip` | R3 / I inspects the focused move or Pokémon; `#move-details` is the touch entry point |
| Opponent inspection | Sidebar Pokémon tooltips | `#view-own` / `#view-opponent` swap the shared `#roster`; `#opponent-1` through `#opponent-6` remain focusable even when unknown |
| Replay / end controls | `instantReplay`, `rewindTurn`, `skipTurn`, `goToEnd`, `saveReplay` button names | `#replay` and `#skip`; publishing replay is not implemented |
| Gamepad highlight | Userscript `.gen2-gp-sel` | Native focus outline in the same `#d02860` pink |

The official room structure observed in the browser includes:

```html
<div id="room-battle-…" class="ps-room ps-room-opaque">
  <div class="battle">
    <div class="innerbattle">
      <div class="backdrop"></div>
      <!-- sprites, weather, statbars, teams and turn display -->
      <div class="leftbar" aria-label="Your team"></div>
      <div class="rightbar" aria-label="Opponent's team"></div>
      <div class="messagebar message"></div>
    </div>
  </div>
  <div class="battle-log" aria-label="Battle Log"></div>
  <div class="battle-log-add"></div>
  <ul class="battle-userlist userlist userlist-minimized"></ul>
  <div class="battle-controls" aria-label="Battle Controls"></div>
</div>
```

This is an abbreviated structural excerpt, with battle IDs, content, styles and unrelated nodes omitted. Player move markup is verified in source; a spectator cannot see a player's private move controls.

## What we carry over

- Light `#eef2f5` controls, four moves and six team buttons across on tablets, larger icons, type-colored moves, and the pink focus outline.
- Responsive sizing using `visualViewport`, so Safari toolbar changes can resize the field. Controls remain below it instead of hiding the player's sprite.
- Optional horizontal stretching capped at 25%, matching the intent of the userscript; an original-proportions option is available.
- Gamepad actions come from the userscript's actual `ACTIONS` table. Its introductory comment is stale: Select is music, L3 is timer, R3 is information.

## Dependency boundary

These official selectors document how the reference works; our connection and controls do **not** query the live Showdown DOM or `window.app.curRoom`. We own the control IDs and use the wire protocol for state. Only the pinned renderer owns its internal battlefield classes. Upstream website layout changes therefore do not rename our move or team buttons. Renderer updates still need deliberate review. Opponent details read the pinned renderer’s `farSide.pokemon` model and refresh on its subscription events, rather than querying the sidebar HTML. The adapter uses `moveTrack` for observed moves, never an inferred set or the player’s private request. Unknown information stays unknown. Move inspection uses the pinned `@pkmn/dex` reference data, with current PP supplied only for the player’s active request.

Primary code references at our pinned client revision:

- [Legacy battle room and player controls](https://github.com/smogon/pokemon-showdown-client/blob/02c67685cc09d0191a9be015de6db9dfaf5e4159/play.pokemonshowdown.com/src/oldclient/client-battle.js)
- [Battlefield HTML and animations](https://github.com/smogon/pokemon-showdown-client/blob/02c67685cc09d0191a9be015de6db9dfaf5e4159/play.pokemonshowdown.com/src/battle-animations.ts)
- [Original userscript](../../skins/console-skin/console-skin.user.js)

## Speed and possible Random Battle sets

The Speed line in the reference screenshot is standard Showdown functionality. Our adapter calls the pinned [`BattleTooltips.getSpeedRange` and `calculateModifiedStats`](https://github.com/smogon/pokemon-showdown-client/blob/02c67685cc09d0191a9be015de6db9dfaf5e4159/play.pokemonshowdown.com/src/battle-tooltips.ts), via the renderer's tooltip object, and renders the resulting values in our own accessible facts grid. It does not parse generated tooltip HTML or depend on live website selectors. The numeric calculation is not reimplemented. Updating the pinned client still requires checking this adapter.

Opponent Speed estimates use public species, level and format rules, before external modifiers. Own unmodified Speed uses private request stats, matched by Pokémon identity rather than renderer party order; modified Speed is limited to the current, non-fainted active Pokémon at the end of playback. This prevents mixing a future request with an earlier replay turn. Transform falls back to an estimate, as Showdown's tooltip does. Speed alone does not account for move priority or Trick Room when deciding turn order.

The role sections such as **Fast Support**, **Bulky Attacker**, possible items, moves, Tera types and percentages are consistent with [Pokémon Showdown Randbats Tooltip](https://github.com/pkmn/randbats/tree/main/extension). The visible Showdex panel does not establish which extension supplied that tooltip. The [pkmn/randbats](https://github.com/pkmn/randbats) project exposes public JSON used by both extensions and the Random Battle damage calculator. It periodically generates 100,000 teams per supported format and aggregates options and frequencies; these are set possibilities and simulation frequencies, not access to the opponent's actual team. Its extension documentation describes possible stale data and form/stat ambiguities.

The **Possible sets** section now uses a bundled, explicitly refreshable snapshot from the upstream statistics schema. The extension's species/form relationships and the generator's denominators were inspected; we do not install the extension, scrape its HTML, or adopt its reveal-based role filtering. Our renderer separates candidates from revealed facts and never renormalizes role weights. `src/possible-sets.mjs` validates the snapshot and resolves forms; `src/info-components.mjs` renders safe information-only cards. The source date, revision, hash, refresh procedure and failure behavior are documented in the README.
