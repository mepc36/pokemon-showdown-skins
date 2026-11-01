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
| Information hotspots | `.has-tooltip`, `data-tooltip` | R3 / `#info` and focusable team slots; rich opponent tooltips pending |
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

These official selectors document how the reference works; our connection and controls do **not** query the live Showdown DOM or `window.app.curRoom`. We own the control IDs and use the wire protocol for state. Only the pinned renderer owns its internal battlefield classes. Upstream website layout changes therefore do not rename our move or team buttons. Renderer updates still need deliberate review.

Primary code references at our pinned client revision:

- [Legacy battle room and player controls](https://github.com/smogon/pokemon-showdown-client/blob/02c67685cc09d0191a9be015de6db9dfaf5e4159/play.pokemonshowdown.com/src/oldclient/client-battle.js)
- [Battlefield HTML and animations](https://github.com/smogon/pokemon-showdown-client/blob/02c67685cc09d0191a9be015de6db9dfaf5e4159/play.pokemonshowdown.com/src/battle-animations.ts)
- [Original userscript](../../skins/console-skin/console-skin.user.js)
