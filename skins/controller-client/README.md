# Independent controller userscript — paused backup

**Status (November 4, 2026): OAuth approval arrived. Use the normal GitHub Pages frontend and the approved public client ID. This draft is retained as a fallback, not the current installation path. Nothing from this PR has been merged or deployed.**

## Design

The checked-in `controller-client.user.js` is approximately 7.5 KiB. It adds **Open controller UI** on `https://play.pokemonshowdown.com/`, then opens a separately hosted copy of our frontend in a cross-origin iframe. The frontend owns its DOM, CSS, controls, pinned renderer and WebSocket. Neither side queries Showdown component IDs/classes or accesses its application objects.

The frontend requests an assertion through `postMessage`. The launcher calls the same-origin `/api/upkeep?challstr=…` endpoint using browser-managed Showdown session cookies. It sends only the assertion and expected username back to the frame; it never reads cookies or handles passwords. Both sides check the exact source window, origin, per-frame nonce and request ID. Returned assertions must match the current challenge and `mepc36363636`. Closing the frame aborts outstanding requests; reconnecting gets a fresh assertion. No moves or matchmaking searches are replayed automatically.

No backend of our own or OAuth client ID is needed for this fallback. It still depends on Showdown's login API, battle protocol, browser support and trusted hosted frontend code. UI updates come from the static host; the small script only needs replacing when the launcher/bridge changes. Never configure the launcher to trust someone else's frontend origin.

## Resume the backup only if needed

1. Build and publish the bridge-enabled frontend to a separate static preview. The configured `showdown-controller-pr-preview.almondearth2048.chatgpt.site` address was reserved but **never published**; it is not currently an install-ready test URL. Leave the production Pages site untouched.
2. Confirm the exact preview URL in `frontend/src/userscript-launcher.mjs`, run `npm run build:userscript` from `frontend/`, and commit the updated `skins/controller-client/controller-client.user.js`.
3. Download that small `.user.js` directly from the PR branch. No Actions artifact or frontend build is needed on the iPad. Disable the old console-skin/gamepad-debug scripts, then install it using Safari Userscripts or Tampermonkey.
4. Sign in normally on Showdown as `mepc36363636`; choose **Open controller UI → Connect to Showdown**. Verify the account and reconnect before explicitly searching for a match.
5. Complete a real battle and check reconnection, audio and the physical controller on the iPad. Closing the controller disconnects its socket without forfeiting; battle time still passes.

## Development and verification

Source: `frontend/src/userscript-launcher.mjs`, `session-upkeep.mjs` and `session-bridge.mjs`. The generator only joins small JavaScript sources; it does not bundle the frontend into the installed file. CI checks that the committed script matches its sources and does not deploy PRs to Pages.

From a complete repository checkout:

```sh
cd frontend
npm ci
npm test
npm run check:userscript
npm run build
```

The local `/test/userscript.html` fixture uses only a local test parent; it cannot authenticate against a real Showdown session. The production bridge never accepts a parent origin from URL input. The static production output excludes these HTML fixtures.

Automated tests cover wrong origins/windows/nonces, stale or wrong-account assertions, timeout/close cleanup and reconnecting without resending a pending choice. Persistent storage denial falls back to memory, so preferences and room markers may be lost across reloads. iPad frame permissions may limit gamepad/audio access; actual-device testing remains necessary. The normal Showdown client keeps running underneath the frame.

The earlier bundled prototype had browser fixture checks; the new hosted bridge has automated tests and a successful build, but its browser, authenticated-battle and physical-device acceptance checks were paused when OAuth approval arrived.

References: [Showdown protocol](https://github.com/smogon/pokemon-showdown/blob/master/PROTOCOL.md), [Safari Userscripts](https://github.com/quoid/userscripts#installation).
