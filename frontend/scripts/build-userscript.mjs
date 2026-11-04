import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, mergeConfig} from 'vite';
import config from '../vite.config.js';
import {installControllerLauncher} from '../../skins/controller-client/launcher.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'userscript-dist');
const built = await build(mergeConfig(config, {
  configFile: false, root, publicDir: false,
  build: {write: false, minify: true, cssCodeSplit: false,
    lib: {entry: resolve(root, 'src/main.js'), name: 'ShowdownController', formats: ['iife']},
  },
}));
const outputs = Array.isArray(built) ? built.flatMap(result => result.output) : built.output;
const bundle = outputs.filter(file => file.type === 'chunk').map(file => file.code).join('\n');
const css = outputs.filter(file => file.type === 'asset' && file.fileName.endsWith('.css')).map(file => file.source).join('\n');
if (!bundle || !css) throw new Error('Userscript bundle is incomplete.');
const read = path => readFile(resolve(root, path), 'utf8');
const script = text => `<script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
let html = await read('index.html');
for (const file of ['battle.css', 'sim-types.css']) {
  const style = await read(`public/vendor/${file}`);
  html = html.replace(`<link rel="stylesheet" href="./vendor/${file}">`, () => `<style>${style}</style>`);
}
for (const file of ['html-sanitizer-minified.js', 'html-css-sanitizer-minified.js', 'battle-log-misc.js']) {
  const source = await read(`public/vendor/${file}`);
  html = html.replace(`<script src="./vendor/${file}"></script>`, () => script(source));
}
const settings = {authMode: 'showdown-session', username: 'mepc36363636', server: 'wss://sim3.psim.us/showdown/websocket', launcherNonce: '__CONTROLLER_LAUNCHER_NONCE__'};
html = html.replace('</head>', () => `<style>${css}</style></head>`)
  .replace('<script type="module" src="./src/main.js"></script>', () => script(`window.__SHOWDOWN_CONTROLLER_CONFIG__=${JSON.stringify(settings)};`) + script(bundle))
  .replace('<a href="./source.zip" download>Source</a>', '<a href="https://github.com/mepc36/pokemon-showdown-skins" target="_blank" rel="noopener noreferrer">Source</a>');
const markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>');
if (/<script[^>]+src=|<link[^>]+href=|type="module"/i.test(markup)) throw new Error('The installed app must be self-contained.');
const encoded = Buffer.from(html).toString('base64');
const header = `// ==UserScript==
// @name         Showdown Independent Controller (prototype)
// @namespace    https://github.com/mepc36/pokemon-showdown-skins
// @version      0.2.0
// @description  Launch an independent controller UI using your existing Showdown session.
// @match        https://play.pokemonshowdown.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==
`;
const source = `${header}\n(() => {\n'use strict';\nconst install = ${installControllerLauncher.toString()};\n// Generated app payload; edit frontend/src and rebuild, rather than editing this line.\nconst payload = '${encoded}';\nconst html = new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)));\ninstall(html);\n})();\n`;
await mkdir(out, {recursive: true});
await writeFile(resolve(out, 'controller-client.user.js'), source);
await writeFile(resolve(out, 'INSTALL.md'), await readFile(resolve(root, '../skins/controller-client/README.md'), 'utf8'));
// Local browser QA only. This file is ignored and is never packaged into Pages.
await mkdir(resolve(root, 'test/generated'), {recursive: true});
await writeFile(resolve(root, 'test/generated/controller.html'), html);
console.log(`Built userscript-dist/controller-client.user.js (${(Buffer.byteLength(source) / 1024 / 1024).toFixed(1)} MiB, including the frontend).`);
