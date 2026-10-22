#!/usr/bin/env node
/**
 * Package the extension for addons.mozilla.org: only the files Firefox needs,
 * zipped with manifest.json at the root (docs/, scripts/ and store-assets/
 * live in this repo too, and don't belong in the upload).
 *
 * Usage:
 *   node scripts/build.js    # -> dist/mirrorly-firefox-v<version>.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(DIST, 'firefox');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ZIP_PATH = path.join(DIST, `mirrorly-firefox-v${manifest.version}.zip`);

const INCLUDE = [
  'manifest.json', 'icons',
  'background.js', 'background-agent.js', 'content.js', 'shared.js', 'styles.js', 'touch.js',
  'sidebar',
];

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.rmSync(ZIP_PATH, { force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const item of INCLUDE) {
  fs.cpSync(path.join(ROOT, item), path.join(OUT_DIR, item), {
    recursive: true,
    filter: (src) => path.basename(src) !== '.DS_Store',
  });
}

execSync(`zip -r -X "${ZIP_PATH}" .`, { cwd: OUT_DIR, stdio: 'ignore' });
console.log(`ready → ${path.relative(ROOT, ZIP_PATH)}`);
console.log(`unpacked copy → ${path.relative(ROOT, OUT_DIR)}/`);
