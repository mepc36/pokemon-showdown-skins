# Independent controller userscript — prototype

This adds **Open controller UI** to `https://play.pokemonshowdown.com/`. It launches the existing controller frontend in a same-origin `srcdoc` frame, with its own DOM, CSS, JavaScript globals and WebSocket. It does not move official UI elements, query their classes/IDs, patch their socket, or access their application objects.

The frame asks Showdown's documented `/api/upkeep?challstr=…` endpoint for an assertion using the browser's existing session. It never reads `document.cookie`, handles a password, stores an assertion, or sends a credential to GitHub Pages. Each new socket challenge gets a fresh assertion. It accepts only `mepc36363636`. No OAuth app ID or backend is required.

The installed userscript contains a bundled copy of the app (several MiB). Only the launcher logic is small. It does not fetch executable application code from a moving branch or the live Pages site. Showdown still supplies sprites, music, login and battle services. Updating the app requires building and reinstalling the userscript.

## Install the PR build on iPad

1. Open this PR's **Controller frontend** workflow run and download its **controller-userscript** artifact. Unzip it in Files.
2. Disable the old **console-skin** and **gamepad-debug** scripts for this test; their independent gamepad polling can trigger duplicate actions.
3. Put `controller-client.user.js` in your Safari Userscripts app's selected folder. Enable Userscripts for `play.pokemonshowdown.com`.
4. Open Showdown in Safari and sign in normally as **mepc36363636**. Tap **Open controller UI**.
5. Tap inside the controller once for audio, then **Connect to Showdown**. Confirm the signed-in account. A battle starts only when you press **Find Random Battle**.

On desktop, import the same `.user.js` into Tampermonkey. `launcher.js` is build source, not the installable script.

## Test without starting a match

The controller initially shows the existing offline fixture. Try the D-pad, move/Pokémon info, **Display**, and **Controller check**. The parent Showdown page should remain unchanged when you choose **Back to Showdown**.

After connecting, choose **Reconnect** before searching. It should authenticate the new connection as the same account using the session cookie. If logged out or signed in to a different account, it should remain locked and direct you back to Showdown's sign-in. Logging in on Showdown, then reopening the controller, retries without an OAuth ID.

To exercise recovery during a real battle, choose **Reconnect** while waiting for the opponent. The server history should restore the room, a submitted choice should remain pending, and no move or new search should be sent automatically. Finish any match you start. Closing the controller disconnects its socket and does not forfeit; the normal Showdown client remains available. A suspended iPad can still lose battle time.

## Build locally

```sh
cd frontend
npm ci
npm test
npm run build:userscript
```

Install `frontend/userscript-dist/controller-client.user.js` (relative to the repo root). PR CI uploads it as an artifact; it does not deploy the branch to Pages. The ordinary `npm run build` still produces the OAuth-based static frontend. Neither old userscript is modified.

For local browser QA after building, run `npm run dev` and visit `/test/userscript.html`. That harness deliberately uses a non-Showdown origin, so real session login is refused. Authentication/reconnect fixtures run in `npm test`; they make no live account requests.

## Boundaries and remaining checks

- The frame isolates layout and globals, not security privileges. Only install userscripts you trust on your signed-in Showdown origin.
- Showdown's login API, battle protocol, site policies and browser userscript/frame support can still change. The copied renderer is pinned; live site selector changes do not affect it.
- The normal Showdown client continues running underneath. Mute its music if it competes with controller audio; this script does not reach into its audio internals.
- The launcher ignores messages from other windows, unexpected origins, or an earlier frame. Assertions are never sent through `postMessage`.
- A real authenticated battle and Safari/SN30 Pro+ test are still required. Browser and mocked protocol checks do not establish physical-device compatibility or successful live login.

References: [Showdown protocol](https://github.com/smogon/pokemon-showdown/blob/master/PROTOCOL.md), [Safari Userscripts installation](https://github.com/quoid/userscripts#installation).
