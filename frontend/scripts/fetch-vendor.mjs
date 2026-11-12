import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = JSON.parse(await readFile(resolve(root, 'vendor/manifest.json'), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
async function fetchFile(file) {
  const output = resolve(root, file.output);
  try { if (hash(await readFile(output)) === file.sha256) return; } catch {}
  const response = await fetch(file.url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Vendor download failed: ${file.output} (${response.status})`);
  let content = file.binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  if (file.absoluteAssetUrls) content = content.replaceAll('url(../', 'url(https://play.pokemonshowdown.com/');
  if (hash(content) !== file.sha256) throw new Error(`Vendor checksum mismatch: ${file.output}`);
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, content);
}
// Eight downloads at a time. Every file is attempted before the first failure is reported.
const queue = [...files], failures = [];
await Promise.all(Array.from({length: 8}, async () => {
  for (let file; (file = queue.shift());) await fetchFile(file).catch(error => failures.push(error));
}));
if (failures.length) throw failures[0];
console.log(`Verified ${files.length} pinned upstream files.`);
