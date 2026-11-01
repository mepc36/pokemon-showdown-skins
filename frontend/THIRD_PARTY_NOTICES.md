# Third-party notices

This independent example is not an official Pokémon Showdown product.

- Pokémon Showdown client: https://github.com/smogon/pokemon-showdown-client. Exact revision in `vendor/upstream.json`. The client is AGPL-3.0; battle replay/animation source files carry MIT/CC0 notices and specific exceptions. Upstream notices are preserved. The full client license is in `vendor/CLIENT-LICENSE` and the source distribution's `LICENSE`. This example is distributed under AGPL-3.0, with these upstream notices preserved.
- Pokémon Showdown simulator text data: https://github.com/smogon/pokemon-showdown, exact revision in `vendor/upstream.json`; MIT license in `vendor/SERVER-LICENSE`.
- `@pkmn/dex` 0.10.11: https://github.com/pkmn/ps, MIT; incorporates Pokémon Showdown data.
- jQuery 3.7.1: https://jquery.com, MIT.
- The upstream Caja HTML/CSS sanitizers retain their upstream terms. See the upstream client repository and the original Google Caja project (Apache-2.0).
- Sprites, trainer artwork, backgrounds, effects, and audio are requested from `play.pokemonshowdown.com` at runtime, not relicensed as original artwork. Pokémon characters and artwork remain the property of their respective rights holders. The renderer's source-code license does not cover all visual/audio assets. Effect-specific exceptions are preserved in the header of `battle-animations.ts`.
- Google Fonts serves DM Sans and Space Grotesk under the fonts' respective open font licenses.

The downloadable source archive includes the pinned vendored code used to build this app. The build-time adapters are documented in `README.md` and `vite.config.js`.
