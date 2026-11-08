import { defineConfig } from 'vite';
// Upstream builds these circular modules together. ESM needs aliases evaluated
// lazily; keep the pinned vendor files untouched and adapt only at build time.
const upstreamEsm = {
  name: 'upstream-animation-aliases', enforce: 'pre',
  transform(source, id) {
    if (!id.includes('/vendor/pokemon-showdown/')) return;
    // Bundlers can inject a require shim; that must not activate Node-only globals.
    source = source.replaceAll("if (typeof require === 'function')", 'if (false)');
    if (id.endsWith('/battle-animations.ts')) {
      // Upstream prefixes effect sprite URLs only if window.Dex exists while this module evaluates.
      // In our ESM graph battle-dex is still in its import cycle at that point, so prefix unconditionally.
      source = source.replace('if (!window.Dex || !Dex.resourcePrefix) return;', '')
        .replace('BattleEffects[id].url = Dex.fxPrefix + BattleEffects[id].url;',
          "BattleEffects[id].url = (window.location.protocol === 'http:' ? '' : 'https:') + '//play.pokemonshowdown.com/fx/' + BattleEffects[id].url;");
    }
    if (id.endsWith('/battle-animations-moves.ts')) {
      source = source.replace(/(anim|prepareAnim): (BattleOtherAnims\.\w+\.anim),/g,
        '$1(...args) { return $2(...args); },');
    }
    return source;
  },
};
export default defineConfig({base: './', plugins: [upstreamEsm], server: {allowedHosts: ['terminal.local']}, build: {target: 'es2020'}});
