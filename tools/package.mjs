/**
 * Build the zip that goes on a GitHub Release.
 *
 *   npm run package
 *
 * Contains only what Chrome needs to run the extension — manifest plus `src/`
 * — so a reader downloads a few tens of KB rather than the whole repo with its
 * tests, screenshots and design notes.
 *
 * Built from `git archive`, which reads committed content: the zip can never
 * contain a half-finished edit sitting in the working tree. It also means an
 * uncommitted change is silently absent, so a dirty tree is reported rather
 * than trusted.
 *
 * The extracted folder is named `youtube-side-comments/` and holds
 * `manifest.json` at its top level, because that is the folder Chrome's "Load
 * unpacked" has to be pointed at. The name is deliberately stable across
 * versions so the instructions never have to change.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = 'youtube-side-comments';

const { version } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const out = join('dist', `${FOLDER}-${version}.zip`);

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim();
if (dirty) {
  console.warn('! The working tree has uncommitted changes. They will NOT be in the zip —');
  console.warn('  it is built from the last commit. Commit first if that is not what you want.\n');
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });

execFileSync(
  'git',
  [
    'archive',
    '--format=zip',
    `--prefix=${FOLDER}/`,
    '-o',
    out,
    'HEAD',
    'manifest.json',
    'src',
    'README.md',
    'LICENSE',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

console.log(`\nBuilt ${out}`);
console.log(`Install: unzip it, then chrome://extensions -> Developer mode -> Load unpacked`);
console.log(`         -> select the "${FOLDER}" folder.`);
