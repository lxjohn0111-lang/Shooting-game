// Builds the CrazyGames upload package as ONE self-contained index.html:
// all JavaScript bundled with esbuild and inlined, the stylesheet inlined. Nothing is loaded by relative path,
// so the game works however the host serves or unpacks files (no folders, no MIME types for modules).
//
//   cd tools && npm install && npm run build:crazygames
//
// Output: crazygames/game/index.html and crazygames/vanta-protocol-crazygames.zip (index.html at the zip root).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'crazygames');
const gameDir = path.join(outDir, 'game');
const zipPath = path.join(outDir, 'vanta-protocol-crazygames.zip');

const res = await build({
  entryPoints: [path.join(root, 'js/main.js')], bundle: true, format: 'iife', minify: true, target: 'es2020',
  write: false, legalComments: 'eof', banner: { js: '"use strict";' }, logLevel: 'warning',
});
// an inline <script> ends at the first "</script": escape it (valid inside strings, templates and regexes)
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const swap = (re, make) => { const n = (html.match(re) || []).length; if (n !== 1) throw new Error(`expected exactly one match for ${re}, found ${n}`); html = html.replace(re, make); };
swap(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>\n${css}\n</style>`);
swap(/<script type="module" src="js\/main\.js"><\/script>/, () => `<script>\n${js}</script>`);

// sanity: nothing left that points at a local file
const local = html.match(/(?:src|href)="(?!https?:|data:|#)[^"]+"/g);
if (local) throw new Error('index.html still references local files: ' + local.join(', '));
if (!html.includes('https://sdk.crazygames.com/crazygames-sdk-v3.js')) throw new Error('CrazyGames SDK script tag missing');

fs.rmSync(gameDir, { recursive: true, force: true }); fs.mkdirSync(gameDir, { recursive: true });
fs.writeFileSync(path.join(gameDir, 'index.html'), html);
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-q', '-9', '-X', zipPath, 'index.html'], { cwd: gameDir });
const kb = (p) => Math.round(fs.statSync(p).size / 1024);
console.log(`built ${path.relative(root, zipPath)} (${kb(zipPath)} KB zipped, index.html ${kb(path.join(gameDir, 'index.html'))} KB, 1 file)`);
