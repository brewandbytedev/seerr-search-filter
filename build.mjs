import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const common = {
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  target: 'chrome110',
  sourcemap: true,
  logLevel: 'info',
};

// background.js (MV3 module service worker) and options.js (loaded via
// <script type="module">) can be real ESM output.
const esmBuild = {
  ...common,
  entryPoints: ['src/background.ts', 'src/options/options.ts'],
  format: 'esm',
};

// Content scripts injected via chrome.scripting.registerContentScripts run
// as classic (non-module) scripts, so they must not contain import/export
// statements at the top level.
const iifeBuild = {
  ...common,
  entryPoints: ['src/content/inject-main.ts', 'src/content/panel.ts'],
  format: 'iife',
};

function copyStaticFiles() {
  cpSync('manifest.json', 'dist/manifest.json');
  mkdirSync('dist/options', { recursive: true });
  cpSync('src/options/options.html', 'dist/options/options.html');
  cpSync('src/options/options.css', 'dist/options/options.css');
}

if (watch) {
  const [esmCtx, iifeCtx] = await Promise.all([esbuild.context(esmBuild), esbuild.context(iifeBuild)]);
  await Promise.all([esmCtx.watch(), iifeCtx.watch()]);
  copyStaticFiles();
  console.log('Watching for changes... (dist/ output, load unpacked in chrome://extensions)');
} else {
  await Promise.all([esbuild.build(esmBuild), esbuild.build(iifeBuild)]);
  copyStaticFiles();
  console.log('Build complete: dist/');
}
