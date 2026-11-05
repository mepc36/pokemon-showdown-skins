# Showdown controller — minimal example

A static frontend for one **Gen 9 Random Battle** at a time, using the official Pokémon Showdown server and the existing account `mepc36363636`. It owns its controls and WebSocket connection; it does not query or modify the official site's DOM.

## What you can test now

The app opens in a clearly labelled offline display fixture. It shows the official battlefield and sprites, four moves, six slots for either team, and the controller focus behavior. Selecting something in the fixture shows a local confirmation; **no opponent, battle, or matchmaking request is created**.

The implemented live path is connect → authorize on Showdown → confirm identity → block registered bots → search → answer battle requests → finish → replay locally or search again. The live acceptance test is **not yet verified**: the owner confirmed OAuth login works on November 4, 2026; a complete controller battle and disconnect recovery still need acceptance testing.

Authentication configuration and the documented [userscript fallback](docs/authentication.md) are described separately. OAuth remains the active approach; no userscript or backend is needed for it.

## Hosted testing

Main deployment: https://mepc36.github.io/pokemon-showdown-skins/

1. Open it in Safari on the iPad and tap the page once for music.
2. Try the D-pad, A, B, and X in the offline fixture.
3. Open **Controller check** and press each button. Save any button numbers the app should ignore.
4. Open **Display** to compare the userscript-style **Wide field** with **Original proportions**. The choice is saved on this device.

The light controls, pink focus outline, type colors, enlarged icons, HP strips, and Grumpig/Landorus preview follow the supplied userscript and screenshot. The active Pokémon’s **Tera type** is always visible beside its HP, with a direct toggle when Terastallize is available. **Cancel** appears beside the move heading while a submitted choice can be cancelled. **More controls** expands the timer, music, info, skip and forfeit buttons; collapsing them reserves more space for the field. All six of your Pokémon can receive focus, including active or fainted slots; A opens details when switching is unavailable, and R3 opens details for the focused slot. Use **Your team / Opponent** to change the six-slot row. Every opponent slot is navigable, including fainted and unrevealed Pokémon; A or R3 opens details. The inspector reads public reveals from the pinned renderer, stays in sync with playback, and resets when a battle is rebuilt or replaced. Unknown slots, moves, abilities, items and Tera types are not filled from random-team sets. See [the component map](docs/showdown-components.md) for the inspected official HTML and its equivalents here.

Highlight a move and press **R3 / I** for its type, category, base power, base accuracy, current PP, priority, target, contact and effect description. **Move info** gives touch users the same inspector and buttons to inspect each move. Pokémon detail cards also link to their moves; for opponents, only revealed moves appear. B / Escape goes back from a move to its Pokémon, then closes the inspector and restores focus. Inspecting information never submits a choice. Move reference values are labelled as baseline values, not battle-adjusted predictions; opponent moves show base PP, not an invented remaining count.

Pokémon details now include **Speed**. Your unmodified stat comes from the latest private team request. For your current active Pokémon, **Speed (modified)** reuses Showdown's calculation for boosts, paralysis, items, abilities and field effects. It appears only when playback has caught up and the request and displayed active Pokémon agree. Bench, fainted and replay states do not get a misleading modified value. Missing private stats stay unknown; Transform uses Showdown's estimate instead of claiming the original stat is current.

Opponents show **Speed (estimate)** using the pinned Showdown tooltip calculator: for example, level 82 Raikou displays **193 or 236**, before external modifiers. This is a species/level estimate, not a revealed stat or a prediction of turn order. Unrevealed slots stay unknown. Use **Your team / Opponent**, highlight a slot, then press **R3 / I**; **A / Enter** also opens opponent details. No extension, backend, new network dependency, or live Showdown DOM access is needed. See [the component map](docs/showdown-components.md#speed-and-possible-random-battle-sets) for the source and possible-set follow-up.

The fixture is deliberately small. It does not simulate a battle or prove live login, reconnect, iPad audio, or hardware mapping.

Validation completed: 23 automated protocol/input/information tests, a production build, keyboard inspection at 1024×650 and 390×720, and 17 renderer integration checks. These cover public reveals, snapshot/room resets, both player perspectives, the Raikou Speed example, boosts/Choice Scarf/paralysis rounding, Tailwind, and replay guards. Earlier connection testing reached Showdown's anonymous login challenge. The owner has confirmed OAuth login. A complete authenticated battle and physical-controller acceptance test have not been verified.

## Enable live login

An existing Showdown player account is separate from an application's public client ID. Do not copy another application's ID, scrape login cookies, or put your password in this project.

1. Use the approved ID `884f404fc4be81e1d3eb`. It is configured in this branch's `public/config.json`; on the current live site, paste it into **Setup → Public application ID → Save setup**. No merge is required for that browser-local setting.
2. Press **Connect to Showdown**, then **Sign in with Showdown**. Keep the app tab open. Sign in to `mepc36363636` on Showdown's own page and authorize **showdown_skins**.
3. Confirm **Signed in as mepc36363636**, then use **Reconnect** before matchmaking to check that authorization is reused.
4. Press **Find Random Battle** only when ready to finish a real ladder match.

Showdown's authorization page recognizes this ID as **showdown_skins by mepc36363636**, and its API permits the `https://mepc36.github.io` origin. This checks the registration; it does not prove an authenticated battle. The primary [OAuth documentation](https://github.com/smogon/pokemon-showdown-loginserver/blob/master/OAUTH.md) describes the callback and token flow.

The callback is `auth-callback.html` beside `index.html`. Its query string is cleared immediately. The app verifies callback origin, popup source, and a random state value. Passwords never enter this app. An OAuth token is saved in this browser's local storage to reconnect and refresh authorization; **Clear saved sign-in** removes it locally. Tokens are not committed or logged. Showdown's authorization settings can revoke the authorization itself.

## Controller mapping

This follows the actual mappings in `console-skin.user.js`, not the stale header comment. Different controller connection modes may report different indices.

| Button index | Action |
| --- | --- |
| 12 / 13 / 14 / 15 | Up / down / left / right |
| 1 | Confirm (A in the existing setup) |
| 0 | Undo / close dialog (B) |
| 3 | Toggle Terastallize (X) |
| 8 | Music on / off (Select) |
| 9 | Forfeit confirmation (Start) |
| 10 | Reveal controls and focus Timer on (L3); A confirms, right reaches Timer off |
| 11 | Focused move or Pokémon information, or the whole team (R3) |
| 5 | Unbound (R1) |

Arrow keys and Enter work too. Escape cancels; X toggles the visible Tera control; M toggles music; T reveals the timer controls; I opens information. Directional inputs repeat; confirm acts once per press. The diagnostics screen reports received keys, button edges, and stick directions. Ignoring a button only disables **this app's** reaction; it cannot suppress iPadOS-reserved actions.

## Cancel while waiting for the opponent

Move and switch selections are submitted immediately, as on the official Showdown client. While a choice is pending and the request allows cancellation, **Cancel** is visible beside the move heading. Selecting a choice focuses Cancel; **A / Enter** on that button or **B / Escape** sends the existing Showdown `/undo` command with the current request ID. No extra confirmation step or local selection state is added.

This uses Showdown's existing cancellation behavior: the choice has already been sent, but can be withdrawn before the turn proceeds if the server still permits it. The server may reject a late cancellation. Cancel is hidden when there is no pending choice, when `noCancel` applies, during recovery, or after battle end. Cancelling restores focus to the selected move where possible. The offline fixture never sends choices, so it has no live Cancel state.

## Reconnect behavior

- Retain only the current battle room ID across reloads; do not persist a choice to resend.
- Reconnect with backoff, request an assertion for the **new** challenge, wait for `updateuser`, and rejoin the room.
- Rebuild the renderer from server history. Lock choices until a current `request` arrives.
- Process `request` and `sentchoice` within the same packet before rendering controls. A previously submitted choice remains pending.
- Send choices with their current `rqid`. Never automatically replay a move or start another search after a connection drop.
- A successful undo has no dedicated acknowledgement; unlock locally, as the official client does. The server can still reject a late undo or choice.
- If iPadOS suspends Safari long enough for the battle timer to expire, reconnect cannot restore the lost time or undo the result.

## Run and build

Node 22+ and Python 3 are needed for the build. The deployed output needs only static HTTPS hosting.

```sh
cd frontend
npm ci
npm test
npm run dev
```

For a standalone source ZIP, run the commands from the extracted directory and omit `cd frontend`.

For a local Cancel UI check, open `/test/cancel.html`, choose **Connect to Showdown**, select a move, then use **Cancel** or **B / Escape**. This explicitly labelled fixture replaces only the WebSocket transport with a simulation and displays the emitted `/choose` and `/undo` commands; it never opens a live match.

For the real renderer integration checks and tablet/phone layout fixtures, open `/test/renderer.html` on the local dev server and press **Run renderer checks**. This test page is not included in the production app.

`npm run build` creates `dist/`, including a downloadable source archive. `npm ci` downloads exact upstream revisions and checks their SHA-256 hashes. Downloads are skipped when the checked files already exist. `package-lock.json` pins npm dependencies.

In the existing skins repository, the app lives under `frontend/`; the original userscripts remain in `skins/`. The Pages workflow belongs at the repository root as `.github/workflows/controller-frontend.yml`. It tests PRs and uploads a static-build artifact. Frontend changes merged into `main` are tested, built, and deployed to Pages automatically. Manual **Controller frontend → Run workflow → deploy** remains available. Pages is already enabled through **Settings → Pages → GitHub Actions**, and the owner made this repository public. The same `dist/` can be hosted by the existing martinconnor.com pipeline.

## Acceptance test on the actual iPad

With the approved client ID configured:

1. Log in as `mepc36363636`; verify the signed-in name.
2. Start a Random Battle and complete it using the controller, including a normal move, switch, forced switch, and Terastallize when available.
3. While waiting for an opponent, press **Reconnect**. Confirm the submitted choice stays pending and is not resent.
4. Briefly disable and restore Wi-Fi; recover the same battle. Also reload the page and sign back in. Do this with the battle timer in mind.
5. Try undo, timer on/off, forfeit confirmation, and end-of-battle replay. Confirm all controls can be reached without touch.
6. After the initial tap, check music through a second battle. Test Safari backgrounding and both portrait and landscape.

## Deliberate limits of this first version

- Gen 9 Random Battle singles only; one room at a time. No teambuilder, chat, challenges, doubles, or battle automation.
- `/blockbots` excludes registered ladder bots. It does not establish that every other account is a human.
- Official renderer, move effects, backgrounds, and static sprite fallback. The full animated-sprite metadata and uncommon icon variants are not packaged yet. Trainer-name avatars work; only the fixture's two legacy numeric avatars are mapped.
- Music currently uses the existing media element. Music continuity is handled in a separate PR; physical iPad autoplay and interruption behavior require device testing.
- Move details use Gen 9 reference values; damage and battle-adjusted move properties are not computed. Speed uses the pinned Showdown calculator as described above. Opponent information reflects public events through the displayed turn, with approximate HP and unknown values left unknown; Speed estimates are separately labelled.
- Replay plays the current battle locally. Publishing to Showdown's replay service is not included.
- The current layout uses the supplied screenshot's large-field / move-row / team-row structure, but is not a pixel-accurate reproduction.
- Browser suspensions, networking, popup behavior, and OS-reserved buttons require actual-device testing. Automated protocol fixtures are not a substitute for completing a live human battle.

## Dependencies and architecture

`src/session.mjs` owns the wire protocol. `src/auth.mjs` handles authorization. `src/controller.mjs` handles focus and button edges. `src/renderer.js` is the small boundary around the pinned upstream renderer. `src/information.mjs` adapts its public opponent state and provides move reference data. `src/main.js` and the stylesheet own the UI. The full official frontend is not embedded or forked.

`vendor/manifest.json` records exact file URLs and checksums; `vendor/upstream.json` records repository revisions. Two tiny local bridge modules supply renderer configuration. A Vite transform defers circular animation aliases for ESM and removes Node-only global exports from the browser build. Copied battle CSS uses absolute official asset URLs. These are the only integration adaptations; there are no selectors aimed at the live Showdown client.

Useful primary references: [wire protocol](https://github.com/smogon/pokemon-showdown/blob/master/PROTOCOL.md), [simulator protocol](https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md), [official client](https://github.com/smogon/pokemon-showdown-client), and [login protocol](https://github.com/smogon/pokemon-showdown-loginserver/blob/master/OAUTH.md).

See `THIRD_PARTY_NOTICES.md` for source and asset notices.

## Possible sets and all moves

**All moves** beside the team tabs opens an information browser for all six slots on either side. **Your known moves / Revealed moves** uses private team/current-request data for your team and public `moveTrack` events for opponents. **Possible moves** shows a separate union of candidate moves from the dataset. It is not a learned moveset. Unknown slots remain unknown; fainted Pokémon remain inspectable. Move cards show reference type, category, power, accuracy, PP and a short description; A / Enter or R3 / I opens full details. Browsing never submits a choice. B / Escape restores the prior card and scroll position.

Each Pokémon detail panel has a separate **Possible sets** section: roles, abilities, items, Tera types and move frequencies. Role percentages are shares of simulated sets for that form; option percentages are frequencies *within the role*. Move percentages can sum above 100%. No frequencies are filtered or renormalized using public reveals, and no candidate data is written into confirmed battle state. Illusion and Transform can make the displayed species misleading.

The bundled `public/data/gen9randombattle.json` snapshot comes from [pkmn/randbats](https://github.com/pkmn/randbats), whose generator samples 100,000 teams per format. It carries a source commit, UTC source/retrieval dates and the raw source SHA-256. The UI shows the source date and link and warns that live sets may have changed. Species/form matching handles documented cosmetic and battle-only relationships; ambiguous variants stay labelled, and missing data is explicit. A failed or malformed snapshot leaves battle controls and known/revealed moves working, with a Retry action.

Refresh deliberately with `npm run refresh:sets` (current upstream) or `npm run refresh:sets -- <full-upstream-commit-sha>`, review the snapshot diff, then commit it. The script retrieves metadata, statistics and license at the same immutable revision and validates before replacement. Builds do not refresh silently. Browsers fetch only the bundled same-origin JSON with credentials omitted, so set browsing needs neither external CORS nor access to the data host or OAuth credentials.

## Planned visual pass (not part of this PR)

Make move types faster to recognize through stronger type-colored shading of move names/cards and nontextual cues such as type/category icons. Keep accessible labels and controller focus contrast. The existing action-button palette remains in place; the new information components use the current neutral styling until that separate pass.
