import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Use the standard Python ZIP writer; no ZIP dependency ships to browsers.
execFileSync('python3', ['-c', `
import pathlib, zipfile
root = pathlib.Path('.')
with zipfile.ZipFile(root/'public/source.zip', 'w', zipfile.ZIP_DEFLATED) as out:
 for name in ['src','test','scripts','vendor','public','index.html','package.json','package-lock.json','vite.config.js','README.md','LICENSE','THIRD_PARTY_NOTICES.md','.github','.gitignore']:
  path=root/name
  files=path.rglob('*') if path.is_dir() else [path]
  for f in files:
   if f.is_file() and f.as_posix() != 'public/source.zip': out.write(f, f.as_posix())
`], {cwd: root, stdio: 'inherit'});
