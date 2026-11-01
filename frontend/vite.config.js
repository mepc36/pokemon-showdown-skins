import { defineConfig } from 'vite';
// Upstream builds these circular modules together. ESM needs aliases evaluated
// lazily; keep the pinned vendor files untouched and adapt only at build time.
const upstreamEsm = {
  name: 'upstream-animation-aliases', enforce: 'pre',
  transform(source, id) {
    if (!id.includes('/vendor/pokemon-showdown/')) return;
    // Bundlers can inject a require shim; that must not activate Node-only globals.
    source = source.replaceAll("if (typeof require === 'function')", 'if (false)');
    if (id.endsWith('/battle-animations-moves.ts')) {
      source = source.replace(/(anim|prepareAnim): (BattleOtherAnims\.\w+\.anim),/g,
        '$1(...args) { return $2(...args); },');
    }
    return source;
  },
};
export default defineConfig({base: './', plugins: [upstreamEsm], server: {allowedHosts: ['terminal.local']}, build: {target: 'es2020'}});
