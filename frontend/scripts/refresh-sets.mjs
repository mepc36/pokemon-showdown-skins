import {mkdir, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSetData, SET_FORMAT, SET_SOURCE} from '../src/possible-sets.mjs';

// All inputs come from one immutable upstream commit. Nothing refreshes silently
// at install/build time; commit the resulting snapshot after reviewing its diff.
const ref = process.argv[2] || 'main';
if (ref !== 'main' && !/^[a-f0-9]{40}$/.test(ref)) throw new Error('Use a full upstream commit SHA');
const get = async url => {
  const response = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Snapshot fetch failed: ${response.status}`);
  return response;
};
const commit = await (await get(`https://api.github.com/repos/pkmn/randbats/commits/${ref}`)).json();
if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid upstream commit');
const root = `https://raw.githubusercontent.com/pkmn/randbats/${commit.sha}`;
const raw = await (await get(`${root}/data/stats/${SET_FORMAT}.json`)).text();
const snapshot = {schemaVersion: 1, format: SET_FORMAT, source: {url: SET_SOURCE,
  commit: commit.sha, updatedAt: commit.commit.committer.date, retrievedAt: new Date().toISOString(),
  sha256: createHash('sha256').update(raw).digest('hex')}, pokemon: validateSetData(JSON.parse(raw))};
const upstream = await (await get(`https://api.github.com/repos/pkmn/randbats/contents/vendor/pokemon-showdown?ref=${commit.sha}`)).json();
if (!/^[a-f0-9]{40}$/.test(upstream.sha)) throw new Error('Invalid generator revision');
const rules = {source: {repository: 'https://github.com/smogon/pokemon-showdown', commit: upstream.sha,
  path: 'data/random-battles/gen9/sets.json', randbatsCommit: commit.sha, license: 'MIT'},
  pokemon: await (await get(`https://raw.githubusercontent.com/smogon/pokemon-showdown/${upstream.sha}/data/random-battles/gen9/sets.json`)).json()};
for (const pokemon of Object.values(rules.pokemon)) {
  if (!Array.isArray(pokemon.sets) || !pokemon.sets.length || pokemon.sets.some(set =>
    !set.role || ['movepool', 'abilities', 'teraTypes'].some(key => !Array.isArray(set[key]) || !set[key].length))) {
    throw new Error('Invalid generator set definitions');
  }
}
const license = await (await get(`${root}/LICENSE`)).text();
const directory = new URL('../public/data/', import.meta.url);
await mkdir(directory, {recursive: true});
const target = new URL(`${SET_FORMAT}.json`, directory);
const rulesTarget = new URL('../src/set-rules.json', import.meta.url);
const rulesText = `{\n  "source": ${JSON.stringify(rules.source)},\n  "pokemon": {\n${Object.entries(rules.pokemon).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n  }\n}\n`;
await writeFile(new URL(`${SET_FORMAT}.json.tmp`, directory), JSON.stringify(snapshot) + '\n');
await writeFile(new URL('../src/set-rules.json.tmp', import.meta.url), rulesText);
await writeFile(new URL('../vendor/RANDBATS-LICENSE', import.meta.url), license);
await rename(new URL(`${SET_FORMAT}.json.tmp`, directory), target);
await rename(new URL('../src/set-rules.json.tmp', import.meta.url), rulesTarget);
console.log(`Saved ${Object.keys(snapshot.pokemon).length} species from ${commit.sha} to ${fileURLToPath(target)}`);
