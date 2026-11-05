import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = JSON.parse(await readFile(resolve(root, 'vendor/manifest.json'), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
for (const file of files) {
  const output = resolve(root, file.output);
  try { if (hash(await readFile(output)) === file.sha256) continue; } catch {}
  const response = await fetch(file.url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Vendor download failed: ${file.output} (${response.status})`);
  let content = file.binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  if (file.absoluteAssetUrls) content = content.replaceAll('url(../', 'url(https://play.pokemonshowdown.com/');
  if (hash(content) !== file.sha256) throw new Error(`Vendor checksum mismatch: ${file.output}`);
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, content);
}
console.log(`Verified ${files.length} pinned upstream files.`);
