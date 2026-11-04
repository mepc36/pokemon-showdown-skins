# Authentication: OAuth first, userscript backup

## Active approach

The application uses Pokémon Showdown's OAuth-like browser flow. The approved public client ID is `884f404fc4be81e1d3eb`; it is an identifier, not a secret, and may be committed in `public/config.json`.

- App: https://mepc36.github.io/pokemon-showdown-skins/
- Registered origin required by this client: `https://mepc36.github.io`
- Callback: `https://mepc36.github.io/pokemon-showdown-skins/auth-callback.html` (with a per-attempt `state` query parameter).
- Expected account: `mepc36363636`.

The frontend opens Showdown's authorization page, receives an assertion and token through its callback, and authenticates its own WebSocket. The opener checks origin/source/state; the callback clears its credential-bearing URL and posts the result to the opener. The app stores the OAuth token locally for fresh assertions on reconnect and refreshes it after a week. It sends a new search only after an explicit user action. Passwords stay on Showdown. Tokens and assertions must not be committed or shared.

The owner confirmed that OAuth login works on November 4, 2026. The existing live site can be tested before this configuration PR is merged: open **Setup**, paste the public ID, choose **Save setup**, then **Connect to Showdown → Sign in**. Sign in as the expected account on Showdown and authorize the app. Wait for **Signed in as mepc36363636** before starting a Random Battle. The Setup value is a per-browser override of the default in `config.json`.

This PR does not deploy itself. It also adds visible Tera information and a visible Cancel button using Showdown's existing undo command; those UI changes require deploying the PR before they appear on the live site. PR checks run normally; Pages deployment remains limited to a push to main or an explicitly requested deployment.

## Userscript fallback (paused)

[Draft PR #4](https://github.com/mepc36/pokemon-showdown-skins/pull/4) preserves the alternative for use only if OAuth becomes unsuitable. The current prototype is a roughly 7.5 KiB script plus a separately hosted independent frontend; it does not embed a multi-megabyte app in the script.

The script runs on Showdown, opens the frontend in a cross-origin iframe, and supplies fresh assertions through a narrowly scoped `postMessage` bridge. It calls Showdown's `/api/upkeep` with browser-managed session cookies; it never reads or forwards cookies or handles a password. Both sides validate the sender window, exact origin, nonce and request ID; the assertion must match the connection challenge and expected account.

The UI, battle protocol and WebSocket remain independent of Showdown component IDs/classes. This fallback needs no backend of our own or OAuth ID, but does need a trusted static frontend host, a userscript installation, and real iPad checks for frame/gamepad/audio compatibility. The reserved preview was not published after OAuth approval arrived. It is not currently an install-ready alternative. Details and remaining work are in the draft PR's `skins/controller-client/README.md`.

## Remaining acceptance checks

1. Confirm the signed-in account name on the iPad (OAuth login has already been reported working).
2. Reconnect before matchmaking; confirm authorization is reused.
3. Check the visible Tera type; submit a move, cancel while waiting for the opponent, then select another. Complete a Gen 9 Random Battle using the controller.
4. During another battle, reconnect while waiting; recover the room and keep the submitted move pending without replaying it.
5. Verify first-tap music, timer, Tera, switching, forfeit confirmation and end-of-battle controls.

`/blockbots` excludes registered bots; it cannot guarantee every opponent is human. Mock protocol tests do not establish successful real login, physical controller compatibility or recovery after an actual iPad suspension.

Primary reference: https://github.com/smogon/pokemon-showdown-loginserver/blob/master/OAUTH.md
