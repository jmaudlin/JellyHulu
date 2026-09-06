/* ==========================================================================
   JellyHulu build
   Concatenates the CSS modules and JS modules into the shippable bundles in
   dist/, and generates the @font-face layer in two flavours.

   Run:  node build.mjs          build everything
         node build.mjs --check  build, then fail on any sanity problem

   esbuild is used for minification when it's installed; without it the build
   still produces working (unminified) output, so a fresh clone can build
   with no install at all.
   ========================================================================== */

import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_CSS = path.join(ROOT, 'src', 'css');
const SRC_JS = path.join(ROOT, 'src', 'js');
const FONTS = path.join(ROOT, 'fonts');
const DIST = path.join(ROOT, 'dist');

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

/* Where a self-hosted (non-embedded) font build should look for the files.
   Override with JH_FONT_BASE when serving them from somewhere else. */
const FONT_BASE = process.env.JH_FONT_BASE || '/web/jellyhulu/fonts';

const CHECK = process.argv.includes('--check');
const problems = [];
const fail = (msg) => { problems.push(msg); };

let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  console.warn('· esbuild not installed — writing unminified bundles only');
}

/* --------------------------------------------------------------------------
   Font layer
   -------------------------------------------------------------------------- */
const FONT_FACES = [
  { file: 'figtree-latin.woff2',            style: 'normal', range: 'latin' },
  { file: 'figtree-latin-ext.woff2',        style: 'normal', range: 'latin-ext' },
  { file: 'figtree-italic-latin.woff2',     style: 'italic', range: 'latin' },
  { file: 'figtree-italic-latin-ext.woff2', style: 'italic', range: 'latin-ext' },
];

const UNICODE_RANGES = {
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
    'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
    'U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, ' +
    'U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, ' +
    'U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
};

async function fontFace(face, embed, base) {
  const filePath = path.join(FONTS, face.file);
  if (!existsSync(filePath)) {
    fail(`missing font file: ${face.file}`);
    return '';
  }

  let src;
  if (embed) {
    const bytes = await readFile(filePath);
    src = `url("data:font/woff2;base64,${bytes.toString('base64')}") format("woff2")`;
  } else {
    src = `url("${base}/${face.file}") format("woff2")`;
  }

  return [
    '@font-face {',
    '  font-family: "Figtree";',
    `  font-style: ${face.style};`,
    '  font-weight: 300 900;',   // Figtree ships as a variable font
    '  font-display: swap;',
    `  src: ${src};`,
    `  unicode-range: ${UNICODE_RANGES[face.range]};`,
    '}',
  ].join('\n');
}

async function fontLayer(embed, base) {
  const header = [
    '/* ==========================================================================',
    '   JellyHulu — Figtree (SIL Open Font License 1.1)',
    '   Figtree by Erik D. Kennedy — https://github.com/erikdkennedy/figtree',
    '   Full licence text: fonts/Figtree-OFL.txt',
    embed
      ? '   Embedded as data URIs so the theme makes no external requests and'
      : `   Loaded from ${base} — the files in fonts/ must be served there.`,
    embed
      ? '   works on a LAN-only or air-gapped server.'
      : '   ',
    '   ========================================================================== */',
    '',
  ].join('\n');

  const faces = [];
  for (const face of FONT_FACES) faces.push(await fontFace(face, embed, base));
  return header + faces.filter(Boolean).join('\n\n') + '\n';
}

/* --------------------------------------------------------------------------
   CSS
   -------------------------------------------------------------------------- */
async function collect(dir, ext) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(ext)).sort();
  const out = [];
  for (const name of names) {
    out.push({ name, code: await readFile(path.join(dir, name), 'utf8') });
  }
  return out;
}

function banner(kind) {
  return [
    '/*!',
    ` * JellyHulu v${VERSION} — a Hulu-inspired theme for Jellyfin (${kind})`,
    ' * https://github.com/jmaudlin/JellyHulu',
    ' * Released under the MIT License.',
    ' * Bundled font: Figtree, SIL Open Font License 1.1.',
    ' *',
    ' * Not affiliated with, endorsed by, or connected to Hulu, LLC,',
    ' * The Walt Disney Company, or the Jellyfin project.',
    ' */',
    '',
  ].join('\n');
}

async function buildCss({ embedFonts, outName, label, fontBase = FONT_BASE }) {
  const modules = await collect(SRC_CSS, '.css');
  if (!modules.length) fail('no CSS modules found');

  const parts = [banner(label)];

  // 00-tokens must come first; the font layer sits between tokens and the
  // typography module that applies it.
  const tokens = modules.find((m) => m.name.startsWith('00-'));
  const rest = modules.filter((m) => m !== tokens);

  if (tokens) parts.push(tokens.code);
  parts.push(await fontLayer(embedFonts, fontBase));
  rest.forEach((m) => parts.push(`\n/* ── ${m.name} ${'─'.repeat(Math.max(0, 62 - m.name.length))} */\n`, m.code));

  const code = parts.join('\n');
  await writeFile(path.join(DIST, outName + '.css'), code, 'utf8');

  let min = code;
  if (esbuild) {
    const result = await esbuild.transform(code, {
      loader: 'css',
      minify: true,
      legalComments: 'inline',
    });
    min = result.code;
  }
  await writeFile(path.join(DIST, outName + '.min.css'), min, 'utf8');

  return { raw: code.length, min: min.length };
}

/* --------------------------------------------------------------------------
   JS
   -------------------------------------------------------------------------- */
async function buildJs() {
  const modules = await collect(SRC_JS, '.js');
  if (!modules.length) fail('no JS modules found');

  const body = modules
    .map((m) => `/* ── ${m.name} ${'─'.repeat(Math.max(0, 62 - m.name.length))} */\n${m.code}`)
    .join('\n');

  // One IIFE: nothing leaks into the page except the deliberate
  // window.JellyHulu surface set in 99-boot.
  const code = [
    banner('companion script'),
    '(function () {',
    "'use strict';",
    '',
    body.replace(/__VERSION__/g, VERSION),
    '',
    '})();',
    '',
  ].join('\n');

  await writeFile(path.join(DIST, 'jellyhulu.js'), code, 'utf8');

  let min = code;
  if (esbuild) {
    const result = await esbuild.transform(code, {
      loader: 'js',
      minify: true,
      target: 'es2020',
      legalComments: 'inline',
    });
    min = result.code;
  }
  await writeFile(path.join(DIST, 'jellyhulu.min.js'), min, 'utf8');

  return { raw: code.length, min: min.length };
}

/* --------------------------------------------------------------------------
   Sanity checks
   Cheap invariants that catch the mistakes that actually happen when hand
   editing a large stylesheet.
   -------------------------------------------------------------------------- */
async function sanity() {
  const css = await readFile(path.join(DIST, 'jellyhulu.css'), 'utf8');

  // Balanced braces.
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  if (open !== close) fail(`unbalanced braces in CSS: ${open} "{" vs ${close} "}"`);

  // Every var(--jh-*) must resolve to something declared somewhere. Comments
  // are stripped first — a property named in a doc comment is not a
  // declaration, and treating it as one hides exactly the bug this catches.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Set([...code.matchAll(/(--jh-[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...code.matchAll(/var\((--jh-[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  if (missing.length) fail(`CSS custom properties used but never declared: ${missing.join(', ')}`);

  // The font layer actually made it in.
  if (!css.includes('@font-face')) fail('no @font-face in the built CSS');

  const js = await readFile(path.join(DIST, 'jellyhulu.js'), 'utf8');
  if (js.includes('__VERSION__')) fail('version placeholder left in the JS bundle');
  if (esbuild) {
    // A parse error here is a syntax error in a source module.
    try {
      await esbuild.transform(js, { loader: 'js', minify: false });
    } catch (err) {
      fail('JS bundle does not parse: ' + err.message);
    }
  }
}

/* --------------------------------------------------------------------------
   Run
   -------------------------------------------------------------------------- */
await mkdir(DIST, { recursive: true });

const kb = (n) => (n / 1024).toFixed(1) + ' kB';

const full = await buildCss({
  embedFonts: true,
  outName: 'jellyhulu',
  label: 'stylesheet, fonts embedded',
});

const light = await buildCss({
  embedFonts: false,
  outName: 'jellyhulu-linked-fonts',
  label: 'stylesheet, fonts served from ' + FONT_BASE,
});

/* The plugin serves this stylesheet from <base>/JellyHulu/jellyhulu.css and
   the font files from <base>/JellyHulu/fonts/. A relative url() resolves
   against the stylesheet's own address, so "fonts/..." is correct whatever
   base path Jellyfin is mounted under — no absolute path to get wrong. */
const plugin = await buildCss({
  embedFonts: false,
  fontBase: 'fonts',
  outName: 'jellyhulu-plugin',
  label: 'stylesheet for the Jellyfin plugin',
});

const js = await buildJs();

await sanity();

console.log(`JellyHulu v${VERSION}`);
console.log(`  dist/jellyhulu.css                ${kb(full.raw)}  →  min ${kb(full.min)}`);
console.log(`  dist/jellyhulu-linked-fonts.css   ${kb(light.raw)}  →  min ${kb(light.min)}`);
console.log(`  dist/jellyhulu-plugin.css         ${kb(plugin.raw)}  →  min ${kb(plugin.min)}`);
console.log(`  dist/jellyhulu.js                 ${kb(js.raw)}  →  min ${kb(js.min)}`);

if (problems.length) {
  console.error('\nProblems:');
  problems.forEach((p) => console.error('  ✗ ' + p));
  if (CHECK) process.exit(1);
} else {
  console.log('\n  ✓ all checks passed');
}
