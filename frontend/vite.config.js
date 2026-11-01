import { defineConfig } from 'vite';
// Upstream builds these circular modules together. ESM needs aliases evaluated
// lazily; keep the pinned vendor files untouched and adapt only at build time.
const upstreamEsm = {
  name: 'upstream-animation-aliases', enforce: 'pre',
  transform(source, id) {
    if (!id.endsWith('/battle-animations-moves.ts')) return;
    return source.replace(/(anim|prepareAnim): (BattleOtherAnims\.\w+\.anim),/g,
      '$1(...args) { return $2(...args); },');
  },
};
export default defineConfig({base: './', plugins: [upstreamEsm], server: {allowedHosts: ['terminal.local']}, build: {target: 'es2020'}});
